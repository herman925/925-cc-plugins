import {randomUUID,createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=(v,n=8000)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
export function questionStore({db,readPrivate,putPrivate,readWork,listDispatches,atomic}) {
 const list=workId=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'question:%'").all().map(r=>{const q=JSON.parse(r.json);if(q.format!=='team-question-v1'||!text(q.id,256)||!Array.isArray(q.answers)||!['pending','answered','closed'].includes(q.status))throw Error('Saved pending question is damaged; preserve original data.');return q;}).filter(q=>q.workId===workId);
 const api={
  listQuestions:list,
  questionProjection:workId=>({questions:list(workId).map(({fingerprint,proof,...q})=>({...q,answers:q.answers.map(({nativeSend,fingerprint,...a})=>a)})),failureStreaks:api.failureStreaks(workId)}),
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
   const a={id:input.answerId,body:input.body,revision:q.revision,from:'user',toMemberId:q.fromMemberId,state:'queued',processed:'unconfirmed',fingerprint,createdAt:new Date().toISOString()};q.answers.push(a);putPrivate(`question:${q.workId}:${q.id}`,q);return a;
  });},
  updateQuestion(workId,id,change){return atomic(()=>{const key=`question:${workId}:${id}`,q=readPrivate(key);if(!q)throw Error('Question missing.');change(q);putPrivate(key,q);return q;});},
  failureStreaks(workId){
   const groups=new Map();
   for(const a of listDispatches(workId)){
    const key=a.businessTaskKey??a.taskKey;const rows=groups.get(key)??[];rows.push(a);groups.set(key,rows);
   }
   return [...groups].map(([taskKey,rows])=>{let failures=[];const seen=new Set();for(const a of rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt))){if(a.admission!=='committed'||!a.evidenceId||seen.has(a.id)||!['failed','succeeded'].includes(a.outcome))continue;seen.add(a.id);if(a.outcome==='succeeded')failures=[];else failures.push({attemptId:a.id,evidenceId:a.evidenceId,dispatchId:a.dispatchId,nativeTaskId:a.nativeTaskId});}return {taskKey,count:failures.length,evidence:failures,escalationNeeded:failures.length>=2};});
  },
  questionTaskGate(workId,taskKey){
   const q=list(workId).find(q=>q.status==='pending'&&q.blockingTaskKeys.includes(taskKey));if(q)throw Error('This task is waiting for a user decision; independent tasks may continue.');
   const streak=api.failureStreaks(workId).find(s=>s.taskKey===taskKey&&s.escalationNeeded);
   if(streak&&!list(workId).some(q=>q.blockingTaskKeys.includes(taskKey)&&q.answers.some(a=>a.processed==='confirmed')&&streak.evidence.every(e=>q.evidence.includes(e.evidenceId))))throw Error('Two proven execution failures require the highest supervisor summary and a user decision before another attempt.');
  }
 };return api;
}
