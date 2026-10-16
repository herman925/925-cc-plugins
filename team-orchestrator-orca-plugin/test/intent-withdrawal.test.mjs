import {authorizedHeadRebind} from './head-rebind-fixture.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKER_RULES } from '../src/dispatch.mjs';
import { fixture, nativeHash } from './dispatch-fixture.mjs';
async function withdrawalFixture(t, options={}) {
 const f=await fixture(t,options);
 const {createDispatchService}=await import('../src/local/dispatch.mjs');
 const service=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service().check(f.work.id);
 const protocol=f.store.readDispatchProtocol(f.work.id);
 f.createIntent(protocol,{taskId:'original'});
 const original=JSON.parse(f.db.prepare('SELECT spec FROM tasks WHERE id=?').get('original').spec);
 delete original.workerRules;
 const spec=JSON.stringify(original);
 f.db.prepare('UPDATE tasks SET spec=? WHERE id=?').run(spec,'original');
 f.db.prepare('DELETE FROM mutation_receipts WHERE request_id=?').run('create-original');
 f.receipt('create-original','orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task:{id:'original',run_id:'run-head',spec,status:'ready'}});
 f.createIntent(protocol,{taskId:'corrected'});
 const withdraw=(patch={},forged=false)=>{
  const result=JSON.stringify({protocol:'team-intent-withdrawal/v1',workId:f.work.id,token:protocol.token,generation:1,supervisorMemberId:f.team.members[0].id,nativeTaskId:'original',taskKey:'task-key-one',memberId:f.member.id,replacementNativeTaskId:'corrected',reason:'missing-worker-rules',...patch});
  f.db.prepare("UPDATE tasks SET status='failed',result=? WHERE id='original'").run(result);
  const task=f.db.prepare('SELECT * FROM tasks WHERE id=?').get('original');
  f.receipt('withdraw-original','orchestration.taskUpdate',{id:'original',status:'failed',result,run:'run-head',callerTerminalHandle:f.from},{task},forged);
 };
 return {...f,get store(){return f.store;},get works(){return f.works;},service,protocol,withdraw};
}
test('supervisor can withdraw an unadmitted malformed intent while its valid replacement obeys the member pause',async t=>{
 const f=await withdrawalFixture(t);
 f.store.setAdmission({teamId:f.team.id,memberId:f.member.id,paused:true,requestId:'pause',expectedRevision:f.store.readSnapshot().revision});
 f.withdraw();await f.service().check(f.work.id);
 const view=f.store.readSnapshot().works[0];
 assert.deepEqual(view.withdrawnIntents?.map(r=>[r.nativeTaskId,r.replacementNativeTaskId,r.reason]),[['original','corrected','missing-worker-rules']]);
 assert.equal(view.tasks.length,0);assert.equal(view.queuedTasks.length,1);assert.equal(view.queuedTasks[0].nativeTaskId,'corrected');assert.match(view.queuedTasks[0].detail,/paused/);
 assert.deepEqual(view.failureStreaks,[]);
 await f.service().check(f.work.id);assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,1);
});

async function acceptedReplacement(f){
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await f.service().check(f.work.id);
 let attempt=f.store.readSnapshot().works[0].tasks.find(row=>row.nativeTaskId==='corrected');
 f.complete(attempt);await f.service().check(f.work.id);
 attempt=f.store.listDispatches(f.work.id).find(row=>row.nativeTaskId==='corrected');f.review(attempt);await f.service().check(f.work.id);
 return f.store.readSnapshot().works[0].tasks.find(row=>row.nativeTaskId==='corrected');
}
async function proposedDelivery(f,attempt){
 const {createLifecycleService}=await import('../src/local/lifecycle.mjs');
 const spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:f.protocol.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Corrected task verified.',evidenceRefs:[attempt.evidenceId],attemptIds:[attempt.id]});
 const task={id:'delivery',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks(id,run_id,spec,status) VALUES(?,?,?,?)').run(task.id,task.run_id,spec,task.status);
 f.receipt('create-delivery','orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task});
 const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works,notify:async()=>({delivered:true})});
 await lifecycle.check(f.work.id);const work=f.store.readSnapshot().works[0];
 return {lifecycle,input:{requestId:'accept-corrected',workId:work.id,deliveryId:work.delivery.id,expectedWorkVersion:work.version,decision:'accept'}};
}
test('a replacement already accepted before withdrawal permits genuine user closure without counting an execution failure',async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f);
 assert.equal(attempt.status,'accepted');f.withdraw();await f.service().check(f.work.id);
 const {lifecycle,input}=await proposedDelivery(f,attempt);await lifecycle.decide(input);
 const view=f.store.readSnapshot().works[0];assert.equal(view.status,'completed');assert.equal(view.withdrawnIntents.length,1);assert.equal(view.failureStreaks[0].count,0);
});
for(const [name,patch] of [['wrong token',{token:'wrong'}],['wrong generation',{generation:9}],['wrong owner',{supervisorMemberId:'wrong'}],['other work',{workId:'wrong'}],['other member',{memberId:'wrong'}],['other task key',{taskKey:'wrong'}],['extra field',{approved:true}],['self replacement',{replacementNativeTaskId:'original'}]])test(`withdrawal with ${name} never discharges malformed intent closure`,async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f);f.withdraw(patch);await f.service().check(f.work.id);
 assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,0);
 const {lifecycle,input}=await proposedDelivery(f,attempt);await assert.rejects(lifecycle.decide(input),/Unregistered native work|Native task evidence/);
});
test('a result string without the actual supervisor mutation identity cannot withdraw a task',async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f);f.withdraw({},true);await f.service().check(f.work.id);
 assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,0);
 const {lifecycle,input}=await proposedDelivery(f,attempt);await assert.rejects(lifecycle.decide(input),/Unregistered native work|Native task evidence/);
});
for(const change of ['removed-original','changed-result','removed-update-proof','changed-create-proof','old-epoch','historical-dispatch'])test(`previously observed withdrawal cannot hide ${change} at closure`,async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f);f.withdraw();await f.service().check(f.work.id);
 assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,1);
 const {lifecycle,input}=await proposedDelivery(f,attempt);
 if(change==='removed-original')f.db.prepare("DELETE FROM tasks WHERE id='original'").run();
 if(change==='changed-result')f.db.prepare("UPDATE tasks SET result='{}' WHERE id='original'").run();
 if(change==='removed-update-proof')f.db.prepare("DELETE FROM mutation_receipts WHERE request_id='withdraw-original'").run();
 if(change==='changed-create-proof')f.db.prepare("UPDATE mutation_receipts SET payload_hash='wrong' WHERE request_id='create-original'").run();
 if(change==='old-epoch')f.db.prepare("UPDATE runs SET consumer_generation=2 WHERE id='run-head'").run();
 if(change==='historical-dispatch')f.db.prepare("INSERT INTO dispatch_contexts(id,run_id,task_id,status) VALUES('old-dispatch','run-head','original','completed')").run();
 await assert.rejects(lifecycle.decide(input),/native|Native|Run|Unregistered|authority|generation/);
 assert.equal(f.store.readSnapshot().works[0].status,'awaiting_acceptance');
});
for(const problem of ['scope-change','rules-change','forged-replacement','pending-start','unattributable-completed-start','admitted-original'])test(`${problem} is not a safe withdrawal even with an authentic update`,async t=>{
 const f=await withdrawalFixture(t);
 if(problem==='admitted-original'){
  // A prior application reservation is a public admission, even without a native Dispatch.
  const {spec,...row}=f.db.prepare("SELECT * FROM tasks WHERE id='original'").get(),value={...JSON.parse(spec),workerRules:WORKER_RULES},valid=JSON.stringify(value);
  f.db.prepare("UPDATE tasks SET spec=? WHERE id='original'").run(valid);f.db.prepare("DELETE FROM mutation_receipts WHERE request_id='create-original'").run();f.receipt('create-original','orchestration.taskCreate',{spec:valid,run:'run-head',callerTerminalHandle:f.from},{task:{...row,spec:valid}});
  await f.service().check(f.work.id);assert.ok(f.store.readSnapshot().works[0].tasks.some(row=>row.nativeTaskId==='original'));
  f.db.prepare("UPDATE tasks SET spec=? WHERE id='original'").run(spec);f.db.prepare("DELETE FROM mutation_receipts WHERE request_id='create-original'").run();f.receipt('create-original','orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task:{...row,spec}});
 }else if(problem==='unattributable-completed-start')f.db.prepare("INSERT INTO mutation_receipts VALUES('local-fingerprint','uncertain-start','orchestration.workerStart','unknown','completed',NULL)").run();
 else if(problem==='pending-start')f.db.prepare("INSERT INTO mutation_receipts VALUES('local-fingerprint','uncertain-start','orchestration.workerStart','unknown','pending',NULL)").run();
 else if(problem==='forged-replacement')f.db.prepare("UPDATE mutation_receipts SET payload_hash='wrong' WHERE request_id='create-corrected'").run();
 else {const task=f.db.prepare("SELECT * FROM tasks WHERE id='corrected'").get(),spec=JSON.parse(task.spec);if(problem==='scope-change')spec.writeScope=[{path:'.',kind:'directory'}];else spec.workerRules='different';task.spec=JSON.stringify(spec);f.db.prepare("UPDATE tasks SET spec=? WHERE id='corrected'").run(task.spec);f.db.prepare("DELETE FROM mutation_receipts WHERE request_id='create-corrected'").run();f.receipt('create-corrected','orchestration.taskCreate',{spec:task.spec,run:'run-head',callerTerminalHandle:f.from},{task});}
 f.withdraw();await f.service().check(f.work.id);assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,0);
});
test('terminal supervisor withdrawal proves the raw native creator and persists across worker restart',async t=>{
 const f=await withdrawalFixture(t,{kind:'terminal'});f.withdraw();await f.service().check(f.work.id);
 assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,1);
 await f.restart();await f.service().check(f.work.id);
 assert.equal(f.store.readSnapshot().works[0].withdrawnIntents.length,1);
});
test('accepted corrected work can clear display history while preserving its authenticated correction record',async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f);f.withdraw();await f.service().check(f.work.id);
 const {lifecycle,input}=await proposedDelivery(f,attempt);await lifecycle.decide(input);
 const preview=f.store.previewHistoryCleanup({selectedWorkIds:[f.work.id]});
 assert.deepEqual(preview.eligibleWorkIds,[f.work.id]);
 f.store.applyHistoryCleanup({requestId:'cleanup-correction',previewToken:preview.previewToken,expectedStorageRevision:preview.storageRevision});
 assert.equal(f.store.readSnapshot().works[0].withdrawnIntents[0].nativeTaskId,'original');
 assert.equal(f.store.readNativeHistory(f.work.id).withdrawals[0].updateProof.requestId,'withdraw-original');
});

async function recoveredDelivery(f,recovered,attempt){
 const {createLifecycleService}=await import('../src/local/lifecycle.mjs');
 const spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:recovered.protocol.token,generation:2,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Recovered Head verified the original corrected result.',evidenceRefs:[attempt.evidenceId],attemptIds:[attempt.id]}),task={id:'recovered-delivery',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks(id,run_id,spec,status) VALUES(?,?,?,?)').run(task.id,task.run_id,spec,task.status);
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','create-recovered-delivery','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:'orca_session_id:codex_recovered',__orcaCallerOrcaSessionId:'codex_recovered'}),'completed',JSON.stringify({task}));
 const lifecycle=createLifecycleService({store:f.store,rpc:recovered.rpc,userData:f.profile,consent:async()=>{},works:recovered.works});await lifecycle.check(f.work.id);
 const work=f.store.readCurrentWork(f.work.id);return {lifecycle,input:{requestId:'accept-recovered',workId:work.id,deliveryId:task.id,expectedWorkVersion:work.version,decision:'accept'}};
}
for(const kind of ['structured','terminal'])test(`${kind} authenticated withdrawal survives an actual approved Head replacement and permits verified user closure`,async t=>{
 const f=await withdrawalFixture(t,{kind}),attempt=await acceptedReplacement(f);f.withdraw();await f.service().check(f.work.id);
 const saved=f.store.readNativeHistory(f.work.id).withdrawals[0],before=f.store.listDispatches(f.work.id)[0],oldOwner=f.store.readCurrentWork(f.work.id).instance,recovered=await authorizedHeadRebind(t,f),{lifecycle,input}=await recoveredDelivery(f,recovered,attempt);
 const after=f.store.listDispatches(f.work.id)[0];assert.deepEqual(after.review,before.review);assert.equal(after.evidenceId,before.evidenceId);assert.deepEqual(after.originalSupervisorInstance,oldOwner);assert.equal(after.reviewAuthority,undefined);
 await lifecycle.decide(input);assert.equal(f.store.readCurrentWork(f.work.id).status,'completed');
 assert.deepEqual(f.store.readNativeHistory(f.work.id).withdrawals[0],saved);assert.equal(f.store.listDispatches(f.work.id).length,1);
});

test('recorded withdrawal keeps its frozen configuration during approved idle Head preference replacement',async t=>{
 const f=await withdrawalFixture(t);await acceptedReplacement(f);f.withdraw();await f.service().check(f.work.id);
 const {DatabaseSync}=await import('node:sqlite'),{join}=await import('node:path'),{createWakeService}=await import('../src/local/wake.mjs'),{createWorkService}=await import('../src/local/teamwork.mjs');
 const op=f.store.readOperation('launch'),scope=f.store.readScope(f.team.id),journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());
 journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');journal.prepare('INSERT INTO agent_session_records VALUES(?,?)').run(op.sessionId,JSON.stringify({schemaVersion:2,sessionId:op.sessionId,provider:'codex',location:scope,lease:{sessionId:op.sessionId,runtimeFence:7,claimStatus:'live',ownerProcess:{pid:1,hostId:'local',spawnToken:'old-owner'}}}));
 const rpc=async(method,params,...rest)=>method==='agentSession.history'?{ok:true,page:{sessionId:params.sessionId,fence:7,latestTurn:{itemId:'finished',turn:{state:'completed'}},backgroundTasks:null,queuedMessages:[],submissions:[]}}:f.rpc(method,params,...rest);
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}}),saved=f.store.readNativeHistory(f.work.id).withdrawals[0];
 await wake.requestReplacement({requestId:'idle-head',teamId:f.team.id,memberId:f.team.members[0].id,bindingRequestId:'launch',expectedRevision:f.store.readSnapshot().revision,agent:'claude',model:'default',effort:'default',summary:'Preserve accepted work and change the idle Head provider.',evidenceRefs:['worker_report:report-corrected']});
 assert.equal(f.store.effectiveTeamForWork(f.work.id).configVersion,2);
 const fresh=await wake.prepareFresh('idle-head');assert.equal(fresh.operation.configVersion,2);assert.equal(fresh.operation.nativeRequest.agent,'claude');
 assert.deepEqual(f.store.readNativeHistory(f.work.id).withdrawals[0],saved);assert.equal(f.store.readNativeHistory(f.work.id).withdrawalContexts[0].team.configVersion,1);
});

for(const change of ['original-spec','replacement-spec','withdrawal-result','original-create','replacement-create','withdrawal-update','original-dispatch','unresolved-start','recovery-record'])test(`authorized Head rebind cannot hide changed historical withdrawal proof: ${change}`,async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f);f.withdraw();await f.service().check(f.work.id);
 const recovered=await authorizedHeadRebind(t,f),{lifecycle,input}=await recoveredDelivery(f,recovered,attempt);
 if(change==='original-spec')f.db.prepare("UPDATE tasks SET spec=spec||' ' WHERE id='original'").run();
 if(change==='replacement-spec')f.db.prepare("UPDATE tasks SET spec=spec||' ' WHERE id='corrected'").run();
 if(change==='withdrawal-result')f.db.prepare("UPDATE tasks SET result=result||' ' WHERE id='original'").run();
 if(change==='original-create')f.db.prepare("UPDATE mutation_receipts SET payload_hash='changed' WHERE request_id='create-original'").run();
 if(change==='replacement-create')f.db.prepare("DELETE FROM mutation_receipts WHERE request_id='create-corrected'").run();
 if(change==='withdrawal-update')f.db.prepare("UPDATE mutation_receipts SET payload_hash='changed' WHERE request_id='withdraw-original'").run();
 if(change==='original-dispatch')f.db.prepare("INSERT INTO dispatch_contexts(id,run_id,task_id,status) VALUES('forbidden-old-effect','run-head','original','completed')").run();
 if(change==='unresolved-start')f.db.prepare("INSERT INTO mutation_receipts VALUES('local-fingerprint','uncertain-old-start','orchestration.workerStart','unknown','pending',NULL)").run();
 if(change==='recovery-record'){const wake=f.store.readWake('head-recovery');f.store.updateWake(wake.requestId,wake.version,{state:'needs_decision'});}
 await assert.rejects(lifecycle.decide(input),/native|Native|Unregistered|evidence|authority/);
 assert.equal(f.store.readCurrentWork(f.work.id).status,'awaiting_acceptance');assert.equal(f.store.readNativeHistory(f.work.id).withdrawals.length,1);
});
test('an unrecorded withdrawal cannot acquire old-epoch authority after Head rebind',async t=>{
 const f=await withdrawalFixture(t),attempt=await acceptedReplacement(f),recovered=await authorizedHeadRebind(t,f);
 f.withdraw();const {lifecycle,input}=await recoveredDelivery(f,recovered,attempt);
 await assert.rejects(lifecycle.decide(input),/Unregistered|Native task evidence/);
 assert.equal(f.store.readNativeHistory(f.work.id).withdrawals.length,0);
 assert.equal(f.store.listDispatches(f.work.id).length,1);
});
