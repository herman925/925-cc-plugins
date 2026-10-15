import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionFixture} from './questions-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
async function setup(t,options){const f=await questionFixture(t,options);const dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);f.dispatch=dispatch;return f;}
function headIntent(f,spec,{forged=false}={}){const id='question-'+spec.appQuestionId,body=JSON.stringify({protocol:'team-questions/v1',workId:f.work.id,token:f.store.readDispatchProtocol(f.work.id).token,generation:1,...spec});f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,'run-head',body,'ready',null,f.kind==='terminal'?'term-head':null,f.kind==='terminal'?f.binding.paneKey:null,f.kind==='terminal'?'head-instance':null,f.kind==='terminal'?1:null);f.receipt('create-'+id,'orchestration.taskCreate',{spec:body,run:'run-head',callerTerminalHandle:f.from},{task:{id,run_id:'run-head',spec:body}},forged);}
test('only native highest-supervisor author proof creates durable pending user questions',async t=>{
 const f=await setup(t);const {createQuestionService}=await import('../src/local/questions.mjs');const q=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 headIntent(f,{kind:'user-question',appQuestionId:'choice',summary:'Choose scope',options:['Small','Full'],blockingTaskKeys:['task-a']});
 await q.check(f.work.id);await q.check(f.work.id);
 const items=f.store.readSnapshot().works[0].questions;assert.equal(items.length,1);assert.equal(items[0].summary,'Choose scope');assert.equal(items[0].fromMemberId,f.team.members[0].id);assert.equal(items[0].status,'pending');
 headIntent(f,{kind:'user-question',appQuestionId:'forged',summary:'Fake',options:[],blockingTaskKeys:[]},{forged:true});await q.check(f.work.id);assert.equal(f.store.readSnapshot().works[0].questions.length,1);
});
test('user answers persist before native input, replay exactly once, and require explicit supplements',async t=>{
 const f=await setup(t);const {createQuestionService}=await import('../src/local/questions.mjs');const make=()=>createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let q=make();
 headIntent(f,{kind:'user-question',appQuestionId:'choice',summary:'Choose scope',options:['Small','Full'],blockingTaskKeys:[]});await q.check(f.work.id);
 const input={workId:f.work.id,questionId:'choice',questionRevision:1,answerId:'answer-one',body:'Small',supplement:false};
 f.onInput(text=>{if(text.startsWith('TEAM_USER_ANSWER\n'))assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].state,'sending');});
 await q.answer(input);await q.answer(input);
 let saved=f.store.listQuestions(f.work.id)[0];assert.equal(saved.answers.length,1);assert.equal(saved.answers[0].state,'accepted');assert.equal(saved.answers[0].processed,'unconfirmed');
 assert.equal(f.messages.filter(s=>s.startsWith('TEAM_USER_ANSWER\n')).length,1);
 await assert.rejects(q.answer({...input,body:'Full'}),/conflicts/);
 await assert.rejects(q.answer({...input,answerId:'answer-two',body:'Full'}),/supplement/);
 await q.answer({...input,answerId:'answer-two',body:'Additional evidence',supplement:true});assert.equal(f.store.listQuestions(f.work.id)[0].answers.length,2);
 assert.equal(f.calls.some(s=>s==='orchestration.reply'||s==='orchestration.send'),false);
});
test('lost answer receipt remains unknown after restart and stale supervisor preserves user answer without replacement',async t=>{
 const f=await setup(t);const {createQuestionService}=await import('../src/local/questions.mjs');let q=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 headIntent(f,{kind:'user-question',appQuestionId:'choice',summary:'Choose scope',options:[],blockingTaskKeys:[]});await q.check(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_USER_ANSWER\n'))throw Error('socket lost');});
 await q.answer({workId:f.work.id,questionId:'choice',questionRevision:1,answerId:'answer-one',body:'Small',supplement:false});
 assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].state,'unknown');
 await f.restart();q=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await q.check(f.work.id);
 assert.equal(f.messages.filter(s=>s.startsWith('TEAM_USER_ANSWER\n')).length,1);
 f.db.exec('UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2');
 await q.answer({workId:f.work.id,questionId:'choice',questionRevision:1,answerId:'answer-two',body:'New evidence',supplement:true});
 assert.equal(f.store.listQuestions(f.work.id)[0].answers[1].state,'blocked');assert.equal(f.messages.filter(s=>s.startsWith('TEAM_USER_ANSWER\n')).length,1);
});
test('native ask and owning-manager reply preserve original requester and separate accepted input from a native answer',async t=>{
 const f=await setup(t);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await f.dispatch.check(f.work.id);
 const attempt=f.store.listDispatches(f.work.id)[0];
 f.db.exec(`ALTER TABLE messages ADD COLUMN to_handle TEXT; ALTER TABLE messages ADD COLUMN thread_id TEXT;
 CREATE TABLE question_threads(message_id TEXT PRIMARY KEY,run_id TEXT,dispatch_id TEXT,asker_handle TEXT,status TEXT,answer_message_id TEXT,answer_body TEXT,answered_by_generation INTEGER);`);
 const askParams={question:'Need user scope',run:'run-head',from:'structworker_child',compatibilityCliCommand:'orca',timeoutMs:10000};
 f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run('native-question','run-head',`dispatch:${attempt.dispatchId}`,null,'question','Need user scope',JSON.stringify({taskId:attempt.nativeTaskId,dispatchId:attempt.dispatchId}), 'run:run-head','native-question');
 f.db.prepare('INSERT INTO question_threads VALUES(?,?,?,?,?,?,?,?)').run('native-question','run-head',attempt.dispatchId,attempt.binding.handle,'pending',null,null,null);
 // Native boundary supplies actual child identity, independently of product hash implementation.
 const {createHash}=await import('node:crypto');const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const digest=createHash('sha256').update(JSON.stringify(canonical({method:'orchestration.ask',params:{...askParams,from:{paneKey:'child-tab:child-leaf'},__orcaCallerOrcaSessionId:'claude_child'}}))).digest('hex');
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','ask-one','orchestration.ask',digest,'completed',JSON.stringify({accepted:true,messageId:'native-question',threadId:'native-question'}));
 headIntent(f,{kind:'user-question',appQuestionId:'scope',summary:'Which scope?',options:['Small'],blockingTaskKeys:['task-key-one'],origin:{attemptId:attempt.id,dispatchId:attempt.dispatchId,nativeTaskId:attempt.nativeTaskId,messageId:'native-question',askRequestId:'ask-one',askParams}});
 const {createQuestionService}=await import('../src/local/questions.mjs');const q=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await q.check(f.work.id);
 await q.answer({workId:f.work.id,questionId:'scope',questionRevision:1,answerId:'answer-one',body:'Small',supplement:false});
 assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].state,'accepted');assert.equal(f.store.listQuestions(f.work.id)[0].nativeQuestion.fromMemberId,f.member.id);
 f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run('native-answer','run-head','run:run-head',null,'message','Small',null,`dispatch:${attempt.dispatchId}`,'native-question');
 f.db.prepare("UPDATE question_threads SET status='answered',answer_message_id='native-answer',answer_body='Small',answered_by_generation=1").run();
 await q.check(f.work.id);const saved=f.store.listQuestions(f.work.id)[0];assert.equal(saved.status,'answered');assert.equal(saved.answers[0].nativeAnswer.messageId,'native-answer');assert.equal(saved.nativeQuestion.requesterResumed,'unconfirmed');
 assert.equal(f.calls.includes('orchestration.reply'),false);
});
test('notifications are capability-bound, deduplicated, and attempted delivery is never an acknowledgement',async t=>{
 const f=await setup(t);const {createQuestionService}=await import('../src/local/questions.mjs');const notices=[];
 const q=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works,notify:async n=>{notices.push(n);return {delivered:false};}});
 await q.check(f.work.id);assert.equal(notices.length,0);
 headIntent(f,{kind:'user-question',appQuestionId:'notice',summary:'Choose scope',options:[],blockingTaskKeys:[]});await q.check(f.work.id);await q.check(f.work.id);assert.equal(notices.length,1);assert.equal(f.store.listQuestions(f.work.id)[0].notification.state,'unconfirmed');assert.equal(f.store.listQuestions(f.work.id)[0].status,'pending');
 headIntent(f,{kind:'user-question',appQuestionId:'denied',summary:'Permission denied',options:[],blockingTaskKeys:[]});
 const denied=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works,notify:async()=>{throw Error('capability denied');}});await denied.check(f.work.id);assert.equal(f.store.listQuestions(f.work.id)[1].notification.state,'unavailable');
});
test('two-failure policy counts distinct execution evidence, preserves unknown, resets only on proven success and gates only that task',async t=>{
 const f=await setup(t);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await f.dispatch.check(f.work.id);
 const base=f.store.listDispatches(f.work.id)[0];
 const record=(id,outcome,time)=>f.store.writeReceipt('dispatch:'+id,{...base,id,attemptId:id,taskKey:'business-task',createdAt:time,status:outcome?'pending_acceptance':'unknown',...(outcome?{outcome,evidenceId:'worker_report:'+id,result:outcome}:{} )});
 record('one','failed','2026-01-01');assert.equal(f.store.failureStreaks(f.work.id).find(s=>s.taskKey==='business-task').count,1);
 record('unknown',null,'2026-01-02');assert.equal(f.store.failureStreaks(f.work.id).find(s=>s.taskKey==='business-task').count,1);
 record('two','failed','2026-01-03');record('two','failed','2026-01-03');assert.equal(f.store.failureStreaks(f.work.id).find(s=>s.taskKey==='business-task').count,2);
 assert.throws(()=>f.store.questionTaskGate(f.work.id,'business-task','next-task'),/Two proven/);assert.doesNotThrow(()=>f.store.questionTaskGate(f.work.id,'independent-task','independent'));
 record('success','succeeded','2026-01-04');record('three','failed','2026-01-05');assert.equal(f.store.failureStreaks(f.work.id).find(s=>s.taskKey==='business-task').count,1);
 record('one','failed','2026-01-01');assert.equal(f.store.failureStreaks(f.work.id).find(s=>s.taskKey==='business-task').count,1);
});
