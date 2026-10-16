import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nativeLaunchIntent } from '../src/local/native-launch.mjs';
import { createWorkService } from '../src/local/teamwork.mjs';
import { fixture, nativeHash } from './dispatch-fixture.mjs';
test('genuine supervisor intent commits admission before native member start and records execution pending acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');
 const f=await fixture(t);const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);
 const protocol=f.store.readDispatchProtocol(f.work.id);
 assert.equal(protocol.state,'accepted');assert.notEqual(protocol.token,f.store.readWork(f.work.id).protocolToken);
 f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n')){const permit=JSON.parse(text.split('\n').slice(1).join('\n'));assert.equal(f.store.listDispatches(f.work.id)[0].status,'admitted');f.start(permit);}});
 await service.check(f.work.id);await service.check(f.work.id);
 let task=f.store.listDispatches(f.work.id)[0];assert.equal(task.status,'running');assert.equal(task.memberId,f.member.id);assert.equal(task.configVersion,1);assert.equal(task.roleVersion,1);
 assert.equal(f.calls.some(method=>/workerStart|runCreate|taskCreate|orchestration.send/.test(method)),false);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
 f.db.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id=?").run(task.dispatchId);
 f.db.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id=?").run(task.dispatchId);
 f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run('report-one','run-head','structworker_child','child-tab:child-leaf','worker_done','Inspection finished with tests.',JSON.stringify({taskId:'task-one',dispatchId:task.dispatchId,outcome:'succeeded'}));
 f.db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:report-one',task.dispatchId,'task-one','run_home:run-head','worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:report-one'}));
 await service.check(f.work.id);task=f.store.listDispatches(f.work.id)[0];assert.equal(task.status,'pending_acceptance');assert.equal(task.outcome,'succeeded');assert.match(task.result,/Inspection finished/);
 await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
});
test('already-started native work is retained as unadmitted uncertainty and reserves its member without a new permit',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.start({nativeTaskId:'task-one',startParams:{task:'task-one',worktree:'folder:/work',agent:'claude',run:'run-head'}});
 await service.check(f.work.id);
 const rows=f.store.listDispatches(f.work.id);assert.equal(rows.length,1);assert.equal(rows[0].admission,'unadmitted');assert.equal(rows[0].status,'unknown');
 assert.equal(rows[0].permit.state,'unknown');assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
 f.createIntent(protocol,{taskId:'task-two',taskKey:'task-key-two'});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('forged native caller, indirect member, and revoked Run generation cannot authorize a permit',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.createIntent(protocol,{forged:true});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);assert.match(f.store.readDispatchProtocol(f.work.id).detail,/author proof/);
 f.createIntent(protocol,{taskId:'task-root',taskKey:'root',memberId:f.team.members[0].id});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);
 f.db.exec('UPDATE runs SET consumer_generation=3,coordinator_orca_session_id_generation=3');
 f.createIntent(protocol,{taskId:'after-takeover',taskKey:'after-takeover'});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('two distinct members cannot adopt the same active native session even when native receipts otherwise match',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 f.createIntent(protocol);await service.check(f.work.id);
 f.createIntent(protocol,{taskId:'task-other',taskKey:'other-member',memberId:f.team.members[2].id});await service.check(f.work.id);
 const tasks=f.store.listDispatches(f.work.id);assert.equal(tasks.length,2);assert.equal(tasks[0].status,'running');
 assert.equal(tasks[1].status,'unknown');assert.equal(tasks[1].binding,undefined);assert.match(tasks[1].detail,/another member/);
});
test('unknown permit survives worker restart and late native start settles only its saved attempt without another input',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const make=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let service=make();
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));let savedPermit;
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n')){savedPermit=JSON.parse(text.split('\n').slice(1).join('\n'));throw Error('lost permit receipt');}});
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'unknown');
 await f.restart();service=make();await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
 f.start(savedPermit);await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');assert.equal(f.store.listDispatches(f.work.id).length,1);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
});
for(const kind of ['structured','terminal'])test(`Claude supervisor to Codex member uses actual ${kind} identity and preserves native caller proof`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{headAgent:'claude',workerAgent:'codex',kind}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.startParams.agent,'codex');assert.equal(row.status,'running');
 assert.ok(f.calls.includes(kind==='terminal'?'terminal.send':'agentSession.send'));
});
test('a late native Task proves an ambiguous protocol input without resending the protocol',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PROTOCOL\n'))throw Error('lost protocol receipt');});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);assert.equal(protocol.state,'unknown');f.createIntent(protocol);
 f.onInput(()=>{});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PROTOCOL\n')).length,1);
});
test('wrong native execution host and obsolete Dispatch reports remain unconfirmed and cannot complete a member',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n')){const id=f.start(JSON.parse(text.split('\n').slice(1).join('\n')));f.db.prepare('UPDATE dispatch_contexts SET host_scope=? WHERE id=?').run(JSON.stringify({kind:'ssh',targetId:'wrong-host'}),id);}});
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.status,'unknown');assert.equal(row.binding,undefined);assert.match(row.detail,/host/);
 f.db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:old-report','old-dispatch','task-one','run_home:run-head','worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:old-report'}));
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].outcome,undefined);
});
test('SQLite admission failure sends no permit and rollback keeps the member available for the exact corrected intent',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 const fault=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>fault.close());
 fault.exec("CREATE TRIGGER refuse_admission BEFORE INSERT ON receipts WHEN NEW.id LIKE 'dispatch:%' BEGIN SELECT RAISE(ABORT,'admission disk failure'); END");
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
 fault.exec('DROP TRIGGER refuse_admission');await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
});
test('unverifiable native worker observation preserves identity but does not claim an active assignment',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const rpc=async(method,...args)=>{const value=await f.rpc(method,...args);if(method==='orchestration.workerShow')value.observation={status:'unverifiable',exactWorker:false};return value;};
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.status,'unknown');assert.equal(row.binding.handle,'structworker_child');
});
test('corrupt stored completion or protocol evidence blocks reads without inventing acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await service.check(f.work.id);
 const row=f.store.listDispatches(f.work.id)[0],fault=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>fault.close());
 const corrupt={...row,status:'pending_acceptance'};fault.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(corrupt),`dispatch:${row.id}`);
 assert.throws(()=>f.store.readSnapshot(),/damaged/);
 assert.equal(fault.prepare('SELECT json FROM receipts WHERE id=?').get(`dispatch:${row.id}`).json,JSON.stringify(corrupt));
 fault.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(row),`dispatch:${row.id}`);
 const protocol=f.store.readDispatchProtocol(f.work.id);fault.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify({...protocol,state:'not_sent'}),`dispatch-protocol:${f.work.id}`);
 assert.throws(()=>f.store.readSnapshot(),/protocol is damaged/);
});
test('unavailable native evidence reports a bounded diagnostic without exposing the verified profile path',async()=>{
 const {readNativeDispatchEvidence}=await import('../src/local/native-dispatch.mjs');
 const result=await readNativeDispatchEvidence('/private/nonexistent-sensitive-orca-profile',{work:{}});
 assert.equal(result.state,'unverified');assert.equal(result.detail.includes('/private/'),false);
});
test('native start arriving during capability reads is not retroactively admitted from an older Task snapshot',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);let inject=false;
 const rpc=async(method,...args)=>{if(inject&&method==='preflight.detectAgents'){inject=false;f.start({nativeTaskId:'task-one',startParams:{task:'task-one',worktree:'folder:/work',agent:'claude',run:'run-head'}});}return f.rpc(method,...args);};
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));inject=true;
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.admission,'unadmitted');assert.equal(row.status,'unknown');
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('an observed native start after app reservation but before permit is fenced without issuing the permit',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);let inject=false;
 const works={...f.works,async verifyWork(...args){const value=await f.works.verifyWork(...args);if(inject&&f.store.listDispatches(f.work.id).length){inject=false;f.start({nativeTaskId:'task-one',startParams:{task:'task-one',worktree:'folder:/work',agent:'claude',run:'run-head'}});}return value;}};
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));inject=true;await service.check(f.work.id);
 const row=f.store.listDispatches(f.work.id)[0];assert.equal(inject,false);assert.equal(row.admission,'unadmitted');assert.equal(row.status,'unknown');assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('recovery reads explicit Run and exact Dispatch, labels incomplete output and never sends or releases the attempt',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');const f=await fixture(t);
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice('TEAM_DISPATCH_PERMIT\n'.length)));});await service.check(f.work.id);await f.restart();
 let exited=false,exact=true;const readCalls=[];
 const rpc=async(method,params)=>{readCalls.push({method,params});if(method==='orchestration.workerRead')return {dispatchId:params.dispatch,source:'terminal',sourceIdentity:'native-output',sourceExact:true,contentComplete:false,warnings:['SSH transcript was clipped'],archived:true};const result=await f.rpc(method,params);if(method==='orchestration.workerShow')result.observation={status:exited?'exited':'live',exactWorker:exact};return result;};
 const recovery=createRecoveryService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});const before=f.messages.length;
 await recovery.checkWork(f.work.id);let task=f.store.dispatchProjection(f.work.id).tasks[0];assert.equal(task.recovery.state,'confirmed_effect');assert.equal(task.recovery.incomplete,true);assert.match(task.recovery.output.warnings[0],/clipped/);
 exited=true;exact=false;await recovery.checkWork(f.work.id);assert.equal(f.store.dispatchProjection(f.work.id).tasks[0].recovery.liveness,'unknown');
 exact=true;await recovery.checkWork(f.work.id);task=f.store.dispatchProjection(f.work.id).tasks[0];assert.equal(task.recovery.state,'stopped');assert.equal(task.status,'running','execution evidence does not rewrite business task facts');
 assert.equal(f.messages.length,before);assert.equal(readCalls.some(row=>/inbox|ack|send|start|launch/i.test(row.method)),false);assert.equal(readCalls.find(row=>row.method==='orchestration.taskList').params.run,'run-head');
 f.createIntent(f.store.readDispatchProtocol(f.work.id),{taskId:'blocked',taskKey:'blocked'});await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,1);
});
test('recovery refuses a new native incarnation under an existing Dispatch without overwriting the saved member binding',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice('TEAM_DISPATCH_PERMIT\n'.length)));});await service.check(f.work.id);
 const before=f.store.listDispatches(f.work.id)[0];f.db.exec("UPDATE dispatch_contexts SET process_incarnation='replacement-instance'");
 await createRecoveryService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}}).checkWork(f.work.id);
 const after=f.store.listDispatches(f.work.id)[0];assert.equal(after.binding.incarnationId,before.binding.incarnationId);assert.equal(after.recovery.state,'unknown');
});

test('supervisor acceptance alone releases an application dependency and survives restart with original result',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const make=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let service=make();
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});
 f.createIntent(protocol);await service.check(f.work.id);let first=f.store.listDispatches(f.work.id)[0];
 f.createIntent(protocol,{taskId:'dependent',taskKey:'dependent',dependencies:[first.taskKey]});
 f.complete(first);await service.check(f.work.id);first=f.store.listDispatches(f.work.id)[0];
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(first.status,'pending_acceptance');
 f.review(first);await service.check(f.work.id);await service.check(f.work.id);
 first=f.store.listDispatches(f.work.id)[0];assert.equal(first.status,'accepted');assert.equal(first.result,'Original execution result');assert.equal(first.review.decision,'accept');
 assert.equal(f.store.listDispatches(f.work.id).length,2);
 const dependent=f.store.listDispatches(f.work.id)[1];assert.equal(dependent.status,'running');assert.equal(dependent.startParams.terminal,'orca_session_id:claude_child');
 f.complete(dependent);await service.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[1]);await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[1].status,'accepted');
 await f.restart();service=make();await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].review.requestId,'review-'+first.id);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,2);
});
for(const kind of ['structured','terminal'])test(`rework reuses the verified retained child session under a new attempt (${kind} supervisor)`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{kind});
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});
 f.createIntent(protocol);await service.check(f.work.id);f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);
 const first=f.store.listDispatches(f.work.id)[0];f.review(first,{decision:'rework'});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id)[0].status,'rework');
 f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 const attempts=f.store.listDispatches(f.work.id);assert.equal(attempts.length,2);assert.equal(attempts[1].status,'running');
 assert.equal(attempts[1].startParams.terminal,'orca_session_id:claude_child');assert.equal(attempts[1].startParams.agent,undefined);
 assert.equal(attempts[0].result,'Original execution result');assert.equal(attempts[1].outcome,undefined);
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[1].status,'running');
 f.complete(attempts[1]);await service.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[1]);await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id)[1].status,'accepted');
});
for(const fault of ['wrong-author','wrong-work','wrong-attempt','missing-evidence','wrong-generation'])test(`${fault} review cannot accept native completion or release its dependent`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];
 f.createIntent(protocol,{taskId:'dependent',taskKey:'dependent',dependencies:[row.taskKey]});
 const patch={'wrong-work':{workId:'another-work'},'wrong-attempt':{attemptId:'obsolete'},'missing-evidence':{evidenceRefs:[]},'wrong-generation':{generation:4}}[fault]??{};
 f.review(row,{forged:fault==='wrong-author',patch});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.store.listDispatches(f.work.id)[0].status,'pending_acceptance');assert.equal(f.store.listDispatches(f.work.id)[0].result,'Original execution result');
});
test('conflicting late decision cannot replace prior review, finish rework or permit a duplicate',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const make=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let service=make();
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];
 f.review(first,{decision:'rework'});await service.check(f.work.id);await f.restart();service=make();
 f.createIntent(protocol,{taskId:'dependent',taskKey:'dependent',dependencies:[first.taskKey]});
 f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 f.review(first,{requestId:'late-conflict'});await service.check(f.work.id);await service.check(f.work.id);
 const rows=f.store.listDispatches(f.work.id);assert.equal(rows.length,2);assert.equal(rows[0].status,'rework');assert.equal(rows[1].status,'running');assert.equal(rows[1].result,undefined);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,2);
 f.complete(rows[1]);await service.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[1]);await service.check(f.work.id);await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,3);assert.equal(f.store.listDispatches(f.work.id)[2].taskKey,'dependent');assert.equal(f.store.listDispatches(f.work.id)[2].status,'running');
});
test('unverifiable retained session keeps rework reserved and never falls back to fresh launch',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);let unavailable=false;
 const rpc=async(method,...args)=>{if(unavailable&&method==='orchestration.partyLocation'&&args[0].address==='orca_session_id:claude_child')return {location:null,lost:'chat'};return f.rpc(method,...args);};
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];f.review(first,{decision:'rework'});await service.check(f.work.id);
 unavailable=true;f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
 assert.match(f.store.readDispatchProtocol(f.work.id).detail,/closed|unverified/);
});

test('rework retains exact terminal process and normalizes the native target independently from its supervisor',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{childKind:'terminal'}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];f.review(first,{decision:'rework'});await service.check(f.work.id);
 f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 const next=f.store.listDispatches(f.work.id)[1];assert.equal(next.status,'running');assert.equal(next.startParams.terminal,'structworker_child');assert.equal(next.startParams.agent,undefined);assert.equal(next.binding.incarnationId,'child-pty:child-instance');
});
test('overall delivery requires native Head author proof and user decision; rework keeps queued goals and stale acceptance conflicts',async t=>{
 const {createLifecycleService}=await import('../src/local/lifecycle.mjs');
 const f=await fixture(t),notices=[];
 const {createDispatchService}=await import('../src/local/dispatch.mjs');await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const service=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works,notify:async n=>{notices.push(n);return {delivered:true};}}),p=f.store.readDispatchProtocol(f.work.id);
 const proposal=(id,forged=false)=>{
  const spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:p.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:id==='delivery-two'?'delivery-one':null,summary:'Audit complete',evidenceRefs:['artifact:report.md'],attemptIds:[]});
  const task={id,run_id:'run-head',spec,status:'ready'};f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,'run-head',spec,'ready',null,null,null,null,null);
  f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','create-'+id,'orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:'orca_session_id:codex_head',__orcaCallerOrcaSessionId:forged?'forged':'codex_head'}),'completed',JSON.stringify({task}));
 };
 proposal('forged',true);await service.check(f.work.id);assert.equal(f.store.readSnapshot().works[0].delivery,undefined);f.db.prepare('DELETE FROM tasks WHERE id=?').run('forged');
 proposal('delivery-one');await service.check(f.work.id);await service.check(f.work.id);
 let w=f.store.readSnapshot().works[0];assert.equal(w.delivery.id,'delivery-one');assert.equal(w.status,'awaiting_acceptance');assert.equal(notices.length,1);
 f.store.enqueueGoal({teamId:f.team.id,requestId:'next',expectedRevision:f.store.readSnapshot().revision,objective:'Next goal'});
 const rework={requestId:'user-rework',workId:w.id,deliveryId:w.delivery.id,expectedWorkVersion:w.version,decision:'rework',feedback:'Add the missing comparison'};
 await service.decide(rework);await service.decide(rework);assert.equal(f.store.readWork(w.id).status,'active');assert.equal(f.store.listGoals(f.team.id)[0].status,'queued');
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_GOAL_REWORK')).length,1);
 await assert.rejects(service.decide({...rework,requestId:'stale',decision:'accept'}),/delivery|changed|superseded/i);
 proposal('delivery-two');await service.check(w.id);w=f.store.readSnapshot().works[0];
 const accepted={requestId:'user-accept',workId:w.id,deliveryId:w.delivery.id,expectedWorkVersion:w.version,decision:'accept'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('unregistered','run-head','{}','completed',null,null,null,null,null);
 await assert.rejects(service.decide(accepted),/Unregistered native work/);assert.equal(f.store.readWork(w.id).status,'awaiting_acceptance');f.db.prepare('DELETE FROM tasks WHERE id=?').run('unregistered');
 await service.decide(accepted);await service.decide(accepted);assert.equal(f.store.readWork(w.id).status,'completed');assert.equal(f.store.listGoals(f.team.id)[0].status,'reserved');
 assert.equal(f.store.isActiveOperation(f.store.readOperation('launch')),false);assert.equal(f.store.readOperation('launch').status,'created');
 const callCount=f.calls.length;await f.works.check(w.id);await f.works.reconcile();await service.check(w.id);
 const {createQuestionService}=await import('../src/local/questions.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');
 await createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(w.id);await createRecoveryService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}}).checkWork(w.id);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(w.id);
 assert.equal(f.calls.length,callCount,'all closed Work observation loops are effect-free');assert.equal(f.store.readWork(w.id).status,'completed');
 await f.restart();assert.equal(f.store.readWork(w.id).status,'completed');assert.equal(f.store.readSnapshot().works[0].delivery.summary,'Audit complete');
});

test('declared overlapping paths queue until acceptance while independent members proceed without a worker cap',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.createIntent(protocol,{writeScope:[{path:'src',kind:'directory'}]});
 f.createIntent(protocol,{taskId:'overlap',taskKey:'overlap',memberId:f.team.members[2].id,writeScope:[{path:'src/app.js',kind:'file'}]});
 f.createIntent(protocol,{taskId:'independent',taskKey:'independent',memberId:f.team.members[3].id,writeScope:[{path:'docs/readme.md',kind:'file'}]});
 await service.check(f.work.id);
 assert.deepEqual(f.store.listDispatches(f.work.id).map(row=>row.taskKey),['task-key-one','independent']);
 const queued=f.store.dispatchProjection(f.work.id).queuedTasks;
 assert.equal(queued.length,1);assert.equal(queued[0].taskKey,'overlap');assert.match(queued[0].detail,/scope.*task-key-one/i);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,2);
 await f.restart();assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks[0].taskKey,'overlap');
});

for(const headAgent of ['codex','claude'])test(`prepared structured member reuses canonical session without preferences under ${headAgent} supervisor`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true,headAgent}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));let permit;
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){permit=JSON.parse(text.split('\n').slice(1).join('\n'));f.start(permit);}});
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0]?.status,'running');
 assert.equal(permit.startParams.terminal,'orca_session_id:claude_child');
 assert.deepEqual(Object.keys(permit.startParams).sort(),['run','task','terminal','worktree']);
 await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,1);
 assert.equal(f.calls.some(method=>/agent.launch|terminal.create|workerStart/.test(method)),false);
});

for(const hold of ['pending_acceptance','unknown','rework'])test(`overlapping scope remains reserved during ${hold}, accepted scope releases queued task`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){const permit=JSON.parse(text.split('\n').slice(1).join('\n'));if(permit.nativeTaskId==='task-one')f.start(permit);}});
 f.createIntent(protocol,{writeScope:[{path:'src',kind:'directory'}]});await service.check(f.work.id);
 let first=f.store.listDispatches(f.work.id)[0];
 if(hold==='unknown')f.db.prepare("UPDATE mutation_receipts SET payload_hash='unverified' WHERE request_id='start-task-one'").run();
 else {f.complete(first);await service.check(f.work.id);first=f.store.listDispatches(f.work.id)[0];if(hold==='rework'){f.review(first,{decision:'rework'});await service.check(f.work.id);}}
 f.createIntent(protocol,{taskId:'overlap',taskKey:'overlap',memberId:f.team.members[2].id,writeScope:[{path:'src/app.js',kind:'file'}]});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.match(f.store.dispatchProjection(f.work.id).queuedTasks[0].detail,/scope conflicts/);
 if(hold==='pending_acceptance'){f.review(first);await service.check(f.work.id);await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,2);assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks.length,0);}
});
for(const fault of ['closed','wrong-workspace','self','changed-preferences'])test(`prepared ${fault} member stays reserved without fresh launch`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true});
 const rpc=async(method,params,...rest)=>{
  if(params?.sessionId==='claude_child'&&method==='orchestration.sessionAddress'&&fault==='self')return {orcaSessionId:'orca_session_id:codex_head'};
  if(params?.address==='orca_session_id:claude_child'&&method==='orchestration.partyLocation'&&fault!=='self'&&fault!=='changed-preferences')return {location:fault==='closed'?null:{kind:'chat',sessionId:'claude_child',worktreeId:'foreign'}};
  return f.rpc(method,params,...rest);
 };
 if(fault==='changed-preferences'){const op=f.store.readMemberOperation(f.member.id);f.store.settleOperation(op.requestId,op.nativeRequest.operationId,{nativeRequest:{...op.nativeRequest,sessionOptions:{model:'different'}}});}
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,0);assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks.length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,0);assert.equal(f.store.readMemberOperation(f.member.id).status,'created');
});

test('prepared PTY preserves native process identity and reuses without model overrides',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true,preparedKind:'terminal',childKind:'terminal'}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];assert.equal(attempt.status,'running');assert.equal(attempt.startParams.terminal,'structworker_child');assert.equal(attempt.binding.incarnationId,'child-pty:child-instance');assert.equal(Object.hasOwn(attempt.startParams,'agent'),false);
});

test('one confirmed failed member task holds its dependents but permits independent nonconflicting work',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){const permit=JSON.parse(text.split('\n').slice(1).join('\n'));if(permit.nativeTaskId==='task-one')f.start(permit);}});
 f.createIntent(protocol,{writeScope:[{path:'src',kind:'directory'}]});await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];f.complete(first);
 f.db.prepare("UPDATE dispatch_contexts SET status='failed'").run();f.db.prepare("UPDATE worker_dispatches SET state='failed'").run();f.db.prepare("UPDATE tasks SET status='failed'").run();
 f.db.prepare("UPDATE attempt_observation_facts SET payload=json_set(payload,'$.outcome','failed')").run();f.db.prepare("UPDATE messages SET payload=json_set(payload,'$.outcome','failed')").run();
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].outcome,'failed');
 f.createIntent(protocol,{taskId:'blocked',taskKey:'blocked',memberId:f.team.members[2].id,dependencies:[first.taskKey]});
 f.createIntent(protocol,{taskId:'independent',taskKey:'independent',memberId:f.team.members[3].id,writeScope:[{path:'docs',kind:'directory'}]});await service.check(f.work.id);
 assert.deepEqual(f.store.listDispatches(f.work.id).map(row=>row.taskKey),[first.taskKey,'independent']);assert.match(f.store.dispatchProjection(f.work.id).queuedTasks[0].detail,/dependencies/);
});

test('retiring a preparation pointer cannot authorize a second session while its Dispatch remains reserved',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await service.check(f.work.id);
 const prior=f.store.readMemberOperation(f.member.id);f.store.retireBinding({memberId:f.member.id,requestId:prior.requestId,instanceGeneration:prior.instanceGeneration});
 assert.throws(()=>f.store.prepareOperation({teamId:f.team.id,memberId:f.member.id,configVersion:1,requestId:'second-session'},{...prior,nativeRequest:nativeLaunchIntent(f.team,f.member,prior.scope)}),/reserved|binding/);
});

test('busy structured supervisor queues independent permits under negotiated native queue support',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{queuedPermits:true}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);f.createIntent(protocol,{taskId:'other',taskKey:'other',memberId:f.team.members[2].id});
 await service.check(f.work.id);assert.deepEqual(f.store.listDispatches(f.work.id).map(row=>row.status),['awaiting_start','awaiting_start']);
 assert.ok(f.store.listDispatches(f.work.id).every(row=>row.detail.includes('queued')));await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,2);
});

test('paused member admission queues its Task while independent members continue and resume releases the queue',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.store.setAdmission({teamId:f.team.id,memberId:f.member.id,paused:true,requestId:'pause',expectedRevision:f.store.readSnapshot().revision});f.createIntent(protocol);f.createIntent(protocol,{taskId:'independent',taskKey:'independent',memberId:f.team.members[2].id});await service.check(f.work.id);assert.deepEqual(f.store.listDispatches(f.work.id).map(a=>a.taskKey),['independent']);assert.match(f.store.dispatchProjection(f.work.id).queuedTasks[0].detail,/paused/);
 f.store.setAdmission({teamId:f.team.id,memberId:f.member.id,paused:false,requestId:'resume',expectedRevision:f.store.readSnapshot().revision});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,2);assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks.length,0);
});
for(const outcome of ['stopped','assignment-only','unknown'])test(`native ${outcome} stop preserves exact Dispatch and scope; only positive process evidence proves stopped`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const {createStopService}=await import('../src/local/stop.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await service.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0],stops=createStopService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}});
 const row=await stops.prepare({requestId:'stop-one',teamId:f.team.id,memberId:f.member.id,workId:f.work.id,attemptId:attempt.id}),plan=await stops.validate(row.requestId);assert.deepEqual(plan.params,{dispatch:attempt.dispatchId});assert.equal(plan.envelope.orchestrationRequestId,row.nativeRequestId);
 const receipt={dispatchId:attempt.dispatchId,state:outcome==='unknown'?'stop_unknown':'stopped',processAction:outcome==='assignment-only'?'none':'closed_agent_terminal',...(outcome==='stopped'?{close:{ptyKilled:true}}:{})};
 // Simulate native response loss: reconcile exact UUID/fingerprint from actual native-shaped ledger.
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',row.nativeRequestId,'orchestration.workerStop',nativeHash('orchestration.workerStop',plan.params),'completed',JSON.stringify(receipt));
 assert.equal((await stops.check(row.requestId)).state,outcome==='stopped'?'stopped':'unknown');assert.equal(f.store.readReceipt(`dispatch-member:${f.member.id}`).id,attempt.id);assert.deepEqual(f.store.listDispatches(f.work.id)[0],attempt);assert.equal(await stops.validate(row.requestId),null);assert.equal(f.store.workClosureBlockers(f.work.id).some(reason=>reason.includes('Stop')),outcome!=='stopped');if(outcome!=='stopped')assert.throws(()=>f.store.assertAdmission(f.team.id,f.member.id),/Stop outcome/);
});
test('stop refuses an unverified native worker observation and exact exit later reconciles an unknown request without effect',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const {createStopService}=await import('../src/local/stop.mjs');const f=await fixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];let observation={exactWorker:false,status:'unverifiable'};
 const rpc=async(method,params)=>{const value=await f.rpc(method,params);return method==='orchestration.workerShow'?{...value,observation}:value;},stops=createStopService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),row=await stops.prepare({requestId:'uncertain-stop',teamId:f.team.id,memberId:f.member.id,workId:f.work.id,attemptId:attempt.id});await assert.rejects(stops.validate(row.requestId),/ownership/);assert.equal(f.store.readStop(row.requestId).state,'unknown');
 // A separate admitted request with lost receipt can later use the native exact-exit projection.
 // This row was refused before a plan; its missing submission is deliberately not promoted.
 assert.equal((await stops.check(row.requestId)).state,'unknown');
 observation={exactWorker:true,status:'live'};
 const other=await fixture(t),otherDispatch=createDispatchService({store:other.store,rpc:other.rpc,userData:other.profile,consent:async()=>{},works:other.works});await otherDispatch.check(other.work.id);other.createIntent(other.store.readDispatchProtocol(other.work.id));other.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))other.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await otherDispatch.check(other.work.id);const active=other.store.listDispatches(other.work.id)[0],read=async(method,params)=>{const value=await other.rpc(method,params);return method==='orchestration.workerShow'?{...value,observation}:value;},service=createStopService({store:other.store,rpc:read,userData:other.profile,consent:async()=>{}}),intent=await service.prepare({requestId:'lost-stop',teamId:other.team.id,memberId:other.member.id,workId:other.work.id,attemptId:active.id});await service.validate(intent.requestId);await service.settle(intent.requestId,null,'response lost');observation={exactWorker:true,status:'exited'};assert.equal((await service.check(intent.requestId)).state,'stopped');assert.equal(other.store.readStopProof({memberId:other.member.id,attemptId:active.id,binding:active.binding}).kind,'native-worker-exit');assert.equal(await service.validate(intent.requestId),null);
});

test('native PTY-qualified terminal Task creator reconciles saved work after reload without recreating objective or Tasks',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');
 const f=await fixture(t,{kind:'terminal',childKind:'terminal'});
 const service=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service().check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.db.prepare('UPDATE tasks SET created_by_process_incarnation=?').run('head-pty:head-instance');
 const old=f.store.readCurrentWork(f.work.id);
 f.store.updateWork(old.id,old.version,{instance:{kind:'terminal',handle:'term-head',paneKey:'tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',incarnationId:'head-instance'}});
 await f.restart();
 await f.works.check(f.work.id);
 await service().check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);
 assert.equal(f.store.readCurrentWork(f.work.id).instance.processIncarnation,'head-pty:head-instance');
 assert.equal(f.messages.filter(text=>text.startsWith('Team Orchestrator work protocol')).length,1);
 assert.equal(f.calls.some(method=>/workerStart|runCreate|taskCreate/.test(method)),false);
});

for(const processIdentity of ['other-pty:head-instance','head-pty:other-instance','head-instance'])test(`terminal Task creator ${processIdentity} cannot substitute for the exact native process`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{kind:'terminal'});
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.db.prepare('UPDATE tasks SET created_by_process_incarnation=?').run(processIdentity);
 await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,0);
 assert.match(f.store.readDispatchProtocol(f.work.id).detail,/creator instance/);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,0);
});

for(const patch of [{ptyId:'swapped-pty'},{incarnationId:'swapped-instance'},{ptyId:null}])test(`saved terminal observation refuses changed or missing exact identity ${JSON.stringify(patch)}`,async t=>{
 const f=await fixture(t,{kind:'terminal'});
 const rpc=async(method,...args)=>{const result=await f.rpc(method,...args);return method==='terminal.show'?{terminal:{...result.terminal,...patch}}:result;};
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 await assert.rejects(works.verifyWork(f.work.id),/incarnation|PTY/);
 const sends=f.messages.length;await works.check(f.work.id);assert.equal(f.messages.length,sends);
 assert.equal(f.store.readCurrentWork(f.work.id).run.state,'unverified');
});

test('terminal total delivery uses exact PTY-qualified creator evidence before user acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createLifecycleService}=await import('../src/local/lifecycle.mjs');
 const f=await fixture(t,{kind:'terminal'});
 await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const p=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:p.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Exact terminal result',evidenceRefs:['artifact:report'],attemptIds:[]});
 const task={id:'terminal-delivery',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,spec,'ready',null,'term-head','tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','wrong-pty:head-instance',1);
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','terminal-delivery-receipt','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:{paneLeafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}),'completed',JSON.stringify({task}));
 const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await lifecycle.check(f.work.id);assert.equal(f.store.readSnapshot().works[0].delivery,undefined);
 f.db.prepare('UPDATE tasks SET created_by_process_incarnation=? WHERE id=?').run('head-pty:head-instance',task.id);
 await lifecycle.check(f.work.id);const work=f.store.readSnapshot().works[0];assert.equal(work.delivery.id,task.id);
 await lifecycle.decide({requestId:'accept-terminal',workId:work.id,deliveryId:task.id,expectedWorkVersion:work.version,decision:'accept'});
 assert.equal(f.store.readCurrentWork(work.id).status,'completed');
});

test('recovery winning the version race during dispatch observation is not overwritten by a stale failure patch',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');const f=await fixture(t);
 let hold=false,entered,release;const waiting=new Promise(resolve=>{entered=resolve;}),barrier=new Promise(resolve=>{release=resolve;});t.after(()=>release());
 const rpc=async(method,...args)=>{const result=await f.rpc(method,...args);if(hold&&method==='orchestration.workerShow'){hold=false;entered();await barrier;}return result;};
 const dispatch=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);
 const first=f.store.listDispatches(f.work.id)[0];assert.equal(first.status,'running');
 hold=true;const checking=dispatch.check(f.work.id);await waiting;
 await createRecoveryService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}}).checkWork(f.work.id);
 const reconciled=f.store.listDispatches(f.work.id)[0];assert.ok(reconciled.version>first.version);
 release();await checking;assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');
 assert.equal(f.store.listDispatches(f.work.id)[0].version,reconciled.version);
 f.complete(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,1);
});

test('a clean accepted native reconciliation replaces stale protocol diagnostics while current author refusals remain visible',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatch.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);
 const current=f.store.readDispatchProtocol(f.work.id);f.store.updateDispatchProtocol(f.work.id,current.version,{detail:'Dispatch attempt changed while observing evidence.'});
 await dispatch.check(f.work.id);assert.equal(f.store.readDispatchProtocol(f.work.id).detail,'Native supervisor protocol and current Dispatch evidence verified.');
 f.createIntent(protocol,{taskId:'wrong-author',taskKey:'blocked',memberId:f.team.members[2].id,forged:true});
 await dispatch.check(f.work.id);assert.match(f.store.readDispatchProtocol(f.work.id).detail,/author proof/);
 await dispatch.check(f.work.id);assert.match(f.store.readDispatchProtocol(f.work.id).detail,/author proof/);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,1);
});

test('completed work projects a superseded concurrency diagnostic without rewriting sealed protocol history',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createLifecycleService}=await import('../src/local/lifecycle.mjs');const f=await fixture(t,{kind:'terminal'});
 await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const p=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:p.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Complete',evidenceRefs:['artifact:report'],attemptIds:[]}),task={id:'done',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,spec,'ready',null,'term-head','tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','head-pty:head-instance',1);
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','done-receipt','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:{paneLeafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}),'completed',JSON.stringify({task}));
 const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await lifecycle.check(f.work.id);
 const protocol=f.store.readDispatchProtocol(f.work.id);f.store.updateDispatchProtocol(f.work.id,protocol.version,{detail:'Dispatch attempt changed while observing evidence.'});
 const work=f.store.readCurrentWork(f.work.id);await lifecycle.decide({requestId:'close',workId:work.id,deliveryId:task.id,expectedWorkVersion:work.version,decision:'accept'});
 assert.equal(f.store.readSnapshot().works[0].dispatchProtocol.detail,undefined);
 assert.equal(f.store.readSnapshot().works[0].nativeRuns[0].dispatchProtocol.detail,undefined);
 assert.equal(f.store.readDispatchProtocol(work.id).detail,'Dispatch attempt changed while observing evidence.');
});

test('supervisor protocol maps permitted attempt IDs and native worker_done message IDs directly to delivery references',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const protocol=JSON.parse(f.messages.find(text=>text.startsWith('TEAM_DISPATCH_PROTOCOL')).split('\n').slice(1).join('\n'));
 assert.match(protocol.instructions,/attemptId delivered in each latest TEAM_DISPATCH_PERMIT/);
 assert.match(protocol.instructions,/evidenceId.*exactly worker_report:MESSAGE_ID/);
 assert.match(protocol.instructions,/actual native worker_done message/);
 assert.match(protocol.instructions,/same reference.*native acceptance review/);
 assert.match(protocol.instructions,/Do not wait for a separate plugin acceptance notification/);
 assert.match(protocol.instructions,/proposing a delivery does not assert plugin or user acceptance/);
});

test('native review and delivery proposal may arrive before plugin review observation while user closure remains gated',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createLifecycleService}=await import('../src/local/lifecycle.mjs');const f=await fixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatch.check(f.work.id);const p=f.store.readDispatchProtocol(f.work.id);f.createIntent(p);f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];f.review(attempt);
 assert.equal(attempt.evidenceId,'worker_report:report-task-one');assert.equal(attempt.status,'pending_acceptance');
 const spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:p.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Verified review done',evidenceRefs:['worker_report:report-task-one','artifact:tests'],attemptIds:[attempt.id]}),task={id:'early-delivery',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,spec,'ready',null,null,null,null,null);
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','early-delivery-receipt','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:'orca_session_id:codex_head',__orcaCallerOrcaSessionId:'codex_head'}),'completed',JSON.stringify({task}));
 const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await lifecycle.check(f.work.id);
 let work=f.store.readCurrentWork(f.work.id);assert.equal(f.store.readSnapshot().works[0].delivery.id,task.id);
 await assert.rejects(lifecycle.decide({requestId:'too-soon',workId:work.id,deliveryId:task.id,expectedWorkVersion:work.version,decision:'accept'}),/accepted|acceptance|review|pending/i);
 await dispatch.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');work=f.store.readCurrentWork(f.work.id);
 await lifecycle.decide({requestId:'after-review',workId:work.id,deliveryId:task.id,expectedWorkVersion:work.version,decision:'accept'});
 assert.equal(f.store.readCurrentWork(work.id).status,'completed');
});

test('manually closed exact native worker can enter checked wake handoff without a plugin Stop row',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createWakeService}=await import('../src/local/wake.mjs');const f=await fixture(t,{childKind:'terminal'});
 const dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];
 let exited=true;const rpc=async(method,...args)=>{const result=await f.rpc(method,...args);if(method==='orchestration.workerShow')return {...result,observation:{status:exited?'exited':'live',exactWorker:true},projection:{liveness:{verdict:'unverifiable'}}};if(method==='terminal.show'&&args[0].terminal===attempt.binding.handle)return {terminal:{...result.terminal,connected:false}};return result;};
 const wake=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works}),input={teamId:f.team.id,memberId:attempt.memberId,requestId:'manual-close',bindingRequestId:attempt.id};
 const before=f.calls.length;assert.deepEqual(f.store.listStops(),[]);
 const result=await wake.wake(input);assert.equal(result.state,'needs_decision');assert.equal(f.store.readWake(input.requestId).proof.death.kind,'native-worker-exit');
 assert.equal(f.store.readWake(input.requestId).proof.death.dispatchId,attempt.dispatchId);assert.equal(f.store.readWake(input.requestId).proof.death.binding.incarnationId,'child-pty:child-instance');
 assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');assert.deepEqual(f.store.listStops(),[]);
 assert.equal(f.calls.slice(before).some(method=>/workerStop|stopExact|launchReplay|restartContinue|taskCreate|workerStart/.test(method)),false);
 await wake.wake(input);assert.equal(f.store.listWakes().length,1);
 const protocol=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-questions/v1',kind:'recovery-handoff',workId:f.work.id,token:protocol.token,generation:1,appQuestionId:input.requestId,memberId:attempt.memberId,oldRequestId:attempt.id,decision:'replace',summary:'Manager checked the exact exited worker and prior accepted result.',evidence:['worker_report:report-task-one']});
 const task={id:'manual-close-handoff',run_id:'run-head',spec};f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,spec,'ready',null,null,null,null,null);
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','manual-close-handoff-receipt','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:'orca_session_id:codex_head',__orcaCallerOrcaSessionId:'codex_head'}),'completed',JSON.stringify({task}));
 assert.equal((await wake.handoff(input.requestId)).state,'approved');
 exited=false;await assert.rejects(wake.prepareFresh(input.requestId),/not proven stopped/);assert.equal(f.store.readWake(input.requestId).newInstance,undefined);
 exited=true;await wake.prepareFresh(input.requestId);exited=false;await assert.rejects(wake.validateFresh(input.requestId),/execution proof changed/);

});

test('manual-close wake refuses unknown, missing, changed or cross-scope worker observations even after Task acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createWakeService}=await import('../src/local/wake.mjs');const f=await fixture(t,{childKind:'terminal'});
 const dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];
 let scenario,changed=false;
 const rpc=async(method,...args)=>{
  if(method==='status.get'&&(scenario==='runtime'||changed))return {runtimeId:'other-runtime'};
  if(method==='orchestration.workerShow'&&scenario==='missing')throw Error('Native observation unavailable');
  const result=await f.rpc(method,...args);
  if(method==='terminal.show'&&args[0].terminal===attempt.binding.handle)return {terminal:{...result.terminal,connected:scenario==='connected'}};
  if(method!=='orchestration.workerShow')return result;
  const value=structuredClone({...result,observation:{status:'exited',exactWorker:true}});
  if(['live','unverifiable','identity_changed'].includes(scenario))value.observation.status=scenario;
  if(scenario==='inexact')value.observation.exactWorker=false;
  if(scenario==='dispatch')value.dispatch.id='other-dispatch';
  if(scenario==='task')value.dispatch.taskId='other-task';
  if(scenario==='run')value.dispatch.runId='other-run';
  if(scenario==='handle')value.dispatch.assigneeHandle='other-handle';
  if(scenario==='pane')value.dispatch.assigneePaneKey='other:pane';
  if(scenario==='pty')value.dispatch.processIncarnation='other-pty:child-instance';
  if(scenario==='incarnation')value.dispatch.processIncarnation='child-pty:other-instance';
  if(scenario==='host')value.dispatch.hostScope={kind:'ssh',targetId:'other-host'};
  if(scenario==='workspace')value.worker.worktreeId='other-workspace';
  if(scenario==='worker-handle')value.worker.agentTerminalHandle='other-handle';
  if(scenario==='epoch')value.worker.runtimeEpoch='other-runtime';
  if(scenario==='parent')value.dispatch.creatorDispatchId='other-parent';
  if(scenario==='runtime-race')changed=true;
  return value;
 };
 const wake=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});const before=f.calls.length;
 for(scenario of ['live','unverifiable','identity_changed','inexact','missing','connected','dispatch','task','run','handle','pane','pty','incarnation','host','workspace','worker-handle','epoch','parent','runtime','runtime-race']){
  changed=false;const row=await wake.wake({teamId:f.team.id,memberId:attempt.memberId,requestId:'negative-'+scenario.replaceAll('_','-'),bindingRequestId:attempt.id});assert.equal(row.state,'blocked',scenario);
 }
 assert.equal(f.store.listWakes().length,0);assert.equal(f.store.listStops().length,0);assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');
 assert.equal(f.calls.slice(before).some(method=>/send|Stop|stopExact|launchReplay|restartContinue/.test(method)),false);
});
