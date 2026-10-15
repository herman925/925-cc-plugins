import { randomBytes, randomUUID } from 'node:crypto';
import { sendFingerprint } from './teamwork.mjs';
import { readNativeDispatchEvidence } from './native-dispatch.mjs';
import { discoverCapabilities } from './capabilities.mjs';
import { preferenceIssue } from '../capabilities.mjs';
export function dispatchInstructions(work,team,protocol) {
 const children=team.members.filter(row=>row.boss===work.supervisorMemberId).map(row=>({memberId:row.id,name:row.name,agent:row.agent,model:row.model,effort:row.effort,roleVersion:row.roleVersion,role:{brief:row.brief,habits:row.habits,collaboration:row.collaboration}}));
 return 'TEAM_DISPATCH_PROTOCOL\n'+JSON.stringify({protocol:'team-dispatch/v1',workId:work.id,token:protocol.token,generation:protocol.generation,configVersion:work.configVersion,runId:work.run.id,children,instructions:'You are the real supervisor. For a direct child create exactly one native Task with task-create --spec JSON --run this Run --json, no extra task flags or forged --from. Spec fields: protocol,workId,token,generation,taskKey (stable alphanumeric/hyphen ID),memberId,configVersion,roleVersion,role (exact saved role object),instruction. Do not worker-start yet. Finish your turn and wait for TEAM_DISPATCH_PERMIT. Repeating an unknown request requires the native reported retry-request UUID, never a fresh creation. Only after the permit, execute worker-start with exactly the supplied startParams using your own inherited native identity. Record native Task/Dispatch receipts; never claim completion from accepted input. Tell each actual worker to use the native worker_done report with its real Task/Dispatch and succeeded/failed outcome. Members stay open while idle. Results await your later separate acceptance protocol.'});
}
export function userMessage(work,instance,text){
 if(work.binding.kind==='structured'){
  const body={kind:'message',role:'user',blocks:[{type:'text',text}]},sessionId=work.binding.sessionId;
  return {method:'agentSession.send',params:{envelope:{sessionId,clientOperationId:`${Date.now()}-${randomBytes(16).toString('hex')}`,expectedRuntimeFence:instance.fence,payloadFingerprint:sendFingerprint(sessionId,body)},body},envelope:{}};
 }
 return {method:'terminal.send',params:{terminal:work.binding.handle,text,enter:true,agentPrompt:true,waitSubmitMs:1000,client:{id:'team-orchestrator',type:'desktop'}},envelope:{orchestrationRequestId:randomUUID()}};
}
export function accepted(receipt,send,instance){
 if(send.method==='agentSession.send')return receipt?.ok===true&&receipt.value?.clientMessageId===send.params.envelope.clientOperationId&&['pending','accepted'].includes(receipt.value.submission?.dispatchState);
 return receipt?.send?.accepted===true&&receipt.send.handle===instance.handle&&receipt.send.prompt?.requestId===send.envelope.orchestrationRequestId&&receipt.send.prompt.processIncarnation===instance.incarnationId;
}
export function createDispatchService({store,rpc,userData,consent,works}) {
 const queues=new Map();
 const serial=(id,fn)=>{const promise=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(fn);queues.set(id,promise);promise.finally(()=>{if(queues.get(id)===promise)queues.delete(id);}).catch(()=>{});return promise;};
 const project=id=>store.dispatchProjection(id);
 async function evidence(work,protocol,team,verified){return readNativeDispatchEvidence(userData,{work,protocol,team,owner:verified.instance,admitted:store.listDispatches(work.id)});}
 async function sendProtocol(work,team,protocol,verified){
  if(protocol.state!=='not_sent')return protocol;
  const nativeSend=userMessage(work,verified.instance,dispatchInstructions(work,team,protocol));
  await consent();protocol=store.updateDispatchProtocol(work.id,protocol.version,{state:'sending',nativeSend});
  try { const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope); if(!accepted(receipt,nativeSend,verified.instance))throw Error('Protocol input was not confirmed; no automatic resend.'); return store.updateDispatchProtocol(work.id,protocol.version,{state:'accepted',detail:'Native host accepted dispatch instructions; the real supervisor must create Task intents.'}); }
  catch(error){return store.updateDispatchProtocol(work.id,protocol.version,{state:'unknown',detail:String(error.message).slice(0,1200)});}
 }
 async function permit(work,attempt){
  if(attempt.permit.state!=='not_sent')return;
  const verified=await works.verifyWork(work.id,true),protocol=store.readDispatchProtocol(work.id),team=store.readTeamVersion(work.teamId,work.configVersion);
  const member=team.members.find(row=>row.id===attempt.memberId);
  if(!member||member.boss!==work.supervisorMemberId||member.roleVersion!==attempt.roleVersion||attempt.startParams.agent!==member.agent||(attempt.startParams.model??'default')!==member.model||(attempt.startParams.effort??'default')!==member.effort)throw Error('Saved permit preferences or direct supervisor do not match the frozen member.');
  const checked=await evidence(store.readWork(work.id),protocol,team,verified);
  if(checked.state!=='verified')throw Error(checked.detail);
  const existing=checked.observations.find(row=>row.id===attempt.id);
  if(existing?.state!=='absent') {
   store.updateDispatch(attempt.id,attempt.version,{admission:'unadmitted',status:'unknown',permit:{state:'unknown'},detail:'Native work appeared before the user-input permit. It is retained unadmitted; no permit or replacement was sent.'});
   return;
  }
  const text='TEAM_DISPATCH_PERMIT\n'+JSON.stringify({workId:work.id,attemptId:attempt.id,memberId:attempt.memberId,roleVersion:attempt.roleVersion,configVersion:attempt.configVersion,nativeTaskId:attempt.nativeTaskId,generation:attempt.generation,startParams:attempt.startParams,instruction:'Admission was committed. Execute this native worker-start once as your own supervisor identity. Never override from/devMode. Preserve reported request/Dispatch IDs; uncertain delivery is not permission for another worker.'});
  const nativeSend=userMessage(work,verified.instance,text);
  await consent();attempt=store.updateDispatch(attempt.id,attempt.version,{permit:{state:'sending',nativeSend}});
  try { const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);if(!accepted(receipt,nativeSend,verified.instance))throw Error('Native permit delivery is unconfirmed; do not resend.');store.updateDispatch(attempt.id,attempt.version,{status:'awaiting_start',permit:{state:'accepted',nativeSend},detail:'Input accepted; waiting for genuine supervisor worker-start evidence.'}); }
  catch(error){store.updateDispatch(attempt.id,attempt.version,{status:'unknown',permit:{state:'unknown',nativeSend},detail:String(error.message).slice(0,1200)});}
 }
 async function check(workId){
  const work=store.readWork(workId);if(!work||work.run.state!=='verified')return project(workId);
  try {
   const verified=await works.verifyWork(workId),team=store.readTeamVersion(work.teamId,work.configVersion);
   let protocol=store.ensureDispatchProtocol(workId);
   let native=await evidence(work,protocol,team,verified);if(native.state!=='verified')throw Error(native.detail);
   if(protocol.state==='sending')protocol=store.updateDispatchProtocol(workId,protocol.version,{state:'unknown',detail:'Protocol submission was interrupted; it is not automatically sent again.'});
   if(protocol.state==='unknown'&&native.intents.length)protocol=store.updateDispatchProtocol(workId,protocol.version,{state:'accepted',detail:'Native supervisor-authored Task proves receipt of this exact admission protocol.'});
   protocol=await sendProtocol(work,team,protocol,verified);if(protocol.state!=='accepted')return project(workId);
   native=await evidence(work,protocol,team,verified);if(native.state!=='verified')throw Error(native.detail);
   for(const intent of native.intents){
    try{
     if(!intent.unadmitted){const caps=await discoverCapabilities(rpc,work.scope),issue=preferenceIssue(intent.member,caps,{requireCore:true});if(issue)throw Error(issue);}
     const current=await works.verifyWork(workId),fresh=await evidence(store.readWork(workId),protocol,team,current);
     const currentIntent=fresh.intents.find(row=>row.nativeTaskId===intent.nativeTaskId&&row.payloadHash===intent.payloadHash);
     if(fresh.state!=='verified'||!currentIntent)throw Error('Native intent changed during admission.');
     const startParams={task:intent.nativeTaskId,worktree:work.scope.workspaceId.startsWith('folder:')?work.scope.workspaceId:`id:${work.scope.workspaceId}`,agent:intent.member.agent,run:work.run.id,...(intent.member.model!=='default'?{model:intent.member.model}:{}),...(intent.member.effort!=='default'?{effort:intent.member.effort}:{})};
     const admitted=store.prepareDispatch(workId,currentIntent,startParams);if(admitted.fresh&&!currentIntent.unadmitted)await permit(work,admitted.attempt);
    }catch(error){protocol=store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:String(error.message).slice(0,1200)});}
   }
   // Resume only unsent, committed permits; sending/unknown never becomes a fresh input.
   for(const attempt of store.listDispatches(workId))if(attempt.permit.state==='not_sent')await permit(work,attempt);
   native=await evidence(store.readWork(workId),protocol,team,await works.verifyWork(workId));if(native.state!=='verified')throw Error(native.detail);
   for(const observed of native.observations){
    let attempt=store.listDispatches(workId).find(row=>row.id===observed.id);if(attempt.status==='pending_acceptance')continue;
    if(observed.state!=='verified'){if(attempt.permit.state==='sending')attempt=store.updateDispatch(attempt.id,attempt.version,{status:'unknown',permit:{...attempt.permit,state:'unknown'},detail:'Permit delivery interrupted; reconciliation never resends.'});else if(observed.state==='unverified')store.updateDispatch(attempt.id,attempt.version,{status:'unknown',detail:observed.detail});continue;}
    const shown=await rpc('orchestration.workerShow',{dispatch:observed.dispatchId});
    if(shown?.dispatch?.id!==observed.dispatchId||shown.dispatch.runId!==work.run.id||shown.dispatch.taskId!==attempt.nativeTaskId||shown.dispatch.assigneeHandle!==observed.binding.handle||shown.worker?.worktreeId!==work.scope.workspaceId)throw Error('Native worker projection does not match admitted member identity.');
    const final=await evidence(store.readWork(workId),protocol,team,await works.verifyWork(workId)),settled=final.observations.find(row=>row.id===attempt.id);
    if(final.state!=='verified'||settled?.state!=='verified'||settled.dispatchId!==observed.dispatchId||JSON.stringify(settled.binding)!==JSON.stringify(observed.binding))throw Error('Native Dispatch changed during observation.');
    try { store.updateDispatch(attempt.id,attempt.version,{dispatchId:settled.dispatchId,binding:settled.binding,permit:{...attempt.permit,state:'accepted',source:'native-worker-start'},nativeState:settled.nativeState,startRequestId:settled.startRequestId,startPayloadHash:settled.startPayloadHash,...(settled.completion?{status:'pending_acceptance',...settled.completion,detail:'Native execution report recorded. Direct supervisor acceptance is still required.'}:{status:settled.nativeState==='ready'&&shown.observation?.exactWorker===true&&shown.observation.status==='live'&&!shown.observation.agentWait?'running':'unknown',detail:shown.observation?.agentWait?'Native session is waiting for input or authorization. Resolve its native tab; no replacement was started.':shown.observation?.exactWorker===true&&shown.observation.status==='live'?'Native assignment observed; execution result is not yet proven.':'Native worker observation is unverified; its saved identity remains reserved.'})}); } catch(error) { store.updateDispatch(attempt.id,attempt.version,{status:'unknown',detail:String(error.message).slice(0,1200)}); }
   }
   if(native.rejected.length)store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:native.rejected[0].detail});
  }catch(error){const protocol=store.readDispatchProtocol(workId);if(protocol)store.updateDispatchProtocol(workId,protocol.version,{detail:String(error.message).slice(0,1200)});}
  return project(workId);
 }
 return {check:id=>serial(id,()=>check(id)),async reconcile(){for(const work of store.listWorks())if(work.run.state==='verified')await this.check(work.id);}};
}
