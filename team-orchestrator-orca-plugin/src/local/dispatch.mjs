import {sessionDecisionInstructions} from './session-decisions.mjs';
import {controlRuntime,memberControlRuntime} from './runtime-control.mjs';
import {nameDispatchedMember} from './member-names.mjs';
import {terminalIdentity,matchesTerminalObservation} from './terminal-identity.mjs';
import {createKeyedSerializer} from './keyed-serializer.mjs';
import {WORKER_RULES} from '../dispatch.mjs';
import { withNativeRuntime } from './native-runtime.mjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { sendFingerprint } from './teamwork.mjs';
import { readNativeDispatchEvidence } from './native-dispatch.mjs';
import { discoverCapabilities } from './capabilities.mjs';
import { preferenceIssue } from '../capabilities.mjs';
export function dispatchInstructions(work,team,protocol,attempts=[]) {
 const children=team.members.filter(row=>row.boss===work.supervisorMemberId).map(row=>({memberId:row.id,name:row.name,agent:row.agent,model:row.model,effort:row.effort,roleVersion:row.roleVersion,role:{brief:row.brief,habits:row.habits,collaboration:row.collaboration}}));
 return 'TEAM_DISPATCH_PROTOCOL\n'+JSON.stringify({protocol:'team-dispatch/v1',workId:work.id,token:protocol.token,generation:protocol.generation,configVersion:team.configVersion,runId:work.run.id,teamWorkId:work.teamWorkId??work.id,parent:work.parent,sessionDecisions:sessionDecisionInstructions(work),workerRules:WORKER_RULES,children,recoveryReviews:attempts.filter(a=>a.reviewAuthority).map(a=>({attemptId:a.id,nativeTaskId:a.nativeTaskId,dispatchId:a.dispatchId,taskKey:a.taskKey,reviewToken:a.reviewAuthority.reviewToken,evidenceId:a.evidenceId,recoveryRequestId:a.reviewAuthority.recoveryRequestId})),questions:{protocol:'team-questions/v1',instructions:'Members ask their direct owning Run using native orchestration ask, with inherited identity and the same message ID on resume. Ordinary messages follow direct reporting lines. Managers may coordinate explicit real Runs. Worker-to-worker collaboration requires your native Task kind=collaboration-directive with appQuestionId as stable directive ID, fromMemberId, toMemberId, fromAttemptId, toAttemptId, workId, token, generation; both must be your admitted direct children. They still report to their original supervisor. For recovery publish a genuine recovery-handoff Task with appQuestionId=recovery request ID,memberId,oldRequestId,decision=replace,checked summary,evidence[]. Only your actual direct child is eligible. Do not start another session before the plugin permit. To retain an ordinary structured native send as verified panel evidence, publish kind=message-evidence with appQuestionId, fromAttemptId, toMemberId, optional toAttemptId, and nativeMessage {messageId,requestId,params}; params must exactly match the original native parsed send. Terminal ordinary from labels remain unverified and cannot authorize application changes. Only the highest supervisor may publish user-question Task intents. Lower managers publish kind=relay-question with the same fields, escalate using native ask from their original parent Dispatch to the original parent Run, and give the parent their relay record {workId,appQuestionId}. The parent question includes relay {workId,appQuestionId}; repeat through each real manager. Never answer or ask as another manager. Highest supervisor user-question Task intents: use exactly task-create --spec JSON --run this Run --json with protocol,kind=user-question,workId,token,generation,appQuestionId,summary,options[],blockingTaskKeys[],evidence[]. Include origin {attemptId,dispatchId,nativeTaskId,messageId,askRequestId,askParams} for a native worker ask; askParams must be the exact native parsed input including from and compatibility CLI fields. For a highest-Head decision based on a native worker_done completion instead, origin may contain ONLY {attemptId,dispatchId,nativeTaskId,messageId} and evidence must include its exact worker_report:messageId. The plugin verifies this as sourceReport; it is not a native ask and requires no orchestration reply or requester resume. Ordinary message IDs are not completion proof. Keep every originating member and owning Run; never use ordinary message labels as proof. Ask the user in your own highest-supervisor session and record their answer with session-answer as described in sessionDecisions. Legacy saved panel answers may still arrive as TEAM_USER_ANSWER. Reply only as the actual native owning Run consumer, relay through actual lower managers for nested asks, then publish kind=answer-ack with appQuestionId,answerId and same protocol authority. An ack may include nextNativeTaskId to authorize exactly one next step after two failures. Only native execution success resets the consecutive failure count. Awaiting one question never pauses independent tasks. For staffing publish a native Task with protocol team-questions/v1, kind staffing-proposal, appQuestionId, workId, token, generation, proposingManagerId equal to your member ID, current configVersion, roleVersion 1 for the new role, member {name,boss,brief,habits,collaboration,agent,model,effort}, rationale and affectedTaskKeys. Lower managers relay this proposal to the highest supervisor. The highest supervisor asks the user in its own session, then records staffing-decision as described in sessionDecisions. Never allocate a member/session yourself. TEAM_ROSTER_DELTA carries user-approved effective configuration and current direct children; use its configVersion for future tasks and publish native kind roster-ack with appQuestionId, deltaId, configVersion and same protocol authority after incorporation.'},instructions:'You are the real supervisor. For a direct child create exactly one native Task with task-create --spec JSON --run this Run --json, no extra task flags or forged --from. Spec fields: protocol,workId,token,generation,taskKey (stable alphanumeric/hyphen ID),memberId,configVersion,roleVersion,role (exact saved role object),instruction,workerRules (copy the exact workerRules string above into the native Task spec so the actual worker receives it). Do not worker-start yet. Finish your turn and wait for TEAM_DISPATCH_PERMIT. Repeating an unknown request requires the native reported retry-request UUID, never a fresh creation. If you omitted workerRules from a never-admitted, never-dispatched Task, preserve that original. Create one corrected Task whose parsed spec is identical except for adding the exact workerRules. You may then task-update the original --status failed --result JSON --run this Run --json, with no forged --from. The exact result fields are protocol=team-intent-withdrawal/v1, workId, token, generation, supervisorMemberId (your member ID), nativeTaskId (original), taskKey, memberId, replacementNativeTaskId (corrected), reason=missing-worker-rules. Never use withdrawal for a Task with any admission, permit, Dispatch or uncertain execution; it is not a worker failure or a retry. Wait for normal permits for the corrected Task.  Only after the permit, execute worker-start with exactly the supplied startParams using your own inherited native identity. Record native Task/Dispatch receipts; never claim completion from accepted input. Tell each actual worker to use the native worker_done report with its real Task/Dispatch and succeeded/failed outcome. Members stay open while idle. Spec must include writeScope: an array of {path: relative file/directory path, kind: file or directory}; use [] for no writes. All members share the exact selected directory; do not create worktrees. Declared scopes are cooperative coordination, not tool-level isolation. Overlapping scopes wait until acceptance; unknown attempts retain their scope. Spec may include dependencies (application taskKey array). They wait for supervisor acceptance, not native completed. After a native worker_done result, inspect evidence and task-update that same native Task with its unchanged completed/failed status and exact JSON result: protocol team-review/v1, workId,token,generation,taskKey,attemptId,nativeTaskId,dispatchId,reviewToken (from permit),reviewerMemberId (your member),decision accept or rework,evidenceRefs (include worker_report:MESSAGE_ID, where MESSAGE_ID is the id of that attempt\'s actual native worker_done message, and validation references),summary. Use --run this Run, no extra flags or forged caller. The plugin verifies the native taskUpdate receipt; JSON alone is not acceptance. Rework creates a NEW native Task with the SAME taskKey and dependencies plus previousAttemptId equal to the rejected attempt. Wait for a fresh permit; never relaunch the member yourself. Lower managers must keep their original parent Dispatch active until all descendants are accepted and relay questions answered, then themselves report native worker_done for that original Dispatch and original parent Run. Do not create a total delivery from a child Run. Only the highest supervisor, when the overall objective is ready, creates a separate native Task using task-create --spec JSON --run this Run --json, no extra flags. Its exact spec: protocol team-delivery/v1,workId,token,generation,supervisorMemberId (your member ID),previousDeliveryId (null initially, then prior delivery Task ID),summary (overall result),evidenceRefs (validation/artifact references including every latest accepted attempt evidenceId),attemptIds (use the attemptId delivered in each latest TEAM_DISPATCH_PERMIT). The execution evidenceId for an accepted attempt is exactly worker_report:MESSAGE_ID for its actual native worker_done message; use the same reference you included in its native acceptance review. Never invent a message ID or include a superseded attempt. After completing your genuine native acceptance reviews for every latest required attempt, publish the delivery proposal using those IDs and real validation references. Do not wait for a separate plugin acceptance notification. The plugin independently verifies reviews and gates user acceptance; proposing a delivery does not assert plugin or user acceptance. Never approve the overall delivery as the user.'});
}
export function userMessage(work,instance,text,status){
 if(work.binding.kind==='structured'){
  const body={kind:'message',role:'user',blocks:[{type:'text',text}]},sessionId=work.binding.sessionId,delivery=status?.capabilities?.includes('agent-session.queued-messages.v1')?'queue-if-active':undefined;
  return {method:'agentSession.send',params:{envelope:{sessionId,clientOperationId:`${Date.now()}-${randomBytes(16).toString('hex')}`,expectedRuntimeFence:instance.fence,payloadFingerprint:sendFingerprint(sessionId,body,delivery)},body,...(delivery?{delivery}:{})},envelope:{}};
 }
 return {method:'terminal.send',params:{terminal:work.binding.handle,text,enter:true,agentPrompt:true,waitSubmitMs:1000,client:{id:'team-orchestrator',type:'desktop'}},envelope:{orchestrationRequestId:randomUUID()}};
}
export function accepted(receipt,send,instance){
 if(send.method==='agentSession.send')return receipt?.ok===true&&receipt.value?.clientMessageId===send.params.envelope.clientOperationId&&(receipt.value.queued?send.params.delivery==='queue-if-active'&&typeof receipt.value.queued.messageId==='string'&&['waiting','dispatched'].includes(receipt.value.queued.state):['pending','accepted'].includes(receipt.value.submission?.dispatchState));
 return receipt?.send?.accepted===true&&receipt.send.handle===instance.handle&&receipt.send.prompt?.requestId===send.envelope.orchestrationRequestId&&receipt.send.prompt.processIncarnation===instance.incarnationId;
}
export function createDispatchService({store,rpc,userData,consent,works,beforeAdmission,onNativeWait,onClosedMember}) {
 const serialize=createKeyedSerializer();
 const serial=(id,fn)=>serialize(id,()=>withNativeRuntime(rpc,controlRuntime(store.readCurrentWork(id)),fn));
 const project=id=>store.dispatchProjection(id);
 const teamFor=work=>store.effectiveTeamForWork?.(work.id)??store.readTeamVersion(work.teamId,work.configVersion);
 async function evidence(work,protocol,team,verified){return readNativeDispatchEvidence(userData,{work,protocol,team,owner:verified.instance,admitted:store.listDispatches(work.id),nativeHistory:store.readNativeHistory(work.id)});}
 async function sendProtocol(work,team,protocol,verified){
  if(protocol.state!=='not_sent')return protocol;
  const nativeSend=userMessage(work,verified.instance,dispatchInstructions(work,team,protocol,store.listDispatches(work.id)),verified.status);
  await consent();protocol=store.updateDispatchProtocol(work.id,protocol.version,{state:'sending',nativeSend});
  try { await works.verifyHost(work.id,verified.hostGeneration);const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope); if(!accepted(receipt,nativeSend,verified.instance))throw Error('Protocol input was not confirmed; no automatic resend.'); return store.updateDispatchProtocol(work.id,protocol.version,{state:'accepted',detail:receipt.value?.queued?'Native host queued dispatch instructions; waiting for the real supervisor to create Task intents.':'Native host accepted dispatch instructions; the real supervisor must create Task intents.'}); }
  catch(error){return store.updateDispatchProtocol(work.id,protocol.version,{state:'unknown',detail:String(error.message).slice(0,1200)});}
 }
 async function preparedSession(work,member,saved){
  if(!saved||!store.isActiveOperation(saved)||saved.status!=='created'||saved.teamId!==work.teamId||saved.memberId!==member.id||saved.scope?.workspaceKey!==work.scope.workspaceKey||saved.roleVersion!==member.roleVersion||memberControlRuntime(work,saved)!==controlRuntime(work))throw Error('Prepared member is unknown, stale or belongs to another scope; no replacement was launched.');
  const preferences={agent:saved.nativeRequest.agent,model:saved.nativeRequest.sessionOptions?.model??'default',effort:saved.nativeRequest.sessionOptions?.effort??'default'};
  if(Object.keys(preferences).some(key=>preferences[key]!==member[key]))throw Error('Prepared session preferences differ; reuse cannot override model or effort.');
  let terminal,binding,sessionFence;
  if(saved.kind==='structured'){
   if(work.scope.executionHostId!=='local')throw Error('Prepared structured session requires its owning runtime.');
   terminal=(await rpc('orchestration.sessionAddress',{sessionId:saved.sessionId}))?.orcaSessionId;
   if(!terminal?.startsWith('orca_session_id:')||terminal===`orca_session_id:${work.instance.sessionId}`)throw Error('Prepared member canonical target is missing or is the supervisor itself.');
   const location=(await rpc('orchestration.partyLocation',{address:terminal}))?.location;
   if(location?.kind!=='chat'||location.sessionId!==saved.sessionId||location.worktreeId!==work.scope.workspaceId)throw Error('Prepared member session is closed, moved or unverified.');
   const history=await rpc('agentSession.history',{sessionId:saved.sessionId,direction:'tail',limit:1});sessionFence=history?.page?.fence;
   if(history?.ok!==true||history.page?.sessionId!==saved.sessionId||!Number.isSafeInteger(sessionFence)||sessionFence<1)throw Error('Prepared member session fence is unavailable.');
   binding={kind:'structured',handle:terminal,sessionId:terminal.slice('orca_session_id:'.length),liveSessionId:saved.sessionId,paneKey:null,incarnationId:null,sessionFence,workspaceId:work.scope.workspaceId,executionHostId:work.scope.executionHostId,runtimeId:saved.runtimeId};
  }else{
   const live=(await rpc('terminal.show',{terminal:saved.handle}))?.terminal;
   if(live?.handle!==saved.handle||!matchesTerminalObservation(live,saved.observation)||`${live.tabId}:${live.leafId}`!==saved.paneKey||live.worktreeId!==work.scope.workspaceId||live.executionHostId!==work.scope.executionHostId||live.agentIdentity!==member.agent||!live.connected||!live.writable||saved.handle===work.binding.handle)throw Error('Prepared member terminal is unverified; no replacement was launched.');
   terminal=saved.handle;binding={kind:'terminal',handle:terminal,paneKey:saved.paneKey,incarnationId:terminalIdentity(live).processIncarnation,workspaceId:work.scope.workspaceId,executionHostId:work.scope.executionHostId,runtimeId:saved.runtimeId};
  }
  if(!store.isActiveOperation(saved))throw Error('Prepared member generation changed during verification.');
  return {kind:'prepared',requestId:saved.requestId,...(saved.wakeRequestId?{recoveryRequestId:saved.wakeRequestId}:{}),...(saved.instanceGeneration?{instanceGeneration:saved.instanceGeneration}:{}),binding,terminal,...(sessionFence?{sessionFence}:{}),preferences};
 }
 async function retainedSession(work,member,prior){
  if(!prior?.binding||!['accepted','rework'].includes(prior.status)||prior.workId!==work.id||prior.roleVersion!==member.roleVersion)throw Error('Member has an unresolved reservation; do not launch another session.');
  const saved=prior.binding,shown=await rpc('orchestration.workerShow',{dispatch:prior.dispatchId});
  if(shown?.dispatch?.id!==prior.dispatchId||shown.dispatch.assigneeHandle!==saved.handle||shown.worker?.worktreeId!==work.scope.workspaceId||shown.worker.runtimeEpoch!==saved.runtimeId||shown.observation?.exactWorker!==true||shown.observation.status!=='live'||shown.observation.agentWait)throw Error('Retained member session is not verified live; no replacement was launched.');
  let terminal,sessionFence;
  if(saved.kind==='structured'){
   if(work.scope.executionHostId!=='local')throw Error('Retained structured session requires its owning runtime.');
   terminal=(await rpc('orchestration.sessionAddress',{sessionId:saved.liveSessionId??saved.sessionId}))?.orcaSessionId;
   if(terminal!==`orca_session_id:${saved.sessionId}`)throw Error('Retained member canonical identity changed.');
   const location=(await rpc('orchestration.partyLocation',{address:terminal}))?.location;
   if(location?.kind!=='chat'||location.sessionId!==(saved.liveSessionId??saved.sessionId)||location.worktreeId!==work.scope.workspaceId)throw Error('Retained member session is closed, moved or has unverified lineage.');
   const history=await rpc('agentSession.history',{sessionId:location.sessionId,direction:'tail',limit:1});
   sessionFence=history?.page?.fence;
   if(history?.ok!==true||history.page?.sessionId!==location.sessionId||!Number.isSafeInteger(sessionFence)||sessionFence<1||(saved.sessionFence!==undefined&&saved.sessionFence!==sessionFence))throw Error('Retained member session fence is unavailable.');
  }else{
   const live=(await rpc('terminal.show',{terminal:saved.handle}))?.terminal;
   if(live?.handle!==saved.handle||terminalIdentity(live).processIncarnation!==saved.incarnationId||`${live.tabId}:${live.leafId}`!==saved.paneKey||live.worktreeId!==work.scope.workspaceId||live.executionHostId!==work.scope.executionHostId||live.agentIdentity!==member.agent||!live.connected||!live.writable)throw Error('Retained member terminal instance is unverified.');
   terminal=saved.handle;
  }
  const original=prior.reuse?.preferences??{agent:prior.startParams.agent,model:prior.startParams.model??'default',effort:prior.startParams.effort??'default'};
  if(original.agent!==member.agent||original.model!==member.model||original.effort!==member.effort)throw Error('Retained session preferences differ; no second session was launched.');
  return {attemptId:prior.id,binding:saved,terminal,...(sessionFence?{sessionFence}:{}),preferences:original};
 }
 async function permit(work,attempt){
  store.assertAdmission(work.teamId,attempt.memberId);
  if(attempt.permit.state!=='not_sent')return;
  const verified=await works.verifyWork(work.id,true),protocol=store.readDispatchProtocol(work.id),team=store.readTeamVersion(work.teamId,attempt.configVersion);
  if(attempt.token!==protocol.token||attempt.generation!==protocol.generation)throw Error('This permit belongs to an earlier supervisor epoch; preserve its original attempt.');
  const member=team.members.find(row=>row.id===attempt.memberId);
  if(!member||member.boss!==work.supervisorMemberId||member.roleVersion!==attempt.roleVersion||(!attempt.reuse&&(attempt.startParams.agent!==member.agent||(attempt.startParams.model??'default')!==member.model||(attempt.startParams.effort??'default')!==member.effort)))throw Error('Saved permit preferences or direct supervisor do not match the frozen member.');
  if(attempt.reuse){const prior=store.listDispatches(work.id).find(row=>row.id===attempt.reuse.attemptId),prepared=store.readMemberOperation(member.id),current=attempt.reuse.kind==='prepared'?await preparedSession(work,member,prepared):await retainedSession(work,member,prior);if(JSON.stringify(current)!==JSON.stringify(attempt.reuse))throw Error('Retained member changed before permit; reservation preserved.');}
  const checked=await evidence(store.readCurrentWork(work.id),protocol,team,verified);
  if(checked.state!=='verified')throw Error(checked.detail);
  const existing=checked.observations.find(row=>row.id===attempt.id);
  if(existing?.state!=='absent') {
   store.updateDispatch(attempt.id,attempt.version,{admission:'unadmitted',status:'unknown',permit:{state:'unknown'},detail:'Native work appeared before the user-input permit. It is retained unadmitted; no permit or replacement was sent.'});
   return;
  }
  const text='TEAM_DISPATCH_PERMIT\n'+JSON.stringify({workId:work.id,attemptId:attempt.id,memberId:attempt.memberId,roleVersion:attempt.roleVersion,configVersion:attempt.configVersion,nativeTaskId:attempt.nativeTaskId,generation:attempt.generation,reviewToken:attempt.reviewToken,reviewProtocol:'team-review/v1',startParams:attempt.startParams,instruction:'Admission was committed. Execute this native worker-start once as your own supervisor identity. Never override from/devMode. Preserve reported request/Dispatch IDs; uncertain delivery is not permission for another worker.'});
  const nativeSend=userMessage(work,verified.instance,text,verified.status);
  await consent();store.assertAdmission(work.teamId,attempt.memberId);attempt=store.updateDispatch(attempt.id,attempt.version,{permit:{state:'sending',nativeSend}});
  try { await works.verifyHost(work.id,verified.hostGeneration);store.assertAdmission(work.teamId,attempt.memberId);const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);if(!accepted(receipt,nativeSend,verified.instance))throw Error('Native permit delivery is unconfirmed; do not resend.');store.updateDispatch(attempt.id,attempt.version,{status:'awaiting_start',permit:{state:'accepted',nativeSend},detail:receipt.value?.queued?'Native host queued the permit for the busy supervisor; waiting for genuine worker-start evidence.':'Input accepted; waiting for genuine supervisor worker-start evidence.'}); }
  catch(error){store.updateDispatch(attempt.id,attempt.version,{status:'unknown',permit:{state:'unknown',nativeSend},detail:String(error.message).slice(0,1200)});}
 }
 async function check(workId){
  const work=store.readCurrentWork(workId);if(!work||work.status==='completed'||work.run.state!=='verified')return project(workId);
  try {
   const verified=await works.verifyWork(workId),team=teamFor(work);let checkIssue=false;
   let protocol=store.ensureDispatchProtocol(workId);
   let native=await evidence(work,protocol,team,verified);if(native.state!=='verified')throw Error(native.detail);
   if(protocol.state==='sending')protocol=store.updateDispatchProtocol(workId,protocol.version,{state:'unknown',detail:'Protocol submission was interrupted; it is not automatically sent again.'});
   if(protocol.state==='unknown'&&native.intents.length)protocol=store.updateDispatchProtocol(workId,protocol.version,{state:'accepted',detail:'Native supervisor-authored Task proves receipt of this exact admission protocol.'});
   protocol=await sendProtocol(work,team,protocol,verified);if(protocol.state!=='accepted')return project(workId);
   native=await evidence(work,protocol,team,verified);if(native.state!=='verified')throw Error(native.detail);
   await beforeAdmission?.(workId);
   for(const intent of native.intents){
    try{
     if(!intent.unadmitted){const caps=await discoverCapabilities(rpc,work.scope),issue=preferenceIssue(intent.member,caps,{requireCore:true});if(issue)throw Error(issue);}
     const current=await works.verifyWork(workId),fresh=await evidence(store.readCurrentWork(workId),protocol,team,current);
     const currentIntent=fresh.intents.find(row=>row.nativeTaskId===intent.nativeTaskId&&row.payloadHash===intent.payloadHash);
     if(fresh.state!=='verified'||!currentIntent)throw Error('Native intent changed during admission.');
     const prior=store.listDispatches(workId).filter(row=>row.memberId===intent.member.id).at(-1);
     const prepared=store.readMemberOperation(intent.member.id),recovery=prepared?.wakeRequestId&&store.readWake(prepared.wakeRequestId);
     const recovered=prior&&recovery&&recovery.newInstance?.requestId===prepared.requestId&&(recovery.oldBinding.sourceAttemptId===prior.id||prior.reuse?.requestId===recovery.oldBinding.requestId);
     let reuse;try{reuse=recovered?await preparedSession(work,intent.member,prepared):prior?await retainedSession(work,intent.member,prior):prepared?await preparedSession(work,intent.member,prepared):undefined;}catch(error){
      const bindingRequestId=prior?.id??prepared?.requestId;if(bindingRequestId&&onClosedMember)await onClosedMember({teamId:work.teamId,memberId:intent.member.id,bindingRequestId,requestId:'taskwake-'+createHash('sha256').update(JSON.stringify([work.id,intent.member.id,bindingRequestId])).digest('hex').slice(0,48)});throw error;
     }
     const startParams={task:intent.nativeTaskId,worktree:work.scope.workspaceId.startsWith('folder:')?work.scope.workspaceId:`id:${work.scope.workspaceId}`,agent:intent.member.agent,run:work.run.id,...(intent.member.model!=='default'?{model:intent.member.model}:{}),...(intent.member.effort!=='default'?{effort:intent.member.effort}:{})};
     if(reuse){delete startParams.agent;delete startParams.model;delete startParams.effort;startParams.terminal=reuse.terminal;}
     const admitted=store.prepareDispatch(workId,currentIntent,startParams,reuse);if(admitted.fresh&&!currentIntent.unadmitted)await permit(work,admitted.attempt);
    }catch(error){checkIssue=true;store.queueDispatch(workId,intent,error.message);protocol=store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:String(error.message).slice(0,1200)});}
   }
   // Resume only unsent, committed permits; sending/unknown never becomes a fresh input.
   for(const attempt of store.listDispatches(workId))if(attempt.permit.state==='not_sent')try{await permit(work,attempt);}catch(error){checkIssue=true;store.updateDispatch(attempt.id,attempt.version,{detail:String(error.message).slice(0,1200)});}
   native=await evidence(store.readCurrentWork(workId),protocol,team,await works.verifyWork(workId));if(native.state!=='verified')throw Error(native.detail);
   for(const observed of native.observations){
    let attempt=store.listDispatches(workId).find(row=>row.id===observed.id);
    try {
    if(attempt.evidenceId){await nameDispatchedMember({store,rpc,consent,work,attempt,team});continue;}
    if(observed.state!=='verified'){if(attempt.permit.state==='sending')attempt=store.updateDispatch(attempt.id,attempt.version,{status:'unknown',permit:{...attempt.permit,state:'unknown'},detail:'Permit delivery interrupted; reconciliation never resends.'});else if(observed.state==='unverified')store.updateDispatch(attempt.id,attempt.version,{status:'unknown',detail:observed.detail});continue;}
    const shown=await rpc('orchestration.workerShow',{dispatch:observed.dispatchId});
    if(shown?.dispatch?.id!==observed.dispatchId||shown.dispatch.runId!==work.run.id||shown.dispatch.taskId!==attempt.nativeTaskId||shown.dispatch.assigneeHandle!==observed.binding.handle||shown.worker?.worktreeId!==work.scope.workspaceId)throw Error('Native worker projection does not match admitted member identity.');
    await onNativeWait?.(workId,{...attempt,binding:observed.binding,dispatchId:observed.dispatchId},shown);
    const final=await evidence(store.readCurrentWork(workId),protocol,team,await works.verifyWork(workId)),settled=final.observations.find(row=>row.id===attempt.id);
    if(final.state!=='verified'||settled?.state!=='verified'||settled.dispatchId!==observed.dispatchId||JSON.stringify(settled.binding)!==JSON.stringify(observed.binding))throw Error('Native Dispatch changed during observation.');
    // An independent recovery pass may have advanced this attempt during the awaits.
    // Discard superseded evidence; never retry an old patch against a newer version.
    if(store.listDispatches(workId).find(row=>row.id===attempt.id)?.version!==attempt.version){checkIssue=true;continue;}
    store.updateDispatch(attempt.id,attempt.version,{dispatchId:settled.dispatchId,creatorDispatchId:settled.creatorDispatchId,...(settled.depth?{depth:settled.depth}:{}),binding:settled.binding,permit:{...attempt.permit,state:'accepted',source:'native-worker-start'},nativeState:settled.nativeState,startRequestId:settled.startRequestId,startPayloadHash:settled.startPayloadHash,...(settled.completion?{status:'pending_acceptance',...settled.completion,detail:'Native execution report recorded. Direct supervisor acceptance is still required.'}:{status:settled.nativeState==='ready'&&shown.observation?.exactWorker===true&&shown.observation.status==='live'&&!shown.observation.agentWait?'running':'unknown',detail:shown.observation?.agentWait?'Native session is waiting for input or authorization. Resolve its native tab; no replacement was started.':shown.observation?.exactWorker===true&&shown.observation.status==='live'?'Native assignment observed; execution result is not yet proven.':'Native worker observation is unverified; its saved identity remains reserved.'})});
    await nameDispatchedMember({store,rpc,consent,work,attempt:store.readMemberDispatch(attempt.memberId),team});
    }catch(error){checkIssue=true;const failed=store.listDispatches(workId).find(row=>row.id===observed.id);if(failed&&!failed.evidenceId&&failed.version===attempt.version)store.updateDispatch(failed.id,failed.version,{status:'unknown',detail:String(error.message).slice(0,1200)});}
   }
   const reviewEvidence=await evidence(store.readCurrentWork(workId),protocol,team,await works.verifyWork(workId));
   if(reviewEvidence.state!=='verified')throw Error(reviewEvidence.detail);
   store.recordIntentWithdrawals(workId,reviewEvidence.withdrawnIntents??[]);
   for(const review of reviewEvidence.reviews??[])try{store.recordDispatchReview(review.attemptId,review);}catch(error){checkIssue=true;store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:String(error.message).slice(0,1200)});}
   if(reviewEvidence.rejected.length)native.rejected=reviewEvidence.rejected;
   if(native.rejected.length)store.updateDispatchProtocol(workId,store.readDispatchProtocol(workId).version,{detail:native.rejected[0].detail});
   const attempts=store.listDispatches(workId),currentProtocol=store.readDispatchProtocol(workId);
   const detail='Native supervisor protocol and current Dispatch evidence verified.';
   if(!checkIssue&&!native.rejected.length&&!reviewEvidence.rejected.length&&!reviewEvidence.intents.length&&!reviewEvidence.unmanaged.length&&attempts.length&&attempts.every(attempt=>['running','pending_acceptance','accepted','rework'].includes(attempt.status)&&reviewEvidence.observations.some(row=>row.id===attempt.id&&row.state==='verified'&&row.dispatchId===attempt.dispatchId&&JSON.stringify(row.binding)===JSON.stringify(attempt.binding)))&&currentProtocol.version===protocol.version&&currentProtocol.detail!==detail)store.updateDispatchProtocol(workId,currentProtocol.version,{detail});

  }catch(error){const protocol=store.readDispatchProtocol(workId);if(protocol)store.updateDispatchProtocol(workId,protocol.version,{detail:String(error.message).slice(0,1200)});}
  return project(workId);
 }
 return {check:id=>serial(id,()=>check(id)),async reconcile(){for(const work of store.listCurrentWorks().flatMap(w=>store.listRunWorks(w.id)))if(work.run.state==='verified')await this.check(work.id);}};
}
