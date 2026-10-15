import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=(v,n=8000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
export function questionStore({db,readPrivate,putPrivate,readWork,listDispatches,atomic}) {
 const list=workId=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'question:%'").all().map(r=>{const q=JSON.parse(r.json);if(q.format!=='team-question-v1'||!text(q.id,256)||!Array.isArray(q.answers)||!['pending','answered','closed'].includes(q.status))throw Error('Saved pending question is damaged; preserve original data.');return q;}).filter(q=>q.workId===workId);
 const api={
  listQuestions:list,
  listTeamMessages(workId){return db.prepare("SELECT json FROM receipts WHERE id LIKE 'team-message:%'").all().map(r=>JSON.parse(r.json)).filter(r=>r.workId===workId);},
  ingestTeamMessage(workId,message){return atomic(()=>{
   const a=listDispatches(workId).find(a=>a.id===message.attemptId);
   if(!a||a.memberId!==message.fromMemberId)throw Error('Message sender is not an admitted member.');
   if(message.toMemberId!==a.supervisorMemberId&&!api.listCollaborations(workId).some(d=>d.fromAttemptId===a.id&&d.toAttemptId===message.toAttemptId&&d.toMemberId===message.toMemberId))throw Error('Worker collaboration requires its supervisor directive.');
   const key=`team-message:${workId}:${message.id}`,prior=readPrivate(key);if(prior){if(hash(prior)!==hash(message))throw Error('Native message identity conflicts.');return prior;}putPrivate(key,message);return message;
  });},
  listCollaborations(workId){return db.prepare("SELECT json FROM receipts WHERE id LIKE 'collaboration:%'").all().map(r=>JSON.parse(r.json)).filter(r=>r.workId===workId);},
  ingestCollaboration(workId,intent){return atomic(()=>{
   const s=intent.spec,work=readWork(workId),attempts=listDispatches(workId),from=attempts.find(a=>a.id===s.fromAttemptId),to=attempts.find(a=>a.id===s.toAttemptId);
   if(!from||!to||from.id===to.id||from.memberId!==s.fromMemberId||to.memberId!==s.toMemberId||from.supervisorMemberId!==work.supervisorMemberId||to.supervisorMemberId!==work.supervisorMemberId||!from.binding||!to.binding||from.configVersion!==work.configVersion||to.configVersion!==work.configVersion||from.status!=='running'||to.status!=='running')throw Error('Collaboration must name two current admitted direct children of this supervisor.');
   const key=`collaboration:${workId}:${s.appQuestionId}`,fingerprint=hash(intent),prior=readPrivate(key);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Collaboration identity conflicts.');return prior;}
   const row={id:s.appQuestionId,workId,fromMemberId:from.memberId,toMemberId:to.memberId,fromAttemptId:from.id,toAttemptId:to.id,fromDispatchId:from.dispatchId,toDispatchId:to.dispatchId,reportToMemberId:from.supervisorMemberId,configVersion:work.configVersion,fromRoleVersion:from.roleVersion,toRoleVersion:to.roleVersion,processing:'unconfirmed',fingerprint,nativeTaskId:intent.nativeTaskId,payloadHash:intent.payloadHash};putPrivate(key,row);return row;
  });},
  ensureQuestionEvent(workId,id,kind,data){return atomic(()=>{const key=`question-event:${workId}:${id}`,prior=readPrivate(key);if(prior)return prior;const event={id,workId,kind,data,state:'queued'};putPrivate(key,event);return event;});},
  updateQuestionEvent(workId,id,patch){return atomic(()=>{const key=`question-event:${workId}:${id}`,event=readPrivate(key);if(!event)throw Error('Question event missing.');Object.assign(event,patch);putPrivate(key,event);return event;});},

  questionProjection:workId=>({messages:api.listTeamMessages(workId).map(({payloadHash,...row})=>row),collaborations:api.listCollaborations(workId).map(({fingerprint,payloadHash,...row})=>row),questions:list(workId).map(({fingerprint,proof,...q})=>({...q,origin:q.origin?Object.fromEntries(Object.entries(q.origin).filter(([k])=>k!=='askParams')):null,answers:q.answers.map(({nativeSend,fingerprint,...a})=>a)})),failureStreaks:api.failureStreaks(workId)}),
  ingestQuestion(workId,intent){return atomic(()=>{
   const work=readWork(workId),s=intent.spec,key=`question:${workId}:${s.appQuestionId}`,fingerprint=hash(intent),prior=readPrivate(key);
   if(prior){if(prior.fingerprint!==fingerprint)throw Error('Question ID conflicts with existing immutable question.');return prior;}
   const q={format:'team-question-v1',id:s.appQuestionId,workId,teamId:work.teamId,fromMemberId:work.supervisorMemberId,to:'user',runId:work.run.id,generation:work.run.consumerGeneration,revision:1,status:'pending',summary:s.summary,options:s.options,blockingTaskKeys:s.blockingTaskKeys,origin:s.origin??null,evidence:s.evidence??[],proof:intent,fingerprint,answers:[],createdAt:new Date().toISOString(),notification:{state:'queued'}};
   putPrivate(key,q);return q;
  });},
  queueQuestionAnswer(input){return atomic(()=>{
   if(!input||!text(input.answerId,120)||!/^[a-zA-Z0-9-]+$/.test(input.answerId)||!text(input.body)||typeof input.supplement!=='boolean')throw Error('Invalid user answer.');
   const q=readPrivate(`question:${input.workId}:${input.questionId}`);if(!q)throw Error('Saved question is unavailable.');
   const fingerprint=hash(input),old=q.answers.find(a=>a.id===input.answerId);
   if(old){if(old.fingerprint!==fingerprint)throw Error('Answer identity conflicts; submit an explicit supplement.');return old;}
   if(q.revision!==input.questionRevision||q.status==='closed')throw Error('Question changed or closed; reopen its saved evidence.');
   if(q.answers.length&&!input.supplement)throw Error('An answer already exists; submit an explicit supplement.');
   const a={id:input.answerId,body:input.body,revision:q.revision,from:'user',toMemberId:q.fromMemberId,state:'queued',processed:'unconfirmed',fingerprint,createdAt:new Date().toISOString()};q.answers.push(a);q.status='pending';putPrivate(`question:${q.workId}:${q.id}`,q);return a;
  });},
  updateQuestion(workId,id,change){return atomic(()=>{const key=`question:${workId}:${id}`,q=readPrivate(key);if(!q)throw Error('Question missing.');change(q);putPrivate(key,q);return q;});},
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
