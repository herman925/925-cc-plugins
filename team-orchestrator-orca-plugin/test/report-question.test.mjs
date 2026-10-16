import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorizedHeadRebind} from './head-rebind-fixture.mjs';
import {nativeHash} from './dispatch-fixture.mjs';
import {questionFixture} from './questions-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
import {createQuestionService} from '../src/local/questions.mjs';

function publish(f,spec,{forged=false,id='question-'+spec.appQuestionId+(spec.answerId?'-'+spec.answerId:'')}={}){
 const protocol=f.store.readDispatchProtocol(f.work.id),body={protocol:'team-questions/v1',workId:f.work.id,token:protocol.token,generation:protocol.generation,...spec},text=JSON.stringify(body),task={id,run_id:'run-head',spec:text};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,'run-head',text,'ready',null,f.kind==='terminal'?'term-head':null,f.kind==='terminal'?f.binding.paneKey:null,f.kind==='terminal'?'head-pty:head-instance':null,f.kind==='terminal'?protocol.generation:null);
 const requestId='create-'+id;f.receipt(requestId,'orchestration.taskCreate',{spec:text,run:'run-head',callerTerminalHandle:f.from},{task},forged);
 return {spec:body,nativeTaskId:id,requestId,payloadHash:f.db.prepare('SELECT payload_hash FROM mutation_receipts WHERE request_id=?').get(requestId).payload_hash};
}
async function reports(t,options={}){
 const f=await questionFixture(t,options),rpc=async(method,params,...rest)=>{
  if(options.workerKind==='terminal'&&method==='terminal.show'&&params.terminal==='structworker_child')return {terminal:{handle:params.terminal,ptyId:'child-pty',incarnationId:'child-instance',tabId:'child-tab',leafId:'child-leaf',worktreeId:'folder:/work',executionHostId:'local',agentIdentity:'claude',connected:true,writable:true}};
  return f.rpc(method,params,...rest);
 },dispatch=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);
 const protocol=f.store.readDispatchProtocol(f.work.id);f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){const permit=JSON.parse(text.split('\n').slice(1).join('\n')),dispatchId=f.start(permit);if(options.workerKind==='terminal'){
 f.db.prepare("UPDATE dispatch_contexts SET assignee_orca_session_id=NULL,process_incarnation='child-pty:child-instance' WHERE id=?").run(dispatchId);
 if(permit.startParams.terminal){const params={...permit.startParams,terminal:{paneKey:'child-tab:child-leaf'},from:options.kind==='terminal'?{paneLeafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}:f.from,devMode:false,...(options.kind==='terminal'?{}:{__orcaCallerOrcaSessionId:'codex_head'})};f.db.prepare('UPDATE mutation_receipts SET payload_hash=? WHERE request_id=?').run(nativeHash('orchestration.workerStart',params),'start-'+permit.nativeTaskId);}
 }}});
 let previous;for(const taskId of ['first-failure','second-failure']){f.createIntent(protocol,{taskId,...(previous?{previousAttemptId:previous.id}:{})});await dispatch.check(f.work.id);let attempt=f.store.listDispatches(f.work.id).at(-1);f.complete(attempt,{outcome:'failed'});await dispatch.check(f.work.id);attempt=f.store.listDispatches(f.work.id).at(-1);if(taskId==='first-failure'||!options.pendingLast){f.review(attempt,{decision:'rework'});await dispatch.check(f.work.id);}previous=f.store.listDispatches(f.work.id).at(-1);}
 const evidence=f.store.failureStreaks(f.work.id)[0].evidence.map(row=>row.evidenceId),origin={attemptId:previous.id,dispatchId:previous.dispatchId,nativeTaskId:previous.nativeTaskId,messageId:'report-second-failure'};
 const spec={kind:'user-question',appQuestionId:'two-failures',summary:'Two attempts failed. Keep the prerequisite absent and accept expected negative QA?',options:['Repair prerequisite','Accept expected negative QA'],blockingTaskKeys:[previous.taskKey],evidence,origin};
 const questions=()=>createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 return {...f,get store(){return f.store;},get works(){return f.works;},protocol,previous,spec,questions,publish:(spec,options)=>publish(f,spec,options)};
}
for(const kind of ['structured','terminal'])test(`${kind} persisted completion-origin Head decision keeps blocked answer immutable and sends only an explicit new supplement`,async t=>{
 const f=await reports(t,{kind,workerKind:kind}),intent=f.publish(f.spec);f.store.ingestQuestion(f.work.id,intent);
 f.store.queueQuestionAnswer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'blocked-answer',body:'Accept expected negative QA; do not make a third attempt.',supplement:false});
 f.store.updateQuestion(f.work.id,f.spec.appQuestionId,q=>Object.assign(q.answers[0],{state:'blocked',detail:'Original native question is closed, answered or unverified; this answer cannot resume it.'}));
 const before=structuredClone(f.store.listQuestions(f.work.id)[0]);await f.restart();let q=f.questions();await q.check(f.work.id);
 const classified=f.store.listQuestions(f.work.id)[0];assert.equal(classified.sourceReport.evidenceId,'worker_report:report-second-failure');
 assert.deepEqual(classified.proof,before.proof);assert.equal(classified.fingerprint,before.fingerprint);assert.deepEqual(classified.origin,before.origin);assert.deepEqual(classified.answers[0],before.answers[0]);assert.equal(f.messages.filter(m=>m.startsWith('TEAM_USER_ANSWER')).length,0);
 f.publish({kind:'answer-ack',appQuestionId:f.spec.appQuestionId,answerId:'blocked-answer',nextNativeTaskId:'guessed-third'});await q.check(f.work.id);assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].processed,'unconfirmed');
 await q.answer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'explicit-supplement',body:'Accept expected negative QA; no third attempt.',supplement:true});
 const sends=f.messages.filter(m=>m.startsWith('TEAM_USER_ANSWER'));assert.equal(sends.length,1);const wire=JSON.parse(sends[0].split('\n').slice(1).join('\n'));
 assert.equal(wire.origin,undefined);assert.equal(wire.sourceReport.messageId,'report-second-failure');assert.match(wire.instruction,/Do not.*reply|No.*reply/);
 assert.equal(f.store.listQuestions(f.work.id)[0].answers[1].processed,'unconfirmed');f.publish({kind:'answer-ack',appQuestionId:f.spec.appQuestionId,answerId:'explicit-supplement'});await q.check(f.work.id);
 const saved=f.store.listQuestions(f.work.id)[0];assert.equal(saved.status,'answered');assert.deepEqual(saved.answers[0],before.answers[0]);assert.equal(saved.answers[1].processed,'confirmed');assert.equal(saved.nativeQuestion,undefined);
 assert.equal(f.store.workClosureBlockers(f.work.id).some(reason=>reason.startsWith('User decision')),false);
 assert.deepEqual(saved.answers[1].supersedesBlockedAnswers,['blocked-answer']);
 assert.equal(f.store.failureStreaks(f.work.id)[0].count,2);assert.equal(f.store.listDispatches(f.work.id).length,2);assert.equal(f.calls.some(method=>/orchestration.reply|restartContinue|restartResume/.test(method)),false);
});

for(const change of ['plain-worker-done','plain-question','fact-rejected','fact-authority','fact-task','start-proof','start-creator','message-sender','message-outcome','dispatch-process','dispatch-host','worker-epoch','worker-workspace','evidence-missing','partial-ask-fields','zero-origin','ask-fields-on-report','relay','forged-head'])test(`unverified completion origin is refused at intake: ${change}`,async t=>{
 const f=await reports(t),spec=structuredClone(f.spec),id='worker_report:report-second-failure';
 if(change==='plain-worker-done'||change==='plain-question')f.db.prepare('DELETE FROM attempt_observation_facts WHERE id=?').run(id);
 if(change==='plain-question')f.db.prepare("UPDATE messages SET type='question' WHERE id='report-second-failure'").run();
 if(change==='fact-rejected')f.db.prepare("UPDATE attempt_observation_facts SET payload=? WHERE id=?").run(JSON.stringify({status:'rejected',outcome:'failed',reportId:id}),id);
 if(change==='fact-authority')f.db.prepare("UPDATE attempt_observation_facts SET authority_id='run_home:other' WHERE id=?").run(id);
 if(change==='fact-task')f.db.prepare("UPDATE attempt_observation_facts SET task_id='other' WHERE id=?").run(id);
 if(change==='start-proof')f.db.prepare("DELETE FROM mutation_receipts WHERE request_id='start-second-failure'").run();
 if(change==='start-creator')f.db.prepare("UPDATE dispatch_contexts SET creator_orca_session_id='other-head' WHERE id=?").run(f.previous.dispatchId);
 if(change==='message-sender')f.db.prepare("UPDATE messages SET from_handle='other-member' WHERE id='report-second-failure'").run();
 if(change==='message-outcome')f.db.prepare("UPDATE messages SET payload=? WHERE id='report-second-failure'").run(JSON.stringify({taskId:f.previous.nativeTaskId,dispatchId:f.previous.dispatchId,outcome:'succeeded'}));
 if(change==='dispatch-process')f.db.prepare("UPDATE dispatch_contexts SET process_incarnation='other-process' WHERE id=?").run(f.previous.dispatchId);
 if(change==='dispatch-host')f.db.prepare('UPDATE dispatch_contexts SET host_scope=? WHERE id=?').run(JSON.stringify({kind:'ssh',targetId:'other'}),f.previous.dispatchId);
 if(change==='worker-epoch')f.db.prepare("UPDATE worker_dispatches SET runtime_epoch='other-runtime' WHERE dispatch_id=?").run(f.previous.dispatchId);
 if(change==='worker-workspace')f.db.prepare("UPDATE worker_dispatches SET worktree_id='other-workspace' WHERE dispatch_id=?").run(f.previous.dispatchId);
 if(change==='evidence-missing')spec.evidence=[];
 if(change==='zero-origin')spec.origin=0;
 if(change==='partial-ask-fields')spec.origin.askRequestId='invented-ask';
 if(change==='ask-fields-on-report')Object.assign(spec.origin,{askRequestId:'invented-ask',askParams:{question:'invented',run:'run-head'}});
 if(change==='relay')spec.relay={workId:'child-work',appQuestionId:'child-question'};
 f.publish(spec,{forged:change==='forged-head'});await f.questions().check(f.work.id);
 assert.equal(f.store.listQuestions(f.work.id).length,0);assert.equal(f.messages.filter(m=>m.startsWith('TEAM_USER_ANSWER')).length,0);assert.equal(f.store.failureStreaks(f.work.id)[0].count,2);
});
for(const stage of ['before-input','before-ack'])test(`report proof tampering ${stage} never gains rights from cached classification`,async t=>{
 const f=await reports(t);f.publish(f.spec);const q=f.questions();await q.check(f.work.id);assert.ok(f.store.listQuestions(f.work.id)[0].sourceReport);
 const input={workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'fresh-answer',body:'Expected negative QA only',supplement:false};
 if(stage==='before-ack')await q.answer(input);
 f.db.prepare("DELETE FROM attempt_observation_facts WHERE id='worker_report:report-second-failure'").run();
 if(stage==='before-input'){await q.answer(input);assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].state,'blocked');assert.equal(f.messages.filter(m=>m.startsWith('TEAM_USER_ANSWER')).length,0);}
 f.publish({kind:'answer-ack',appQuestionId:f.spec.appQuestionId,answerId:input.answerId});await q.check(f.work.id);
 assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].processed,'unconfirmed');assert.equal(f.store.listQuestions(f.work.id)[0].status,'pending');
});
test('ordinary message acknowledgement and forged Head Task cannot confirm a delivered report decision',async t=>{
 const f=await reports(t);f.publish(f.spec);const q=f.questions();await q.check(f.work.id);await q.answer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'report-answer',body:'Keep prerequisite absent',supplement:false});
 f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run('ordinary-ack','run-head','pretend-head',null,'message','{"kind":"answer-ack","answerId":"report-answer"}',null);
 f.publish({kind:'answer-ack',appQuestionId:f.spec.appQuestionId,answerId:'report-answer'},{forged:true});await q.check(f.work.id);
 assert.equal(f.store.listQuestions(f.work.id)[0].answers[0].processed,'unconfirmed');assert.equal(f.store.listQuestions(f.work.id)[0].status,'pending');
});
for(const oldState of ['unknown','sending','accepted','blocked-with-marker'])test(`explicit report supplement cannot supersede an old ${oldState} answer`,async t=>{
 const f=await reports(t);f.publish(f.spec);const q=f.questions();await q.check(f.work.id);
 f.store.queueQuestionAnswer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'old-effect',body:'Old decision',supplement:false});
 f.store.updateQuestion(f.work.id,f.spec.appQuestionId,saved=>Object.assign(saved.answers[0],{state:oldState==='blocked-with-marker'?'blocked':oldState,nativeSend:{method:'agentSession.send',params:{},envelope:{}}}));
 const old=structuredClone(f.store.listQuestions(f.work.id)[0].answers[0]);
 await q.answer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'new-supplement',body:'New decision',supplement:true});f.publish({kind:'answer-ack',appQuestionId:f.spec.appQuestionId,answerId:'new-supplement'});await q.check(f.work.id);
 const saved=f.store.listQuestions(f.work.id)[0];assert.equal(saved.answers[1].supersedesBlockedAnswers,undefined);assert.equal(saved.answers[0].processed,'unconfirmed');assert.equal(saved.answers[0].body,old.body);assert.equal(f.store.workClosureBlockers(f.work.id).some(reason=>reason.startsWith('User decision')),true);
});

async function recoveredReport(t,{recover=true}={}){
 const f=await reports(t,{pendingLast:true}),first=f.store.listDispatches(f.work.id)[0];
 // Use the earlier genuine report so latest-attempt closure cannot mask historical reproof.
 f.spec.origin={attemptId:first.id,dispatchId:first.dispatchId,nativeTaskId:first.nativeTaskId,messageId:'report-first-failure'};
 f.publish(f.spec);const q=f.questions();await q.check(f.work.id);
 f.store.queueQuestionAnswer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'old-blocked',body:'Expected negative QA',supplement:false});
 f.store.updateQuestion(f.work.id,f.spec.appQuestionId,saved=>Object.assign(saved.answers[0],{state:'blocked',detail:'No original ask thread.'}));
 await q.answer({workId:f.work.id,questionId:f.spec.appQuestionId,questionRevision:1,answerId:'new-explicit',body:'Accept expected negative QA; no third attempt',supplement:true});
 f.publish({kind:'answer-ack',appQuestionId:f.spec.appQuestionId,answerId:'new-explicit'});await q.check(f.work.id);
 f.review(f.previous);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const saved=structuredClone(f.store.listQuestions(f.work.id)[0]),recovered=recover?await authorizedHeadRebind(t,f,{summary:'Preserve the user-approved expected negative QA and two original reports.',evidenceRefs:f.spec.evidence}):{rpc:f.rpc,works:f.works,protocol:f.protocol};
 const spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:recovered.protocol.token,generation:recovered.protocol.generation,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Expected negative QA accepted as explicitly directed by the user.',evidenceRefs:[f.previous.evidenceId],attemptIds:[f.previous.id]}),task={id:'recovered-report-delivery',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks(id,run_id,spec,status) VALUES(?,?,?,?)').run(task.id,task.run_id,spec,task.status);
 if(!recover)f.receipt('create-recovered-report-delivery','orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task});
 else f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','create-recovered-report-delivery','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:'orca_session_id:codex_recovered',__orcaCallerOrcaSessionId:'codex_recovered'}),'completed',JSON.stringify({task}));
 const {createLifecycleService}=await import('../src/local/lifecycle.mjs'),lifecycle=createLifecycleService({store:f.store,rpc:recovered.rpc,userData:f.profile,consent:async()=>{},works:recovered.works});await lifecycle.check(f.work.id);
 return {...f,saved,lifecycle,input:{requestId:'accept-report-delivery',workId:f.work.id,deliveryId:task.id,expectedWorkVersion:f.store.readCurrentWork(f.work.id).version,decision:'accept'}};
}
test('explicit report decision survives authorized Head recovery and genuine closure without rewriting the old blocked answer',async t=>{
 const f=await recoveredReport(t);await f.lifecycle.decide(f.input);
 assert.equal(f.store.readCurrentWork(f.work.id).status,'completed');assert.deepEqual(f.store.listQuestions(f.work.id)[0],f.saved);assert.equal(f.store.listDispatches(f.work.id).length,2);assert.equal(f.store.failureStreaks(f.work.id)[0].count,2);
});
for(const change of ['fact','message','dispatch','question','question-author','ack','ack-author','recovery'])test(`historical report decision cannot discharge closure after ${change} proof changes`,async t=>{
 const f=await recoveredReport(t);
 if(change==='fact')f.db.prepare("DELETE FROM attempt_observation_facts WHERE id='worker_report:report-first-failure'").run();
 if(change==='message')f.db.prepare("UPDATE messages SET from_handle='other' WHERE id='report-first-failure'").run();
 if(change==='dispatch')f.db.prepare("UPDATE dispatch_contexts SET process_incarnation='other' WHERE id=?").run(f.spec.origin.dispatchId);
 if(change==='question')f.db.prepare("UPDATE tasks SET spec=spec||' ' WHERE id='question-two-failures'").run();
 if(change==='question-author')f.db.prepare("UPDATE mutation_receipts SET payload_hash='wrong' WHERE request_id='create-question-two-failures'").run();
 if(change==='ack')f.db.prepare("DELETE FROM tasks WHERE id='question-two-failures-new-explicit'").run();
 if(change==='ack-author')f.db.prepare("UPDATE mutation_receipts SET payload_hash='wrong' WHERE request_id='create-question-two-failures-new-explicit'").run();
 if(change==='recovery'){const wake=f.store.readWake('head-recovery');f.store.updateWake(wake.requestId,wake.version,{state:'needs_decision'});}
 await assert.rejects(f.lifecycle.decide(f.input),/native|Native|Unregistered|evidence|authority|recovery/);assert.notEqual(f.store.readCurrentWork(f.work.id).status,'completed');
});

test('current-epoch answered report decision must retain native report evidence at closure',async t=>{
 const f=await recoveredReport(t,{recover:false});f.db.prepare("DELETE FROM attempt_observation_facts WHERE id='worker_report:report-first-failure'").run();
 await assert.rejects(f.lifecycle.decide(f.input),/native|Native|Unregistered|evidence/);assert.notEqual(f.store.readCurrentWork(f.work.id).status,'completed');
});
