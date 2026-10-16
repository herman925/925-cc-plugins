import {matchesTerminalObservation} from './terminal-identity.mjs';
import {withNativeRuntime} from './native-runtime.mjs';
import {sameStopIdentity} from './stop-store.mjs';
import {readNativeDispatchEvidence} from './native-dispatch.mjs';
import {readSessionDeath} from './recovery.mjs';
import {readStopReceipt} from './native-stop.mjs';
const stamp=()=>new Date().toISOString();
export function createStopService({store,rpc,userData,consent}){
 const workFor=id=>store.readCurrentWork?.(id)??store.readWork(id);
 function target(input){
  if(Object.keys(input??{}).some(k=>!['requestId','teamId','memberId','workId','attemptId','operationRequestId'].includes(k)))throw Error('Invalid stop selection.');
  const team=store.readSnapshot().teams.find(t=>t.id===input.teamId);if(!team?.members.some(m=>m.id===input.memberId))throw Error('Choose an existing team member.');
  const reserved=store.readReceipt(`dispatch-member:${input.memberId}`);
  if(input.attemptId){const attempt=store.listDispatches(input.workId).find(a=>a.id===input.attemptId),work=workFor(input.workId);if(!attempt||reserved?.id!==attempt.id||attempt.teamId!==team.id||attempt.memberId!==input.memberId||!attempt.dispatchId||!attempt.binding||work?.run.id!==attempt.runId||work.run.consumerGeneration!==attempt.generation)throw Error('Current member, TeamWork, Task and Dispatch binding is required.');return {teamId:team.id,memberId:input.memberId,workId:work.id,attemptId:attempt.id,dispatchId:attempt.dispatchId,nativeTaskId:attempt.nativeTaskId,runId:work.run.id,generation:attempt.generation,binding:attempt.binding,scope:work.scope};}
  const operation=store.readOperation(input.operationRequestId);if(reserved||!operation||!store.isActiveOperation(operation)||operation.teamId!==team.id||operation.memberId!==input.memberId||operation.status!=='created')throw Error('Choose the current exact member execution; assigned members require their Task and Dispatch.');
  const work=(store.listCurrentWorks?.()??store.listWorks()).find(w=>w.binding.requestId===operation.requestId),binding={kind:operation.kind,handle:operation.handle,paneKey:operation.paneKey,sessionId:operation.sessionId,runtimeId:operation.runtimeId,incarnationId:work?.instance?.incarnationId??operation.observation?.incarnationId,ptyId:work?.instance?.ptyId??operation.observation?.ptyId,processIncarnation:work?.instance?.processIncarnation??operation.observation?.processIncarnation,ownerFence:work?.instance?.fence??operation.observation?.ownerFence};
  return {teamId:team.id,memberId:input.memberId,operationRequestId:operation.requestId,instanceGeneration:operation.instanceGeneration??1,...(work?{workId:work.id}:{}),binding,scope:operation.scope};
 }
 function current(row){const input={teamId:row.target.teamId,memberId:row.target.memberId,...(row.target.attemptId?{workId:row.target.workId,attemptId:row.target.attemptId}:{operationRequestId:row.target.operationRequestId})};if(!sameStopIdentity(target(input),row.target))throw Error('Member execution changed; the original stop remains reserved.');}
 async function verify(row){
  current(row);await consent();const t=row.target,b=t.binding,status=await rpc('status.get');if(!b.runtimeId||status?.runtimeId!==b.runtimeId)throw Error('Native runtime changed; reconcile the original execution.');
  return withNativeRuntime(rpc,b.runtimeId,async()=>{
   let generation=null;const host=async()=>{if(t.scope.executionHostId==='local')return null;const state=(await rpc('ssh.getState',{targetId:decodeURIComponent(t.scope.executionHostId.slice(4))}))?.state;if(state?.status!=='connected'||!Number.isSafeInteger(state.connectionGeneration))throw Error('Stop host is disconnected or unverified.');return state.connectionGeneration;};generation=await host();
   const workspace=(await rpc('worktree.show',{worktree:t.scope.workspaceId.startsWith('folder:')?t.scope.workspaceId:`id:${t.scope.workspaceId}`}))?.worktree;if(workspace?.id!==t.scope.workspaceId||(workspace.hostId??workspace.identity?.executionHostId)!==t.scope.executionHostId)throw Error('Stop workspace or host changed.');
   let plan;
   if(t.attemptId){const work=workFor(t.workId),attempt=store.listDispatches(t.workId).find(a=>a.id===t.attemptId),proof=await readNativeDispatchEvidence(userData,{work,protocol:store.readDispatchProtocol(work.id),team:store.readTeamVersion(work.teamId,work.configVersion),owner:work.instance,admitted:[attempt]}),found=proof.observations?.find(a=>a.id===attempt.id);if(proof.state!=='verified'||found?.state!=='verified'||found.dispatchId!==t.dispatchId||!sameStopIdentity(found.binding,b))throw Error('Native Task/Dispatch author and current member binding are unverified.');
    const shown=await rpc('orchestration.workerShow',{dispatch:t.dispatchId}),d=shown?.dispatch,w=shown?.worker,h=d?.hostScope;const hostMatches=t.scope.executionHostId==='local'?h?.kind==='local'&&h.hostId==='local':h?.kind==='ssh'&&`ssh:${encodeURIComponent(h.targetId)}`===t.scope.executionHostId;
    if(shown.observation?.exactWorker!==true||!['live','exited'].includes(shown.observation?.status)||!hostMatches||d?.id!==t.dispatchId||d.runId!==t.runId||d.taskId!==t.nativeTaskId||d.assigneeHandle!==b.handle||d.assigneePaneKey!==b.paneKey||d.processIncarnation!==b.incarnationId||(d.creatorDispatchId??null)!==(found.creatorDispatchId??null)||w?.dispatchId!==t.dispatchId||w.worktreeId!==t.scope.workspaceId||w.runtimeEpoch!==b.runtimeId)throw Error('Native worker ownership changed.');
    plan={method:'orchestration.workerStop',params:{dispatch:t.dispatchId},envelope:{orchestrationRequestId:row.nativeRequestId},...(shown.observation.status==='exited'?{exitedProof:{kind:'native-worker-exit',dispatchId:t.dispatchId}}:{})};
   }else if(b.kind==='terminal'){
    if(t.scope.executionHostId!=='local')throw Object.assign(Error('Exact standalone terminal stop is unsupported for this remote host.'),{unsupported:true});
    const shown=(await rpc('terminal.show',{terminal:b.handle}))?.terminal;
    if(!matchesTerminalObservation(shown,b)||shown.handle!==b.handle||`${shown.tabId}:${shown.leafId}`!==b.paneKey||shown.worktreeId!==t.scope.workspaceId||shown.executionHostId!==t.scope.executionHostId||typeof shown.ptyId!=='string'||!shown.ptyId)throw Error('Exact native terminal PTY and incarnation are unverified.');
    plan={method:'terminal.stopExact',params:{worktree:t.scope.workspaceId.startsWith('folder:')?t.scope.workspaceId:`id:${t.scope.workspaceId}`,expectedPtyIds:[shown.ptyId],keepHistory:true,targetOnly:true},envelope:{}};
   }else{
    if(t.scope.executionHostId!=='local'||!Number.isSafeInteger(b.ownerFence)||b.ownerFence<1)throw Object.assign(Error('Exact structured owner fence is unavailable; native stop is unsupported for this binding.'),{unsupported:true});
    const location=(await rpc('orchestration.partyLocation',{address:`orca_session_id:${b.sessionId}`}))?.location,history=await rpc('agentSession.history',{sessionId:b.sessionId,direction:'tail',limit:1});if(location?.sessionId!==b.sessionId||location.worktreeId!==t.scope.workspaceId||history?.ok!==true||history.page?.sessionId!==b.sessionId||history.page.fence!==b.ownerFence)throw Error('Structured conversation owner changed.');
    plan={method:'agentSession.close',params:{sessionId:b.sessionId},envelope:{}};
   }
   if(await host()!==generation||(await rpc('status.get'))?.runtimeId!==b.runtimeId)throw Error('Native host generation changed before stop.');current(row);await consent();return {...plan,runtimeId:b.runtimeId,executionHostId:t.scope.executionHostId,hostGeneration:generation,...(plan.method==='terminal.stopExact'?{terminalIdentity:{handle:b.handle,incarnationId:b.incarnationId,ptyId:plan.params.expectedPtyIds[0],paneKey:b.paneKey,workspaceId:t.scope.workspaceId}}:{})};
  });
 }
 async function settle(id,receipt,error){let row=store.readStop(id);if(!row||!['submitted','unknown'].includes(row.state))return row;let state=error?.native===true&&['method_not_found','method_not_supported'].includes(error.code)?'unsupported':'unknown',proof;
  if(!error&&row.plan?.method==='orchestration.workerStop'&&receipt?.dispatchId===row.target.dispatchId&&receipt.state==='stopped'&&receipt.close?.ptyKilled===true){state='stopped';proof={kind:'native-pty-exit',ptyKilled:true};}
  if(!error&&row.plan?.method==='terminal.stopExact'&&receipt?.postStopVerified===true&&receipt.stoppedPtyIds?.includes(row.plan.params.expectedPtyIds[0])){state='stopped';proof={kind:'native-exact-stop',ptyId:row.plan.params.expectedPtyIds[0],postStopVerified:true};}
  if(!error&&row.plan?.method==='agentSession.close'){const death=await readSessionDeath(userData,row.target.binding.sessionId,row.target.binding.ownerFence,row.target.scope);if(death){state='stopped';proof={kind:'native-owner-death',death};}}
  return store.settleStop(id,row.version,{state,...(receipt?{receipt}:{}),...(proof?{proof,confirmedAt:stamp()}:{}),detail:state==='stopped'?'Native evidence confirms this exact execution stopped. Files and execution history are retained.':error?String(error.message??error).slice(0,1200):'Stop requested; session exit is unconfirmed. Assignment stopped or a closed view alone does not prove execution stopped. Check evidence; no replacement or automatic retry.'});
 }
 return {
  async prepare(input){await consent();const row=store.prepareStop(input,target(input));return row;},
  async validate(id){const row=store.readStop(id);if(!row||row.state!=='intent')return null;try{const plan=await verify(row);if(plan.exitedProof){store.settleStop(id,row.version,{state:'stopped',proof:plan.exitedProof,confirmedAt:stamp(),detail:'Exact native worker observation confirms this saved execution already exited.'});return null;}store.settleStop(id,row.version,{state:'submitted',plan,submittedAt:stamp(),detail:'Stop request submitted; awaiting native exit evidence.'});return plan;}catch(error){store.settleStop(id,row.version,{state:error.unsupported?'unsupported':'unknown',detail:error.message});throw error;}},
  settle,
  async check(id){const row=store.readStop(id);if(!row||!['submitted','unknown'].includes(row.state))return row;await consent();if(row.plan?.method==='orchestration.workerStop'){const receipt=await readStopReceipt(userData,row);if(receipt){const saved=await settle(id,receipt);if(saved.state==='stopped')return saved;}try{const observed=await verify(store.readStop(id));if(observed.exitedProof){const current=store.readStop(id);return store.settleStop(id,current.version,{state:'stopped',proof:observed.exitedProof,confirmedAt:stamp(),detail:'Exact native worker observation confirms this saved execution exited.'});}}catch{}}if(row.plan?.method==='agentSession.close')return settle(id);const current=store.readStop(id);return current.state==='submitted'?store.settleStop(id,current.version,{state:'unknown',detail:'Native stop response is unavailable. The original execution remains reserved; checking never repeats the stop.'}):current;},
  async reconcile(){for(const row of store.listStops())await this.check(row.requestId);},
 };
}
