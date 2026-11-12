// Owned official SDK connection. No session discovery/adoption, permission-mode
// override, automatic human answer or model-supplied identity is accepted here.
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile,realpath} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectWindowsProcess} from './windows-native.mjs';
import {refusal} from './errors.mjs';
import {reviewedTeamTools} from './managed-head.mjs';
export const CLAUDE_SDK_VERSION='0.3.322';
export function ownedClaudeEnvironment(input){const env={...input};for(const key of Object.keys(env))if(/^(?:ORCA_|TEAM_|CODEX_(?:THREAD|SESSION)_ID$|CLAUDE_(?:SESSION_ID|CODE_SESSION_ID)$)/i.test(key))delete env[key];return env;}
const unavailable=()=>refusal('API_CLAUDE_CONNECTION_UNVERIFIED','The exact owned Claude execution is unavailable. Preserve the original request; no replacement or input replay is allowed.');
export async function openOwnedClaudeDriver({sdkModule,executable,projectRoot,sessionId,env=process.env,model='default',effort='default',tools,onTool,onGuard,workerAccess},dependencies={}){
 const modulePath=await realpath(sdkModule),packageInfo=JSON.parse(await readFile(join(dirname(modulePath),'package.json'),'utf8'));
 if(packageInfo.name!=='@anthropic-ai/claude-agent-sdk'||packageInfo.version!==CLAUDE_SDK_VERSION)throw refusal('API_CLAUDE_DRIVER_UNSUPPORTED',`The reviewed official Claude SDK ${CLAUDE_SDK_VERSION} is required.`);
 const sdk=await (dependencies.loadSdk??(url=>import(url)))(pathToFileURL(modulePath).href),z=(dependencies.loadZod??(path=>createRequire(pathToFileURL(path))('zod')))(modulePath),root=await realpath(projectRoot),binary=await realpath(executable);
 const queue=[],waiters=[],replays=new Map(),requests=new Map();let child,birth,warm,query,reader,closed=false,metadata=null,idle=true,error=null,serial=Promise.resolve(),results=0;
 const processCurrent=async()=>{if(closed||!child||child.exitCode!==null||child.killed)throw unavailable();const value=await (dependencies.inspectProcess??inspectWindowsProcess)(child.pid);if(value.pid!==child.pid||value.createdAt!==birth||await realpath(value.executable)!==binary)throw unavailable();return value;};
 const nativeCurrent=async()=>{await processCurrent();if(!metadata||metadata.sessionId!==sessionId||metadata.projectRoot!==root||error)throw unavailable();return structuredClone(metadata);};
 const settleError=reason=>{error=reason;idle=false;for(const row of replays.values())row.reject(unavailable());replays.clear();for(const row of requests.values())row.reject(unavailable());requests.clear();};
 const requestHuman=(method,params,signal)=>new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(Object.assign(Error('The native Claude request was cancelled.'),{code:'API_NATIVE_REQUEST_CANCELLED'}));return;}
  const id=randomUUID(),row={id,method,params:{threadId:sessionId,...structuredClone(params)}};requests.set(id,{row,resolve,reject});
  // Native cancellation is a cancelled wait, never an invented human answer.
  signal?.addEventListener('abort',()=>{if(requests.delete(id))reject(Object.assign(Error('The native Claude request was cancelled.'),{code:'API_NATIVE_REQUEST_CANCELLED'}));},{once:true});
 });
 const input={async *[Symbol.asyncIterator](){while(!closed){if(!queue.length)await new Promise(resolve=>waiters.push(resolve));if(closed)break;while(queue.length)yield queue.shift();}}};
 const teamTools=reviewedTeamTools(workerAccess),server=sdk.createSdkMcpServer({name:'team_orchestrator',version:'1.0.0',tools:tools.filter(row=>teamTools.includes(row.name)).map(row=>{
  const schema=z.fromJSONSchema(row.inputSchema);if(!schema.shape)throw Error('A typed worker tool object is required.');
  return sdk.tool(row.name,row.description,schema.shape,async(args,extra)=>{
   // Keep a management proposal pending in this owned execution until the
   // person-facing controller opens its real native form. No SDK request timer
   // expires it, and no worker/model argument supplies the eventual answer.
   try{await nativeCurrent();const value=await onTool(row.name,args,{canElicit:true,elicit:params=>requestHuman('team/review/request',params,extra?.signal)});return {content:[{type:'text',text:JSON.stringify(value)}]};}
   catch(failure){return {isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:{code:/^(?:API_|STORE_)[A-Z_]+$/.test(failure.code??'')?failure.code:'API_WORKER_UNVERIFIED',message:/^(?:API_|STORE_)/.test(failure.code??'')?failure.message:'Worker authority or operation could not be verified.'}})}]};}
  });
 })});
 try{
  const options={cwd:root,env:ownedClaudeEnvironment(env),sessionId,pathToClaudeCodeExecutable:binary,settingSources:['user','project','local'],
   extraArgs:{'replay-user-messages':null},mcpServers:{team_orchestrator:server},allowedTools:teamTools.map(name=>'mcp__team_orchestrator__'+name),
   hooks:{PreToolUse:[{onFailure:'block',hooks:[async value=>{await nativeCurrent();if(value.session_id!==sessionId||await realpath(value.cwd)!==root)throw unavailable();if(value.agent_id&&/^mcp__team_orchestrator__/.test(value.tool_name))return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'A subagent has no independent team-member binding. Return its findings to its owning conversation.'}};return onGuard({tool:value.tool_name,input:value.tool_input});}]}]},
   canUseTool:async(toolName,args,context)=>{if(metadata)await nativeCurrent();return requestHuman('claude/permission/request',{toolName,input:args,toolUseId:context.toolUseID??null},context.signal);},
   onElicitation:async(request,context)=>{if(metadata)await nativeCurrent();return requestHuman('mcpServer/elicitation/request',request,context?.signal);},
   spawnClaudeCodeProcess:options=>{
    if(child||options.command!==binary||options.cwd!==root)throw unavailable();
    // The SDK may merge process.env back into its options. Fence inherited
    // controller identity again at the final native process-creation boundary.
    child=(dependencies.spawn??spawn)(options.command,options.args,{cwd:root,env:ownedClaudeEnvironment(options.env),signal:options.signal,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr?.resume();child.on('exit',()=>{if(!closed)settleError('native-process-exited');});child.on('error',()=>{if(!closed)settleError('native-process-error');});return child;
   },
  };
  if(model!=='default')options.model=model;if(effort!=='default')options.effort=effort;
  // A pending native request has no deadline. The startup convenience API
  // closes its process on an initialization timeout, so use the streaming
  // query directly with an empty input queue until initialization is proven.
  query=sdk.query({prompt:input,options});const initialized=await query.initializationResult();
  const owner=await (dependencies.inspectProcess??inspectWindowsProcess)(child.pid);if(owner.pid!==child.pid||await realpath(owner.executable)!==binary||typeof owner.createdAt!=='string')throw unavailable();birth=owner.createdAt;
  if(initialized.hooks_applied!==true)throw refusal('API_CLAUDE_GUARD_UNVERIFIED','Claude did not attest the registered fail-closed worker hooks. No model input was sent.');
  reader=(async()=>{for await(const message of query){
   if(closed)break;
   if(message.type==='system'&&message.subtype==='init'){
    if(message.session_id!==sessionId||await realpath(message.cwd)!==root)throw unavailable();
    metadata={sessionId:message.session_id,projectRoot:root,permissionMode:message.permissionMode,nativeVersion:initialized.claude_code_version};
   }
   if(message.session_id&&message.session_id!==sessionId&&message.parent_tool_use_id==null)throw unavailable();
   if(message.type==='user'&&message.isReplay===true){const pending=replays.get(message.uuid);if(pending){if(message.session_id!==sessionId||JSON.stringify(message.message)!==JSON.stringify(pending.message.message))throw unavailable();pending.resolve(message);replays.delete(message.uuid);}}
   if(message.type==='result'){results++;idle=true;}
  }if(!closed)settleError('native-stream-ended');})().catch(()=>{if(!closed)settleError('native-stream-unverified');});
  await processCurrent();
 }catch(failure){
  // The manager retains any spawned child on an uncertain preparation. Expose
  // only a private retained handle for explicit owner shutdown, never retry it.
  failure.retainedClaude={child,warm,query,reader};throw failure;
 }
 return Object.freeze({
  process:()=>({pid:child.pid,birth,executable:binary}),
  async verifyProcess(){return processCurrent();},
  async verifyNative(){return nativeCurrent();},
  async state(){await processCurrent();return {sessionId:metadata?.sessionId??sessionId,projectRoot:root,idle,pendingReview:requests.size>0,nativeVerified:metadata!==null,error,results,...(metadata?{permissionMode:metadata.permissionMode,nativeVersion:metadata.nativeVersion}:{})};},
  enqueue(message,{bootstrap=false}={}){
   const execute=async()=>{
    await processCurrent();if(!bootstrap)await nativeCurrent();
    if(error||!idle||requests.size||replays.size||message.type!=='user'||message.session_id!==sessionId||typeof message.uuid!=='string'||!message.uuid||message.parent_tool_use_id!==null)throw unavailable();
    // Flip state before yielding into the owned input iterable, so concurrent
    // sends cannot both observe the same idle receiver.
    idle=false;const receipt=new Promise((resolve,reject)=>replays.set(message.uuid,{resolve,reject,message:structuredClone(message)}));queue.push(structuredClone(message));waiters.splice(0).forEach(resolve=>resolve());return receipt;
   };
   const work=serial.then(execute);serial=work.catch(()=>{});return work;
  },
  pending(){return [...requests.values()].map(value=>structuredClone(value.row));},
  async respond({requestId,expected,result}){await nativeCurrent();const pending=requests.get(requestId);if(!pending||JSON.stringify(pending.row)!==JSON.stringify(expected))throw unavailable();requests.delete(requestId);pending.resolve(result);return {submitted:true};},
  alive:()=>!closed&&!error&&child.exitCode===null&&!child.killed,
  async close(){if(closed)return;closed=true;waiters.splice(0).forEach(resolve=>resolve());for(const value of replays.values())value.reject(unavailable());replays.clear();for(const value of requests.values())value.reject(unavailable());requests.clear();query?.close();warm?.close();child.stdin?.end();child.kill();await reader?.catch(()=>{});},
 });
}
