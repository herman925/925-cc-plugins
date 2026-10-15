import {realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
// Read-only native ancestry evidence. No client-written depth or native DB mutation.
export async function readNativeParentEvidence(userData,{parentWork,attempt,active=true}){
 let db;
 try{
  const root=await realpath(userData),file=await realpath(join(root,'orchestration.db')),rel=relative(root,file);
  if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error('Parent evidence path is unverified.');
  const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(file,{readOnly:true});db.exec('BEGIN');
  if(db.prepare('PRAGMA user_version').get().user_version!==43)throw Error('Native parent schema is unsupported.');
  const run=db.prepare('SELECT * FROM runs WHERE id=?').get(parentWork.run.id),owner=parentWork.instance;
  if(!run||run.objective!==parentWork.nativeObjective||run.home_database!=='this_database'||run.legacy!==0||run.consumer_generation!==parentWork.run.consumerGeneration||(attempt.reviewAuthority?.generation??attempt.generation)!==run.consumer_generation||!owner||(owner.kind==='structured'?run.coordinator_orca_session_id!==owner.sessionId||run.coordinator_orca_session_id_generation!==run.consumer_generation:run.coordinator_handle!==owner.handle||run.coordinator_pane_key!==owner.paneKey))throw Error('Parent Run owner or generation changed.');
  const d=db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(attempt.dispatchId),b=attempt.binding,w=db.prepare('SELECT * FROM worker_dispatches WHERE dispatch_id=?').get(attempt.dispatchId);
  if(!d||!b||d.run_id!==run.id||d.task_id!==attempt.nativeTaskId||d.assignee_handle!==b.handle||d.assignee_pane_key!==b.paneKey||d.process_incarnation!==b.incarnationId||(b.sessionId&&d.assignee_orca_session_id!==b.sessionId)||!w||w.worktree_id!==parentWork.scope.workspaceId||w.runtime_epoch!==b.runtimeId||!Number.isSafeInteger(d.depth)||d.depth<1)throw Error('Parent Dispatch assignee or actual native depth is unverified.');
  const host=JSON.parse(d.host_scope??'null');if(parentWork.scope.executionHostId!=='local'||host?.kind!=='local'||host.hostId!=='local')throw Error('Nested manager parent requires its verified local owning host; remote ancestry remains unverified.');
  if(active&&(!['pending','dispatched'].includes(d.status)||!['starting','ready'].includes(w.state)||attempt.status!=='running'||attempt.evidenceId))throw Error('Parent Dispatch is no longer active; descendant admission is fenced.');
  return {state:'verified',depth:d.depth,dispatchId:d.id,status:d.status,assignee:{sessionId:d.assignee_orca_session_id,handle:d.assignee_handle,paneKey:d.assignee_pane_key,incarnationId:d.process_incarnation}};
 }catch(error){return {state:'unverified',detail:error.code?'Native parent evidence is unavailable; preserve the Run binding.':error.message};}
 finally{if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}
