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
  return {requestId:input.bindingRequestId,sourceAttemptId:attempt.id,sourceDispatchId:attempt.dispatchId,sourceWorkId:attempt.workId,teamId:attempt.teamId,memberId:attempt.memberId,configVersion:attempt.configVersion,roleVersion:attempt.roleVersion,version:attempt.version,instanceGeneration:attempt.instanceGeneration??1,status:'created',kind:b.kind,handle:b.handle,sessionId:b.liveSessionId??b.sessionId,paneKey:b.paneKey,scope:attempt.scope,runtimeId:b.runtimeId,executionHostId:b.executionHostId,title:member.name,nativeRequest:{agent:member.agent,sessionOptions:{model:member.model,effort:member.effort}},observation:{ownerFence:b.sessionFence,incarnationId:b.incarnationId},recovery:attempt.recovery};
 };
 const active=op=>op.sourceAttemptId?store.readMemberDispatch?.(op.memberId)?.id===op.sourceAttemptId:store.isActiveOperation(op);
 const memberFor=row=>store.readSnapshot().teams.find(t=>t.id===row.teamId)?.members.find(m=>m.id===row.memberId);
 async function stopped(row){return row.oldBinding.kind==='structured'&&await readSessionDeath(userData,row.oldBinding.sessionId,row.proof.death.ownerFence,row.oldBinding.scope);}
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
 return {
 async bind(id){
  const row=store.readWake(id);if(!row||!['resumed','replacing'].includes(row.state))return publicWake(row);
  const binding=store.readOperation(row.newInstance.requestId),work=store.listCurrentWorks().find(w=>w.binding.requestId===row.oldBinding.requestId&&w.supervisorMemberId===row.memberId&&w.status!=='completed');
  if(!work||binding?.status!=='created')return publicWake(row);
  await consent();return withNativeRuntime(rpc,binding.runtimeId,async()=>{
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
  const work=store.readCurrentWork(row.oldBinding.sourceWorkId)??store.listCurrentWorks().find(w=>w.teamId===row.teamId&&w.status!=='completed');
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
   if((await rpc('status.get'))?.runtimeId!==row.proof.runtimeId||!await stopped(row))throw Error('Previous execution is not proven stopped in this recovery runtime.');
   const team=store.readSnapshot().teams.find(t=>t.id===row.teamId),member=memberFor(row);if(!member||team.configVersion!==row.oldBinding.configVersion)throw Error('Saved recovery member configuration changed.');
   const nativeRequest=nativeLaunchIntent(team,member,row.oldBinding.scope);
   const work=store.listCurrentWorks().find(w=>w.binding.requestId===row.oldBinding.requestId&&w.status!=='completed');
   nativeRequest.prompt.text+=`\nTEAM_RECOVERY_HANDOFF\nOriginal member ${row.memberId}; original instance ${row.oldBinding.requestId}.\n${row.handoff.summary}\nEvidence: ${row.handoff.evidenceRefs.join(', ')}\nPreserve all original Task/Dispatch identities. ${work?`As your own native identity, run-use ${work.run.id} with the installed Orca CLI; the exact objective remains ${JSON.stringify(work.nativeObjective)}. Never impersonate the old supervisor.`:''} Await verified Run ownership and admission before work.`;
   return store.prepareWakeReplacement(id,row.version,{scope:row.oldBinding.scope,nativeRequest,roleVersion:member.roleVersion,title:row.oldBinding.title,executionHostId:row.oldBinding.executionHostId,runtimeId:row.proof.runtimeId,hostGeneration:row.proof.hostGeneration??null});
  });
 },
 async check(id){
  const row=store.readWake(id);if(!row||!['accepted','unknown'].includes(row.state))return publicWake(row);
  await consent();return withNativeRuntime(rpc,row.proof.runtimeId,async()=>{
   if((await rpc('status.get'))?.runtimeId!==row.proof.runtimeId)throw Error('Recovery runtime changed; reservation retained.');
   const owner=await resumedOwner(userData,row.oldBinding,row.proof.death.ownerFence);if(!owner)return publicWake(row);
   const history=await rpc('agentSession.history',{sessionId:row.oldBinding.sessionId,direction:'tail',limit:1});
   if(history?.ok!==true||history.page?.sessionId!==row.oldBinding.sessionId||history.page.fence!==owner.fence)return publicWake(row);
   if((await resumedOwner(userData,row.oldBinding,row.proof.death.ownerFence))?.fence!==owner.fence)return publicWake(row);
   return publicWake(store.publishWake(id,row.version,owner));
  });
 },async wake(input){
  if(!input||Object.keys(input).some(k=>!['teamId','memberId','requestId','bindingRequestId'].includes(k))||!['teamId','memberId','requestId','bindingRequestId'].every(k=>typeof input[k]==='string'&&/^[a-zA-Z0-9-]{1,120}$/.test(input[k])))throw Error('Choose an exact saved member binding.');
  const prior=store.readWake(input.requestId);if(prior){if(['teamId','memberId','bindingRequestId'].some(k=>prior[k]!==input[k]))throw Error('Recovery request conflicts with saved input.');return publicWake(prior);}
  const op=bindingFor(input);
  if(!op||!active(op)||op.teamId!==input.teamId||op.memberId!==input.memberId||op.status!=='created')throw Error('Current saved member identity is required.');
  await consent();
  const status=await rpc('status.get');
  return withNativeRuntime(rpc,status.runtimeId,async()=>{
   const work=store.listCurrentWorks().find(w=>w.binding.requestId===op.requestId),fence=work?.instance?.fence??op.observation?.ownerFence;
   const death=op.kind==='structured'&&await readSessionDeath(userData,op.sessionId,fence,op.scope);
   if(!death)return {state:'blocked',detail:'The exact previous execution has not been proven stopped. Reconcile native death evidence before waking this member.'};
   const selected=(await rpc('worktree.show',{worktree:op.scope.workspaceId.startsWith('folder:')?op.scope.workspaceId:`id:${op.scope.workspaceId}`}))?.worktree;
   if(selected?.id!==op.scope.workspaceId||(selected.hostId??selected.identity?.executionHostId)!==op.scope.executionHostId)throw Error('Saved recovery project or host changed.');
   const offers=await rpc('agentSession.restartResumable',{sessionIds:[op.sessionId]});
   const offer=offers?.sessions?.find(s=>s.sessionId===op.sessionId&&s.workspaceId===op.scope.workspaceId&&s.executionHostId===op.scope.executionHostId&&s.agent===op.nativeRequest.agent);
   let action=offer?{method:'agentSession.restartContinue',params:{sessionIds:[op.sessionId]}}:null;
   if(!offer){
    const history=await rpc('agentSession.history',{sessionId:op.sessionId,direction:'tail',limit:1});
    if(history?.ok===true&&history.page?.sessionId===op.sessionId&&Number.isSafeInteger(history.page.fence)&&history.page.fence>=fence){
     action=userMessage({binding:op},{kind:'structured',fence:history.page.fence},`TEAM_MEMBER_WAKE\nMember ${op.memberId}; original operation ${op.requestId}; TeamWork ${work?.id??'preparation'}. Continue this existing conversation after its previous execution was confirmed stopped. ${work?`Use your own native identity to run-use ${work.run.id??'the existing exact objective Run'} and verify its objective ${JSON.stringify(work.nativeObjective)}; never override caller identity.`:''} Preserve original Task and Dispatch report identity. Await verified supervisor admission before new tasks; do not create another worker.`,status);
    }
   }
   const prepared=store.prepareWake(input,op,{death,runtimeId:status.runtimeId},action);
   if(!prepared.fresh||!action)return publicWake(await requestDecision(prepared.row));
   await consent();if(!await readSessionDeath(userData,op.sessionId,fence,op.scope))throw Error('Previous execution is no longer proven stopped.');
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
