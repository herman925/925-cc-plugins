import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {ddlFor} from '../contract.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
import * as schema5 from '../src/schema5-contract.mjs';
import * as schema6 from '../src/schema6-contract.mjs';

async function fixture(t,engine,{bound=true,memberId='head',definition={ddlFor}}={}){
 const f=await runtimeFixture(t,engine),db=await f.raw();
 const actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'ordinary-session',executionHostId:'local',contextId:'context',terminalHandle:'ordinary-terminal',incarnationId:'initial'};
 try{
  await db.begin();await db.exec(definition.ddlFor(engine));await seedLayout(db);
  await db.query("UPDATE members SET cli='codex',worktree='context',home_context_kind='worktree',home_execution_host_id='local',home_original_path=:root,machine_id='machine'",{root:f.root});
  if(bound)await db.query("INSERT INTO member_bindings VALUES (:member,'machine','codex','ordinary-session','local','context','ordinary-terminal','initial',1)",{member:memberId});
  await db.commit();
 }finally{await db.close();}
 const adapter=await createCodexAdapter({...f.options,observation:false},{createIdentity:async()=>({launchWorkers:true,verifyCaller:async()=>({...actor})})});
 t.after(()=>adapter.close());
 const write=async sql=>{const db=await f.raw();try{await db.begin();await db.exec(sql);await db.commit();}finally{await db.close();}};
 const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
 const guard=event=>adapter.call('team_guard',event,{});
 return {...f,actor,adapter,write,rows,guard};
}
const ordinaryEvents=[
 {tool:'apply_patch',input:{command:'*** Begin Patch\n*** Add File: ordinary.txt\n+fixture only\n*** End Patch'}},
 {tool:'exec_command',input:{cmd:'Get-Content README.md'}},
 {tool:'spawn_agent',input:{}},
];

test('an ordinary session with no team store is unrestricted and creates no store',async t=>{
 const f=await runtimeFixture(t,'sqlite');
 const actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'no-team',executionHostId:'local',contextId:'context',terminalHandle:'ordinary-terminal',incarnationId:'initial'};
 const adapter=await createCodexAdapter({observation:false},{createIdentity:async()=>({launchWorkers:true,verifyCaller:async()=>actor})});t.after(()=>adapter.close());
 for(const event of ordinaryEvents)assert.deepEqual(await adapter.call('team_guard',event,{}),{});
 assert.equal((await adapter.call('shared_team_status',{},{})).info.storeExists,false);
 const {access}=await import('node:fs/promises');await assert.rejects(access(f.path),{code:'ENOENT'});
});

for(const definition of [schema5,schema6])test(`schema ${definition.SCHEMA_VERSION}: a retired ordinary member is readable without newer launch tables or migration`,async t=>{
 const f=await fixture(t,'sqlite',{definition});
 await f.write("UPDATE members SET membership_state='retired',generation=generation+1 WHERE member_id='head'");
 f.actor.incarnationId='resumed';
 for(const event of ordinaryEvents)assert.deepEqual(await f.guard(event),{});
 assert.equal(Number((await f.rows('SELECT schema_version FROM store_metadata'))[0].schema_version),definition.SCHEMA_VERSION);
});

for(const engine of ['sqlite','postgres']){
 const options={skip:engine==='postgres'&&!postgresTestUrl()};
 test(`${engine}: an empty store does not impose team restrictions or initialize itself`,options,async t=>{
  const f=await runtimeFixture(t,engine),db=await f.raw();await db.close();
  const actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'empty-store',executionHostId:'local',contextId:'context',terminalHandle:'ordinary-terminal',incarnationId:'initial'};
  const adapter=await createCodexAdapter({...f.options,observation:false},{createIdentity:async()=>({launchWorkers:true,verifyCaller:async()=>actor})});t.after(()=>adapter.close());
  for(const event of ordinaryEvents)assert.deepEqual(await adapter.call('team_guard',event,{}),{});
  assert.equal((await adapter.call('shared_team_status',{},{})).info.storeExists,false);
  const check=await f.raw();try{assert.deepEqual(await check.objects(),[]);}finally{await check.close();}
 });
 test(`${engine}: an ordinary unbound session stays outside another team's enforcement`,options,async t=>{
  const f=await fixture(t,engine,{bound:false});
  for(const event of ordinaryEvents)assert.deepEqual(await f.guard(event),{});
  const status=await f.adapter.call('shared_team_status',{},{});
  assert.equal(status.info.member,null);assert.equal(status.info.controllerGeneration,null);
  assert.equal((await f.rows('SELECT * FROM member_bindings')).length,0);
 });
 for(const resumed of [false,true])test(`${engine}: retiring an ordinary member releases team enforcement${resumed?' after resume':''} without deleting its history`,options,async t=>{
  const f=await fixture(t,engine);
  assert.equal((await f.guard(ordinaryEvents[0])).hookSpecificOutput.permissionDecision,'deny');
  await f.write("UPDATE members SET membership_state='retired',generation=generation+1 WHERE member_id='head'");
  const before=await f.rows('SELECT * FROM member_bindings');
  if(resumed){f.actor.terminalHandle='resumed-terminal';f.actor.incarnationId='resumed';}
  for(const event of ordinaryEvents)assert.deepEqual(await f.guard(event),{});
  const status=await f.adapter.call('shared_team_status',{},{});
  assert.equal(status.info.member,null);assert.equal(status.info.binding,null);
  assert.equal(status.info.membershipState,'retired');assert.equal(status.info.retiredMemberId,'head');
  assert.equal(status.info.bindingState,undefined);assert.equal(status.info.controllerGeneration,null);
  assert.deepEqual(await f.rows('SELECT * FROM member_bindings'),before);
  assert.equal((await f.rows("SELECT membership_state FROM members WHERE member_id='head'"))[0].membership_state,'retired');
  await assert.rejects(f.adapter.call('shared_team',{operationId:'no-retired-task-access',command:{type:'inspectAssignment',teamId:'fixture-team',assignmentId:'not-a-task'}},{}),error=>['API_MEMBER_SCOPE','API_STALE_BINDING'].includes(error.code));
 });
 test(`${engine}: retirement cannot turn a launched worker into an unrestricted ordinary session`,options,async t=>{
  const f=await fixture(t,engine,{memberId:'worker'});
  await f.write("INSERT INTO controller_approvals VALUES ('launch-controller','machine','codex','owner',1,1,0); INSERT INTO member_launches VALUES ('reserved-worker','worker','launch-controller','machine','ordinary-session','bound',3,1); UPDATE members SET membership_state='retired',generation=generation+1 WHERE member_id='worker'");
  for(const event of ordinaryEvents)await assert.rejects(f.guard(event),{code:'API_LAUNCH_ATTACH_REQUIRED'});
  await assert.rejects(f.adapter.call('shared_team_status',{},{}),{code:'API_LAUNCH_ATTACH_REQUIRED'});
  assert.equal((await f.rows('SELECT status FROM member_launches'))[0].status,'bound');
  assert.equal((await f.rows('SELECT * FROM member_bindings')).length,1);
 });
}
