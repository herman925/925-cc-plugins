import {isUnsentBlockedAnswer} from './acceptance.mjs';
import {createHash} from 'node:crypto';
import {validateSessionDecision} from './session-decisions.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=(v,n=8000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
export function questionStore({db,readPrivate,putPrivate,readWork,listDispatches,effectiveTeamForWork,atomic}) {
 const list=workId=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'question:%'").all().map(r=>{const q=JSON.parse(r.json);if(q.format!=='team-question-v1'||!['id','workId','teamId','fromMemberId','runId','summary'].every(k=>text(q[k]))||!Number.isSafeInteger(q.revision)||q.revision<1||!Number.isSafeInteger(q.generation)||q.generation<1||!['options','blockingTaskKeys','evidence','answers'].every(k=>Array.isArray(q[k]))||q.options.some(v=>!text(v,2000))||q.blockingTaskKeys.some(v=>!text(v,120))||q.evidence.some(v=>!text(v,2000))||!['queued','attempted','delivered','unconfirmed','unavailable'].includes(q.notification?.state)||q.answers.some(a=>!text(a.id,120)||!text(a.body)||!['queued','sending','accepted','unknown','blocked'].includes(a.state)||!['unconfirmed','confirmed'].includes(a.processed)||a.revision!==q.revision||a.from!=='user'||a.toMemberId!==q.fromMemberId||a.supplement!==undefined&&typeof a.supplement!=='boolean'||a.supersedesBlockedAnswers!==undefined&&(!Array.isArray(a.supersedesBlockedAnswers)||a.supplement!==true||a.supersedesBlockedAnswers.some(id=>!text(id,120))||new Set(a.supersedesBlockedAnswers).size!==a.supersedesBlockedAnswers.length))||new Set(q.answers.map(a=>a.id)).size!==q.answers.length||!['pending','answered','closed'].includes(q.status))throw Error('Saved pending question is damaged; preserve original data.');return q;}).filter(q=>q.workId===workId);
 const api={
  listQuestions:list,
  readQuestionEvent:(workId,id)=>readPrivate(`question-event:${workId}:${id}`),
  claimQuestionAnswer(workId,id,answerId,nativeSend,supersedesBlockedAnswers=[]){return atomic(()=>{if(readWork(workId)?.status==='completed')throw Error('Completed TeamWork is sealed.');const key=`question:${workId}:${id}`,q=readPrivate(key),a=q?.answers.find(a=>a.id===answerId);if(!a||a.state!=='queued')return false;if(supersedesBlockedAnswers.length){const expected=q.answers.slice(0,q.answers.indexOf(a)).filter(isUnsentBlockedAnswer).map(row=>row.id);if(!q.sourceReport||a.supplement!==true||JSON.stringify(expected)!==JSON.stringify(supersedesBlockedAnswers))throw Error('Explicit report supplement supersession changed.');a.supersedesBlockedAnswers=supersedesBlockedAnswers;}Object.assign(a,{state:'sending',nativeSend});putPrivate(key,q);return true;});},
  claimQuestionNotification(workId,id){return atomic(()=>{if(readWork(workId)?.status==='completed')throw Error('Completed TeamWork is sealed.');const key=`question:${workId}:${id}`,q=readPrivate(key);if(q?.notification.state!=='queued')return false;q.notification={state:'attempted'};putPrivate(key,q);return true;});},
  claimQuestionEvent(workId,id,state,nativeSend){return atomic(()=>{const key=`question-event:${workId}:${id}`,e=readPrivate(key);if(e?.state!=='queued')return false;Object.assign(e,{state,...(nativeSend?{nativeSend}:{})});putPrivate(key,e);return true;});},
  listTeamMessages(workId){return db.prepare("SELECT json FROM receipts WHERE id LIKE 'team-message:%'").all().map(r=>JSON.parse(r.json)).filter(r=>r.workId===workId);},
  ingestTeamMessage(workId,message){return atomic(()=>{
   const a=listDispatches(workId).find(a=>a.id===message.attemptId);
   if(!a||a.memberId!==message.fromMemberId)throw Error('Message sender is not an admitted member.');
   const work=readWork(workId),team=effectiveTeamForWork?.(workId)??JSON.parse(db.prepare('SELECT json FROM team_versions WHERE team_id=? AND version=?').get(work.teamId,work.configVersion)?.json??'null'),managers=team?.members.filter(m=>['head','lead','ceo'].includes(m.role)).map(m=>m.id)??[];
   const managerPeer=managers.includes(message.fromMemberId)&&managers.includes(message.toMemberId);
   if(message.toMemberId!==a.supervisorMemberId&&!managerPeer&&!api.listCollaborations(workId).some(d=>d.fromAttemptId===a.id&&d.toAttemptId===message.toAttemptId&&d.toMemberId===message.toMemberId))throw Error('Worker collaboration requires its supervisor directive.');
   const key=`team-message:${workId}:${message.id}`,prior=readPrivate(key);if(prior){if(hash(prior)!==hash(message))throw Error('Native message identity conflicts.');return prior;}putPrivate(key,message);return message;
  });},
  listCollaborations(workId){return db.prepare("SELECT json FROM receipts WHERE id LIKE 'collaboration:%'").all().map(r=>JSON.parse(r.json)).filter(r=>r.workId===workId);},
  ingestCollaboration(workId,intent){return atomic(()=>{
   const s=intent.spec,work=readWork(workId),attempts=listDispatches(workId),from=attempts.find(a=>a.id===s.fromAttemptId),to=attempts.find(a=>a.id===s.toAttemptId);
   if(!from||!to||from.id===to.id||from.memberId!==s.fromMemberId||to.memberId!==s.toMemberId||from.supervisorMemberId!==work.supervisorMemberId||to.supervisorMemberId!==work.supervisorMemberId||!from.binding||!to.binding||from.status!=='running'||to.status!=='running')throw Error('Collaboration must name two current admitted direct children of this supervisor.');
   const key=`collaboration:${workId}:${s.appQuestionId}`,fingerprint=hash(intent),prior=readPrivate(key);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Collaboration identity conflicts.');return prior;}
   const row={id:s.appQuestionId,workId,fromMemberId:from.memberId,toMemberId:to.memberId,fromAttemptId:from.id,toAttemptId:to.id,fromDispatchId:from.dispatchId,toDispatchId:to.dispatchId,reportToMemberId:from.supervisorMemberId,configVersion:effectiveTeamForWork?.(workId)?.configVersion??work.configVersion,fromConfigVersion:from.configVersion,toConfigVersion:to.configVersion,fromRoleVersion:from.roleVersion,toRoleVersion:to.roleVersion,processing:'unconfirmed',fingerprint,nativeTaskId:intent.nativeTaskId,payloadHash:intent.payloadHash};putPrivate(key,row);return row;
  });},
  ensureQuestionEvent(workId,id,kind,data){return atomic(()=>{const key=`question-event:${workId}:${id}`,prior=readPrivate(key);if(prior)return prior;const event={id,workId,kind,data,state:'queued'};putPrivate(key,event);return event;});},
  updateQuestionEvent(workId,id,patch){return atomic(()=>{const key=`question-event:${workId}:${id}`,event=readPrivate(key);if(!event)throw Error('Question event missing.');Object.assign(event,patch);putPrivate(key,event);return event;});},

  questionProjection:workId=>({messages:api.listTeamMessages(workId).map(({payloadHash,controlProof,...row})=>row),collaborations:api.listCollaborations(workId).map(({fingerprint,payloadHash,...row})=>row),questions:list(workId).map(({fingerprint,proof,...q})=>({...q,supersedableBlockedAnswers:q.sourceReport?q.answers.filter(isUnsentBlockedAnswer).map(a=>a.id):[],origin:q.sourceReport?null:q.origin?Object.fromEntries(Object.entries(q.origin).filter(([k])=>k!=='askParams')):null,resolution:q.resolution?(({sessionDecision,...r})=>r)(q.resolution):undefined,answers:q.answers.map(({nativeSend,fingerprint,sessionDecision,...a})=>a)})),failureStreaks:api.failureStreaks(workId)}),
  ingestQuestion(workId,intent){return atomic(()=>{
   const work=readWork(workId),s=intent.spec,key=`question:${workId}:${s.appQuestionId}`,fingerprint=hash(intent),prior=readPrivate(key);
   if(prior){if(prior.fingerprint!==fingerprint)throw Error('Question ID conflicts with existing immutable question.');return prior;}
   if(work.parent?s.kind!=='relay-question':s.kind!=='user-question')throw Error('Only the highest supervisor asks the user; lower managers relay.');
   if(s.relay){const child=readWork(s.relay.workId),q=list(s.relay.workId).find(q=>q.id===s.relay.appQuestionId);if(!child?.parent||child.parent.workId!==workId||!q||!s.origin||s.origin.attemptId!==child.parent.attemptId)throw Error('Relay must preserve the actual direct manager and its original parent question.');}
   const q={format:'team-question-v1',id:s.appQuestionId,workId,teamId:work.teamId,fromMemberId:work.supervisorMemberId,to:work.parent?'manager':'user',...(s.relay?{relay:s.relay}:{}),runId:work.run.id,generation:work.run.consumerGeneration,epoch:work.epoch??0,revision:1,status:'pending',summary:s.summary,options:s.options,blockingTaskKeys:s.blockingTaskKeys,origin:s.origin??null,evidence:s.evidence??[],proof:intent,fingerprint,answers:[],createdAt:new Date().toISOString(),notification:{state:'queued'}};
   putPrivate(key,q);return q;
  });},
  queueQuestionAnswer(input){return atomic(()=>{
   if(readWork(input?.workId)?.status==='completed')throw Error('Completed TeamWork is sealed.');
   if(!input||!text(input.answerId,120)||!/^[a-zA-Z0-9-]+$/.test(input.answerId)||!text(input.body)||typeof input.supplement!=='boolean')throw Error('Invalid user answer.');
   if(readWork(input.workId)?.parent)throw Error('Only the highest supervisor receives user answers.');
   const q=readPrivate(`question:${input.workId}:${input.questionId}`);if(!q)throw Error('Saved question is unavailable.');
   const fingerprint=hash(input),global=readPrivate(`question-answer:${input.answerId}`);if(global&&global.fingerprint!==fingerprint)throw Error('Answer identity conflicts with another question.');
   const old=q.answers.find(a=>a.id===input.answerId);
   if(old){if(old.fingerprint!==fingerprint)throw Error('Answer identity conflicts; submit an explicit supplement.');return old;}
   if(q.revision!==input.questionRevision||q.status==='closed')throw Error('Question changed or closed; reopen its saved evidence.');
   if(q.answers.length&&!input.supplement)throw Error('An answer already exists; submit an explicit supplement.');
   const a={id:input.answerId,body:input.body,supplement:input.supplement,revision:q.revision,from:'user',toMemberId:q.fromMemberId,state:'queued',processed:'unconfirmed',fingerprint,createdAt:new Date().toISOString()};q.answers.push(a);q.status='pending';putPrivate(`question:${q.workId}:${q.id}`,q);putPrivate(`question-answer:${a.id}`,{workId:q.workId,questionId:q.id,fingerprint});return a;
  });},
  recordSessionAnswer(workId,intent){return atomic(()=>{
   const s=intent.spec,work=readWork(workId);
   validateSessionDecision(work,readPrivate(`dispatch-protocol:${workId}`),s);
   const q=readPrivate(`question:${workId}:${s.questionId}`);
   if(s.kind!=='session-answer'||!q||q.to!=='user'||q.runId!==work.run.id||q.generation!==work.run.consumerGeneration||(q.epoch??0)!==(work.epoch??0)||q.revision!==s.questionRevision||q.status==='closed'||!text(s.body)||typeof s.supplement!=='boolean'||s.nextNativeTaskId!==undefined&&!text(s.nextNativeTaskId,120))throw Error('Choose the exact current question and record the user answer.');
   const input={workId,questionId:q.id,questionRevision:q.revision,answerId:s.appQuestionId,body:s.body,supplement:s.supplement},fingerprint=hash({input,intent}),global=readPrivate(`question-answer:${input.answerId}`);
   if(global&&global.fingerprint!==fingerprint)throw Error('Session answer identity conflicts.');
   const prior=q.answers.find(a=>a.id===input.answerId);if(prior)return prior;
   if(q.answers.length&&!s.supplement)throw Error('An answer already exists; record an explicit user supplement.');
   const supersedesBlockedAnswers=q.sourceReport&&s.supplement?q.answers.filter(isUnsentBlockedAnswer).map(a=>a.id):[];
   const a={id:input.answerId,body:s.body,supplement:s.supplement,revision:q.revision,from:'user',toMemberId:q.fromMemberId,state:'accepted',processed:'unconfirmed',source:'supervisor-session',recordedBy:work.supervisorMemberId,sessionDecision:intent,fingerprint,createdAt:new Date().toISOString(),...(supersedesBlockedAnswers.length?{supersedesBlockedAnswers}:{}),...(s.nextNativeTaskId?{nextNativeTaskId:s.nextNativeTaskId}:{})};
   q.answers.push(a);q.status='pending';putPrivate(`question:${workId}:${q.id}`,q);putPrivate(`question-answer:${a.id}`,{workId,questionId:q.id,fingerprint});return a;
  });},
  resolveSessionQuestion(workId,intent){return atomic(()=>{
   const s=intent.spec,work=readWork(workId);validateSessionDecision(work,readPrivate(`dispatch-protocol:${workId}`),s);
   const q=readPrivate(`question:${workId}:${s.questionId}`),wake=readPrivate(`wake:${s.recoveryRequestId}`);
   if(s.kind!=='session-resolution'||!q||q.to!=='user'||(q.epoch??0)>=(work.epoch??0)||wake?.state!=='bound'||wake.newInstance?.workId!==workId||work.recoveryRequestId!==wake.requestId||!text(s.note,4000))throw Error('Only a reviewed superseded question can be resolved after verified recovery.');
   if(q.resolution){if(hash(q.resolution.sessionDecision)!==hash(intent))throw Error('Question resolution is immutable.');return q.resolution;}
   q.status='closed';q.resolution={kind:'superseded-by-recovery',by:'user',source:'supervisor-session',recordedBy:work.supervisorMemberId,recoveryRequestId:wake.requestId,note:s.note,sessionDecision:intent,recordedAt:new Date().toISOString()};putPrivate(`question:${workId}:${q.id}`,q);return q.resolution;
  });},
  updateQuestion(workId,id,change){return atomic(()=>{if(readWork(workId)?.status==='completed')throw Error('Completed TeamWork is sealed.');const key=`question:${workId}:${id}`,q=readPrivate(key);if(!q)throw Error('Question missing.');change(q);putPrivate(key,q);return q;});},
  failureStreaks(workId){
   const groups=new Map();
   for(const a of listDispatches(workId)){
    const key=a.businessTaskKey??a.taskKey;const rows=groups.get(key)??[];rows.push(a);groups.set(key,rows);
   }
   return [...groups].map(([taskKey,rows])=>{let failures=[];const seen=new Set(),seenEvidence=new Set();for(const a of rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(a.admission!=='committed'||!a.evidenceId?.startsWith('worker_report:')||seen.has(a.id)||seenEvidence.has(a.evidenceId)||!['failed','succeeded'].includes(a.outcome))continue;seen.add(a.id);seenEvidence.add(a.evidenceId);if(a.outcome==='succeeded')failures=[];else failures.push({attemptId:a.id,evidenceId:a.evidenceId,dispatchId:a.dispatchId,nativeTaskId:a.nativeTaskId});}return {taskKey,count:failures.length,evidence:failures,escalationNeeded:failures.length>=2};});
  },
  questionTaskGate(workId,taskKey,nativeTaskId){
   const q=list(workId).find(q=>q.status==='pending'&&q.blockingTaskKeys.includes(taskKey));if(q)throw Error('This task is waiting for a user decision; independent tasks may continue.');
   const streak=api.failureStreaks(workId).find(s=>s.taskKey===taskKey&&s.escalationNeeded);
   if(streak&&!list(workId).some(q=>q.blockingTaskKeys.includes(taskKey)&&q.answers.some(a=>a.processed==='confirmed'&&a.nextNativeTaskId===nativeTaskId)&&streak.evidence.slice(-2).every(e=>q.evidence.includes(e.evidenceId))))throw Error('Two proven execution failures require the highest supervisor summary and a user decision before another attempt.');
  }
 };return api;
}
