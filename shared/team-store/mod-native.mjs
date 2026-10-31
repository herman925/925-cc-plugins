import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {homedir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {normalizeActor,exact} from './src/api-domain.mjs';
import {refusal} from './src/errors.mjs';

const execute=promisify(execFile);
const deny=message=>{throw refusal('API_NATIVE_UNVERIFIED',message);};
// Windows Claude registry procStart is the process creation FILETIME, preserved
// as decimal text. A live PID alone can refer to a replacement process. Other
// hosts keep the explicit native-provider path until their registry creation
// fingerprint format has been verified; never guess a portable conversion.
async function processStart(pid) {
 if(process.platform!=='win32')return null;
 const {stdout}=await execute(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
  ['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`],
  {timeout:5000,maxBuffer:8192,windowsHide:true});
 const value=stdout.trim();return /^\d+$/.test(value)?value:null;
}
export async function createModNative({orcaCommand=process.env.ORCA_CLI_COMMAND||'orca',env=process.env}={},dependencies={}) {
 const cli=async args=>{
  const {stdout}=await (dependencies.execute??execute)(orcaCommand,[...args,'--json'],{env,timeout:15000,maxBuffer:2*1024*1024,windowsHide:true});
  const response=JSON.parse(stdout);if(response.ok!==true)deny('The native Orca command refused verification.');return response.result;
 };
 const status=await cli(['status']);
 const profile=env.ORCA_USER_DATA_PATH || (process.platform==='win32'?join(env.APPDATA||'', 'orca'):process.platform==='darwin'?join(homedir(),'Library','Application Support','orca'):join(env.XDG_CONFIG_HOME||join(homedir(),'.config'),'orca'));
 if(!isAbsolute(profile))deny('The current Orca profile is unverified.');
 const path=join(await realpath(profile),'orca-runtime.json');
 const metadata=JSON.parse(await readFile(path,'utf8'));
 if(metadata.pid!==status.app?.pid || metadata.runtimeId!==status.runtime?.runtimeId || !metadata.authToken)deny('Orca profile and native runtime disagree.');
 const transport=(metadata.transports??[metadata.transport]).find(t=>['unix','named-pipe'].includes(t?.kind));
 if(!transport || (transport.kind==='unix'?!isAbsolute(transport.endpoint):!transport.endpoint?.startsWith('\\\\.\\pipe\\')))deny('No verified local Orca transport.');
 const rpc=async(method,params)=>{
  if(!['session.tabs.list','terminal.show'].includes(method))deny('The Mod verifier permits read-only identity calls only.');
  const current=JSON.parse(await readFile(path,'utf8'));
  if(current.pid!==metadata.pid||current.runtimeId!==metadata.runtimeId||current.authToken!==metadata.authToken)deny('Orca runtime changed during verification.');
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),socket=createConnection(transport.endpoint);let buffer='',done=false;
   const end=(err,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();err?reject(err):resolve(result);};
   const timer=setTimeout(()=>end(refusal('API_NATIVE_UNVERIFIED','Native identity verification timed out.')),15000);
   socket.setEncoding('utf8');socket.on('error',()=>end(refusal('API_NATIVE_UNVERIFIED','Native identity connection failed.')));
   socket.on('close',()=>{if(!done)end(refusal('API_NATIVE_UNVERIFIED','Native identity connection closed.'));});
   socket.on('connect',()=>socket.write(JSON.stringify({id,authToken:metadata.authToken,method,params})+'\n'));
   socket.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>2*1024*1024)return end(refusal('API_NATIVE_UNVERIFIED','Native identity response is oversized.'));
    for(let cut;(cut=buffer.indexOf('\n'))>=0;){
     const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(!line.trim())continue;
     let value;try{value=JSON.parse(line);}catch{return end(refusal('API_NATIVE_UNVERIFIED','Malformed native identity response.'));}
     if(value._keepalive===true)continue;
     if(value.id!==id||value._meta?.runtimeId!==metadata.runtimeId||value.ok!==true)return end(refusal('API_NATIVE_UNVERIFIED','Native identity response was refused or changed.'));
     readFile(path,'utf8').then(text=>{const latest=JSON.parse(text);if(latest.runtimeId!==metadata.runtimeId||latest.pid!==metadata.pid||latest.authToken!==metadata.authToken)throw Error();end(null,value.result);}).catch(()=>end(refusal('API_NATIVE_UNVERIFIED','Native runtime changed before verification completed.')));
    }
   });
  });
 };
 const verify=async (input,caller=false)=>{
  exact(input,['projectRoot','conversationId','terminalHandle','contextId']);
  const terminal=(await rpc('terminal.show',{terminal:input.terminalHandle})).terminal;
  if(terminal?.handle!==input.terminalHandle||terminal.connected!==true||terminal.executionHostId!=='local'||terminal.worktreeId!==input.contextId||!terminal.incarnationId)deny('A complete current local terminal binding is required.');
  const root=await realpath(terminal.worktreePath);
  if(root!==await realpath(input.projectRoot))deny('Native terminal root conflicts with the project.');
  const workspace=input.contextId.startsWith('folder:')?input.contextId:`id:${input.contextId}`;
  const response=await rpc('session.tabs.list',{worktree:workspace});
  const matches=(response.tabs??[]).filter(tab=>tab.type==='terminal' && tab.agentStatus?.terminalHandle===input.terminalHandle);
  if(matches.length!==1 || matches[0].incarnationId!==terminal.incarnationId || matches[0].agentStatus?.agentType!=='claude')deny('Native terminal does not prove this exact Claude terminal and incarnation.');
  const providerId=matches[0].agentStatus?.providerSession?.id;
  if(providerId!==undefined && providerId!==input.conversationId)deny('Native terminal conflicts with this Claude conversation.');
  if(providerId===undefined && !caller)deny('Target binding requires an explicit native Claude conversation association.');
  const config=env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude');
  const registry=join(config,'sessions');let records=[];
  for(const name of await readdir(registry)){
   if(!/^\d+\.json$/.test(name))continue;
   try{const row=JSON.parse(await readFile(join(registry,name),'utf8'));if(row.sessionId===input.conversationId && Number.isSafeInteger(row.pid) && row.pid>0 && await realpath(row.cwd)===root){process.kill(row.pid,0);records.push(row);}}catch{}
  }
  if(records.length!==1)deny('The exact live local Claude conversation could not be verified.');
  if(caller && (env.ORCA_TERMINAL_HANDLE!==input.terminalHandle || env.ORCA_WORKTREE_ID!==input.contextId || records[0].pid!==process.ppid))deny('The private bridge is not a direct child of the verified Claude caller.');
  if(providerId===undefined){
   // Idle Orca projections omit providerSession. Only the actual hook child can
   // substitute its own OS parent + registry creation fingerprint. A requested
   // target, copied ID or terminal title cannot use this route.
   let birth;try{birth=await (dependencies.processStart??processStart)(process.ppid);}catch{}
   if(typeof records[0].procStart!=='string'||!/^\d+$/.test(records[0].procStart)||!birth||birth!==records[0].procStart)deny('The idle Claude caller process creation fingerprint is unverified.');
  }
  return normalizeActor({projectRoot:root,machineId:hostname(),provider:'claude',conversationId:input.conversationId,executionHostId:'local',contextId:input.contextId,terminalHandle:terminal.handle,incarnationId:terminal.incarnationId});
 };
 return Object.freeze({verify:input=>verify(input),verifyCaller:input=>verify(input,true)});
}
