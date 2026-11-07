import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {WORKER_TOOL_POLICY} from '../src/worker-policy.mjs';
import {workerReadiness} from '../src/worker-readiness.mjs';
import {codexGuard} from '../src/codex-guard.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
const code=expected=>e=>e.code===expected;
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:4,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
async function fixture(t,engine){
 let api;t.after(()=>api?.close());
 const f=await runtimeFixture(t,engine),actor=id=>({projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:id,executionHostId:'local',contextId:'context',terminalHandle:`term-${id}`,incarnationId:`inc-${id}`});
 const state={actor:actor('head'),target:Object.fromEntries(Object.entries(actor('worker')).filter(([k])=>!['provider','conversationId'].includes(k))),proof:{launchId:'launch',planId:'plan',policyId:WORKER_TOOL_POLICY,runtimeEpoch:'epoch-1',nativeExecutionKey:'native-execution'}};
 api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>state.actor,confirmController:async()=>true,confirmManagement:async()=>true,confirmLaunchPlan:async()=>true,verifyTarget:async()=>state.actor,verifyLaunchTarget:async()=>state.target,verifyWorkerRuntime:async()=>state.proof});
 const call=command=>api.execute({operationId:randomUUID(),command}),launch=command=>api.launch({operationId:randomUUID(),command});
 await api.approveController({operationId:'approval'});
 await api.manageTeam({operationId:'create',command:{type:'createFreshTeam',teamId:'team',name:'Ready',functionText:'Readiness tests',settings,expectedControllerGeneration:1,members:['head','worker'].map(id=>({memberId:id,name:id,bossMemberId:id==='head'?null:'head',role:'Role',officialText:'Official brief before work.',cli:'codex'}))}});
 const config=(await call({type:'inspectConfiguration',teamId:'team'})).result;
 const authority={teamId:'team',expectedConfigVersion:Number(config.team.config_version),expectedControllerGeneration:1};
 await api.manageTeam({operationId:'head-binding',command:{...authority,type:'bindMember',memberId:'head',expectedMemberGeneration:1,expectedBindingGeneration:0},target:'head'});
 const plan={...authority,type:'approveLaunchPlan',planId:'plan',workerToolPolicy:WORKER_TOOL_POLICY,selections:[{memberId:'worker',launchId:'launch',expectedMemberGeneration:1,expectedOfficialGeneration:1,expectedNotesGeneration:1}]};
 await launch(plan);await launch({...authority,type:'claimLaunch',launchId:'launch'});await launch({...authority,type:'recordLaunchTarget',launchId:'launch'});
 state.actor=actor('worker');await launch({type:'attachLaunch'});
 const runtime=(type,extra={})=>api.workerRuntime({operationId:randomUUID(),type,...extra});
 const step=(step,receiptId)=>runtime('observeWorkerRuntime',{step,...(receiptId?{receiptId}:{})});
 const admit={type:'admitAssignment',teamId:'team',runId:'run',taskId:'task',assignmentId:'assignment',memberId:'worker',instructions:'Return 5',expectedResult:'5',expectedConfigVersion:authority.expectedConfigVersion,expectedMemberGeneration:1,expectedBindingGeneration:1,expectedTargetGeneration:1,expectedTargetBindingGeneration:1};
 const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
 const ready=async()=>{await runtime('beginWorkerRuntime');await step('status');await step('api');const inbox=(await step('inbox')).result;await step('seen',inbox.readReceiptId);return inbox;};
 return {...f,api,state,actor,call,launch,authority,plan,runtime,step,admit,rows,ready};
}
for(const engine of ['sqlite','postgres'])describe(`${engine} native worker readiness`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 test('production adapter observes the four real tool entrypoints and disconnects only its runtime',async t=>{
  let adapter;t.after(()=>adapter?.close());const f=await fixture(t,engine);
  const [{project_id:projectId}]=await f.rows('SELECT project_id FROM project_identity');
  adapter=await createCodexAdapter({writer:SHARED_WRITER,postgres:f.options.postgres,observation:false,reservedLaunch:{projectRoot:f.root,machineId:'machine',contextId:'context',projectId,launchId:'launch',memberId:'worker'},workerAccess:{planId:'plan',policyId:WORKER_TOOL_POLICY}},{createIdentity:async()=>({verifyCaller:async()=>f.state.actor}),workerTimers:{setTimeout:()=>({unref(){}}),clearTimeout(){}}});
  const metadata={threadId:'worker'};
  const held=await adapter.call('team_guard',{tool:'Write',input:{file_path:'public.txt',content:'not yet'}},metadata);assert.equal(held.hookSpecificOutput.permissionDecision,'deny');
  const status=await adapter.call('shared_team_status',{},metadata);assert.equal(status.workerTools.state,'checking');
  await adapter.call('shared_team',{operationId:'role-read',command:{type:'inspectTeam',teamId:'team'}},metadata);
  const inbox=await adapter.call('shared_inbox_read',{},metadata);assert.equal(inbox.bootstrap.kind,'worker_tool_readiness');
  const seen=await adapter.call('shared_inbox_seen',{readReceiptId:inbox.readReceiptId},metadata);assert.equal(seen.state,'ready');
  assert.deepEqual(await adapter.call('team_guard',{tool:'Write',input:{file_path:'public.txt',content:'normal member rules'}},metadata),{});
  assert.equal((await f.rows('SELECT * FROM assignments')).length,0);
  await adapter.close();assert.equal((await f.rows('SELECT state FROM worker_readiness'))[0].state,'disconnected');
 });
 test('unready worker guard keeps bootstrap and blocker reporting open while denying effects',()=>{
  const authority={member:{allow_write:1,allow_agent:1},hasReports:false,workerSetup:{covered:true,state:'checking'}};
  for(const tool of ['Write','Agent','apply_patch','write_stdin'])assert.equal(codexGuard(authority,{tool,input:{file_path:'public.txt',content:'x',chars:'run'}}).hookSpecificOutput.permissionDecision,'deny');
  for(const tool of ['shared_team_status','shared_inbox_read','shared_inbox_seen'])assert.deepEqual(codexGuard(authority,{tool:'mcp__team_orchestrator__'+tool,input:{}}),{});
  assert.deepEqual(codexGuard(authority,{tool:'shared_team',input:{command:{type:'askQuestion',assignmentId:null}}}),{});
  assert.equal(codexGuard(authority,{tool:'shared_team',input:{command:{type:'reportOutcome'}}}).hookSpecificOutput.permissionDecision,'deny');
 });
 test('unready admission creates no task, assignment, delivery or deadline',async t=>{
  const f=await fixture(t,engine);f.state.actor=f.actor('head');
  await assert.rejects(f.call(f.admit),code('API_WORKER_NOT_READY'));
  for(const table of ['runs','tasks','assignments','deliveries'])assert.equal((await f.rows(`SELECT * FROM ${table}`)).length,0);
  assert.equal((await f.rows('SELECT status FROM member_launches'))[0].status,'bound');
 });
 test('reviewed existing-worker setup queues no duplicate and preserves current work while blocking new admission',async t=>{
  const f=await fixture(t,engine);await f.ready();f.state.actor=f.actor('head');
  await assert.rejects(f.launch({...f.plan,planId:'wrong-adoption'}),code('API_LAUNCH_BOUND'));
  const adopted=await f.launch({...f.plan,planId:'adopted',selections:f.plan.selections.map(s=>({...s,expectedBindingGeneration:1}))});
  assert.deepEqual(adopted.result.setupRequiredMemberIds,['worker']);assert.equal((await f.rows('SELECT * FROM member_launches')).length,1);
  const db=await f.raw();try{const state=await workerReadiness(db,'worker',Date.now());assert.equal(state.state,'ready');assert.equal(state.setupPending,true);}finally{await db.close();}
  await assert.rejects(f.call(f.admit),code('API_WORKER_NOT_READY'));
  f.state.actor=f.actor('worker');await f.step('heartbeat');
  f.state.proof={...f.state.proof,planId:'adopted',runtimeEpoch:'adopted-runtime'};await f.ready();
  f.state.actor=f.actor('head');await f.call(f.admit);assert.equal((await f.rows('SELECT * FROM assignments')).length,1);
 });
 test('actual-tool bootstrap receipt is required before admission and duplicates replay exactly',async t=>{
  const f=await fixture(t,engine);await f.runtime('beginWorkerRuntime');await f.step('status');await f.step('api');
  await assert.rejects(f.step('seen','forged'),code('API_WORKER_RECEIPT_REQUIRED'));
  const inbox=(await f.step('inbox')).result;assert.equal(inbox.bootstrap.kind,'worker_tool_readiness');assert.equal(inbox.message,null);
  await assert.rejects(f.step('seen','other'),code('API_WORKER_RECEIPT_REQUIRED'));
  const exact={operationId:'exact-bootstrap-seen',type:'observeWorkerRuntime',step:'seen',receiptId:inbox.readReceiptId};
  const seen=await f.api.workerRuntime(exact);assert.equal(seen.result.state,'ready');assert.deepEqual(await f.api.workerRuntime(exact),seen);
  f.state.actor=f.actor('head');await f.call(f.admit);assert.equal((await f.rows('SELECT * FROM assignments')).length,1);
 });
 test('model commands and a head cannot invent worker readiness or confirm its receipt',async t=>{
  const f=await fixture(t,engine);await assert.rejects(f.call({type:'beginWorkerRuntime'}),code('API_OPERATION_DENIED'));
  await f.runtime('beginWorkerRuntime');const inbox=(await f.step('inbox')).result;f.state.actor=f.actor('head');
  await assert.rejects(f.step('seen',inbox.readReceiptId),code('API_WORKER_PROOF_REQUIRED'));
  await assert.rejects(f.api.workerRuntime({operationId:'forged-proof',type:'beginWorkerRuntime',proof:f.state.proof}),code('API_INPUT_INVALID'));
 });
 test('older epochs cannot heartbeat or disconnect the newer runtime',async t=>{
  const f=await fixture(t,engine);await f.ready();f.state.proof={...f.state.proof,runtimeEpoch:'epoch-2'};await f.runtime('beginWorkerRuntime');await f.ready();
  f.state.proof={...f.state.proof,runtimeEpoch:'epoch-1'};await assert.rejects(f.step('heartbeat'),code('API_WORKER_RUNTIME_STALE'));
  assert.equal((await f.runtime('closeWorkerRuntime')).result.closed,false);
  assert.equal((await f.rows('SELECT state FROM worker_readiness'))[0].state,'ready');
 });
 test('disconnect and expired observations retain capacity and refuse readiness',async t=>{
  const f=await fixture(t,engine);await f.ready();
  const db=await f.raw();try{assert.equal((await workerReadiness(db,'worker',Number.MAX_SAFE_INTEGER)).state,'checking');}finally{await db.close();}
  await f.runtime('closeWorkerRuntime');f.state.actor=f.actor('head');await assert.rejects(f.call(f.admit),code('API_WORKER_NOT_READY'));
  assert.equal((await f.rows('SELECT status FROM member_launches'))[0].status,'bound');assert.equal((await f.rows('SELECT * FROM member_bindings')).length,2);
 });
 test('retry to an unready worker rolls back without changing the returned attempt or its deliveries',async t=>{
  const f=await fixture(t,engine);await f.ready();f.state.actor=f.actor('head');await f.call(f.admit);
  await rawWrite(f,'UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1');
  const base={teamId:'team',expectedConfigVersion:f.authority.expectedConfigVersion,expectedMemberGeneration:1,expectedBindingGeneration:1};
  await f.call({...base,type:'observePickupDeadlines'});
  const [attempt]=await f.rows('SELECT * FROM assignment_attempts');const count=(await f.rows('SELECT * FROM deliveries')).length;
  f.state.actor=f.actor('worker');await f.runtime('closeWorkerRuntime');f.state.actor=f.actor('head');
  await assert.rejects(f.call({...base,type:'retryAssignment',assignmentId:'assignment',newAssignmentId:'retry',memberId:'worker',expectedAttemptGeneration:Number(attempt.generation),expectedTargetGeneration:1,expectedTargetBindingGeneration:1}),code('API_WORKER_NOT_READY'));
  assert.equal((await f.rows('SELECT * FROM assignments')).length,1);assert.equal((await f.rows('SELECT * FROM deliveries')).length,count);
  assert.equal(Number((await f.rows('SELECT * FROM assignment_attempts'))[0].generation),Number(attempt.generation));
 });
 test('consent and ready flags cannot be forged by replacing immutable rows',async t=>{
  const f=await fixture(t,engine);await f.ready();
  await assert.rejects(rawWrite(f,"UPDATE worker_tool_consents SET policy_id='other'"));
  await assert.rejects(rawWrite(f,'DELETE FROM worker_tool_consents'));
  await assert.rejects(rawWrite(f,"UPDATE worker_readiness SET state='ready',generation=generation+2"));
 });
});
