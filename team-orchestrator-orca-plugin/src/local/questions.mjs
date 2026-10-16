import {isUnsentBlockedAnswer} from './acceptance.mjs';
import {questionOriginKind} from './native-question-origin.mjs';
import {createKeyedSerializer} from './keyed-serializer.mjs';
import {withNativeRuntime} from './native-runtime.mjs';
import {createHash} from 'node:crypto';
import {readNativeQuestionEvidence} from './native-questions.mjs';
import {userMessage,accepted} from './dispatch.mjs';
// No native replay key exists. Persist an attempted marker before the host effect;
// restart never automatically repeats a possibly visible notification.
export async function notifyQuestionEvent(store,notify,{workId,id,kind,title,body}) {
 if(!['decision','native-fault','goal-delivery'].includes(kind))throw Error('Routine progress is not a critical notification.');
 const event=store.ensureQuestionEvent(workId,id,kind,{title,body});if(event.state!=='queued')return event;
 if(!store.claimQuestionEvent(workId,id,'attempted'))return event;
 let state='unavailable';try{if(notify)state=(await notify({title:title.slice(0,120),body:body.slice(0,1000)}))?.delivered===true?'delivered':'unconfirmed';}catch{}
 return store.updateQuestionEvent(workId,id,{state});
}
export function createQuestionService({store,rpc,userData,consent,works,notify}) {
 const serialize=createKeyedSerializer();
 const serial=(id,fn)=>serialize(id,()=>withNativeRuntime(rpc,store.readCurrentWork(id)?.binding.runtimeId,fn));
 const matchingIntent=(question,native)=>native.intents.find(intent=>intent.nativeTaskId===question.proof?.nativeTaskId&&JSON.stringify(intent)===JSON.stringify(question.proof)&&JSON.stringify(intent.spec.origin??null)===JSON.stringify(question.origin??null));
 const reportFor=(question,native)=>{
  const intent=matchingIntent(question,native),source=intent&&(native.sourceReports??[]).find(row=>row.nativeTaskId===intent.nativeTaskId&&row.appQuestionId===question.id)?.sourceReport;
  return source&&(!question.sourceReport||JSON.stringify(question.sourceReport)===JSON.stringify(source))?source:null;
 };
 const recordReport=(question,sourceReport)=>{if(sourceReport&&!question.sourceReport)store.updateQuestion(question.workId,question.id,saved=>{saved.sourceReport=sourceReport;});};
 const updateAnswer=(workId,id,answerId,patch)=>store.updateQuestion(workId,id,q=>{const a=q.answers.find(a=>a.id===answerId);if(!a)throw Error('Answer missing.');if(patch.state==='blocked'&&a.state!=='queued')return;Object.assign(a,patch);});
 async function evidence(workId){
  const {instance:owner,hostGeneration}=await works.verifyWork(workId,true),work=store.readCurrentWork(workId),protocol=store.readDispatchProtocol(workId);
  if(!protocol||work.run.consumerGeneration!==protocol.generation)throw Error('Saved supervisor generation is stale.');
  const native=await readNativeQuestionEvidence(userData,{work,protocol,owner,attempts:store.listDispatches(workId),nativeHistory:store.readNativeHistory(workId)});
  if(native.state!=='verified')throw Error(native.detail);
  return {work,owner,native,hostGeneration};
 }
 async function relayResolved(question,seen=new Set()){
  if(!question.relay)return true;
  const key=question.relay.workId+':'+question.relay.appQuestionId;if(seen.has(key))return false;seen.add(key);
  const child=store.readWork(question.relay.workId),saved=store.listQuestions(child?.id).find(q=>q.id===question.relay.appQuestionId);
  if(!child?.parent||child.parent.workId!==question.workId||!saved?.origin)return false;
  try{const current=await evidence(child.id),thread=current.native.threads.find(t=>t.messageId===saved.origin.messageId);return Boolean(thread?.answer)&&await relayResolved(saved,seen);}catch{return false;}
 }
 async function deliver(workId,id,answerId){
  let question=store.listQuestions(workId).find(q=>q.id===id),a=question.answers.find(a=>a.id===answerId);
  if(a.state!=='queued')return;
  let sending=false;
  try{
   await consent();const {work,owner,native,hostGeneration}=await evidence(workId);
   if((question.epoch??0)!==(work.epoch??0)||question.generation!==work.run.consumerGeneration||question.runId!==work.run.id)throw Error('Answer target is stale. Preserve it and request a new supervisor decision.');
   const sourceReport=reportFor(question,native),reportReference=questionOriginKind(question.origin)==='report'||Boolean(question.sourceReport);
   if(reportReference&&!sourceReport)throw Error('Completion report or question authority is unverified; this answer was not sent.');
   if(question.origin&&!matchingIntent(question,native))throw Error('Original question proof changed; this answer was not sent.');
   recordReport(question,sourceReport);
   const nativeOrigin=sourceReport?undefined:question.origin;
   const supersedesBlockedAnswers=sourceReport&&a.supplement===true?question.answers.slice(0,question.answers.indexOf(a)).filter(isUnsentBlockedAnswer).map(row=>row.id):[];
   if(nativeOrigin){const thread=native.threads.find(t=>t.messageId===question.origin.messageId);if(!thread||thread.status!=='pending')throw Error('Original native question is closed, answered or unverified; this answer cannot resume it.');}
   const text='TEAM_USER_ANSWER\n'+JSON.stringify({protocol:'team-questions/v1',workId,appQuestionId:id,questionRevision:a.revision,answerId:a.id,body:a.body,origin:nativeOrigin,...(sourceReport?{sourceReport}:{}),...(supersedesBlockedAnswers.length?{supersedesBlockedAnswers}:{}),relay:question.relay,instruction:'This is a saved user answer. Process it once using answerId. '+(sourceReport?'This is the highest Head decision based on the verified sourceReport completion. Do not call orchestration.reply or resume a native requester for this completion report. If supersedesBlockedAnswers is present, this explicit supplement replaces only those earlier unsent blocked answer IDs; do not acknowledge those old IDs. ':nativeOrigin?'Reply to the original native question ONLY as its actual owning Run manager (orca orchestration reply --id MESSAGE --body ANSWER --run OWNING_RUN --json). For a lower manager, send the decision to that real manager; do not impersonate them. Preserve the origin chain. ':'This is the Head decision; no native requester reply is required. ')+'Then publish a Head-authored team-questions/v1 Task kind=answer-ack with appQuestionId, answerId, token and generation. Only when the user authorizes another execution after two failures, include nextNativeTaskId of that specific permitted next Task; a decision to accept expected negative QA does not authorize or require a new Task. An input receipt is not an acknowledgement.'});
   const nativeSend=userMessage(work,owner,text);
   if(!store.claimQuestionAnswer(workId,id,answerId,nativeSend,supersedesBlockedAnswers))return;sending=true;
   await works.verifyHost(workId,hostGeneration);
   const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);
   if(!accepted(receipt,nativeSend,owner))throw Error('Native input receipt is unconfirmed.');
   updateAnswer(workId,id,answerId,{state:'accepted',dispatchState:receipt.value?.submission?.dispatchState??'input_accepted',detail:sourceReport?'Native input accepted by the Head; processing awaits its authenticated answer acknowledgement. No native requester reply is needed.':'Native input accepted; manager processing and native reply remain unconfirmed.'});
  }catch(error){updateAnswer(workId,id,answerId,{state:sending?'unknown':'blocked',detail:sending?'Answer delivery is unknown; it will not be automatically sent again.':String(error.message).slice(0,1200)});}
 }
 async function check(workId){
  const work=store.readCurrentWork(workId),protocol=store.readDispatchProtocol(workId);
  if(work?.status==='completed'||!protocol||work?.run.state!=='verified')return;
  let native;
  try{({native}=await evidence(workId));}catch{return;}
  for(const streak of store.failureStreaks(workId).filter(s=>s.escalationNeeded)){
   const evidenceIds=streak.evidence.slice(-2).map(e=>e.evidenceId);
   if(store.listQuestions(workId).some(q=>q.evidence?.length&&evidenceIds.every(id=>q.evidence.includes(id))))continue;
   const id='failure-'+createHash('sha256').update(JSON.stringify([streak.taskKey,evidenceIds])).digest('hex');
   const event=store.ensureQuestionEvent(workId,id,'failure-summary',{taskKey:streak.taskKey,evidence:streak.evidence.slice(-2)});
   if(event.state==='sending'){store.updateQuestionEvent(workId,id,{state:'unknown'});continue;}
   if(event.state!=='queued')continue;
   try{
    await consent();const current=await evidence(workId);
    const text='TEAM_FAILURE_SUMMARY_NEEDED\n'+JSON.stringify({workId,taskKey:streak.taskKey,evidence:event.data.evidence,instruction:'Two consecutive proven execution attempts failed. This task is blocked; independent tasks may continue. If you are highest supervisor publish a native team-questions/v1 user-question Task; otherwise publish relay-question and ask your real parent manager to escalate it, preserving relay {workId,appQuestionId}. Include a Task with your causes, options, the exact two evidence IDs, and this blockingTaskKeys entry. Do not invent success or silently retry. The user decision must identify the intended next step.'});
    const nativeSend=userMessage(current.work,current.owner,text);if(!store.claimQuestionEvent(workId,id,'sending',nativeSend))continue;
    await works.verifyHost(workId,current.hostGeneration);
    const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);store.updateQuestionEvent(workId,id,{state:accepted(receipt,nativeSend,current.owner)?'accepted':'unknown'});
   }catch{store.updateQuestionEvent(workId,id,{state:'unknown'});}
  }
  for(const intent of native.intents)if(['user-question','relay-question'].includes(intent.spec.kind))try{if((intent.spec.kind==='relay-question'||intent.spec.relay)&&(!intent.spec.origin||!native.threads.some(t=>t.messageId===intent.spec.origin.messageId)))continue;const question=store.ingestQuestion(workId,intent);recordReport(question,reportFor(question,native));}catch{}
  for(const intent of native.intents)if(intent.spec.kind==='collaboration-directive')try{store.ingestCollaboration(workId,intent);}catch{}
  for(const message of native.messages||[])try{store.ingestTeamMessage(workId,message);}catch{}
  for(const intent of native.intents)if(intent.spec.kind==='answer-ack'){
   const s=intent.spec,q=store.listQuestions(workId).find(q=>q.id===s.appQuestionId),a=q?.answers.find(a=>a.id===s.answerId);
   if(!a||!['accepted','unknown','sending'].includes(a.state)||!await relayResolved(q))continue;
   const current=store.readCurrentWork(workId);
   if((q.epoch??0)!==(current.epoch??0)||q.generation!==current.run.consumerGeneration||q.runId!==current.run.id)continue;
   if((questionOriginKind(q.origin)==='report'||q.sourceReport)&&!reportFor(q,native))continue;
   store.updateQuestion(workId,q.id,saved=>{const answer=saved.answers.find(a=>a.id===s.answerId);answer.processed='confirmed';answer.acknowledgement={nativeTaskId:intent.nativeTaskId,payloadHash:intent.payloadHash};if(typeof s.nextNativeTaskId==='string')answer.nextNativeTaskId=s.nextNativeTaskId;if(saved.answers.at(-1).id===answer.id)saved.status='answered';});
  }
  for(const q of store.listQuestions(workId)){
   const thread=q.origin&&native.threads.find(t=>t.messageId===q.origin.messageId);
   const relayReady=await relayResolved(q);
   if(thread)store.updateQuestion(workId,q.id,saved=>{saved.nativeQuestion={...thread,requesterResumed:'unconfirmed'};if(thread.status==='closed'){saved.status='closed';for(const a of saved.answers)if(a.state==='queued')Object.assign(a,{state:'blocked',detail:'The original Dispatch question closed. A new decision is required.'});}if(thread.answer&&relayReady){if(saved.to==='manager')saved.status='answered';for(const a of saved.answers)if(['accepted','unknown','sending'].includes(a.state)&&a.body===thread.answer.body){a.nativeAnswer=thread.answer;a.processed='confirmed';if(saved.answers.at(-1).id===a.id)saved.status='answered';}}});
   for(const a of q.answers){if(a.state==='sending')updateAnswer(workId,q.id,a.id,{state:'unknown',detail:'Worker restarted during answer submission; no automatic resend.'});else if(a.state==='queued')await deliver(workId,q.id,a.id);}
   if(q.to==='user'&&q.notification.state==='queued'){
    if(!store.claimQuestionNotification(workId,q.id))continue;
    let state='unavailable';try{if(notify)state=(await notify({title:'Team decision needs your attention',body:q.summary.slice(0,1000)}))?.delivered===true?'delivered':'unconfirmed';}catch{}
    store.updateQuestion(workId,q.id,saved=>{saved.notification={state};});
   }
  }
 }
 async function nativeWait(workId,attempt,shown){
  const wait=shown?.observation?.agentWait;
  if(shown?.observation?.exactWorker!==true||shown.observation.status!=='live'||shown.dispatch?.id!==attempt.dispatchId||shown.dispatch.assigneeHandle!==attempt.binding?.handle||!wait||!['agent-approval-prompt','agent-trust-workspace','agent-hooks-review-prompt','agent-interactive-prompt','codex-trust-workspace','codex-hooks-review-prompt','codex-interactive-prompt'].includes(wait.reason))return;
  return notifyQuestionEvent(store,notify,{workId,id:`wait-${attempt.id}-${wait.reason}`,kind:'native-fault',title:'Team member needs native input',body:`${attempt.memberName}: ${wait.reason}. Open its original Orca/provider session to handle login or permission. Execution outcome remains unconfirmed.`});
 }
 return {nativeWait,check:id=>serial(id,()=>check(id)),answer:input=>serial(input.workId,async()=>{store.queueQuestionAnswer(input);await deliver(input.workId,input.questionId,input.answerId);return store.readSnapshot();}),async reconcile(){for(const w of store.listCurrentWorks().flatMap(w=>store.listRunWorks(w.id).reverse()))if(w.status!=='completed')await this.check(w.id);}};
}
