import {withOrchestrationSnapshot} from './orchestration-snapshot.mjs';
import {nativeMutationFingerprint} from './native-mutation.mjs';
import {isHistoricalControl} from './native-history.mjs';
const parse=v=>{try{return JSON.parse(v);}catch{return null;}};
const text=(v,n=8000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
export async function readNativeQuestionEvidence(userData,{work,protocol,owner,attempts=[],nativeHistory={authorities:[],controls:[]}}) {
 try {
  return await withOrchestrationSnapshot(userData,{pathError:'Invalid native evidence path.',schemaError:'Unsupported native question schema.'},db=>{
  const run=db.prepare('SELECT * FROM runs WHERE id=?').get(work.run.id);
  if(!run||run.objective!==work.nativeObjective||run.home_database!=='this_database'||run.legacy!==0||run.consumer_generation!==protocol.generation||work.run.consumerGeneration!==protocol.generation)throw Error('Question authority changed.');
  if(owner.kind==='structured'?(run.coordinator_orca_session_id!==owner.sessionId||run.coordinator_orca_session_id_generation!==protocol.generation):(run.coordinator_handle!==owner.handle||run.coordinator_pane_key!==owner.paneKey))throw Error('Question supervisor changed.');
  const identity=db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
  if(!identity?.caller_fingerprint)throw Error('Native author proof unavailable.');
  const intents=[],rejected=[],threads=[];
  for(const task of db.prepare('SELECT * FROM tasks WHERE run_id=?').all(work.run.id)){
   const spec=parse(task.spec);if(spec?.protocol!=='team-questions/v1'||spec.workId!==work.id)continue;
   if(isHistoricalControl(db,work,task,nativeHistory))continue;
   try {
    if(spec.token!==protocol.token||spec.generation!==protocol.generation||!text(spec.appQuestionId,120)||!/^[a-zA-Z0-9-]+$/.test(spec.appQuestionId)||!['user-question','relay-question','answer-ack','collaboration-directive','message-evidence','recovery-handoff','staffing-proposal','roster-ack'].includes(spec.kind))throw Error('Question intent identity invalid.');
    const receipts=db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskCreate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=?").all(identity.caller_fingerprint,task.id);
    const receipt=receipts[0],value=parse(receipt?.receipt),caller=owner.kind==='structured'?`orca_session_id:${owner.sessionId}`:owner.handle;
    if(receipts.length!==1||receipt.payload_hash!==nativeMutationFingerprint('orchestration.taskCreate',{spec:task.spec,run:work.run.id,callerTerminalHandle:caller},owner)||value?.task?.spec!==task.spec||value.task.run_id!==work.run.id)throw Error('Question author proof unavailable.');
    if(owner.kind==='terminal'&&(task.created_by_terminal_handle!==owner.handle||task.created_by_pane_key!==owner.paneKey||task.created_by_process_incarnation!==owner.incarnationId||task.created_by_run_generation!==protocol.generation))throw Error('Question terminal creator unverified.');
    if(spec.kind==='user-question'&&work.parent||spec.kind==='relay-question'&&!work.parent)throw Error('Only the highest supervisor asks the user; lower managers relay.');
    if(['user-question','relay-question'].includes(spec.kind)&&((spec.evidence!==undefined&&(!Array.isArray(spec.evidence)||spec.evidence.length>100||spec.evidence.some(v=>!text(v,2000))))||!text(spec.summary)||!Array.isArray(spec.options)||spec.options.length>20||spec.options.some(v=>!text(v,2000))||!Array.isArray(spec.blockingTaskKeys)||spec.blockingTaskKeys.some(v=>!text(v,120))))throw Error('Invalid question text or blocking scope.');
    if(spec.origin){const a=attempts.find(a=>a.id===spec.origin.attemptId);if(!a||a.admission!=='committed'||!a.binding||a.dispatchId!==spec.origin.dispatchId||a.nativeTaskId!==spec.origin.nativeTaskId||a.runId!==work.run.id)throw Error('Question origin does not match an admitted attempt.');}
    intents.push({spec,nativeTaskId:task.id,requestId:receipt.request_id,payloadHash:receipt.payload_hash});
   }catch(error){rejected.push({id:task.id,detail:error.message});}
  }
  // A schema without native question_threads cannot prove relay or requester resumption.
  if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='question_threads'").get())for(const a of attempts.filter(a=>a.binding&&a.dispatchId&&a.admission==='committed')){
   const d=db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(a.dispatchId);
   if(!d||d.run_id!==a.runId||d.task_id!==a.nativeTaskId||d.assignee_handle!==a.binding.handle||d.assignee_pane_key!==a.binding.paneKey||d.process_incarnation!==a.binding.incarnationId||parse(d.host_scope)?.kind!=='local'||work.scope.executionHostId!=='local')continue;
   for(const q of db.prepare('SELECT * FROM question_threads WHERE dispatch_id=? AND run_id=?').all(a.dispatchId,a.runId)){
    const m=db.prepare('SELECT * FROM messages WHERE id=?').get(q.message_id),p=parse(m?.payload);
    if(!m||m.run_id!==a.runId||m.from_handle!==`dispatch:${a.dispatchId}`||m.to_handle!==`run:${a.runId}`||m.type!=='question'||m.thread_id!==q.message_id||p?.dispatchId!==a.dispatchId||p.taskId!==a.nativeTaskId||q.asker_handle!==a.binding.handle)continue;
    // Native question_threads are admitted by ask, unlike arbitrary send(type=question).
    // Structured receipt identity is checked using the exact original AskParams carried by the Head.
    const origin=intents.find(i=>i.spec.origin?.messageId===q.message_id)?.spec.origin;
    const r=origin&&db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND request_id=? AND method='orchestration.ask' AND state='completed'").get(identity.caller_fingerprint,origin.askRequestId);
    const v=parse(r?.receipt);
    if(!r||!origin.askParams||origin.askParams.question!==m.body||origin.askParams.run!==a.runId||origin.askParams.resume||v?.messageId!==q.message_id||r.payload_hash!==nativeMutationFingerprint('orchestration.ask',origin.askParams,a.binding))continue;
    let answer;
    if(q.status==='answered'&&q.answered_by_generation===protocol.generation){const am=db.prepare('SELECT * FROM messages WHERE id=?').get(q.answer_message_id);if(am?.run_id===a.runId&&am.from_handle===`run:${a.runId}`&&am.to_handle===`dispatch:${a.dispatchId}`&&am.body===q.answer_body)answer={messageId:am.id,body:am.body,generation:q.answered_by_generation};}
    threads.push({messageId:q.message_id,attemptId:a.id,dispatchId:a.dispatchId,nativeTaskId:a.nativeTaskId,runId:a.runId,fromMemberId:a.memberId,toMemberId:a.supervisorMemberId,status:q.status,body:m.body,...(answer?{answer}:{})});
   }
  }
  const messages=[];
  for(const intent of intents.filter(i=>i.spec.kind==='message-evidence')){
   const s=intent.spec,n=s.nativeMessage,a=attempts.find(a=>a.id===s.fromAttemptId);
   if(!a||a.admission!=='committed'||a.binding?.kind!=='structured'||!n?.params||n.params.body?.length>16000)continue;
   const d=db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(a.dispatchId);
   if(!d||d.assignee_orca_session_id!==a.binding.sessionId||d.run_id!==a.runId||d.task_id!==a.nativeTaskId||d.assignee_handle!==a.binding.handle||d.process_incarnation!==a.binding.incarnationId)continue;
   const r=db.prepare("SELECT * FROM mutation_receipts WHERE caller_fingerprint=? AND request_id=? AND method='orchestration.send' AND state='completed'").get(identity.caller_fingerprint,n.requestId),m=db.prepare('SELECT * FROM messages WHERE id=?').get(n.messageId);
   if(!r||!m||parse(r.receipt)?.message?.id!==m.id||r.payload_hash!==nativeMutationFingerprint('orchestration.send',n.params,a.binding)||m.run_id!==a.runId||m.from_handle!==a.binding.handle||m.sender_pane_key!==a.binding.paneKey||m.body!==n.params.body||m.type!==n.params.type||m.to_handle!==n.params.to)continue;
   const target=attempts.find(b=>b.memberId===s.toMemberId&&b.id===s.toAttemptId);
   if(s.toMemberId===a.supervisorMemberId?n.params.to!==`run:${a.runId}`:!target||n.params.to!==target.binding?.handle)continue;
   messages.push({controlProof:intent,id:m.id,workId:work.id,fromMemberId:a.memberId,toMemberId:s.toMemberId,attemptId:a.id,toAttemptId:target?.id,dispatchId:a.dispatchId,nativeTaskId:a.nativeTaskId,runId:a.runId,body:m.body,type:m.type,requestId:r.request_id,payloadHash:r.payload_hash,state:'native_committed',processing:'unconfirmed'});
  }
  return {state:'verified',intents,rejected,threads,messages};
  });
 }catch(error){return {state:'unverified',detail:error.code?'Native question evidence is unavailable. Preserve pending answers and reconnect the owning runtime.':error.message,intents:[],rejected:[],threads:[]};}
}
