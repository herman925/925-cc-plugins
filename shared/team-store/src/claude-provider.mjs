import {readFile,readdir,lstat,realpath,mkdir,mkdtemp,writeFile,rename,rm} from 'node:fs/promises';
import {join,dirname,basename,isAbsolute,relative,sep} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {CLAUDE_SDK_VERSION} from './claude-driver.mjs';
import {CLAUDE_SDK_LOCK} from './claude-sdk-lock.mjs';
import {refusal} from './errors.mjs';
const exec=promisify(execFile),fail=message=>{throw refusal('API_CLAUDE_SETUP_REQUIRED',message);};
export const claudeProviderRoot=()=>join(homedir(),'.team-orchestrator','providers','claude');
async function inventory(root,base=root){
 const result=[];for(const entry of (await readdir(base,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=join(base,entry.name),name=relative(root,path).split(sep).join('/');if(base===root&&entry.name==='driver.json')continue;
  const info=await lstat(path);if(info.isSymbolicLink())fail('The private Claude driver contains a redirected file.');
  if(info.isDirectory())result.push(...await inventory(root,path));else if(info.isFile())result.push([name,createHash('sha256').update(await readFile(path)).digest('hex')]);else fail('The private Claude driver contains an unsupported filesystem object.');
 }return result;
}
const digest=rows=>createHash('sha256').update(JSON.stringify(rows)).digest('hex');
async function npmEntry(){
 const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules','npm','bin','npm-cli.js'),...(process.env.PATH??'').split(';').filter(Boolean).map(path=>join(path,'node_modules','npm','bin','npm-cli.js'))].filter(Boolean);
 for(const path of candidates)try{if(isAbsolute(path)&&basename(path)==='npm-cli.js'&&(await lstat(path)).isFile())return await realpath(path);}catch{}
 fail('A local Node npm installation is required to install the optional Claude component. No package script or shell shim was run.');
}
export async function inspectClaudeProvider({root=claudeProviderRoot()}={}){
 const directory=join(root,CLAUDE_SDK_VERSION);let receipt,present=false;
 try{const actual=await realpath(directory);present=true;if(actual!==directory||(await lstat(directory)).isSymbolicLink())fail('The private Claude driver is redirected.');const path=join(directory,'driver.json'),info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>65536)fail('Claude driver receipt is invalid.');receipt=JSON.parse(await readFile(path,'utf8'));}
 catch(error){if(error.code==='ENOENT'&&!present)return {state:'setup-required',version:CLAUDE_SDK_VERSION};if(error.code==='ENOENT')fail('An existing Claude driver directory has no complete owned receipt. It was not overwritten.');throw error;}
 if(receipt.format!=='925-claude-provider'||receipt.version!==CLAUDE_SDK_VERSION||typeof receipt.digest!=='string'||!isAbsolute(receipt.executable??''))fail('The private Claude driver receipt is invalid.');
 if(digest(await inventory(directory))!==receipt.digest)fail('The private Claude driver changed; it was not loaded or overwritten.');
 const sdkModule=join(directory,'node_modules','@anthropic-ai','claude-agent-sdk','sdk.mjs'),manifest=JSON.parse(await readFile(join(dirname(sdkModule),'package.json'),'utf8'));
 if(manifest.name!=='@anthropic-ai/claude-agent-sdk'||manifest.version!==CLAUDE_SDK_VERSION)fail('Claude SDK version differs from its reviewed install.');
 return {state:'available',version:CLAUDE_SDK_VERSION,sdkModule,executable:await realpath(receipt.executable),directory,digest:receipt.digest};
}
export async function findClaudeExecutable({executable,env=process.env}={}){
 const candidates=executable?[executable]:[join(homedir(),'.local','bin','claude.exe'),...(env.PATH??'').split(';').filter(Boolean).map(path=>join(path,'claude.exe'))];
 for(const candidate of candidates)try{
  if(!isAbsolute(candidate)||!/^claude(?:\.exe)?$/i.test(basename(candidate)))continue;const path=await realpath(candidate),value=await exec(path,['--version'],{windowsHide:true,timeout:5000,maxBuffer:8192});
  if(/^\d+\.\d+\.\d+ \(Claude Code\)/.test(value.stdout.trim()))return {executable:path,nativeVersion:value.stdout.trim()};
 }catch{}fail('A native Claude Code executable is required. Install Claude Code or select its absolute executable through the setup preview.');
}
export async function prepareClaudeProvider(options={},dependencies={}){
 const root=options.root??claudeProviderRoot();if(!isAbsolute(root))fail('The optional Claude driver needs an absolute private directory.');
 const before=await inspectClaudeProvider({root});if(before.state==='available')return {root,noop:true,summary:{state:'installed',version:CLAUDE_SDK_VERSION,directory:before.directory,digest:before.digest,changes:[],teamStoreChanged:false,globalConfigurationChanged:false}};
 const native=await (dependencies.findExecutable??findClaudeExecutable)(options);
 return {root,executable:native.executable,summary:{state:'preview',version:CLAUDE_SDK_VERSION,nativeVersion:native.nativeVersion,directory:join(root,CLAUDE_SDK_VERSION),changes:[`Install optional @anthropic-ai/claude-agent-sdk@${CLAUDE_SDK_VERSION} and its dependencies in the private provider directory; package scripts and optional native downloads are disabled.`, 'Use the verified existing native Claude executable; preserve native project hooks, settings and permission modes.'],teamStoreChanged:false,globalConfigurationChanged:false,launchesWorkers:false}};
}
export async function applyClaudeProvider(plan,dependencies={}){
 if(plan.noop)return plan.summary;
 await mkdir(plan.root,{recursive:true,mode:0o700});const root=await realpath(plan.root);if(root!==plan.root||(await lstat(root)).isSymbolicLink())fail('The private Claude provider root is redirected.');
 const existing=await inspectClaudeProvider({root});if(existing.state==='available')return existing;
 const stage=await mkdtemp(join(root,'.prepare-'));let moved=false;
 try{
  await writeFile(join(stage,'package.json'),JSON.stringify({name:'925-private-claude-driver',private:true,version:'1.0.0',dependencies:{'@anthropic-ai/claude-agent-sdk':CLAUDE_SDK_VERSION}}));await writeFile(join(stage,'package-lock.json'),JSON.stringify(CLAUDE_SDK_LOCK));
  if(dependencies.install)await dependencies.install(stage);
  else{
   const npm=await npmEntry();
   await exec(process.execPath,[npm,'ci','--prefix',stage,'--ignore-scripts','--omit=optional','--no-audit','--no-fund'],{cwd:stage,windowsHide:true,timeout:180000,maxBuffer:1024*1024});
  }
  const module=join(stage,'node_modules','@anthropic-ai','claude-agent-sdk','sdk.mjs'),manifest=JSON.parse(await readFile(join(dirname(module),'package.json'),'utf8'));await realpath(module);
  if(manifest.name!=='@anthropic-ai/claude-agent-sdk'||manifest.version!==CLAUDE_SDK_VERSION)fail('The downloaded Claude SDK does not match the reviewed package version.');
  const hash=digest(await inventory(stage));await writeFile(join(stage,'driver.json'),JSON.stringify({format:'925-claude-provider',version:CLAUDE_SDK_VERSION,executable:plan.executable,digest:hash}),{flag:'wx',mode:0o600});
  const target=join(root,CLAUDE_SDK_VERSION);if(dirname(target)!==root)fail('Unexpected provider installation target.');await rename(stage,target);moved=true;
  return {...await inspectClaudeProvider({root}),teamStoreChanged:false,globalConfigurationChanged:false,launchesWorkers:false};
 }finally{
  if(!moved){const actual=await realpath(stage).catch(()=>null);if(actual&&dirname(actual)===root&&basename(actual).startsWith('.prepare-'))await rm(actual,{recursive:true,force:true});}
 }
}
