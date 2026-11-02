// Trusted local host integration. No model request can select RPC methods,
// profiles or transport credentials through this module.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {homedir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {normalizeActor,exact} from './api-domain.mjs';
import {refusal} from './errors.mjs';

const execute=promisify(execFile);
const deny=message=>{throw refusal('API_NATIVE_UNVERIFIED',message);};
export async function createOrcaHost({orcaCommand=process.env.ORCA_CLI_COMMAND||'orca',env=process.env}={},dependencies={}) {
 const cli=async args=>{
  const {stdout}=await (dependencies.execute??execute)(orcaCommand,[...args,'--json'],{env,timeout:15000,maxBuffer:2*1024*1024,windowsHide:true});
  const response=JSON.parse(stdout);if(response.ok!==true)deny('The native Orca command refused verification.');return response.result;
 };
 const status=await cli(['status']);
 const profile=env.ORCA_USER_DATA_PATH || (process.platform==='win32'?join(env.APPDATA||'', 'orca'):process.platform==='darwin'?join(homedir(),'Library','Application Support','orca'):join(env.XDG_CONFIG_HOME||join(homedir(),'.config'),'orca'));
 if(!isAbsolute(profile))deny('The current Orca profile is unverified.');
 const path=join(await realpath(profile),'orca-runtime.json');
 const readMetadata=()=>dependencies.readMetadata?dependencies.readMetadata(path):readFile(path,'utf8');
 const metadata=JSON.parse(await readMetadata());
 if(metadata.pid!==status.app?.pid || metadata.runtimeId!==status.runtime?.runtimeId || !metadata.authToken)deny('Orca profile and native runtime disagree.');
 const transport=(metadata.transports??[metadata.transport]).find(t=>['unix','named-pipe'].includes(t?.kind));
 if(!transport || (transport.kind==='unix'?!isAbsolute(transport.endpoint):!transport.endpoint?.startsWith('\\\\.\\pipe\\')))deny('No verified local Orca transport.');
 const unchanged=text=>{const current=JSON.parse(text);return current.pid===metadata.pid&&current.runtimeId===metadata.runtimeId&&current.authToken===metadata.authToken;};
 const rpc=async(method,params)=>{
  if(!['session.tabs.list','terminal.show'].includes(method))deny('The host identity adapter permits read-only identity calls only.');
  if(!unchanged(await readMetadata()))deny('Orca runtime changed during verification.');
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),socket=(dependencies.connect??createConnection)(transport.endpoint);let buffer='',done=false,validating=false;
   const end=(err,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();err?reject(err):resolve(result);};
   const timer=setTimeout(()=>end(refusal('API_NATIVE_UNVERIFIED','Native identity verification timed out.')),15000);
   socket.setEncoding('utf8');socket.on('error',()=>end(refusal('API_NATIVE_UNVERIFIED','Native identity connection failed.')));
   socket.on('close',()=>{if(!done&&!validating)end(refusal('API_NATIVE_UNVERIFIED','Native identity connection closed.'));});
   socket.on('connect',()=>socket.write(JSON.stringify({id,authToken:metadata.authToken,method,params})+'\n'));
   socket.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>2*1024*1024)return end(refusal('API_NATIVE_UNVERIFIED','Native identity response is oversized.'));
    for(let cut;(cut=buffer.indexOf('\n'))>=0;){
     const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(!line.trim())continue;
     let value;try{value=JSON.parse(line);}catch{return end(refusal('API_NATIVE_UNVERIFIED','Malformed native identity response.'));}
     if(value._keepalive===true)continue;
     if(value.id!==id||value._meta?.runtimeId!==metadata.runtimeId||value.ok!==true)return end(refusal('API_NATIVE_UNVERIFIED','Native identity response was refused or changed.'));
     // A complete response may precede the peer's close while this async disk
     // read is pending. Keep the deadline and epoch check; only an incomplete
     // response treats close itself as failure.
     validating=true;
     readMetadata().then(text=>{if(!unchanged(text))throw Error();end(null,value.result);}).catch(()=>end(refusal('API_NATIVE_UNVERIFIED','Native runtime changed before verification completed.')));
    }
   });
  });
 };
 async function verifyTerminal(input,provider,{allowMissingClaudeSession=false}={}) {
  exact(input,['projectRoot','conversationId','terminalHandle','contextId']);
  for(const key of ['projectRoot','conversationId','terminalHandle','contextId'])if(!Object.hasOwn(input,key)||typeof input[key]!=='string'||!input[key])deny('Native references require four nonempty own string fields.');
  if(!['claude','codex'].includes(provider))deny('This provider has no verified local identity adapter.');
  const terminal=(await rpc('terminal.show',{terminal:input.terminalHandle})).terminal;
  if(terminal?.handle!==input.terminalHandle||terminal.connected!==true||terminal.executionHostId!=='local'||terminal.worktreeId!==input.contextId||!terminal.incarnationId)deny('A complete current local terminal binding is required.');
  const root=await realpath(terminal.worktreePath);
  if(root!==await realpath(input.projectRoot))deny('Native terminal root conflicts with the project.');
  const response=await rpc('session.tabs.list',{worktree:input.contextId.startsWith('folder:')?input.contextId:`id:${input.contextId}`});
  const matches=(response.tabs??[]).filter(tab=>tab.type==='terminal'&&tab.agentStatus?.terminalHandle===input.terminalHandle);
  if(matches.length!==1||matches[0].incarnationId!==terminal.incarnationId||matches[0].agentStatus?.agentType!==provider)deny('Native terminal does not prove this exact provider and incarnation.');
  const providerId=matches[0].agentStatus?.providerSession?.id;
  if(providerId!==input.conversationId&&!(provider==='claude'&&allowMissingClaudeSession&&providerId===undefined))deny('An explicit matching native provider conversation is required.');
  const actor=normalizeActor({projectRoot:root,machineId:hostname(),provider,conversationId:input.conversationId,executionHostId:'local',contextId:input.contextId,terminalHandle:terminal.handle,incarnationId:terminal.incarnationId});
  return {actor,terminal,tab:matches[0],hasProviderSession:providerId!==undefined};
 }
 return Object.freeze({cli,rpc,verifyTerminal,runtimeId:metadata.runtimeId,capabilities:Object.freeze([...(status.runtime?.capabilities??[])])});
}
