import {readNativeQuestionEvidence} from './native-questions.mjs';
import {userMessage,accepted} from './dispatch.mjs';
export function createQuestionService({store,rpc,userData,consent,works,notify}) {
 const queues=new Map();
 const serial=(id,fn)=>{const p=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(fn);queues.set(id,p);p.finally(()=>{if(queues.get(id)===p)queues.delete(id);}).catch(()=>{});return p;};
 const updateAnswer=(workId,id,answerId,patch)=>store.updateQuestion(workId,id,q=>{const a=q.answers.find(a=>a.id===answerId);if(!a)throw Error('Answer missing.');Object.assign(a,patch);});
 async function evidence(workId){
  const {instance:owner}=await works.verifyWork(workId,true),work=store.readWork(workId),protocol=store.readDispatchProtocol(workId);
  if(!protocol||work.run.consumerGeneration!==protocol.generation)throw Error('Saved supervisor generation is stale.');
  const native=await readNativeQuestionEvidence(userData,{work,protocol,owner,attempts:store.listDispatches(workId)});
  if(native.state!=='verified')throw Error(native.detail);
  return {work,owner,native};
 }
 async function deliver(workId,id,answerId){
  let question=store.listQuestions(workId).find(q=>q.id===id),a=question.answers.find(a=>a.id===answerId);
  if(a.state!=='queued')return;
  let sending=false;
  try{
   await consent();const {work,owner,native}=await evidence(workId);
   if(question.generation!==work.run.consumerGeneration||question.runId!==work.run.id)throw Error('Answer target is stale. Preserve it and request a new supervisor decision.');
   if(question.origin){const thread=native.threads.find(t=>t.messageId===question.origin.messageId);if(!thread||thread.status!=='pending')throw Error('Original native question is closed, answered or unverified; this answer cannot resume it.');}
   const text='TEAM_USER_ANSWER\n'+JSON.stringify({protocol:'team-questions/v1',workId,appQuestionId:id,questionRevision:a.revision,answerId:a.id,body:a.body,origin:question.origin,instruction:'This is a saved user answer. Process it once using answerId. Reply to the original native question ONLY as its actual owning Run manager (orca orchestration reply --id MESSAGE --body ANSWER --run OWNING_RUN --json). For a lower manager, send the decision to that real manager; do not impersonate them. Preserve the origin chain. Then publish a Head-authored team-questions/v1 Task kind=answer-ack with appQuestionId, answerId, token and generation. For a two-failure decision include nextNativeTaskId of the specific permitted next Task. An input receipt is not an acknowledgement.'});
   const nativeSend=userMessage(work,owner,text);
   updateAnswer(workId,id,answerId,{state:'sending',nativeSend});sending=true;
   const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);
   if(!accepted(receipt,nativeSend,owner))throw Error('Native input receipt is unconfirmed.');
   updateAnswer(workId,id,answerId,{state:'accepted',detail:'Native input accepted; manager processing and native reply remain unconfirmed.'});
  }catch(error){updateAnswer(workId,id,answerId,{state:sending?'unknown':'blocked',detail:sending?'Answer delivery is unknown; it will not be automatically sent again.':String(error.message).slice(0,1200)});}
 }
 async function check(workId){
  const work=store.readWork(workId),protocol=store.readDispatchProtocol(workId);
  if(!protocol||work?.run.state!=='verified')return;
  let native;
  try{({native}=await evidence(workId));}catch{return;}
  for(const intent of native.intents)if(intent.spec.kind==='user-question')try{store.ingestQuestion(workId,intent);}catch{}
  for(const intent of native.intents)if(intent.spec.kind==='answer-ack'){
   const s=intent.spec,q=store.listQuestions(workId).find(q=>q.id===s.appQuestionId),a=q?.answers.find(a=>a.id===s.answerId);
   if(!a||!['accepted','unknown','sending'].includes(a.state))continue;
   store.updateQuestion(workId,q.id,saved=>{const answer=saved.answers.find(a=>a.id===s.answerId);answer.processed='confirmed';answer.acknowledgement={nativeTaskId:intent.nativeTaskId,payloadHash:intent.payloadHash};if(typeof s.nextNativeTaskId==='string')answer.nextNativeTaskId=s.nextNativeTaskId;saved.status='answered';});
  }
  for(const q of store.listQuestions(workId)){
   const thread=q.origin&&native.threads.find(t=>t.messageId===q.origin.messageId);
   if(thread)store.updateQuestion(workId,q.id,saved=>{saved.nativeQuestion={...thread,requesterResumed:'unconfirmed'};if(thread.status==='closed'){saved.status='closed';for(const a of saved.answers)if(a.state==='queued')Object.assign(a,{state:'blocked',detail:'The original Dispatch question closed. A new decision is required.'});}if(thread.answer){for(const a of saved.answers)if(a.body===thread.answer.body){a.nativeAnswer=thread.answer;a.processed='confirmed';saved.status='answered';}}});
   for(const a of q.answers){if(a.state==='sending')updateAnswer(workId,q.id,a.id,{state:'unknown',detail:'Worker restarted during answer submission; no automatic resend.'});else if(a.state==='queued')await deliver(workId,q.id,a.id);}
   if(q.notification.state==='queued'){
    store.updateQuestion(workId,q.id,saved=>{saved.notification={state:'attempted'};});
    let state='unavailable';try{if(notify)state=(await notify({title:'Team decision needs your attention',body:q.summary.slice(0,1000)}))?.delivered===true?'delivered':'unconfirmed';}catch{}
    store.updateQuestion(workId,q.id,saved=>{saved.notification={state};});
   }
  }
 }
 return {check:id=>serial(id,()=>check(id)),answer:input=>serial(input.workId,async()=>{store.queueQuestionAnswer(input);await deliver(input.workId,input.questionId,input.answerId);return store.readSnapshot();}),async reconcile(){for(const w of store.listWorks())await this.check(w.id);}};
}
