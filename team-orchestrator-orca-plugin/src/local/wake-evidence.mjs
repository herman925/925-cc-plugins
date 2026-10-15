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
