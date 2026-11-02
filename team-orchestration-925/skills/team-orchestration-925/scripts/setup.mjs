// Keep legacy 925-to receipt/recovery names stable across the package rename.
// Project-local setup. Codex's native TOML writer/parser runs only in disposable
// staging; no home/global configuration is ever passed as its writable target.
import {readFile,writeFile,mkdir,mkdtemp,realpath,lstat,rename,unlink,rm,open} from 'node:fs/promises';
import {join,dirname,basename,resolve,relative,isAbsolute,sep} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createOrcaHost} from './runtime/src/orca-host.mjs';
const exec=promisify(execFile),serverName='team_orchestrator',version='0.1.1';
const hash=v=>v===null?null:createHash('sha256').update(v).digest('hex');
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
const digest=v=>hash(JSON.stringify(ordered(v)));
const guard={type:'mcp_tool',server:serverName,tool:'team_guard',input:{tool:'${tool_name}',input:'${tool_input}'},timeout:30,statusMessage:'Checking team permissions'};
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
async function bytes(path){try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2*1024*1024)fail('SETUP_PATH_REFUSED','Setup targets must be bounded regular files, not links.');return await readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function paths(options){
 const root=await realpath(options.projectRoot||process.cwd()),dir=join(root,'.codex');
 try{const stat=await lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())fail('SETUP_PATH_REFUSED','The project Codex directory must be a real directory.');}catch(e){if(e.code!=='ENOENT')throw e;}
 const state=resolve(options.stateRoot||join(process.env.CODEX_HOME||join(homedir(),'.codex'),'925-to','installations'));
 return {root,dir,state:join(state,hash(root)),files:{config:join(dir,'config.toml'),hooks:join(dir,'hooks.json'),receipt:join(dir,'925-to-installation.json')}};
}
export async function discoverCodexExecutable(){
 if(process.platform!=='win32')fail('SETUP_HOST_UNSUPPORTED','The native Codex adapter currently supports Windows Orca terminals.');
 const script=`$toCursor=${process.ppid}; for($toAttempt=0;$toAttempt -lt 8;$toAttempt++){ $toProcess=Get-Process -Id $toCursor -ErrorAction Stop; if([IO.Path]::GetFileName($toProcess.Path) -ieq 'codex.exe'){ [Console]::Write($toProcess.Path); exit 0 }; $toCursor=(Get-CimInstance Win32_Process -Filter "ProcessId=$toCursor" -ErrorAction Stop).ParentProcessId }; throw 'No native Codex ancestor'`;
 try{const r=await exec(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,maxBuffer:8192});return await realpath(r.stdout.trim());}
 catch{fail('SETUP_CODEX_NOT_FOUND','Run setup from a native Codex session; no native Codex ancestor could be verified.');}
}
async function native(bin,args,stage){
 try{const result=await exec(bin,args,{cwd:stage,env:{...process.env,CODEX_HOME:stage},windowsHide:true,timeout:15000,maxBuffer:2*1024*1024});return result.stdout;}
 catch{fail('SETUP_CONFIG_INVALID','Codex could not validate the staged configuration. Existing project/global files were not changed.');}
}
function mergedHooks(original,receipt,remove){
 let doc;try{doc=original===null?{hooks:{}}:JSON.parse(original.toString('utf8'));}catch{fail('SETUP_CONFIG_INVALID','Existing project hooks are not valid JSON.');}
 if(!doc||typeof doc!=='object'||Array.isArray(doc)||doc.hooks!==undefined&&(typeof doc.hooks!=='object'||Array.isArray(doc.hooks)||doc.hooks===null))fail('SETUP_CONFIG_INVALID','Existing hooks have an unsupported shape.');
 doc.hooks??={};const groups=doc.hooks.PreToolUse??[];if(!Array.isArray(groups))fail('SETUP_CONFIG_INVALID','PreToolUse must be an array.');
 let found=0;
 const next=groups.map(group=>{
  if(!Array.isArray(group.hooks))fail('SETUP_CONFIG_INVALID','Each hook group must have a hooks array.');
  const handlers=group.hooks.filter(h=>{
   if(h.type!=='mcp_tool'||h.server!==serverName||h.tool!=='team_guard')return true;
   const signature=digest({matcher:group.matcher,handler:h});
   if(!receipt||signature!==receipt.guardHash)fail('SETUP_UNOWNED','An existing or modified team hook is not owned by this setup. Review it before replacing it.');
   found++;return false;
  });return {...group,hooks:handlers};
 }).filter(g=>g.hooks.length);
 if(receipt?.phase==='installed'&&found!==1)fail('SETUP_CHANGED','The installed team hook was removed or duplicated. Review it before updating.');
 if(!remove)next.push({matcher:'*',hooks:[guard]});
 if(next.length)doc.hooks.PreToolUse=next;else delete doc.hooks.PreToolUse;
 if(remove&&receipt.hooksCreated&&Object.keys(doc.hooks).length===0&&Object.keys(doc).every(k=>k==='hooks'))return null;
 return Buffer.from(JSON.stringify(doc,null,2)+'\n');
}
async function verifySetupHost(project){
 const env=process.env,conversationId=env.CODEX_THREAD_ID||env.CODEX_SESSION_ID;
 if(!env.ORCA_TERMINAL_HANDLE||!env.ORCA_WORKTREE_ID||!conversationId)fail('SETUP_HOST_UNSUPPORTED','Run setup inside the intended Orca-hosted Codex session. Its native scope could not be discovered.');
 try{const host=await createOrcaHost();await host.verifyTerminal({projectRoot:project,conversationId,terminalHandle:env.ORCA_TERMINAL_HANDLE,contextId:env.ORCA_WORKTREE_ID},'codex');}
 catch{fail('SETUP_HOST_UNVERIFIED','Orca could not verify this Codex conversation in the selected project. No project configuration was changed.');}
}
async function nativeProjectRoot(){
 if(!process.env.ORCA_TERMINAL_HANDLE||!process.env.ORCA_WORKTREE_ID)fail('SETUP_HOST_UNSUPPORTED','Setup requires the intended Orca-hosted Codex session.');
 try{const host=await createOrcaHost(),{terminal}=await host.rpc('terminal.show',{terminal:process.env.ORCA_TERMINAL_HANDLE});if(terminal.worktreeId!==process.env.ORCA_WORKTREE_ID)throw Error('Scope changed.');return await realpath(terminal.worktreePath);}
 catch{fail('SETUP_HOST_UNVERIFIED','The current Orca project could not be discovered. No configuration was changed.');}
}
export async function prepareSetup(options={},dependencies={}){
 const p=await paths(options),before=Object.fromEntries(await Promise.all(Object.entries(p.files).map(async([k,path])=>[k,await bytes(path)])));
 let receipt;try{receipt=before.receipt?JSON.parse(before.receipt):null;}catch{fail('SETUP_CONFIG_INVALID','The setup receipt is malformed.');}
 if(receipt&&receipt.project!==p.root)fail('SETUP_SCOPE','The setup receipt belongs to another project.');
 if(receipt?.phase==='prepared')fail('SETUP_RECOVERY_REQUIRED','A setup was interrupted. Run recover before making another change.');
 const installed=receipt?.phase==='installed'?receipt:null,remove=options.action==='remove';
 if(remove&&!installed)return {noop:true,summary:{project:p.root,status:'not-installed',changes:[]}};
 if(!remove)await (dependencies.verifyHost??verifySetupHost)(p.root);
 const bin=options.codexExecutable||await discoverCodexExecutable(),temp=await realpath(tmpdir()),stage=await mkdtemp(join(temp,'925-to-setup-'));
 try{
  if(before.config!==null)await writeFile(join(stage,'config.toml'),before.config,{mode:0o600});
  const list=JSON.parse(await native(bin,['mcp','list','--json'],stage)),existing=list.find(s=>s.name===serverName);
  if(existing){const current=JSON.parse(await native(bin,['mcp','get',serverName,'--json'],stage));if(!installed||digest(current)!==installed.serverHash)fail('SETUP_UNOWNED','The project already has an unowned or modified team MCP server. It was not replaced.');}
  else if(installed)fail('SETUP_CHANGED','The installed MCP server was removed. Review its configuration before updating.');
  if(existing)await native(bin,['mcp','remove',serverName],stage);
  let server=null;
  if(!remove){
   const adapter=await realpath(options.adapter||fileURLToPath(new URL('./runtime/codex-mcp.mjs',import.meta.url))),node=await realpath(options.node||process.execPath);
   await native(bin,['mcp','add',serverName,'--env',`TEAM_PROJECT_ROOT=${p.root}`,'--',node,adapter],stage);
   let config=await readFile(join(stage,'config.toml'),'utf8');const header='[mcp_servers.team_orchestrator]';if(config.split(header).length!==2)fail('SETUP_CONFIG_INVALID','Codex emitted an unexpected server table.');
   config=config.replace(header,header+'\nenv_vars = ["ORCA_TERMINAL_HANDLE", "ORCA_WORKTREE_ID", "ORCA_USER_DATA_PATH", "ORCA_CLI_COMMAND", "CODEX_HOME"]\ntool_timeout_sec = 300');
   await writeFile(join(stage,'config.toml'),config,{mode:0o600});server=JSON.parse(await native(bin,['mcp','get',serverName,'--json'],stage));
  }
  let config=await bytes(join(stage,'config.toml'));if(remove&&installed.configCreated&&(!config||!config.toString().trim()))config=null;
  const hooks=mergedHooks(before.hooks,installed,remove),next={phase:remove?'removed':'installed',version,project:p.root,serverHash:server?digest(server):null,guardHash:digest({matcher:'*',handler:guard}),configCreated:installed?.configCreated??before.config===null,hooksCreated:installed?.hooksCreated??before.hooks===null};
  return {paths:p,before,after:{config,hooks,receipt:Buffer.from(JSON.stringify(next,null,2)+'\n')},summary:{project:p.root,status:remove?'remove-ready':'setup-ready',changes:[remove?'Remove owned project MCP server and team hook':'Configure project MCP server and native team hook'],globalConfigurationChanged:false,teamStoreChanged:false,hookTrustGranted:false,requiresReconnect:!remove,requiresNativeHookReview:!remove}};
 }finally{
  if(dirname(stage)!==temp||!basename(stage).startsWith('925-to-setup-'))throw Error('Refusing unexpected staging cleanup.');
  await rm(stage,{recursive:true,force:true});
 }
}
async function atomic(path,value){
 if(value===null){await unlink(path).catch(e=>{if(e.code!=='ENOENT')throw e;});return;}
 const temporary=`${path}.925-to-${randomUUID()}.tmp`;await writeFile(temporary,value,{flag:'wx',mode:0o600});await rename(temporary,path);
}
async function setupLock(path){
 try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())fail('SETUP_PATH_REFUSED','The setup lock must be a regular local file.');}catch(e){if(e.code!=='ENOENT')throw e;}
 if(process.platform!=='win32')fail('SETUP_HOST_UNSUPPORTED','Native setup locking is currently verified on Windows only.');
 return new Promise((resolve,reject)=>{
  const child=spawn(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./setup-lock.ps1',import.meta.url)),'-LiteralPath',path],{windowsHide:true,stdio:['pipe','pipe','ignore']});
  let ready=false,buffer='';const exited=new Promise(done=>child.once('exit',done));
  const timer=setTimeout(()=>{child.kill();reject(Object.assign(Error('Setup lock did not answer.'),{code:'SETUP_BUSY'}));},5000);
  child.on('error',()=>{clearTimeout(timer);reject(Object.assign(Error('Native setup lock failed.'),{code:'SETUP_BUSY'}));});
  child.once('exit',()=>{if(!ready){clearTimeout(timer);reject(Object.assign(Error('Another setup process holds the project lock.'),{code:'SETUP_BUSY'}));}});
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{buffer+=chunk;if(!ready&&buffer.includes('locked')){ready=true;clearTimeout(timer);resolve({close:async()=>{child.stdin.end();const stop=setTimeout(()=>child.kill(),3000);await exited;clearTimeout(stop);}});}});
 });
}
export async function applySetup(plan,{afterWrite}={}){
 if(plan.noop)return plan.summary;
 const {paths:p,before,after}=plan;await mkdir(p.dir,{recursive:true});await paths({projectRoot:p.root,stateRoot:dirname(p.state)});
 const lockPath=join(p.dir,'925-to-install.lock'),lock=await setupLock(lockPath);
 try{
  for(const [key,path] of Object.entries(p.files))if(hash(await bytes(path))!==hash(before[key]))fail('SETUP_CHANGED','Project configuration changed during setup preview. Preview again.');
  await mkdir(p.state,{recursive:true,mode:0o700});const canonicalState=await realpath(p.state),stateRelation=relative(p.root,canonicalState);if(canonicalState.toLowerCase()!==p.state.toLowerCase()||stateRelation===''||stateRelation!=='..'&&!stateRelation.startsWith('..'+sep)&&!isAbsolute(stateRelation)||(await lstat(p.state)).isSymbolicLink())fail('SETUP_PATH_REFUSED','The private recovery directory must not be redirected.');
  const transaction=randomUUID(),backup={project:p.root,transaction,before:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v===null?null:v.toString('base64')])),afterHashes:Object.fromEntries(Object.entries(after).map(([k,v])=>[k,hash(v)]))};
  const backupPath=join(p.state,`${transaction}.json`),file=await open(backupPath,'wx',0o600);try{await file.writeFile(JSON.stringify(backup));await file.sync();}finally{await file.close();}
  await atomic(p.files.receipt,Buffer.from(JSON.stringify({phase:'prepared',version,project:p.root,transaction})+'\n'));
  let count=0;for(const key of ['config','hooks']){if(hash(await bytes(p.files[key]))!==hash(before[key]))fail('SETUP_CHANGED','A setup target changed independently; it was not overwritten.');await atomic(p.files[key],after[key]);await afterWrite?.(++count);}
  await atomic(p.files.receipt,after.receipt);return {...plan.summary,status:'complete'};
 }catch(e){if(e.code==='SETUP_CHANGED'||e.code==='SETUP_PATH_REFUSED')throw e;fail('SETUP_RECOVERY_REQUIRED','Setup did not finish. Its private backup/journal was retained; run recover before retrying.');}
 finally{await lock.close();}
}
export async function recoverSetup(options={}){
 const p=await paths(options),value=await bytes(p.files.receipt);if(value===null)return {status:'nothing-to-recover'};
 const receipt=JSON.parse(value);if(receipt.phase!=='prepared')return {status:'nothing-to-recover'};
 if(receipt.project!==p.root||!(/^[a-f0-9-]{36}$/).test(receipt.transaction))fail('SETUP_SCOPE','Invalid recovery identity.');
 const backupPath=join(p.state,`${receipt.transaction}.json`),backup=JSON.parse((await bytes(backupPath)).toString());if(backup.project!==p.root||backup.transaction!==receipt.transaction)fail('SETUP_SCOPE','Recovery backup scope disagrees.');
 const lockPath=join(p.dir,'925-to-install.lock'),lock=await setupLock(lockPath);
 try{
  for(const key of ['config','hooks']){const value=await bytes(p.files[key]),original=backup.before[key]===null?null:Buffer.from(backup.before[key],'base64');if(hash(value)!==hash(original)&&hash(value)!==backup.afterHashes[key])fail('SETUP_CHANGED','A setup target changed independently. Recovery refused to overwrite it.');}
  if(hash(await bytes(p.files.receipt))!==hash(value))fail('SETUP_CHANGED','Recovery receipt changed.');
  for(const key of ['config','hooks','receipt'])await atomic(p.files[key],backup.before[key]===null?null:Buffer.from(backup.before[key],'base64'));
  return {status:'recovered',project:p.root};
 }finally{await lock.close();}
}
export async function diagnoseSetup(options={}){
 const p=await paths(options),receipt=await bytes(p.files.receipt);return {project:p.root,platform:process.platform,orcaEnvironmentPresent:Boolean(process.env.ORCA_TERMINAL_HANDLE&&process.env.ORCA_WORKTREE_ID),installation:receipt?JSON.parse(receipt).phase:'not-installed',hookTrust:'requires-native-review',globalConfigurationChanged:false,teamStoreChanged:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const action=process.argv[2]||'preview';
 try{
  const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||major===22&&minor<13)fail('SETUP_NODE_UNSUPPORTED','Node 22.13 or newer is required.');
  if(!['preview','apply','remove','recover','diagnose'].includes(action))fail('SETUP_INPUT','Use preview, apply, remove, recover or diagnose.');
  const options={projectRoot:['preview','apply'].includes(action)?await nativeProjectRoot():process.cwd(),action};
  const result=action==='diagnose'?await diagnoseSetup(options):action==='recover'?await recoverSetup(options):await (async()=>{const plan=await prepareSetup(options);return action==='preview'?plan.summary:applySetup(plan);})();
  console.log(JSON.stringify(result));
 }catch(e){console.log(JSON.stringify({ok:false,error:{code:e.code||'SETUP_REFUSED',message:e.code?e.message:'Project setup was refused; existing configuration was preserved.'}}));process.exitCode=1;}
}
