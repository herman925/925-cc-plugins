import {nativeMutationFingerprint} from './native-mutation.mjs';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const text=value=>typeof value==='string'&&value.length>0&&value.length<=256;
const reportKeys=['attemptId','dispatchId','nativeTaskId','messageId'];
export function questionOriginKind(origin){
 if(!origin||typeof origin!=='object'||Array.isArray(origin)||reportKeys.some(key=>!text(origin[key])))return null;
 const keys=Object.keys(origin);
 if(keys.length===4&&keys.every(key=>reportKeys.includes(key)))return 'report';
 if(keys.length===6&&keys.every(key=>[...reportKeys,'askRequestId','askParams'].includes(key))&&text(origin.askRequestId)&&origin.askParams&&typeof origin.askParams==='object'&&!Array.isArray(origin.askParams))return 'ask';
 return null;
}
// A completion reference is positive native evidence, never a missing-ask fallback.
export function verifiedReportOrigin(db,{work,attempts,spec}){
 if(work.parent||spec.kind!=='user-question'||spec.relay||questionOriginKind(spec.origin)!=='report')return null;
 const o=spec.origin,a=attempts.find(row=>row.id===o.attemptId),b=a?.binding,evidenceId=`worker_report:${o.messageId}`;
 if(!a||a.admission!=='committed'||a.supervisorMemberId!==work.supervisorMemberId||a.runId!==work.run.id||a.dispatchId!==o.dispatchId||a.nativeTaskId!==o.nativeTaskId||a.evidenceId!==evidenceId||!['failed','succeeded'].includes(a.outcome)||!spec.evidence?.includes(evidenceId)||!b||!['terminal','structured'].includes(b.kind)||a.scope?.workspaceId!==work.scope.workspaceId||a.scope?.executionHostId!==work.scope.executionHostId||b.workspaceId!==work.scope.workspaceId||b.executionHostId!==work.scope.executionHostId)return null;
 const owner=a.originalSupervisorInstance??work.instance,identity=db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
 if(!owner||!identity?.caller_fingerprint||!a.startRequestId||!a.startPayloadHash)return null;
 const starts=db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.workerStart' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.taskId')=?").all(identity.caller_fingerprint,a.nativeTaskId),start=starts[0],value=parse(start?.receipt),caller=owner.kind==='structured'?`orca_session_id:${owner.sessionId}`:owner.handle;
 if(starts.length!==1||start.request_id!==a.startRequestId||start.payload_hash!==a.startPayloadHash||start.payload_hash!==nativeMutationFingerprint('orchestration.workerStart',{...a.startParams,from:caller,devMode:false},owner,a.reuse?.binding)||value?.runId!==a.runId||value.dispatchId!==o.dispatchId)return null;
 const d=db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(o.dispatchId),w=db.prepare('SELECT * FROM worker_dispatches WHERE dispatch_id=?').get(o.dispatchId),h=parse(d?.host_scope);
 const host=work.scope.executionHostId==='local'?h?.kind==='local'&&h.hostId==='local':h?.kind==='ssh'&&`ssh:${encodeURIComponent(h.targetId)}`===work.scope.executionHostId;
 if(!d||(owner.kind==='structured'?d.creator_orca_session_id!==owner.sessionId:d.creator_handle!==owner.handle||d.creator_pane_key!==owner.paneKey)||d.run_id!==a.runId||d.task_id!==a.nativeTaskId||d.assignee_handle!==b.handle||d.assignee_pane_key!==b.paneKey||d.process_incarnation!==b.incarnationId||(b.kind==='structured'?d.assignee_orca_session_id!==b.sessionId:Boolean(d.assignee_orca_session_id))||!host||!w||w.agent_terminal_handle!==b.handle||w.worktree_id!==b.workspaceId||w.runtime_epoch!==b.runtimeId||w.state!==a.outcome||d.status!==(a.outcome==='failed'?'failed':'completed'))return null;
 const fact=db.prepare("SELECT * FROM attempt_observation_facts WHERE id=? AND dispatch_id=? AND facet='worker_report'").get(evidenceId,d.id),report=parse(fact?.payload);
 if(!fact||fact.task_id!==a.nativeTaskId||fact.authority_id!==`run_home:${a.runId}`||report?.status!=='accepted'||report.reportId!==evidenceId||report.outcome!==a.outcome)return null;
 const message=db.prepare('SELECT * FROM messages WHERE id=?').get(o.messageId),payload=parse(message?.payload);
 if(!message||message.run_id!==a.runId||message.type!=='worker_done'||message.from_handle!==b.handle||message.sender_pane_key!==b.paneKey||payload?.dispatchId!==d.id||payload.taskId!==a.nativeTaskId||payload.outcome!==a.outcome)return null;
 return {kind:'worker-report',attemptId:a.id,dispatchId:d.id,nativeTaskId:a.nativeTaskId,messageId:message.id,evidenceId,runId:a.runId,memberId:a.memberId,supervisorMemberId:a.supervisorMemberId,outcome:a.outcome};
}
