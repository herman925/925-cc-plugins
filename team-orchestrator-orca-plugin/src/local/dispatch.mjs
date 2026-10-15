import { withNativeRuntime } from './native-runtime.mjs';
import { randomBytes, randomUUID } from 'node:crypto';
import { sendFingerprint } from './teamwork.mjs';
import { readNativeDispatchEvidence } from './native-dispatch.mjs';
import { discoverCapabilities } from './capabilities.mjs';
import { preferenceIssue } from '../capabilities.mjs';
export function dispatchInstructions(work,team,protocol) {
 const children=team.members.filter(row=>row.boss===work.supervisorMemberId).map(row=>({memberId:row.id,name:row.name,agent:row.agent,model:row.model,effort:row.effort,roleVersion:row.roleVersion,role:{brief:row.brief,habits:row.habits,collaboration:row.collaboration}}));
 return 'TEAM_DISPATCH_PROTOCOL\n'+JSON.stringify({protocol:'team-dispatch/v1',workId:work.id,token:protocol.token,generation:protocol.generation,configVersion:work.configVersion,runId:work.run.id,children,instructions:'You are the real supervisor. For a direct child create exactly one native Task with task-create --spec JSON --run this Run --json, no extra task flags or forged --from. Spec fields: protocol,workId,token,generation,taskKey (stable alphanumeric/hyphen ID),memberId,configVersion,roleVersion,role (exact saved role object),instruction. Do not worker-start yet. Finish your turn and wait for TEAM_DISPATCH_PERMIT. Repeating an unknown request requires the native reported retry-request UUID, never a fresh creation. Only after the permit, execute worker-start with exactly the supplied startParams using your own inherited native identity. Record native Task/Dispatch receipts; never claim completion from accepted input. Tell each actual worker to use the native worker_done report with its real Task/Dispatch and succeeded/failed outcome. Members stay open while idle. Spec may include dependencies (application taskKey array). They wait for supervisor acceptance, not native completed. After a native worker_done result, inspect evidence and task-update that same native Task with its unchanged completed/failed status and exact JSON result: protocol team-review/v1, workId,token,generation,taskKey,attemptId,nativeTaskId,dispatchId,reviewToken (from permit),reviewerMemberId (your member),decision accept or rework,evidenceRefs (include worker_report:<native-message-id> and validation references),summary. Use --run this Run, no extra flags or forged caller. The plugin verifies the native taskUpdate receipt; JSON alone is not acceptance. Rework creates a NEW native Task with the SAME taskKey and dependencies plus previousAttemptId equal to the rejected attempt. Wait for a fresh permit; never relaunch the member yourself.'});
}
function userMessage(work,instance,text){
 if(work.binding.kind==='structured'){
  const body={kind:'message',role:'user',blocks:[{type:'text',text}]},sessionId=work.binding.sessionId;
  return {method:'agentSession.send',params:{envelope:{sessionId,clientOperationId:`${Date.now()}-${randomBytes(16).toString('hex')}`,expectedRuntimeFence:instance.fence,payloadFingerprint:sendFingerprint(sessionId,body)},body},envelope:{}};
 }
 return {method:'terminal.send',params:{terminal:work.binding.handle,text,enter:true,agentPrompt:true,waitSubmitMs:1000,client:{id:'team-orchestrator',type:'desktop'}},envelope:{orchestrationRequestId:randomUUID()}};
}
function accepted(receipt,send,instance){
 if(send.method==='agentSession.send')return receipt?.ok===true&&receipt.value?.clientMessageId===send.params.envelope.clientOperationId&&['pending','accepted'].includes(receipt.value.submission?.dispatchState);
 return receipt?.send?.accepted===true&&receipt.send.handle===instance.handle&&receipt.send.prompt?.requestId===send.envelope.orchestrationRequestId&&receipt.send.prompt.processIncarnation===instance.incarnationId;
}
export function createDispatchService({store,rpc,userData,consent,works}) {
 const queues=new Map();
 const serial=(id,fn)=>{const promise=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(()=>withNativeRuntime(rpc,store.readWork(id)?.binding.runtimeId,fn));queues.set(id,promise);promise.finally(()=>{if(queues.get(id)===promise)queues.delete(id);}).catch(()=>{});return promise;};
 const project=id=>store.dispatchProjection(id);
 async function evidence(work,protocol,team,verified){return readNativeDispatchEvidence(userData,{work,protocol,team,owner:verified.instance,admitted:store.listDispatches(work.id)});}
 async function sendProtocol(work,team,protocol,verified){
  if(protocol.state!=='not_sent')return protocol;
  const nativeSend=userMessage(work,verified.instance,dispatchInstructions(work,team,protocol));
  await consent();protocol=store.updateDispatchProtocol(work.id,protocol.version,{state:'sending',nativeSend});
  try { await works.verifyHost(work.id,verified.hostGeneration);const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope); if(!accepted(receipt,nativeSend,verified.instance))throw Error('Protocol input was not confirmed; no automatic resend.'); return store.updateDispatchProtocol(work.id,protocol.version,{state:'accepted',detail:'Native host accepted dispatch instructions; the real supervisor must create Task intents.'}); }
  catch(error){return store.updateDispatchProtocol(work.id,protocol.version,{state:'unknown',detail:String(error.message).slice(0,1200)});}
 }
 async function retainedSession(work,member,prior){
  if(!prior?.binding||!['accepted','rework'].includes(prior.status)||prior.workId!==work.id||prior.roleVersion!==member.roleVersion)throw Error('Member has an unresolved reservation; do not launch another session.');
  const saved=prior.binding,shown=await rpc('orchestration.workerShow',{dispatch:prior.dispatchId});
  if(shown?.dispatch?.id!==prior.dispatchId||shown.dispatch.assigneeHandle!==saved.handle||shown.worker?.worktreeId!==work.scope.workspaceId||shown.worker.runtimeEpoch!==saved.runtimeId||shown.observation?.exactWorker!==true||shown.observation.status!=='live'||shown.observation.agentWait)throw Error('Retained member session is not verified live; no replacement was launched.');
  let terminal,sessionFence;
  if(saved.kind==='structured'){
   if(work.scope.executionHostId!=='local')throw Error('Retained structured session requires its owning runtime.');
   terminal=(await rpc('orchestration.sessionAddress',{sessionId:saved.sessionId}))?.orcaSessionId;
   if(terminal!==`orca_session_id:${saved.sessionId}`)throw Error('Retained member canonical identity changed.');
   const location=(await rpc('orchestration.partyLocation',{address:terminal}))?.location;
   if(location?.kind!=='chat'||location.sessionId!==saved.sessionId||location.worktreeId!==work.scope.workspaceId)throw Error('Retained member session is closed, moved or has unverified lineage.');
   const history=await rpc('agentSession.history',{sessionId:location.sessionId,direction:'tail',limit:1});
   sessionFence=history?.page?.fence;
   if(history?.ok!==true||history.page?.sessionId!==location.sessionId||!Number.isSafeInteger(sessionFence)||sessionFence<1||(saved.sessionFence!==undefined&&saved.sessionFence!==sessionFence))throw Error('Retained member session fence is unavailable.');
  }else{
   const live=(await rpc('terminal.show',{terminal:saved.handle}))?.terminal;
   if(live?.handle!==saved.handle||live.incarnationId!==saved.incarnationId||`${live.tabId}:${live.leafId}`!==saved.paneKey||live.worktreeId!==work.scope.workspaceId||live.executionHostId!==work.scope.executionHostId||live.agentIdentity!==member.agent||!live.connected||!live.writable)throw Error('Retained member terminal instance is unverified.');
   terminal=saved.handle;
  }
  const original=prior.reuse?.preferences??{agent:prior.startParams.agent,model:prior.startParams.model??'default',effort:prior.startParams.effort??'default'};
  if(original.agent!==member.agent||original.model!==member.model||original.effort!==member.effort)throw Error('Retained session preferences differ; no second session was launched.');
  return {attemptId:prior.id,binding:saved,terminal,...(sessionFence?{sessionFence}:{}),preferences:original};
 }
 async function permit(work,attempt){
  if(attempt.permit.state!=='not_sent')return;
  const verified=await works.verifyWork(work.id,true),protocol=store.readDispatchProtocol(work.id),team=store.readTeamVersion(work.teamId,work.configVersion);
  const member=team.members.find(row=>row.id===attempt.memberId);
  if(!member||member.boss!==work.supervisorMemberId||member.roleVersion!==attempt.roleVersion||(!attempt.reuse&&(attempt.startParams.agent!==member.agent||(attempt.startParams.model??'default')!==member.model||(attempt.startParams.effort??'default')!==member.effort)))throw Error('Saved permit preferences or direct supervisor do not match the frozen member.');
  if(attempt.reuse){const prior=store.listDispatches(work.id).find(row=>row.id===attempt.reuse.attemptId),current=await retainedSession(work,member,prior);if(JSON.stringify(current)!==JSON.stringify(attempt.reuse))throw Error('Retained member changed before permit; reservation preserved.');}
  const checked=await evidence(store.readWork(work.id),protocol,team,verified);
  if(checked.state!=='verified')throw Error(checked.detail);
  const existing=checked.observations.find(row=>row.id===attempt.id);
  if(existing?.state!=='absent') {
   store.updateDispatch(attempt.id,attempt.version,{admission:'unadmitted',status:'unknown',permit:{state:'unknown'},detail:'Native work appeared before the user-input permit. It is retained unadmitted; no permit or replacement was sent.'});
   return;
  }
  const text='TEAM_DISPATCH_PERMIT\n'+JSON.stringify({workId:work.id,attemptId:attempt.id,memberId:attempt.memberId,roleVersion:attempt.roleVersion,configVersion:attempt.configVersion,nativeTaskId:attempt.nativeTaskId,generation:attempt.generation,reviewToken:attempt.reviewToken,reviewProtocol:'team-review/v1',startParams:attempt.startParams,instruction:'Admission was committed. Execute this native worker-start once as your own supervisor identity. Never override from/devMode. Preserve reported request/Dispatch IDs; uncertain delivery is not permission for another worker.'});
  const nativeSend=userMessage(work,verified.instance,text);
  await consent();attempt=store.updateDispatch(attempt.id,attempt.version,{permit:{state:'sending',nativeSend}});
  try { await works.verifyHost(work.id,verified.hostGeneration);const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);if(!accepted(receipt,nativeSend,verified.instance))throw Error('Native permit delivery is unconfirmed; do not resend.');store.updateDispatch(attempt.id,attempt.version,{status:'awaiting_start',permit:{state:'accepted',nativeSend},detail:'Input accepted; waiting for genuine supervisor worker-start evidence.'}); }
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
     const prior=store.listDispatches(workId).filter(row=>row.memberId===intent.member.id).at(-1);
     const reuse=prior?await retainedSession(work,intent.member,prior):undefined;
     const startParams={task:intent.nativeTaskId,worktree:work.scope.workspaceId.startsWith('folder:')?work.scope.workspaceId:`id:${work.scope.workspaceId}`,agent:intent.member.agent,run:work.run.id,...(intent.member.model!=='default'?{model:intent.member.model}:{}),...(intent.member.effort!=='default'?{effort:intent.member.effort}:{})};
     if(reuse){delete startParams.agent;delete startParams.model;delete startParams.effort;startParams.terminal=reuse.terminal;}
     const admitted=store.prepareDispatch(workId,currentIntent,startParams,reuse);if(admitted.fresh&&!currentIntent.unadmitted)await permit(work,admitted.attempt);
    }catch(error){protocol=store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:String(error.message).slice(0,1200)});}
   }
   // Resume only unsent, committed permits; sending/unknown never becomes a fresh input.
   for(const attempt of store.listDispatches(workId))if(attempt.permit.state==='not_sent')await permit(work,attempt);
   native=await evidence(store.readWork(workId),protocol,team,await works.verifyWork(workId));if(native.state!=='verified')throw Error(native.detail);
   for(const observed of native.observations){
    let attempt=store.listDispatches(workId).find(row=>row.id===observed.id);if(attempt.evidenceId)continue;
    if(observed.state!=='verified'){if(attempt.permit.state==='sending')attempt=store.updateDispatch(attempt.id,attempt.version,{status:'unknown',permit:{...attempt.permit,state:'unknown'},detail:'Permit delivery interrupted; reconciliation never resends.'});else if(observed.state==='unverified')store.updateDispatch(attempt.id,attempt.version,{status:'unknown',detail:observed.detail});continue;}
    const shown=await rpc('orchestration.workerShow',{dispatch:observed.dispatchId});
    if(shown?.dispatch?.id!==observed.dispatchId||shown.dispatch.runId!==work.run.id||shown.dispatch.taskId!==attempt.nativeTaskId||shown.dispatch.assigneeHandle!==observed.binding.handle||shown.worker?.worktreeId!==work.scope.workspaceId)throw Error('Native worker projection does not match admitted member identity.');
    const final=await evidence(store.readWork(workId),protocol,team,await works.verifyWork(workId)),settled=final.observations.find(row=>row.id===attempt.id);
    if(final.state!=='verified'||settled?.state!=='verified'||settled.dispatchId!==observed.dispatchId||JSON.stringify(settled.binding)!==JSON.stringify(observed.binding))throw Error('Native Dispatch changed during observation.');
    try { store.updateDispatch(attempt.id,attempt.version,{dispatchId:settled.dispatchId,binding:settled.binding,permit:{...attempt.permit,state:'accepted',source:'native-worker-start'},nativeState:settled.nativeState,startRequestId:settled.startRequestId,startPayloadHash:settled.startPayloadHash,...(settled.completion?{status:'pending_acceptance',...settled.completion,detail:'Native execution report recorded. Direct supervisor acceptance is still required.'}:{status:settled.nativeState==='ready'&&shown.observation?.exactWorker===true&&shown.observation.status==='live'&&!shown.observation.agentWait?'running':'unknown',detail:shown.observation?.agentWait?'Native session is waiting for input or authorization. Resolve its native tab; no replacement was started.':shown.observation?.exactWorker===true&&shown.observation.status==='live'?'Native assignment observed; execution result is not yet proven.':'Native worker observation is unverified; its saved identity remains reserved.'})}); } catch(error) { store.updateDispatch(attempt.id,attempt.version,{status:'unknown',detail:String(error.message).slice(0,1200)}); }
   }
   const reviewEvidence=await evidence(store.readWork(workId),protocol,team,await works.verifyWork(workId));
   if(reviewEvidence.state!=='verified')throw Error(reviewEvidence.detail);
   for(const review of reviewEvidence.reviews??[])try{store.recordDispatchReview(review.attemptId,review);}catch(error){store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:String(error.message).slice(0,1200)});}
   if(reviewEvidence.rejected.length)native.rejected=reviewEvidence.rejected;
   if(native.rejected.length)store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:native.rejected[0].detail});
  }catch(error){const protocol=store.readDispatchProtocol(workId);if(protocol)store.updateDispatchProtocol(workId,protocol.version,{detail:String(error.message).slice(0,1200)});}
  return project(workId);
 }
 return {check:id=>serial(id,()=>check(id)),async reconcile(){for(const work of store.listWorks())if(work.run.state==='verified')await this.check(work.id);}};
}
