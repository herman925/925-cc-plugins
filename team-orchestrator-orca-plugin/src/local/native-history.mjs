import {createHash} from 'node:crypto';
import {canonical,nativeMutationFingerprint} from './native-mutation.mjs';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const caller=owner=>owner.kind==='structured'?`orca_session_id:${owner.sessionId}`:owner.handle;
const authority=(history,spec,epoch)=>history.authorities.filter(h=>(epoch===undefined||h.epoch===epoch)&&h.protocol.token===spec.token&&h.protocol.generation===spec.generation);
function controlProof(entry){const r=entry.record;return entry.kind==='delivery'?{...r.proof,nativeTaskId:r.id}:entry.kind==='answer-ack'?entry.answer.acknowledgement:entry.kind==='roster-ack'?r.acknowledgement:entry.kind==='message-evidence'?r.controlProof:r.proof??r;}
function savedControl(entry,spec,task,receipt){
 const r=entry.record,proof=controlProof(entry);
 if(proof?.nativeTaskId!==task.id||proof.payloadHash!==receipt.payload_hash||proof.requestId&&proof.requestId!==receipt.request_id)return false;
 const intent={spec,nativeTaskId:task.id,requestId:receipt.request_id,payloadHash:receipt.payload_hash};
 if(proof.spec&&!same(proof.spec,spec)||['question','staffing-proposal','collaboration-directive'].includes(entry.kind)&&r.fingerprint&&r.fingerprint!==digest(entry.kind==='staffing-proposal'?canonical(intent):intent))return false;
 switch(entry.kind){
  case 'question':return spec.kind===(r.to==='manager'?'relay-question':'user-question')&&spec.appQuestionId===r.id&&spec.generation===r.generation&&r.runId===task.run_id;
  case 'delivery':return spec.protocol==='team-delivery/v1'&&spec.generation===r.generation&&spec.token===r.protocolToken&&spec.supervisorMemberId===r.supervisorMemberId&&same(spec.previousDeliveryId??null,r.previousDeliveryId??null)&&same(spec.summary,r.summary)&&same(spec.attemptIds,r.attemptIds)&&same(spec.evidenceRefs,r.evidenceRefs);
  case 'staffing-proposal':return spec.kind===entry.kind&&spec.appQuestionId===r.id&&spec.proposingManagerId===r.proposingManagerId&&r.runId===task.run_id&&spec.generation===r.generation;
  case 'roster-ack':return spec.kind===entry.kind&&spec.deltaId===r.id&&spec.configVersion===r.configVersion&&spec.generation===r.generation&&r.runId===task.run_id;
  case 'answer-ack':return spec.kind===entry.kind&&spec.appQuestionId===r.id&&spec.answerId===entry.answer.id;
  case 'collaboration-directive':return spec.kind===entry.kind&&spec.appQuestionId===r.id&&spec.fromAttemptId===r.fromAttemptId&&spec.toAttemptId===r.toAttemptId&&spec.fromMemberId===r.fromMemberId&&spec.toMemberId===r.toMemberId;
  case 'message-evidence':return spec.kind===entry.kind&&spec.nativeMessage?.messageId===r.id&&spec.fromAttemptId===r.attemptId;
  case 'recovery-handoff':return spec.kind===entry.kind&&spec.oldRequestId===r.oldRequestId&&spec.decision===r.decision&&spec.summary===r.summary&&same(spec.evidence,r.evidenceRefs)&&spec.generation===r.generation&&r.runId===task.run_id;
  default:return false;
 }
}
// Historical records can discharge closure evidence only. They never enter the
// current intent/review stream, so an old token cannot authorize a new effect.
export function isHistoricalControl(db,work,task,history){
 const spec=parse(task.spec);
 if(!spec||spec.workId!==work.id||task.run_id!==work.run.id||!['team-questions/v1','team-delivery/v1'].includes(spec.protocol)||db.prepare('SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1').get(task.id))return false;
 const identity=db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();if(!identity?.caller_fingerprint)return false;
 const receipts=db.prepare("SELECT request_id,payload_hash,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskCreate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=?").all(identity.caller_fingerprint,task.id),receipt=receipts[0],value=parse(receipt?.receipt);
 if(receipts.length!==1||value?.task?.spec!==task.spec||value.task.run_id!==task.run_id)return false;
 return history.controls.some(entry=>savedControl(entry,spec,task,receipt)&&authority(history,spec,entry.epoch).some(({owner,protocol})=>receipt.payload_hash===nativeMutationFingerprint('orchestration.taskCreate',{spec:task.spec,run:work.run.id,callerTerminalHandle:caller(owner)},owner)&&(owner.kind==='structured'||owner.kind==='terminal'&&task.created_by_terminal_handle===owner.handle&&task.created_by_pane_key===owner.paneKey&&task.created_by_process_incarnation===owner.incarnationId&&task.created_by_run_generation===protocol.generation)));
}
export function isHistoricalReview(work,attempt,proof,task,review,history){
 const saved=attempt.review,status=attempt.outcome==='succeeded'?'completed':'failed';
 if(!saved||!['accepted','rework'].includes(attempt.status)||saved.requestId!==proof.request_id||saved.payloadHash!==proof.payload_hash||task.run_id!==work.run.id||task.status!==status||review.workId!==work.id||review.attemptId!==attempt.id||review.nativeTaskId!==attempt.nativeTaskId||review.dispatchId!==attempt.dispatchId||review.taskKey!==attempt.taskKey||review.generation!==saved.generation||review.token!==saved.protocolToken||review.reviewToken!==saved.reviewToken||review.reviewerMemberId!==saved.reviewerMemberId||review.decision!==saved.decision||!same(review.evidenceRefs,saved.evidenceRefs)||review.summary!==saved.summary)return false;
 return authority(history,review).some(({owner})=>proof.payload_hash===nativeMutationFingerprint('orchestration.taskUpdate',{id:attempt.nativeTaskId,status,result:task.result,run:work.run.id,callerTerminalHandle:caller(owner)},owner));
}

// Disappearing or rewritten native records must not turn saved proof into a
// silent absence. The normal reader still verifies current/historical authors.
export function changedRecordedControls(db,work,history){
 const identity=db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
 return history.controls.flatMap(entry=>{
  const id=controlProof(entry)?.nativeTaskId;if(!id)return [];
  const task=db.prepare('SELECT * FROM tasks WHERE id=?').get(id),spec=parse(task?.spec);
  const receipts=identity?db.prepare("SELECT request_id,payload_hash,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskCreate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=?").all(identity.caller_fingerprint,id):[],receipt=receipts[0],value=parse(receipt?.receipt);
  return task?.run_id===work.run.id&&spec?.workId===work.id&&receipts.length===1&&value?.task?.spec===task.spec&&value.task.run_id===work.run.id&&savedControl(entry,spec,task,receipt)?[]:[{nativeTaskId:id,detail:'Recorded native control evidence is missing or changed.'}];
 });
}
