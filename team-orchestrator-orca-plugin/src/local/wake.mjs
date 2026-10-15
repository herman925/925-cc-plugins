import {verifyIdleReplacement} from './idle-replacement.mjs';
import {notifyQuestionEvent} from './questions.mjs';
import {readNativeQuestionEvidence} from './native-questions.mjs';
import {readNativeRunEvidence} from './native-run.mjs';
import {nativeLaunchIntent} from './native-launch.mjs';
import {resumedOwner} from './wake-evidence.mjs';
import {userMessage,accepted} from './dispatch.mjs';
import {publicWake} from './wake-store.mjs';
import {readSessionDeath} from './recovery.mjs';
import {withNativeRuntime} from './native-runtime.mjs';
export function createWakeService({store,rpc,userData,consent,works,notify}) {
 const bindingFor=input=>{
  const op=store.readOperation(input.bindingRequestId);if(op)return op;
  const attempt=store.listDispatches().find(a=>a.id===input.bindingRequestId&&a.teamId===input.teamId&&a.memberId===input.memberId),b=attempt?.binding,team=attempt&&store.readTeamVersion(attempt.teamId,attempt.configVersion),member=team?.members.find(m=>m.id===input.memberId);
  if(!b||!member)return null;
  const prepared=store.readMemberOperation(input.memberId);if(prepared&&(b.kind==='structured'?(b.liveSessionId??b.sessionId)!==prepared.sessionId:b.handle!==prepared.handle||b.incarnationId!==prepared.observation?.incarnationId))return null;
  return {...(prepared?{sourceOperationRequestId:prepared.requestId}:{}),requestId:input.bindingRequestId,sourceAttemptId:attempt.id,sourceDispatchId:attempt.dispatchId,sourceWorkId:attempt.workId,teamId:attempt.teamId,memberId:attempt.memberId,configVersion:attempt.configVersion,roleVersion:attempt.roleVersion,version:attempt.version,instanceGeneration:attempt.instanceGeneration??1,status:'created',kind:b.kind,handle:b.handle,sessionId:b.liveSessionId??b.sessionId,paneKey:b.paneKey,scope:attempt.scope,runtimeId:b.runtimeId,executionHostId:b.executionHostId,title:member.name,nativeRequest:{agent:member.agent,sessionOptions:{model:member.model,effort:member.effort}},observation:{ownerFence:b.sessionFence,incarnationId:b.incarnationId},recovery:attempt.recovery};
 };
 const active=op=>op.sourceAttemptId?store.readMemberDispatch?.(op.memberId)?.id===op.sourceAttemptId:store.isActiveOperation(op);
 async function hostGeneration(scope,expected){
  if(!scope.executionHostId.startsWith('ssh:'))return null;
  const state=(await rpc('ssh.getState',{targetId:decodeURIComponent(scope.executionHostId.slice(4))}))?.state;
  if(state?.status!=='connected'||!Number.isSafeInteger(state.connectionGeneration)||(expected!=null&&state.connectionGeneration!==expected))throw Error('Saved recovery host disconnected or changed generation.');return state.connectionGeneration;
 }
 const memberFor=row=>store.readSnapshot().teams.find(t=>t.id===row.teamId)?.members.find(m=>m.id===row.memberId);
 async function stopped(row){
  const op=row.oldBinding;
  if(op.kind==='structured'){const stop=store.readStopProof?.({memberId:op.memberId,requestId:op.sourceAttemptId?undefined:op.requestId,instanceGeneration:op.sourceAttemptId?undefined:op.instanceGeneration,attemptId:op.sourceAttemptId});return readSessionDeath(userData,op.sessionId,row.proof.death?.ownerFence??op.observation?.ownerFence??stop?.death?.ownerFence,op.scope);}
  const proof=store.readStopProof?.({memberId:op.memberId,requestId:op.sourceAttemptId?undefined:op.requestId,instanceGeneration:op.sourceAttemptId?undefined:op.instanceGeneration,attemptId:op.sourceAttemptId});
  if(!proof||!(['native-exact-stop','native-pty-exit','native-worker-exit'].includes(proof.kind)))return null;
  try{const shown=(await rpc('terminal.show',{terminal:op.handle}))?.terminal;if(shown?.connected===true)return null;}catch(error){if(!error.native&&!/not found|missing|not_found/i.test(error.message))return null;}
  return proof;
 }
 async function requestDecision(row){
  if(row.state!=='needs_decision')return row;
  const member=memberFor(row),work=store.readCurrentWork(row.oldBinding.sourceWorkId)??store.listCurrentWorks().find(w=>w.teamId===row.teamId&&w.status!=='completed');
  if(!member?.boss){await notifyQuestionEvent(store,notify,{workId:work?.id??row.teamId,id:`wake-${row.requestId}`,kind:'decision',title:'Supervisor recovery needs your decision',body:'Native continuation is unavailable. Review the saved handoff before creating a replacement conversation.'});return row;}
  if(!works||!work||work.supervisorMemberId!==member.boss||row.managerRequest)return row;
  try{
   const verified=await works.verifyWork(work.id,true),nativeSend=userMessage(work,verified.instance,'TEAM_MEMBER_RECOVERY_REQUEST\n'+JSON.stringify({requestId:row.requestId,memberId:row.memberId,oldRequestId:row.oldBinding.requestId,attemptId:row.oldBinding.sourceAttemptId,dispatchId:row.oldBinding.sourceDispatchId,proof:row.proof,reason:row.detail,instruction:'Review the original task, attempt, result and available evidence. If replacement is appropriate publish a genuine team-questions/v1 recovery-handoff Task with appQuestionId=requestId, memberId, oldRequestId, decision=replace, checked summary and evidence[]. Use your own current Run and identity; do not start a replacement yourself.'}),verified.status);
   row=store.updateWake(row.requestId,row.version,{managerRequest:{state:'submitted',nativeSend,workId:work.id,reviewer:member.boss}});
   await works.verifyHost(work.id,verified.hostGeneration);const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);
   row=store.updateWake(row.requestId,row.version,{managerRequest:{...row.managerRequest,state:accepted(receipt,nativeSend,verified.instance)?'accepted':'unknown'}});
  }catch(error){const current=store.readWake(row.requestId);if(current.managerRequest?.state==='submitted')row=store.updateWake(row.requestId,current.version,{managerRequest:{...current.managerRequest,state:'unknown'}});}
  return row;
 }
 const verifyIdle=op=>verifyIdleReplacement({store,rpc,userData,works,operation:op});
 return {
 async requestReplacement(input){
  if(!input||Object.keys(input).some(k=>!['requestId','teamId','memberId','bindingRequestId','expectedRevision','agent','model','effort','summary','evidenceRefs'].includes(k))||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>4000||!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length||input.evidenceRefs.some(v=>typeof v!=='string'||!v||v.length>1000))throw Error('An explicit replacement decision, handoff summary and evidence references are required.');
  const prior=store.readWake(input.requestId);if(prior){if(prior.mode!=='idle-replacement'||!store.replay('reserveIdleReplacement',input))throw Error('Replacement request conflicts with saved input.');return publicWake(prior);}
  const op=bindingFor(input);if(!op||op.teamId!==input.teamId||op.memberId!==input.memberId||op.status!=='created'||!active(op))throw Error('Choose the current exact member binding.');
  await consent();return withNativeRuntime(rpc,op.runtimeId,async()=>{
   if((await rpc('status.get'))?.runtimeId!==op.runtimeId)throw Error('Replacement runtime changed.');
   const generation=await hostGeneration(op.scope,op.hostGeneration),idle=await verifyIdle(op);await consent();
   store.reserveIdleReplacement(input,op,{idle,runtimeId:op.runtimeId,hostGeneration:generation});return publicWake(store.readWake(input.requestId));
  });
 },
 async validateFresh(id){const row=store.readWake(id);if(row?.state!=='replacing'||!(row.mode==='idle-replacement'?await verifyIdle(row.oldBinding):await stopped(row)))throw Error('Previous execution stopped proof changed before fresh replacement.');await hostGeneration(row.oldBinding.scope,row.proof.hostGeneration);},
 async resolveQuestion(input){
  const row=store.readWake(input?.requestId),work=store.readCurrentWork(input?.workId),question=work&&store.listQuestions(work.id).find(q=>q.id===input.questionId);
  if(row?.state!=='bound'||row.newInstance?.workId!==work?.id||work.recoveryRequestId!==row.requestId||!question||(question.epoch??0)>=(work.epoch??0)||typeof input.note!=='string'||!input.note.trim()||input.note.length>4000)throw Error('Review the exact superseded question and provide a resolution note.');
  await consent();return store.updateQuestion(work.id,question.id,q=>{if(q.resolution){if(q.resolution.recoveryRequestId!==row.requestId||q.resolution.note!==input.note)throw Error('Question already has an immutable user resolution.');return;}q.status='closed';q.resolution={kind:'superseded-by-recovery',by:'user',recoveryRequestId:row.requestId,note:input.note,recordedAt:new Date().toISOString()};});
 },
 async bind(id){
  const row=store.readWake(id);if(!row||!['resumed','replacing'].includes(row.state))return publicWake(row);
  const binding=store.readOperation(row.newInstance.requestId),work=store.listCurrentWorks().find(w=>w.binding.requestId===row.oldBinding.requestId&&w.supervisorMemberId===row.memberId&&w.status!=='completed');
  if(!work||binding?.status!=='created')return publicWake(!work&&row.mode==='idle-replacement'?store.finishIdleReplacement(id):row);
  await consent();return withNativeRuntime(rpc,binding.runtimeId,async()=>{
   await hostGeneration(binding.scope,row.proof.hostGeneration);
   if((await rpc('status.get'))?.runtimeId!==binding.runtimeId||!store.isActiveOperation(binding))throw Error('Recovered supervisor runtime or recipient changed.');
   let instance;
   if(binding.kind==='structured'){
    const address=(await rpc('orchestration.sessionAddress',{sessionId:binding.sessionId}))?.orcaSessionId,location=address&&(await rpc('orchestration.partyLocation',{address}))?.location;
    const owner=await resumedOwner(userData,binding,row.state==='resumed'?row.proof.death.ownerFence:0);
    if(!owner||!address?.startsWith('orca_session_id:')||location?.kind!=='chat'||location.sessionId!==binding.sessionId||location.worktreeId!==work.scope.workspaceId)return publicWake(row);
    instance={kind:'structured',sessionId:address.slice('orca_session_id:'.length),liveSessionId:binding.sessionId,fence:owner.fence};
   }else{
    const shown=(await rpc('terminal.show',{terminal:binding.handle}))?.terminal;
    if(shown?.handle!==binding.handle||shown.worktreeId!==work.scope.workspaceId||shown.executionHostId!==work.scope.executionHostId||shown.incarnationId!==binding.observation?.incarnationId||!shown.connected||!shown.writable)return publicWake(row);
    instance={kind:'terminal',handle:binding.handle,paneKey:binding.paneKey,incarnationId:shown.incarnationId};
   }
   const run=await readNativeRunEvidence(userData,{objective:work.nativeObjective,owner:instance,runId:work.run.id});
   if(run.state!=='verified'||(row.state==='replacing'&&run.consumerGeneration<=(work.run.consumerGeneration??0)))return publicWake(row);
   const shown=(await rpc('orchestration.runShow',{id:run.id}))?.run;
   if(shown?.id!==run.id||shown.consumer_generation!==run.consumerGeneration||shown.objective!==work.nativeObjective)return publicWake(row);
   const final=await readNativeRunEvidence(userData,{objective:work.nativeObjective,owner:instance,runId:run.id});if(final.state!=='verified'||final.consumerGeneration!==run.consumerGeneration)return publicWake(row);
   return publicWake(store.rebindWake(id,row.version,work.id,instance,run));
  });
 },
 async handoff(id){
  const row=store.readWake(id),member=row&&memberFor(row);if(!row||row.state!=='needs_decision'||!member?.boss)throw Error('A subordinate pending handoff is required.');
  const root=store.listCurrentWorks().find(w=>w.teamId===row.teamId&&w.status!=='completed'),work=store.readOwningWork?.(root?.id,row.memberId)??store.readCurrentWork(row.oldBinding.sourceWorkId)??root;
  if(!work||work.supervisorMemberId!==member.boss||!works)throw Error('The actual direct manager Run must be verified before this handoff.');
  const verified=await works.verifyWork(work.id),protocol=store.readDispatchProtocol(work.id),native=await readNativeQuestionEvidence(userData,{work,protocol,owner:verified.instance,attempts:store.listDispatches(work.id)});
  const intent=native.state==='verified'&&native.intents.find(i=>i.spec.kind==='recovery-handoff'&&i.spec.appQuestionId===id&&i.spec.memberId===member.id&&i.spec.oldRequestId===row.oldBinding.requestId&&i.spec.decision==='replace'&&typeof i.spec.summary==='string'&&i.spec.summary.trim()&&i.spec.summary.length<=4000&&Array.isArray(i.spec.evidence)&&i.spec.evidence.length&&i.spec.evidence.every(v=>typeof v==='string'&&v.length<=1000));
  if(!intent)throw Error('A genuine direct manager checked handoff Task is still required.');
  return publicWake(store.updateWake(id,row.version,{state:'approved',handoff:{reviewer:member.boss,decision:'replace',summary:intent.spec.summary,evidenceRefs:intent.spec.evidence,oldRequestId:row.oldBinding.requestId,workId:work.id,runId:work.run.id,generation:work.run.consumerGeneration,nativeTaskId:intent.nativeTaskId,requestId:intent.requestId,payloadHash:intent.payloadHash,recordedAt:new Date().toISOString()}}));
 },
 async decide(input){
  const row=store.readWake(input?.requestId),member=row&&memberFor(row);
  if(!member||member.boss)throw Error('Only the highest supervisor replacement is decided here by the user. A subordinate needs its actual direct manager handoff.');
  if(row.state!=='needs_decision'||input.version!==row.version)throw Error('Recovery decision changed; reopen pending evidence.');
  if(!['replace','wait'].includes(input.decision)||typeof input.summary!=='string'||!input.summary.trim()||input.summary.length>4000||!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length||input.evidenceRefs.some(v=>typeof v!=='string'||!v||v.length>1000))throw Error('A bounded handoff summary and evidence references are required.');
  await consent();return publicWake(store.updateWake(row.requestId,row.version,{state:input.decision==='replace'?'approved':'needs_decision',handoff:{reviewer:'user',decision:input.decision,summary:input.summary,evidenceRefs:input.evidenceRefs,oldRequestId:row.oldBinding.requestId,recordedAt:new Date().toISOString()}}));
 },
 async prepareFresh(id){
  const row=store.readWake(id);if(row?.newInstance?.requestId)return {operation:store.readOperation(row.newInstance.requestId),fresh:false};
  if(row?.state!=='approved'||row.handoff?.decision!=='replace')throw Error('A checked handoff decision is required before fresh replacement.');
  await consent();return withNativeRuntime(rpc,row.proof.runtimeId,async()=>{
   if((await rpc('status.get'))?.runtimeId!==row.proof.runtimeId||!(row.mode==='idle-replacement'?await verifyIdle(row.oldBinding):await stopped(row)))throw Error('Previous execution is not proven stopped in this recovery runtime.');
   await hostGeneration(row.oldBinding.scope,row.proof.hostGeneration);
   const root=store.listCurrentWorks().find(w=>w.teamId===row.teamId&&w.status!=='completed'),team=root&&store.effectiveTeamForWork?store.effectiveTeamForWork(root.id):store.readSnapshot().teams.find(t=>t.id===row.teamId),member=team?.members.find(m=>m.id===row.memberId);if(!member)throw Error('Saved recovery member configuration changed.');
   const nativeRequest=nativeLaunchIntent(team,member,row.oldBinding.scope);
   const work=store.listCurrentWorks().find(w=>w.binding.requestId===row.oldBinding.requestId&&w.status!=='completed');
   nativeRequest.prompt.text+=`\nTEAM_RECOVERY_HANDOFF\nOriginal member ${row.memberId}; original instance ${row.oldBinding.requestId}.\n${row.handoff.summary}\nEvidence: ${row.handoff.evidenceRefs.join(', ')}\nPreserve all original Task/Dispatch identities. ${work?`As your own native identity, run-use ${work.run.id} with the installed Orca CLI; the exact objective remains ${JSON.stringify(work.nativeObjective)}. Never impersonate the old supervisor.`:''} Await verified Run ownership and admission before work.`;
   return store.prepareWakeReplacement(id,row.version,{scope:row.oldBinding.scope,nativeRequest,configVersion:team.configVersion,roleVersion:member.roleVersion,title:row.oldBinding.title,executionHostId:row.oldBinding.executionHostId,runtimeId:row.proof.runtimeId,hostGeneration:row.proof.hostGeneration??null});
  });
 },
 async check(id){
  let row=store.readWake(id);if(row?.state==='submitted')row=store.updateWake(id,row.version,{state:'unknown',detail:'Continuation receipt was lost. Reconciliation never submits it again.'});if(!row||!['accepted','unknown'].includes(row.state))return publicWake(row);
  await consent();return withNativeRuntime(rpc,row.proof.runtimeId,async()=>{
   await hostGeneration(row.oldBinding.scope,row.proof.hostGeneration);
   if((await rpc('status.get'))?.runtimeId!==row.proof.runtimeId)throw Error('Recovery runtime changed; reservation retained.');
   const owner=await resumedOwner(userData,row.oldBinding,row.proof.death.ownerFence);if(!owner)return publicWake(row);
   const history=await rpc('agentSession.history',{sessionId:row.oldBinding.sessionId,direction:'tail',limit:1});
   if(history?.ok!==true||history.page?.sessionId!==row.oldBinding.sessionId||history.page.fence!==owner.fence)return publicWake(row);
   if((await resumedOwner(userData,row.oldBinding,row.proof.death.ownerFence))?.fence!==owner.fence)return publicWake(row);
   return publicWake(store.publishWake(id,row.version,owner));
  });
 },async wake(input){
  if(!input||input.requestId?.length>100||Object.keys(input).some(k=>!['teamId','memberId','requestId','bindingRequestId'].includes(k))||!['teamId','memberId','requestId','bindingRequestId'].every(k=>typeof input[k]==='string'&&/^[a-zA-Z0-9-]{1,120}$/.test(input[k])))throw Error('Choose an exact saved member binding.');
  const prior=store.readWake(input.requestId);if(prior){if(['teamId','memberId','bindingRequestId'].some(k=>prior[k]!==input[k]))throw Error('Recovery request conflicts with saved input.');return publicWake(prior);}
  const op=bindingFor(input);
  if(!op||!active(op)||op.teamId!==input.teamId||op.memberId!==input.memberId||op.status!=='created')throw Error('Current saved member identity is required.');
  await consent();
  const status=await rpc('status.get');if(typeof status?.runtimeId!=='string'||!status.runtimeId)throw Error('Native runtime identity is required for recovery.');
  return withNativeRuntime(rpc,status.runtimeId,async()=>{
   const generation=await hostGeneration(op.scope,op.hostGeneration);
   const work=store.listCurrentWorks().find(w=>w.binding.requestId===op.requestId),fence=work?.instance?.fence??op.observation?.ownerFence;
   const death=await stopped({oldBinding:op,proof:{death:{ownerFence:fence}}});
   if(!death||op.kind==='structured'&&death.provider!==op.nativeRequest.agent)return {state:'blocked',detail:'The exact previous execution has not been proven stopped. Reconcile native death evidence before waking this member.'};
   const selected=(await rpc('worktree.show',{worktree:op.scope.workspaceId.startsWith('folder:')?op.scope.workspaceId:`id:${op.scope.workspaceId}`}))?.worktree;
   if(selected?.id!==op.scope.workspaceId||(selected.hostId??selected.identity?.executionHostId)!==op.scope.executionHostId)throw Error('Saved recovery project or host changed.');
   let offers;try{offers=op.kind==='structured'?await rpc('agentSession.restartResumable',{sessionIds:[op.sessionId]}):null;}catch{/* A failed read admits no native continuation; checked handoff remains required. */}
   const offer=offers?.sessions?.find(s=>s.sessionId===op.sessionId&&s.workspaceId===op.scope.workspaceId&&s.executionHostId===op.scope.executionHostId&&s.agent===op.nativeRequest.agent);
   let action=offer?{method:'agentSession.restartContinue',params:{sessionIds:[op.sessionId]}}:null;
   if(!offer&&op.kind==='structured'){
    let history;try{history=await rpc('agentSession.history',{sessionId:op.sessionId,direction:'tail',limit:1});}catch{/* No resume authority can be inferred from unreadable history. */}
    if(history?.ok===true&&history.page?.sessionId===op.sessionId&&Number.isSafeInteger(history.page.fence)&&history.page.fence>=death.ownerFence){
     action=userMessage({binding:op},{kind:'structured',fence:history.page.fence},`TEAM_MEMBER_WAKE\nMember ${op.memberId}; original operation ${op.requestId}; TeamWork ${work?.id??'preparation'}. Continue this existing conversation after its previous execution was confirmed stopped. ${work?`Use your own native identity to run-use ${work.run.id??'the existing exact objective Run'} and verify its objective ${JSON.stringify(work.nativeObjective)}; never override caller identity.`:''} Preserve original Task and Dispatch report identity. Await verified supervisor admission before new tasks; do not create another worker.`,status);
    }
   }
   const prepared=store.prepareWake(input,op,{death,...(op.kind==='terminal'?{stop:death}:{}),runtimeId:status.runtimeId,hostGeneration:generation},action);
   if(!prepared.fresh||!action)return publicWake(await requestDecision(prepared.row));
   await consent();if(!await stopped({oldBinding:op,proof:{death}}))throw Error('Previous execution is no longer proven stopped.');
   await hostGeneration(op.scope,generation);if((await rpc('status.get'))?.runtimeId!==status.runtimeId)throw Error('Recovery runtime changed before continuation.');
   if(!store.claimWake(input.requestId))return publicWake(store.readWake(input.requestId));
   let patch;
   try{
    const receipt=await rpc(action.method,action.params,action.envelope);
    const entry=action.method==='agentSession.send'?{sessionId:op.sessionId,outcome:accepted(receipt,action,{fence})?'continued':receipt?.ok===false?'refused':'unknown'}:receipt?.continued?.find(r=>r.sessionId===op.sessionId);
    if(!entry||!['continued','pending','unknown','refused'].includes(entry.outcome))throw Error('Native continuation identity is unconfirmed.');
    patch={state:entry.outcome==='continued'?'accepted':entry.outcome==='refused'?'needs_decision':'unknown',receipt:{sessionId:entry.sessionId,outcome:entry.outcome},detail:entry.outcome==='continued'?'Native continuation accepted. New execution and Run authority still require verification.':'Native continuation is unconfirmed or refused; no automatic fallback is allowed.'};
   }catch(error){patch={state:'unknown',detail:String(error.message).slice(0,1200)};}
   const row=store.readWake(input.requestId);return publicWake(await requestDecision(store.updateWake(row.requestId,row.version,patch)));
  });
 }};
}
