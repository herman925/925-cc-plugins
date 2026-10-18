import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionFixture} from './questions-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
import {createQuestionService} from '../src/local/questions.mjs';
import {createStaffingService} from '../src/local/staffing.mjs';
import {readNativeQuestionEvidence} from '../src/local/native-questions.mjs';
import {readNativeDispatchEvidence} from '../src/local/native-dispatch.mjs';
import {sessionDecisionKey} from '../src/local/session-decisions.mjs';
import {authorizedHeadRebind} from './head-rebind-fixture.mjs';
const service=(f,create)=>create({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
async function setup(t,options){const f=await questionFixture(t,options);await service(f,createDispatchService).check(f.work.id);return f;}
function publish(f,kind,id,fields={},forged=false){
 const p=f.store.readDispatchProtocol(f.work.id),spec={protocol:'team-questions/v1',workId:f.work.id,token:p.token,generation:p.generation,appQuestionId:id,kind,...fields},body=JSON.stringify(spec),taskId='native-'+id;
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(taskId,'run-head',body,'ready',null,f.kind==='terminal'?'term-head':null,f.kind==='terminal'?f.binding.paneKey:null,f.kind==='terminal'?'head-pty:head-instance':null,f.kind==='terminal'?1:null);
 f.receipt('create-'+id,'orchestration.taskCreate',{spec:body,run:'run-head',callerTerminalHandle:f.from},{task:{id:taskId,run_id:'run-head',spec:body}},forged);
 return {spec,nativeTaskId:taskId};
}
function propose(f,id='reviewer') {return publish(f,'staffing-proposal',id,{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:{name:'Reviewer',boss:f.team.members[0].id,brief:'Review the findings',habits:'',collaboration:'Report to your manager',agent:'claude',model:'default',effort:'default'},rationale:'Independent review',affectedTaskKeys:[]});}
const approval={proposalId:'reviewer',proposalNativeTaskId:'native-reviewer',configVersion:1,decision:'approve',userConfirmed:true,userStatement:'Yes, add that reviewer.'};
const answer={questionId:'scope',questionRevision:1,body:'Small',supplement:false,userConfirmed:true,userStatement:'Use the small scope.'};
const question=f=>publish(f,'user-question','scope',{summary:'Which scope?',options:['Small','Full'],blockingTaskKeys:['task-one']});

for(const kind of ['terminal','structured'])test(`${kind}: supervisor records explicit staffing approval through native CLI evidence, with no panel and no duplicate after restart`,async t=>{
 const f=await setup(t,{kind,formOverrides:{launchMode:'all'}});propose(f);let staffing=service(f,createStaffingService);
 await staffing.check(f.work.id);assert.equal(f.store.readSnapshot().teams[0].members.length,4);
 assert.ok(f.messages.some(m=>m.startsWith('TEAM_STAFFING_PROPOSAL\n')));
 publish(f,'staffing-decision','approve',approval);await staffing.check(f.work.id);
 const team=f.store.effectiveTeamForWork(f.work.id),proposal=f.store.listStaffingProposals(f.work.id)[0];
 assert.equal(team.members.length,5);assert.equal(proposal.decision.source,'supervisor-session');assert.equal(proposal.decision.recordedBy,f.team.members[0].id);
 assert.equal(proposal.decision.result.launch,undefined,'new members await actual task admission, including all-at-start teams');
 assert.ok(f.messages.some(m=>m.startsWith('TEAM_ROSTER_DELTA\n')&&m.includes(team.members.at(-1).id)));
 assert.equal(f.calls.some(m=>m==='agent.launchReplay'||m==='orchestration.workerStart'),false);
 const resultCount=f.messages.filter(m=>m.startsWith('TEAM_SESSION_DECISION_RESULT\n')).length;
 await f.restart();staffing=service(f,createStaffingService);await staffing.check(f.work.id);
 assert.equal(f.store.effectiveTeamForWork(f.work.id).members.at(-1).id,team.members.at(-1).id);
 assert.equal(f.messages.filter(m=>m.startsWith('TEAM_SESSION_DECISION_RESULT\n')).length,resultCount);
 const native=await readNativeDispatchEvidence(f.profile,{work:f.store.readCurrentWork(f.work.id),protocol:f.store.readDispatchProtocol(f.work.id),owner:(await f.works.verifyWork(f.work.id)).instance,team});assert.deepEqual(native.unmanaged,[]);
});

for(const [name,patch,forged] of [['missing-consent',{userConfirmed:false}],['missing-user-answer',{userStatement:''}],['wrong-proposal',{proposalNativeTaskId:'different-task'}],['stale-config',{configVersion:2}],['forged-author',{},true],['stale-generation',{generation:99}]])test(`staffing refuses ${name} without adding a member`,async t=>{
 const f=await setup(t);propose(f);const staffing=service(f,createStaffingService);await staffing.check(f.work.id);
 publish(f,'staffing-decision',name,{...approval,...patch},forged);await staffing.check(f.work.id);await staffing.check(f.work.id);
 assert.equal(f.store.effectiveTeamForWork(f.work.id).members.length,4);assert.equal(f.store.listStaffingProposals(f.work.id)[0].status,'pending');
});

test('supervisor records user rejection without allocating a member',async t=>{
 const f=await setup(t);propose(f);publish(f,'staffing-decision','reject',{...approval,decision:'reject',userStatement:'Do not add anyone.'});await service(f,createStaffingService).check(f.work.id);
 assert.equal(f.store.listStaffingProposals(f.work.id)[0].status,'rejected');assert.equal(f.store.effectiveTeamForWork(f.work.id).members.length,4);
});

for(const kind of ['terminal','structured'])test(`${kind}: session answer resolves saved question without sending the user's answer back to their supervisor`,async t=>{
 const f=await setup(t,{kind});question(f);let questions=service(f,createQuestionService);await questions.check(f.work.id);
 assert.throws(()=>f.store.questionTaskGate(f.work.id,'task-one','native-next'),/waiting/);
 publish(f,'session-answer','answer',answer);await questions.check(f.work.id);
 let q=f.store.listQuestions(f.work.id)[0];assert.equal(q.status,'answered');assert.equal(q.answers[0].processed,'confirmed');assert.equal(q.answers[0].source,'supervisor-session');
 assert.equal(f.messages.some(m=>m.startsWith('TEAM_USER_ANSWER\n')),false);assert.doesNotThrow(()=>f.store.questionTaskGate(f.work.id,'task-one','native-next'));
 publish(f,'session-answer','supplement',{...answer,body:'Include tests',supplement:true,userStatement:'Also include tests.'});await questions.check(f.work.id);
 await f.restart();questions=service(f,createQuestionService);await questions.check(f.work.id);q=f.store.listQuestions(f.work.id)[0];assert.equal(q.answers.length,2);assert.equal(q.answers.at(-1).body,'Include tests');
});

test('new protocol reaches an already running supervisor once, and unanswered questions stay pending',async t=>{
 const f=await setup(t);question(f);let questions=service(f,createQuestionService);await questions.check(f.work.id);await f.restart();questions=service(f,createQuestionService);await questions.check(f.work.id);
 assert.equal(f.messages.filter(m=>m.startsWith('TEAM_SESSION_DECISIONS\n')).length,1);assert.equal(f.messages.filter(m=>m.startsWith('TEAM_SESSION_QUESTION\n')).length,1);assert.equal(f.store.listQuestions(f.work.id)[0].status,'pending');
 publish(f,'session-answer','forged',{...answer},true);publish(f,'session-answer','silence',{...answer,userConfirmed:false});await questions.check(f.work.id);assert.equal(f.store.listQuestions(f.work.id)[0].answers.length,0);
});

test('a rejected decision stays rejected after restart; fixing it requires a new explicit decision',async t=>{
 const f=await setup(t);propose(f);const intent=publish(f,'staffing-decision','bad',{...approval,proposalNativeTaskId:'missing'});await service(f,createStaffingService).check(f.work.id);
 const event=f.store.readQuestionEvent(f.work.id,'result-'+sessionDecisionKey(intent));assert.equal(event.data.status,'rejected');
 await f.restart();await service(f,createStaffingService).check(f.work.id);assert.equal(f.store.effectiveTeamForWork(f.work.id).members.length,4);
 publish(f,'staffing-decision','fixed',approval);await service(f,createStaffingService).check(f.work.id);assert.equal(f.store.effectiveTeamForWork(f.work.id).members.length,5);
});

test('a lower manager cannot author a user session decision',async t=>{
 const f=await setup(t);publish(f,'staffing-decision','lower',approval);
 const evidence=await readNativeQuestionEvidence(f.profile,{work:{...f.store.readCurrentWork(f.work.id),parent:{workId:'parent'}},protocol:f.store.readDispatchProtocol(f.work.id),owner:(await f.works.verifyWork(f.work.id)).instance});
 assert.equal(evidence.intents.length,0);assert.match(evidence.rejected[0].detail,/highest supervisor/);
});

test('a recovered highest supervisor resolves an obsolete question in session and retains native history',async t=>{
 const f=await setup(t);question(f);await service(f,createQuestionService).check(f.work.id);f.protocol=f.store.readDispatchProtocol(f.work.id);
 const recovered=await authorizedHeadRebind(t,f,{summary:'Continue the original objective and discuss the old question.',evidenceRefs:['original-question:scope']});
 const spec={protocol:'team-questions/v1',workId:f.work.id,token:recovered.protocol.token,generation:2,kind:'session-resolution',appQuestionId:'resolve-old',questionId:'scope',recoveryRequestId:'head-recovery',note:'The user confirmed this scope question is obsolete.',userConfirmed:true,userStatement:'Close that old scope question.'},body=JSON.stringify(spec),row={id:'native-resolution',run_id:'run-head',spec:body};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.run_id,body,'ready',null,null,null,null,null);
 f.receipt('create-resolution','orchestration.taskCreate',{spec:body,run:'run-head',callerTerminalHandle:'orca_session_id:codex_recovered',__orcaCallerOrcaSessionId:'codex_recovered'},{task:row},true);
 const questions=createQuestionService({store:f.store,rpc:recovered.rpc,userData:f.profile,works:recovered.works,consent:async()=>{}});await questions.check(f.work.id);await questions.check(f.work.id);
 const q=f.store.listQuestions(f.work.id)[0];assert.equal(q.status,'closed');assert.equal(q.resolution.source,'supervisor-session');assert.equal(q.answers.length,0);
 const evidence=await readNativeDispatchEvidence(f.profile,{work:f.store.readCurrentWork(f.work.id),protocol:recovered.protocol,owner:(await recovered.works.verifyWork(f.work.id)).instance,team:f.store.effectiveTeamForWork(f.work.id),nativeHistory:f.store.readNativeHistory(f.work.id)});assert.deepEqual(evidence.unmanaged,[]);assert.deepEqual(evidence.rejected,[]);
});

test('a failed staffing transaction rolls back both the member and decision receipt',async t=>{
 const f=await setup(t);propose(f);await service(f,createStaffingService).check(f.work.id);
 const decision=publish(f,'staffing-decision','disk-failure',approval);
 const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(f.profile+'/plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite');t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_session_staffing BEFORE INSERT ON team_versions WHEN NEW.version=2 BEGIN SELECT RAISE(ABORT,'disk full'); END");
 await service(f,createStaffingService).check(f.work.id);
 assert.equal(f.store.effectiveTeamForWork(f.work.id).members.length,4);assert.equal(f.store.listStaffingProposals(f.work.id)[0].status,'pending');assert.equal(f.store.readQuestionEvent(f.work.id,'result-'+sessionDecisionKey(decision)).data.status,'rejected');
});

test('changing an ingested proposal cannot turn an earlier user decision into a different member',async t=>{
 const f=await setup(t);propose(f);await service(f,createStaffingService).check(f.work.id);
 f.db.prepare("UPDATE tasks SET spec=? WHERE id='native-reviewer'").run('{}');publish(f,'staffing-decision','changed-proposal',approval);await service(f,createStaffingService).check(f.work.id);
 assert.equal(f.store.effectiveTeamForWork(f.work.id).members.length,4);
 assert.ok(f.messages.some(m=>m.startsWith('TEAM_SESSION_DECISION_RESULT\n')&&m.includes('evidence changed')));
});

for(const headAgent of ['codex','claude'])for(const kind of ['terminal','structured'])test(`${headAgent} ${kind}: question tool follows the bound supervisor even after future preferences change`,async t=>{
 const f=await setup(t,{headAgent,kind}),expected=headAgent==='codex'?'request_user_input':'AskUserQuestion',other=headAgent==='codex'?'AskUserQuestion':'request_user_input';
 const initial=JSON.parse(f.messages.find(m=>m.startsWith('TEAM_DISPATCH_PROTOCOL\n')).split('\n')[1]);
 assert.ok(initial.sessionDecisions.includes(expected));assert.equal(initial.sessionDecisions.includes(other),false);
 f.store.updateAgentPreferences({requestId:'future-provider',expectedRevision:f.store.readSnapshot().revision,teamId:f.team.id,memberId:f.team.members[0].id,agent:headAgent==='codex'?'claude':'codex',model:'default',effort:'default'});
 await service(f,createQuestionService).check(f.work.id);
 const guide=JSON.parse(f.messages.find(m=>m.startsWith('TEAM_SESSION_DECISIONS\n')).split('\n')[1]);assert.deepEqual(guide.questionMethod,{agent:headAgent,preferredTool:expected});
 assert.match(guide.instructions,/empty result, cancellation, timeout, preselected option or no response is never consent/);
 assert.match(guide.instructions,/same conversation, end the turn and wait for an explicit user reply/);
});
