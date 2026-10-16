import {readNativeDispatchEvidence} from './native-dispatch.mjs';
import {sameStopIdentity} from './stop-store.mjs';
import {realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
// Bounded, read-only native owner evidence; no journal constructors or migrations.
export async function resumedOwner(userData,operation,oldFence){
 let db;try{
  const root=await realpath(userData),path=await realpath(join(root,'agent-session-journal.db')),rel=relative(root,path);if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))return null;
  const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(path,{readOnly:true});if(db.prepare('PRAGMA user_version').get().user_version!==4)return null;
  const raw=db.prepare('SELECT record_json FROM agent_session_records WHERE session_id=?').get(operation.sessionId)?.record_json;if(typeof raw!=='string'||raw.length>262144)return null;
  const record=JSON.parse(raw),lease=record.lease;
  if(record.schemaVersion!==2||record.sessionId!==operation.sessionId||record.provider!==operation.nativeRequest.agent||record.location?.workspaceId!==operation.scope.workspaceId||record.location.executionHostId!==operation.scope.executionHostId||lease?.sessionId!==operation.sessionId||lease.claimStatus!=='live'||lease.unreconciled||lease.handoffStage||!lease.ownerProcess||!Number.isSafeInteger(lease.ownerProcess.pid)||lease.ownerProcess.pid<1||typeof lease.ownerProcess.hostId!=='string'||!lease.ownerProcess.hostId||typeof lease.ownerProcess.spawnToken!=='string'||!lease.ownerProcess.spawnToken||!Number.isSafeInteger(lease.runtimeFence)||lease.runtimeFence<=oldFence)return null;
  return {fence:lease.runtimeFence};
 }catch{return null;}finally{db?.close();}
}

// Positive native process-exit evidence for an existing assigned terminal worker.
// Completion, a missing terminal and fleet projection liveness are not exit proofs.
export async function readNativeWorkerExit({store,rpc,userData,operation:op}) {
 try {
  if(op.kind!=='terminal'||!op.sourceAttemptId||!op.sourceDispatchId||!op.sourceWorkId)return null;
  const work=store.readCurrentWork(op.sourceWorkId),attempt=store.listDispatches(op.sourceWorkId).find(a=>a.id===op.sourceAttemptId),binding=attempt?.binding;
  const current=()=>{
   const saved=store.listDispatches(op.sourceWorkId).find(a=>a.id===op.sourceAttemptId);
   return store.readMemberDispatch(op.memberId)?.id===op.sourceAttemptId&&saved?.dispatchId===op.sourceDispatchId&&saved.runId===attempt.runId&&saved.nativeTaskId===attempt.nativeTaskId&&sameStopIdentity(saved.binding,binding);
  };
  if(!work||!attempt||!binding||binding.kind!=='terminal'||attempt.memberId!==op.memberId||attempt.teamId!==op.teamId||attempt.workId!==op.sourceWorkId||attempt.runId!==work.run.id||attempt.dispatchId!==op.sourceDispatchId||binding.handle!==op.handle||binding.paneKey!==op.paneKey||binding.incarnationId!==op.observation?.processIncarnation||binding.runtimeId!==op.runtimeId||binding.workspaceId!==op.scope.workspaceId||binding.executionHostId!==op.scope.executionHostId||work.scope.workspaceKey!==op.scope.workspaceKey||work.scope.workspaceId!==op.scope.workspaceId||work.scope.executionHostId!==op.scope.executionHostId||attempt.scope.workspaceId!==op.scope.workspaceId||attempt.scope.executionHostId!==op.scope.executionHostId||!current())return null;
  if((await rpc('status.get'))?.runtimeId!==binding.runtimeId)return null;
  const protocol=store.readDispatchProtocol(work.id),team=store.effectiveTeamForWork?.(work.id)??store.readTeamVersion(work.teamId,work.configVersion);
  const evidence=()=>readNativeDispatchEvidence(userData,{work,protocol,team,owner:work.instance,admitted:[attempt],allowSettledParent:true});
  const match=native=>{const found=native.observations?.find(row=>row.id===attempt.id);return native.state==='verified'&&found?.state==='verified'&&found.dispatchId===op.sourceDispatchId&&sameStopIdentity(found.binding,binding)&&(found.creatorDispatchId??null)===(attempt.creatorDispatchId??null)?found:null;};
  const found=match(await evidence());if(!found)return null;
  const shown=await rpc('orchestration.workerShow',{dispatch:op.sourceDispatchId}),d=shown?.dispatch,w=shown?.worker,h=d?.hostScope;
  const host=op.scope.executionHostId==='local'?h?.kind==='local'&&h.hostId==='local':h?.kind==='ssh'&&`ssh:${encodeURIComponent(h.targetId)}`===op.scope.executionHostId;
  if(shown?.observation?.status!=='exited'||shown.observation.exactWorker!==true||!host||d?.id!==op.sourceDispatchId||d.runId!==attempt.runId||d.taskId!==attempt.nativeTaskId||d.assigneeHandle!==binding.handle||d.assigneePaneKey!==binding.paneKey||d.processIncarnation!==binding.incarnationId||(d.creatorDispatchId??null)!==(found.creatorDispatchId??null)||w?.dispatchId!==op.sourceDispatchId||w.agentTerminalHandle!==binding.handle||w.worktreeId!==binding.workspaceId||w.runtimeEpoch!==binding.runtimeId)return null;
  if(!match(await evidence())||!current()||(await rpc('status.get'))?.runtimeId!==binding.runtimeId)return null;
  return {kind:'native-worker-exit',source:'native-worker-show',dispatchId:op.sourceDispatchId,attemptId:attempt.id,runId:attempt.runId,nativeTaskId:attempt.nativeTaskId,binding,observedAt:Date.now()};
 }catch{return null;}
}
