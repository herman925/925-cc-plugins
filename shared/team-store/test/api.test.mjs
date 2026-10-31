import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';

const code = expected=>error=>error.code===expected;
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:8,launch:'demand',batch:3,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
for(const engine of ['sqlite','postgres']) describe(`${engine} authenticated API`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 async function setup(t){
  const apis=[]; t.after(async()=>{for(const api of apis) await api.close();});
  const f=await runtimeFixture(t,engine);
  const actor=name=>({projectRoot:f.root,machineId:'machine',provider:'claude',conversationId:name,executionHostId:'local',contextId:'context',terminalHandle:`term-${name}`,incarnationId:`inc-${name}`});
  const native={current:actor('controller')};
  const api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.42'},authenticate:async()=>native.current,verifyTarget:async target=>actor(target),confirmController:async({approval})=>approval==='specific-ui-action'}); apis.push(api);
  let seq=0;
  const call=(command,extra={})=>api.execute({operationId:`op-${++seq}`,command,...extra});
  const approve=()=>api.approveController({operationId:`approval-${++seq}`,approval:'specific-ui-action'});
  const fresh={type:'createFreshTeam',teamId:'team',name:'Fresh',functionText:'Test',settings,members:[{memberId:'head',name:'Head',bossMemberId:null,role:'Review',officialText:'Head role'},{memberId:'worker',name:'Worker',bossMemberId:'head',role:'Implement',officialText:'Worker role'},{memberId:'other',name:'Other',bossMemberId:'head',role:'Implement',officialText:'Other role'}],expectedControllerGeneration:1};
  const bind=(memberId,target=memberId,generation=0)=>call({type:'bindMember',teamId:'team',memberId,expectedConfigVersion:7,expectedMemberGeneration:1,expectedBindingGeneration:generation,expectedControllerGeneration:1},{target});
  const base={teamId:'team',expectedConfigVersion:7,expectedMemberGeneration:1,expectedBindingGeneration:1};
  const admit={...base,type:'admitAssignment',runId:'run',taskId:'task',assignmentId:'assignment',memberId:'worker',instructions:'Return 2 + 3.',expectedResult:'5 with evidence',expectedTargetGeneration:1,expectedTargetBindingGeneration:1};
  const verify={...base,type:'verifyAssignment',assignmentId:'assignment',expectedAttemptGeneration:1};
  const report={...base,type:'reportOutcome',assignmentId:'assignment',expectedAttemptGeneration:2,outcome:'succeeded',summary:'5',evidence:'2 + 3 = 5'};
  const accept={...base,type:'acceptTask',assignmentId:'assignment',expectedAttemptGeneration:3,decision:'accepted',reason:'Checked arithmetic'};
  const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
  const ready=async()=>{await approve();await call(fresh);await bind('head');await bind('worker');await bind('other');native.current=actor('head');await call(admit);};
  return {...f,api,native,actor,call,approve,fresh,bind,base,admit,verify,report,accept,rows,ready};
 }
 test('complete fresh team flow records worker outcome separately from head acceptance',async t=>{
  const f=await setup(t); await f.ready(); f.native.current=f.actor('worker');
  const pickup=await f.call(f.verify); assert.equal(pickup.result.brief.instructions,'Return 2 + 3.'); assert.equal(pickup.result.role.official_text,'Worker role');
  assert.equal((await f.call(f.report)).result.acceptance,'pending');
  f.native.current=f.actor('head');
  assert.equal((await f.call({type:'inspectAssignment',teamId:'team',assignmentId:'assignment'})).result.attempt.evidence,'2 + 3 = 5');
  f.native.current=f.actor('worker');
  assert.equal((await f.rows("SELECT status FROM tasks WHERE task_id='task'"))[0].status,'open');
  await assert.rejects(f.call(f.accept),code('API_HEAD_REQUIRED'));
  f.native.current=f.actor('head'); await f.call(f.accept);
  assert.equal((await f.rows("SELECT outcome FROM tasks WHERE task_id='task'"))[0].outcome,'succeeded');
  assert.equal((await f.rows('SELECT * FROM task_acceptances')).length,1);
 });
 test('self-asserted caller, approval, paths and raw mutations cannot become authority',async t=>{
  const f=await setup(t);
  await assert.rejects(f.api.execute({operationId:'spoof',command:f.fresh,caller:{principalId:'head'}}),code('API_INPUT_INVALID'));
  await assert.rejects(f.api.execute({operationId:'approval',command:{type:'approveController'}}),code('API_OPERATION_DENIED'));
  await assert.rejects(f.api.approveController({operationId:'bad',approval:true}),code('API_APPROVAL_REQUIRED'));
  await f.approve(); f.native.current=f.actor('outsider');
  await assert.rejects(f.call(f.fresh),code('API_CONTROLLER_REQUIRED'));
  await assert.rejects(f.call({...f.fresh,projectRoot:'C:/elsewhere'}),code('API_INPUT_INVALID'));
  f.native.current={...f.actor('controller'),machineId:'other'};
  await assert.rejects(f.call(f.fresh),code('API_CALLER_SCOPE'));
 });
 test('separate controllers coexist and approval survives a freshly verified same-conversation resume',async t=>{
  const f=await setup(t);const first=await f.approve();f.native.current=f.actor('second');await f.approve();
  f.native.current={...f.actor('controller'),incarnationId:'restarted',terminalHandle:'new-terminal'};
  await f.call(f.fresh);assert.equal((await f.rows('SELECT * FROM controller_approvals WHERE revoked=0')).length,2);
  await f.call({type:'revokeController',controllerId:first.result.controllerId,expectedControllerGeneration:1});
  await assert.rejects(f.call({type:'inspectTeam',teamId:'team'}),code('API_BINDING_REQUIRED'));
  f.native.current=f.actor('second');await f.call({type:'inspectTeam',teamId:'team'});
 });
 test('a stale native incarnation, member generation or binding generation is refused',async t=>{
  const f=await setup(t);await f.ready();f.native.current={...f.actor('worker'),incarnationId:'new'};
  await assert.rejects(f.call(f.verify),code('API_STALE_BINDING'));
  f.native.current=f.actor('controller');await f.bind('worker','worker',1);f.native.current=f.actor('worker');
  await assert.rejects(f.call(f.verify),code('API_STALE_AUTHORITY'));
  await rawWrite(f,"UPDATE members SET generation=2 WHERE member_id='worker'");
  await assert.rejects(f.call({...f.verify,expectedBindingGeneration:2}),code('API_STALE_AUTHORITY'));
 });
 test('another worker cannot pick up or report, and a worker cannot admit work to a peer',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('other');
  await assert.rejects(f.call(f.verify),code('API_ASSIGNEE_REQUIRED'));
  await assert.rejects(f.call(f.report),code('API_STALE_AUTHORITY'));
  await assert.rejects(f.call({...f.admit,taskId:'peer-task',assignmentId:'peer-assignment'}),code('API_DIRECT_REPORT_REQUIRED'));
  f.native.current=f.actor('worker');await assert.rejects(f.call({...f.report,expectedAttemptGeneration:1}),code('API_PICKUP_REQUIRED'));
 });
 test('same-operation replay is idempotent; changed body and revoked roles do not replay',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  const request={operationId:'stable-pickup',command:f.verify};const first=await f.api.execute(request);assert.deepEqual(await f.api.execute(request),first);
  assert.deepEqual(await f.api.reconcile(request),first);
  await assert.rejects(f.api.execute({...request,command:{...f.verify,expectedAttemptGeneration:2}}),code('STORE_IDEMPOTENCY_CONFLICT'));
  await rawWrite(f,"UPDATE members SET membership_state='retired' WHERE member_id='worker'");
  await assert.rejects(f.api.execute(request),code('API_MEMBER_SCOPE'));
  await assert.rejects(f.api.reconcile(request),code('API_MEMBER_SCOPE'));
 });
 test('pickup expiry and explicit failed/rejected results are preserved',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  await rawWrite(f,"UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1 WHERE assignment_id='assignment'");
  await assert.rejects(f.call(f.verify),code('API_PICKUP_EXPIRED'));
  await rawWrite(f,"UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+600000 WHERE assignment_id='assignment'");
  await f.call(f.verify);await f.call({...f.report,outcome:'failed',summary:'Unable',evidence:'Reproduced error'});
  f.native.current=f.actor('head');await f.call({...f.accept,decision:'rejected',reason:'Needs another attempt'});
  assert.deepEqual((await f.rows('SELECT status,outcome FROM tasks'))[0],{status:'blocked',outcome:null});
 });
 test('current authority is checked after waiting for the common database lock',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  const db=await f.raw();
  try{
   await db.begin();await db.lockLeaseControl();
   await db.query("UPDATE members SET generation=2 WHERE member_id='worker'");
   const pending=f.call(f.verify);
   // The API authenticates outside the transaction, then waits for this lock.
   // It must observe the committed generation rather than that earlier proof.
   await new Promise(resolve=>setTimeout(resolve,30));await db.commit();
   await assert.rejects(pending,code('API_STALE_AUTHORITY'));
   assert.equal((await f.rows("SELECT pickup_observed_at_ms FROM assignments WHERE assignment_id='assignment'"))[0].pickup_observed_at_ms,null);
  }finally{await db.close();}
 });
 test('failed fresh-team creation rolls back all roster and approval-independent changes',async t=>{
  const f=await setup(t);await f.approve();
  await assert.rejects(f.call({...f.fresh,members:[f.fresh.members[0],{...f.fresh.members[1],name:'Head'}]}),code('STORE_MEMBER_NAME_EXISTS'));
  assert.equal((await f.rows('SELECT * FROM teams')).length,0);
  assert.equal((await f.rows('SELECT * FROM members')).length,0);
  assert.equal((await f.rows('SELECT * FROM controller_approvals')).length,1);
 });
});
