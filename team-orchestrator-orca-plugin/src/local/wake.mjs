import {publicWake} from './wake-store.mjs';
import {readSessionDeath} from './recovery.mjs';
import {withNativeRuntime} from './native-runtime.mjs';
export function createWakeService({store,rpc,userData,consent}) {
 return {async wake(input){
  if(!input||Object.keys(input).some(k=>!['teamId','memberId','requestId','bindingRequestId'].includes(k))||!['teamId','memberId','requestId','bindingRequestId'].every(k=>typeof input[k]==='string'&&/^[a-zA-Z0-9-]{1,120}$/.test(input[k])))throw Error('Choose an exact saved member binding.');
  const prior=store.readWake(input.requestId);if(prior){if(['teamId','memberId','bindingRequestId'].some(k=>prior[k]!==input[k]))throw Error('Recovery request conflicts with saved input.');return publicWake(prior);}
  const op=store.readOperation(input.bindingRequestId);
  if(!op||!store.isActiveOperation(op)||op.teamId!==input.teamId||op.memberId!==input.memberId||op.status!=='created')throw Error('Current saved member identity is required.');
  await consent();
  const status=await rpc('status.get');
  return withNativeRuntime(rpc,status.runtimeId,async()=>{
   const work=store.listWorks().find(w=>w.binding.requestId===op.requestId),fence=work?.instance?.fence??op.observation?.ownerFence;
   const death=op.kind==='structured'&&await readSessionDeath(userData,op.sessionId,fence,op.scope);
   if(!death)return {state:'blocked',detail:'The exact previous execution has not been proven stopped. Reconcile native death evidence before waking this member.'};
   const selected=(await rpc('worktree.show',{worktree:op.scope.workspaceId.startsWith('folder:')?op.scope.workspaceId:`id:${op.scope.workspaceId}`}))?.worktree;
   if(selected?.id!==op.scope.workspaceId||(selected.hostId??selected.identity?.executionHostId)!==op.scope.executionHostId)throw Error('Saved recovery project or host changed.');
   const offers=await rpc('agentSession.restartResumable',{sessionIds:[op.sessionId]});
   const offer=offers?.sessions?.find(s=>s.sessionId===op.sessionId&&s.workspaceId===op.scope.workspaceId&&s.executionHostId===op.scope.executionHostId&&s.agent===op.nativeRequest.agent);
   const action=offer?{method:'agentSession.restartContinue',params:{sessionIds:[op.sessionId]}}:null;
   const prepared=store.prepareWake(input,op,{death,runtimeId:status.runtimeId},action);
   if(!prepared.fresh||!action)return publicWake(prepared.row);
   await consent();if(!await readSessionDeath(userData,op.sessionId,fence,op.scope))throw Error('Previous execution is no longer proven stopped.');
   if(!store.claimWake(input.requestId))return publicWake(store.readWake(input.requestId));
   let patch;
   try{
    const receipt=await rpc(action.method,action.params),entry=receipt?.continued?.find(r=>r.sessionId===op.sessionId);
    if(!entry||!['continued','pending','unknown','refused'].includes(entry.outcome))throw Error('Native continuation identity is unconfirmed.');
    patch={state:entry.outcome==='continued'?'accepted':entry.outcome==='refused'?'needs_decision':'unknown',receipt:{sessionId:entry.sessionId,outcome:entry.outcome},detail:entry.outcome==='continued'?'Native continuation accepted. New execution and Run authority still require verification.':'Native continuation is unconfirmed or refused; no automatic fallback is allowed.'};
   }catch(error){patch={state:'unknown',detail:String(error.message).slice(0,1200)};}
   const row=store.readWake(input.requestId);return publicWake(store.updateWake(row.requestId,row.version,patch));
  });
 }};
}
