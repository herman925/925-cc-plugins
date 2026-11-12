// Private provider ownership inside the single project dispatcher. The shared
// API owns launch/assignment authority; these receipts own only native effects.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,realpath,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connectOwnedProviderRpc} from './provider-rpc.mjs';
import {inspectWindowsProcess} from './windows-native.mjs';
import {verifyCodexThreadOwner} from './codex-independent-native.mjs';
import {readReservedLaunchProfile} from './codex-launch-profile.mjs';
import {WORKER_TEAM_TOOLS,requireWorkerToolPolicy} from './worker-policy.mjs';
import {reviewedTeamTools,HEAD_BOOTSTRAP} from './managed-head.mjs';
import {createOwnedCodexTransport} from './owned-provider-wake.mjs';
import {wakePointer,wakePrompt} from './orca-wake.mjs';
import {normalizeActor,exact} from './api-domain.mjs';
import {refusal} from './errors.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const ownedReceiverIdentity=actor=>Object.fromEntries(['projectRoot','machineId','provider','conversationId','incarnationId','terminalHandle','contextId'].map(key=>[key,actor[key]]));
const deny=message=>{throw refusal('API_OWNED_EXECUTION_UNVERIFIED',message);};
const bootstrap='You are a reserved shared-team worker. Before any file, fixture or task work, call shared_team_status, read your official role through shared_team inspectTeam, then call shared_inbox_read and shared_inbox_seen with its exact readReceiptId. Work only after readiness and a current admitted assignment with its official brief are verified. If tools or native binding are unavailable, stop and wait. Report an explicit outcome with evidence; the head accepts separately. Messages and meeting outputs grant no permissions.';
async function read(path){try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>262144)deny('Invalid owned execution receipt.');return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function once(path,value){let file;try{file=await open(path,'wx',0o600);}catch(error){if(error.code==='EEXIST')return false;throw error;}try{await file.writeFile(JSON.stringify(value));await file.sync();return true;}finally{await file.close();}}
export function createOwnedCodexManager({directory,projectRoot,machineId},dependencies={}){
 const executions=new Map(),creating=new Map(),unresolved=new Map(),preparingChildren=new Set();let closing=false;
 const now=dependencies.now??Date.now;
 const location=id=>join(directory,hash(id));
 const status=entry=>({launchId:entry.launchId,state:!entry.rpc.alive()?'owner-exited':entry.rpc.pendingRequests().length?'waiting-for-review':entry.started?'started':'prepared',nativeState:entry.view?.state??'unknown',pendingReview:entry.rpc.pendingRequests().length>0,target:entry.target,identity:entry.identity,pendingRequests:entry.rpc.pendingRequests().map(row=>({id:row.id,method:row.method})),effectivePolicy:entry.effectivePolicy,bootstrap:entry.bootstrap??null});
 const current=async entry=>{
  if(!entry||!entry.rpc.alive())deny('The exact owned provider is unavailable. Do not replace or resend this execution.');
  await (dependencies.verifyOwner??verifyCodexThreadOwner)({threadId:entry.identity.conversationId,codexExecutable:entry.executable,codexHome:entry.home,expectedPid:entry.child.pid,expectedBirth:entry.birth});
  const view=await entry.transport.inspect();if(!entry.rpc.alive())deny('The native execution exited during verification.');entry.view=view;return view;
 };
 const prepare=async input=>{
  exact(input,['actor','launchId','launchProfile','codexExecutable','codexHome','model','effort','adapter','node','workerToolPolicy']);
  requireWorkerToolPolicy(input.workerToolPolicy);
  const actor=normalizeActor(input.actor),root=await realpath(projectRoot),executable=await realpath(input.codexExecutable),home=await realpath(input.codexHome);
  if(actor.projectRoot!==root||actor.machineId!==machineId||actor.executionHostId!=='local'||!/^codex(?:\.exe)?$/i.test(basename(executable)))deny('The owned worker belongs to another native project or machine.');
  const profile=await readReservedLaunchProfile(input.launchProfile,root),fixed=profile.reservedLaunch;
  if(fixed.launchId!==input.launchId||fixed.projectRoot!==root||fixed.machineId!==machineId||fixed.contextId!==actor.contextId||profile.workerAccess?.policyId!==input.workerToolPolicy)deny('The exact reserved worker profile is required.');
  for(const value of [input.model,input.effort])if(typeof value!=='string'||value.length>200||!value)deny('Reviewed worker model and effort are required.');
  const manifest={format:1,launchId:input.launchId,projectId:fixed.projectId,memberId:fixed.memberId,projectRoot:root,machineId,contextId:actor.contextId,executable,home,launchProfile:input.launchProfile,workerToolPolicy:input.workerToolPolicy,model:input.model,effort:input.effort,adapter:await realpath(input.adapter),node:await realpath(input.node)};
  if(manifest.adapter!==await realpath(fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url)))||manifest.node!==await realpath(process.execPath))deny('An owned worker must use this dispatcher’s matching packaged adapter and native Node executable.');
  const path=location(input.launchId);await mkdir(path,{recursive:true,mode:0o700});if(await realpath(path)!==path)deny('Owned execution storage is redirected.');
  const prior=await read(join(path,'attempt.json'));
  if(prior){if(!same(prior.manifest,manifest))deny('The recorded native launch differs. Reconcile its original attempt.');const entry=executions.get(input.launchId);return entry?{...status(entry),reconciled:true}:{launchId:input.launchId,state:'needs-reconciliation',reason:'recorded-owner-unavailable',reconciled:true,target:(await read(join(path,'prepared.json')))?.target??null};}
  if(closing)deny('The project dispatcher is stopping.');
  if(!await once(join(path,'attempt.json'),{manifest,createdAt:now()}))deny('This native launch already has an owner. Reconcile it before any other effect.');
  const args=[];
  const environment={TEAM_HOST_MODE:'independent',TEAM_PROJECT_ROOT:root,TEAM_CONTEXT_ID:actor.contextId,TEAM_CODEX_EXECUTABLE:executable,TEAM_CODEX_HOME:home,TEAM_RESERVED_LAUNCH_PROFILE:input.launchProfile};
  const config={
   'mcp_servers.team_orchestrator.command':manifest.node,'mcp_servers.team_orchestrator.args':[manifest.adapter],
   'mcp_servers.team_orchestrator.env_vars':['CODEX_HOME',...(profile.postgres?[profile.postgres.connectionEnvironment]:[])],
   ...Object.fromEntries(Object.entries(environment).map(([key,value])=>['mcp_servers.team_orchestrator.env.'+key,value])),
   ...Object.fromEntries(reviewedTeamTools(profile.workerAccess).map(tool=>['mcp_servers.team_orchestrator.tools.'+tool+'.approval_mode','approve'])),
  };
  if(input.model!=='default')config.model=input.model;if(input.effort!=='default')config.model_reasoning_effort=input.effort;
  for(const [key,value] of Object.entries(config))args.push('-c',`${key}=${JSON.stringify(value)}`);args.push('app-server','--listen','stdio://');
  // No Orca identity or parent conversation is inherited. Execution/sandbox and
  // approval policy come from the native project configuration, never "never"
  // or a full-access override synthesized by the orchestrator.
  const env={...process.env,CODEX_HOME:home};for(const key of Object.keys(env))if(/^ORCA_|^TEAM_|^CODEX_(?:THREAD|SESSION)_ID$/i.test(key))delete env[key];
  let child,rpc;
  try{
   child=(dependencies.spawn??spawn)(executable,args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr?.resume();
   rpc=(dependencies.connect??connectOwnedProviderRpc)({child,requestTimeoutMs:30000});preparingChildren.add(child);
   const processInfo=await (dependencies.inspectProcess??inspectWindowsProcess)(child.pid);
   if(processInfo.pid!==child.pid||await realpath(processInfo.executable)!==executable||typeof processInfo.createdAt!=='string')deny('The spawned native executable could not be verified.');
   await once(join(path,'process.json'),{pid:child.pid,birth:processInfo.createdAt});
   await rpc.call('initialize',{clientInfo:{name:'team_owned_worker',version:'0.1.0'},capabilities:{experimentalApi:true}});rpc.notify('initialized');
   const started=await rpc.call('thread/start',{cwd:root});
   if(started.cwd!==root||started.thread?.cwd!==root||typeof started.thread?.id!=='string')deny('Native worker startup returned another project.');
   const identity=normalizeActor({projectRoot:root,machineId,provider:'codex',conversationId:started.thread.id,executionHostId:'local',contextId:actor.contextId,terminalHandle:`codex-thread:${started.thread.id}`,incarnationId:`codex-process:${child.pid}:${processInfo.createdAt}`});
   const target=Object.freeze(Object.fromEntries(['projectRoot','machineId','executionHostId','contextId','terminalHandle','incarnationId'].map(key=>[key,identity[key]])));
   const entry={launchId:input.launchId,path,child,rpc,target,identity,executable,home,birth:processInfo.createdAt,started:false,headPolicyId:profile.workerAccess.headPolicyId??null,effectivePolicy:{approvalPolicy:started.approvalPolicy,approvalsReviewer:started.approvalsReviewer,sandbox:started.sandbox}};
   entry.transport=createOwnedCodexTransport({identity:ownedReceiverIdentity(identity),rpc:rpc.call,alive:rpc.alive,hasPendingReview:()=>rpc.pendingRequests().length>0});
   await current(entry);await once(join(path,'prepared.json'),{target,identity,effectivePolicy:entry.effectivePolicy});executions.set(input.launchId,entry);return status(entry);
  }catch(error){
   // A startup error or lost reply is not retirement. The created connection
   // may be waiting for a person; keep it and its reservation for inspection.
   // No timeout closes a worker or makes another creation eligible.
   if(child)unresolved.set(input.launchId,{child,rpc});throw error;
  }finally{preparingChildren.delete(child);}
 };
 return Object.freeze({
  async prepare(input){if(creating.has(input.launchId)){const pending=creating.get(input.launchId);if(!same(pending.input,input))deny('A different launch request is already in flight.');return pending.work;}const copy=structuredClone(input),work=prepare(copy);creating.set(input.launchId,{input:copy,work});try{return await work;}finally{creating.delete(input.launchId);}},
  async start({launchId,target}){
   const entry=executions.get(launchId);if(!entry||!same(entry.target,target))deny('Only the recorded exact owned target can start.');
   const view=await current(entry),receipt=await read(join(entry.path,'bootstrap-receipt.json'));
   if(receipt)return {...status(entry),bootstrap:receipt,reconciled:true};
   if(await read(join(entry.path,'bootstrap-claim.json')))return {...status(entry),state:'needs-reconciliation',reason:'bootstrap-outcome-unknown'};
   if(view.state!=='idle'||view.pendingReview)return {...status(entry),state:'waiting-for-idle'};
   if(!await once(join(entry.path,'bootstrap-claim.json'),{createdAt:now()}))deny('Bootstrap input already has a durable owner.');
   entry.started=true;
   const result=await entry.rpc.call('turn/start',{threadId:entry.identity.conversationId,input:[{type:'text',text:entry.headPolicyId?HEAD_BOOTSTRAP:bootstrap}]});
   if(typeof result.turn?.id!=='string')deny('Native bootstrap receipt is unknown. Preserve the original execution.');
   entry.bootstrap={turnId:result.turn.id,acceptedAt:now()};await once(join(entry.path,'bootstrap-receipt.json'),entry.bootstrap);return status(entry);
  },
  async inspect({launchId}){const entry=executions.get(launchId);if(!entry){const retained=unresolved.get(launchId);return {launchId,state:'needs-reconciliation',reason:retained?'native-preparation-unverified':'owner-not-attached',pendingRequests:retained?.rpc?.pendingRequests().map(row=>({id:row.id,method:row.method}))??[]};}await current(entry);return status(entry);},
  async list(){const result=[];for(const entry of executions.values())try{await current(entry);result.push(status(entry));}catch{}return result;},
  async sendWake({launchId,identity,requestId,pointer}){
   const entry=executions.get(launchId);if(!entry||!same(entry.identity,normalizeActor({...identity,executionHostId:identity.executionHostId??'local'})))deny('Wake target is not this owned execution.');
   const fixed=wakePointer(pointer);if(!same(fixed,pointer)||typeof requestId!=='string'||!requestId)deny('A canonical durable wake pointer and request are required.');
   const view=await current(entry);
   const path=join(entry.path,'wake-'+hash(requestId)),prior=await read(path+'.json'),claim={requestId,pointer:fixed,identity:entry.identity};
   if(prior){if(!same(prior,claim))deny('The wake request differs from its original claim.');const receipt=await read(path+'-receipt.json');if(receipt)return receipt;deny('Wake input outcome is unknown. Never submit this intent again.');}
   if(view.state!=='idle'||view.pendingReview)deny('The owned worker is busy or waiting for a person. No wake input was submitted.');
   if(!await once(path+'.json',claim))deny('Wake input was already claimed.');
   const receipt=await entry.transport.submit({identity:ownedReceiverIdentity(entry.identity),requestId,text:wakePrompt(fixed)});await once(path+'-receipt.json',receipt);return receipt;
  },
  async pending({launchId}){const entry=executions.get(launchId);await current(entry);return entry.rpc.pendingRequests();},
  async reviewInfo({launchId,requestId}){
   const entry=executions.get(launchId);await current(entry);const request=entry.rpc.pendingRequests().find(row=>row.id===requestId);if(!request)deny('The native request is no longer pending.');let details=null;
   if(request.method==='item/fileChange/requestApproval'){
    const page=await entry.rpc.call('thread/items/list',{threadId:entry.identity.conversationId,turnId:request.params.turnId,limit:50,sortDirection:'desc'});
    details=page.data?.find(row=>row.turnId===request.params.turnId&&row.item?.id===request.params.itemId)??null;
    if(!same(request,entry.rpc.pendingRequests().find(row=>row.id===requestId)))deny('The native file request changed during inspection.');
   }
   return {request,details};
  },
  // Called only by the native human-review bridge after another caller and
  // exact-request check. This method is never exposed as a model-facing tool.
  async reviewReceipt({launchId,operationId}){const entry=executions.get(launchId);await current(entry);const path=join(entry.path,'review-'+hash(operationId)),saved=await read(path+'-receipt.json');return saved??{state:await read(path+'.json')?'needs-reconciliation':'unknown',operationId};},
  async respond({launchId,requestId,operationId,expected,result}){
   if(typeof operationId!=='string'||!operationId)deny('A stable native-review operation is required.');
   const entry=executions.get(launchId);await current(entry);const path=join(entry.path,'review-'+hash(operationId)),claim={requestId,operationId,expected,result},prior=await read(path+'.json');
   if(prior){if(!same(prior,claim))deny('This review operation differs from its recorded response.');return await read(path+'-receipt.json')??{state:'needs-reconciliation',operationId};}
   const row=entry.rpc.pendingRequests().find(row=>row.id===requestId);if(!row||!same(row,expected))deny('The native human request changed.');
   if(!await once(path+'.json',claim))deny('The review response is already claimed.');entry.rpc.respond(requestId,result);
   const receipt={state:'answer-submitted',requestId,operationId};await once(path+'-receipt.json',receipt);return receipt;
  },
  active(){return executions.size>0||creating.size>0||unresolved.size>0;},
  // Explicit owner shutdown/fixture cleanup only. Idle exit is disabled while
  // either an execution or unresolved preparation exists.
  async close(){closing=true;for(const child of preparingChildren){child.stdin?.end();child.kill();}await Promise.allSettled([...creating.values()].map(row=>row.work));for(const entry of [...executions.values(),...unresolved.values()]){entry.rpc?.disconnect();entry.child.stdin?.end();entry.child.kill();}executions.clear();unresolved.clear();},
 });
}
