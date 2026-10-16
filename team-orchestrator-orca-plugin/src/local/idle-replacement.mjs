import {matchesTerminalObservation} from './terminal-identity.mjs';
import {readNativeQuestionEvidence} from './native-questions.mjs';
import {resumedOwner} from './wake-evidence.mjs';
import {readNativeDispatchEvidence} from './native-dispatch.mjs';
// This proves safe application retirement, never native process death.
export async function verifyIdleReplacement({store,rpc,userData,works,operation,retirementRequestId}){
 const op=operation,root=store.listCurrentWorks().find(w=>w.teamId===op.teamId&&w.status!=='completed'),contexts=root?(store.listRunWorks?.(root.id)??[root]):[];
 store.assertReplacementIdle(op.memberId);
 for(const context of contexts){
  if(!works)throw Error('Current native execution evidence is required before idle replacement.');
  const verified=await works.verifyWork(context.id,false,{allowSettledParent:true,retirementRequestId}),team=store.effectiveTeamForWork?.(context.id)??store.readTeamVersion(context.teamId,context.configVersion),attempts=store.listDispatches(context.id);
  const evidence=await readNativeDispatchEvidence(userData,{work:context,protocol:store.readDispatchProtocol(context.id),team,owner:verified.instance,admitted:attempts,allowSettledParent:true,nativeHistory:store.readNativeHistory(context.id)});
  if(evidence.state!=='verified'||evidence.unmanaged?.length||evidence.rejected.length||evidence.intents.some(i=>i.spec.memberId===op.memberId||context.supervisorMemberId===op.memberId))throw Error('Native unadmitted or unknown execution prevents idle replacement.');
  for(const a of attempts.filter(a=>a.memberId===op.memberId||a.supervisorMemberId===op.memberId))if(!evidence.observations.some(o=>o.id===a.id&&o.state==='verified'&&o.completion?.evidenceId===a.evidenceId))throw Error('Accepted execution evidence changed; idle replacement is blocked.');
  const questions=await readNativeQuestionEvidence(userData,{work:context,protocol:store.readDispatchProtocol(context.id),owner:verified.instance,attempts,nativeHistory:store.readNativeHistory(context.id)});
  if(questions.state!=='verified'||questions.rejected.length||questions.threads.some(q=>q.status!=='answered'||!q.answer)||questions.intents.some(i=>['user-question','relay-question'].includes(i.spec.kind)&&!store.listQuestions(context.id).some(q=>q.id===i.spec.appQuestionId)))throw Error('Native question or decision remains unresolved before idle replacement.');
  await works.verifyHost(context.id,verified.hostGeneration);
 }
 if(op.kind==='structured'){
  const fence=contexts.find(w=>w.supervisorMemberId===op.memberId&&w.binding.requestId===op.requestId)?.instance?.fence??op.observation?.ownerFence;
  const owner=await resumedOwner(userData,op,0),history=await rpc('agentSession.history',{sessionId:op.sessionId,direction:'tail',limit:1}),p=history?.page;
  if(!Number.isSafeInteger(fence)||owner?.fence!==fence||history?.ok!==true||p?.sessionId!==op.sessionId||p.fence!==fence||p.latestTurn?.turn?.state!=='completed'||typeof p.latestTurn.itemId!=='string'||!p.latestTurn.itemId||p.backgroundTasks!==null||!Array.isArray(p.queuedMessages)||p.queuedMessages.length||!Array.isArray(p.submissions)||p.submissions.some(s=>!['accepted','rejected'].includes(s.dispatchState))||(await resumedOwner(userData,op,0))?.fence!==fence)throw Error('Current native idle turn, empty queue and owner fence are required; unknown execution needs exact stop.');
  return {kind:'confirmed-idle-app-retirement',ownerFence:fence,turnId:p.latestTurn.itemId};
 }
 const shown=(await rpc('terminal.show',{terminal:op.handle}))?.terminal,status=(await rpc('terminal.agentStatus',{terminal:op.handle}))?.agentStatus;
 if(!matchesTerminalObservation(shown,op.observation)||shown?.handle!==op.handle||`${shown.tabId}:${shown.leafId}`!==op.paneKey||shown.worktreeId!==op.scope.workspaceId||shown.executionHostId!==op.scope.executionHostId||shown.connected!==true||shown.writable!==true||status?.handle!==op.handle||status.isRunningAgent!==true||status.status!=='idle')throw Error('Current native idle terminal identity is required; unknown execution needs exact stop.');
 return {kind:'confirmed-idle-app-retirement',incarnationId:shown.incarnationId};
}
