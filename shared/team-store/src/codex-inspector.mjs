// Read-only native metadata connection. Never starts/resumes a thread, sends a
// turn, loads its tools or responds to a native human request.
import {spawn} from 'node:child_process';
import {realpath} from 'node:fs/promises';
import {connectOwnedProviderRpc} from './provider-rpc.mjs';
import {refusal} from './errors.mjs';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function createCodexThreadInspector({codexExecutable,codexHome,projectRoot,env=process.env}={},dependencies={}){
 let child,rpc,initializing,closed=false;
 const denied=()=>refusal('API_NATIVE_SCOPE_UNVERIFIED','The native Codex thread project could not be verified. No conversation was resumed or approval inferred.');
 const start=async()=>{
  if(closed)throw denied();
  if(!initializing)initializing=(async()=>{
   child=(dependencies.spawn??spawn)(codexExecutable,['app-server','--listen','stdio://'],{cwd:projectRoot,env:{...env,CODEX_HOME:codexHome},windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr?.resume();
   rpc=connectOwnedProviderRpc({child,requestTimeoutMs:10000});
   await rpc.call('initialize',{clientInfo:{name:'team_scope_inspector',version:'0.1.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');
   if(rpc.pendingRequests().length)throw denied();
  })();
  await initializing;if(closed||!rpc?.alive())throw denied();return rpc;
 };
 return Object.freeze({async inspect(threadId){
  if(typeof threadId!=='string'||!uuid.test(threadId))throw denied();
  try{const connection=await start(),result=await connection.call('thread/read',{threadId,includeTurns:false});
   if(connection.pendingRequests().length||result.thread?.id!==threadId||typeof result.thread.cwd!=='string')throw denied();
   return {threadId,projectRoot:await realpath(result.thread.cwd)};
  }catch{throw denied();}
 },async close(){if(closed)return;closed=true;rpc?.disconnect();child?.stdin?.end();child?.kill();}});
}
