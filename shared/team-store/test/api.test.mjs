import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {createInboxJournal} from '../src/inbox-journal.mjs';
import {join} from 'node:path';

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
 test('admission and explicit outcome atomically enqueue stable immutable messages',async t=>{
  const f=await setup(t);await f.ready();
  const [dispatch]=await f.rows('SELECT * FROM messages');
  assert.equal(dispatch.kind,'dispatch');assert.equal(dispatch.recipient_member_id,'worker');
  assert.equal(JSON.parse(dispatch.body).instructions,'Return 2 + 3.');
  assert.equal((await f.rows('SELECT * FROM deliveries')).length,1);
  assert.equal((await f.rows('SELECT * FROM threads')).length,1);
  f.native.current=f.actor('worker');await f.call(f.verify);
  const request={operationId:'durable-outcome',command:f.report};
  const first=await f.api.execute(request);assert.deepEqual(await f.api.execute(request),first);
  assert.deepEqual(await f.api.reconcile(request),first);
  const messages=await f.rows('SELECT * FROM messages ORDER BY created_at_ms');
  assert.equal(messages.length,2);assert.equal(messages[1].kind,'worker_done');
  assert.equal(messages[1].recipient_member_id,'head');assert.ok(Number(messages[1].created_at_ms)>Number(messages[0].created_at_ms));
  assert.equal((await f.rows('SELECT * FROM task_acceptances')).length,0);
  f.native.current=f.actor('head');await f.call(f.accept);
  assert.equal((await f.rows('SELECT status FROM threads'))[0].status,'answered');
  assert.ok((await f.rows('SELECT status FROM deliveries')).every(row=>row.status==='fenced'));
  assert.deepEqual(await f.rows(`SELECT * FROM messages WHERE message_id='${dispatch.message_id}'`),[dispatch]);
 });
 test('wake reservations throttle retries and never skip older outstanding recipient mail',async t=>{
  const f=await setup(t);await f.ready();
  await f.call({...f.admit,taskId:'second-task',assignmentId:'second-assignment'});
  const command={...f.base,type:'prepareDeliveries'};
  const first=(await f.call(command)).result.deliveries;
  assert.equal(first.length,1);assert.equal(first[0].replay,false);assert.equal(first[0].recipient.member_id,'worker');
  assert.equal((await f.call(command)).result.deliveries.length,0);
  await rawWrite(f,'UPDATE deliveries SET last_replayed_at_ms=0 WHERE replay_count>0');
  const replay=(await f.call(command)).result.deliveries;
  assert.equal(replay.length,1);assert.equal(replay[0].deliveryId,first[0].deliveryId);assert.equal(replay[0].replay,true);
  assert.equal((await f.rows("SELECT COUNT(*) AS n FROM deliveries WHERE status='acknowledged'"))[0].n,engine==='postgres'?'0':0);
  f.native.current=f.actor('worker');
  const peek=await f.call({type:'inspectInbox',teamId:'team',recipientMemberId:'worker'});
  assert.equal(peek.result.messages.length,1);assert.equal(peek.result.messages[0].delivery_id,first[0].deliveryId);
  await assert.rejects(f.call({type:'inspectInbox',teamId:'team',recipientMemberId:'head'}),code('API_HEAD_REQUIRED'));
  await rawWrite(f,'UPDATE runs SET consumer_generation=2');
  assert.deepEqual((await f.call({type:'inspectInbox',teamId:'team',recipientMemberId:'worker'})).result.messages,[]);
 });
 test('deadline observation returns an unpicked assignment once and fences its delivery without closing resources',async t=>{
  const f=await setup(t);await f.ready();
  await rawWrite(f,"UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1 WHERE assignment_id='assignment'");
  const first=await f.call({...f.base,type:'observePickupDeadlines'});
  assert.equal(first.result.returned.length,1);assert.equal(first.result.returned[0].returnedToMemberId,'head');
  assert.equal((await f.call({...f.base,type:'observePickupDeadlines'})).result.returned.length,0);
  assert.equal((await f.rows('SELECT status FROM threads'))[0].status,'fenced');
  assert.equal((await f.rows('SELECT status FROM deliveries'))[0].status,'fenced');
  assert.equal((await f.rows('SELECT COUNT(*) AS n FROM messages'))[0].n,engine==='postgres'?'1':1);
  assert.equal((await f.rows('SELECT status FROM tasks'))[0].status,'open');
  assert.ok((await f.rows('SELECT membership_state FROM members')).every(m=>m.membership_state==='active'));
  assert.equal((await f.rows('SELECT * FROM member_bindings')).length,3);
  f.native.current=f.actor('worker');
  await assert.rejects(f.call({...f.verify,expectedAttemptGeneration:2}),code('API_PICKUP_EXPIRED'));
 });
 test('recipient read advances FIFO once and its durable receipt recovers a lost response',async t=>{
  const f=await setup(t);await f.ready();await f.call({...f.admit,taskId:'second-task',assignmentId:'second-assignment'});
  f.native.current=f.actor('worker');
  const peek=()=>f.call({type:'inspectInbox',teamId:'team',recipientMemberId:'worker'});
  const oldest=(await peek()).result.messages[0];
  const read={...f.base,type:'readInbox',deliveryId:oldest.delivery_id,expectedDeliveryGeneration:oldest.delivery_generation};
  f.native.current=f.actor('head');await assert.rejects(f.call(read),code('API_INBOX_ORDER'));
  f.native.current=f.actor('worker');
  const request={operationId:'read-lost-response',command:read};
  const first=await f.api.execute(request);assert.equal(first.result.acknowledged,true);
  assert.equal(first.result.message.delivery_status,'acknowledged');
  assert.deepEqual(await f.api.reconcile(request),first);assert.deepEqual(await f.api.execute(request),first);
  const next=(await peek()).result.messages[0];assert.notEqual(next.delivery_id,oldest.delivery_id);
  await assert.rejects(f.call(read),code('API_INBOX_ORDER'));
  assert.equal((await f.rows("SELECT COUNT(*) AS n FROM deliveries WHERE status='acknowledged'"))[0].n,engine==='postgres'?'1':1);
 });
 test('read receipt recovery follows the bound recipient, not just the conversation id',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  const [message]=(await f.call({type:'inspectInbox',teamId:'team',recipientMemberId:'worker'})).result.messages;
  const request={operationId:'recipient-read',command:{...f.base,type:'readInbox',deliveryId:message.delivery_id,expectedDeliveryGeneration:message.delivery_generation}};
  const first=await f.api.execute(request);
  f.native.current=f.actor('controller');await f.bind('worker','worker',1);
  f.native.current=f.actor('worker');assert.deepEqual(await f.api.reconcile(request),first);
  f.native.current=f.actor('controller');await rawWrite(f,"DELETE FROM member_bindings WHERE member_id='worker'");await f.bind('other','worker',1);
  f.native.current=f.actor('worker');
  await assert.rejects(f.api.reconcile(request),code('API_ASSIGNEE_REQUIRED'));
  await assert.rejects(f.api.execute(request),code('API_ASSIGNEE_REQUIRED'));
 });
 test('task evidence receipts cannot bypass a changed reporting relationship',async t=>{
  const f=await setup(t);await f.ready();
  const request={operationId:'head-evidence',command:{type:'inspectAssignment',teamId:'team',assignmentId:'assignment'}};
  await f.api.execute(request);
  await rawWrite(f,"UPDATE members SET boss_member_id='other' WHERE member_id='worker'");
  await assert.rejects(f.api.reconcile(request),code('API_ASSIGNEE_REQUIRED'));
  await assert.rejects(f.api.execute(request),code('API_ASSIGNEE_REQUIRED'));
 });
 test('replaying a previous approval cannot report a revoked controller as approved',async t=>{
  const f=await setup(t);const approval=await f.approve();
  await f.call({type:'revokeController',controllerId:approval.result.controllerId,expectedControllerGeneration:1});
  await assert.rejects(f.api.approveController({operationId:approval.operationId,approval:'specific-ui-action'}),code('API_CONTROLLER_REQUIRED'));
 });
 test('machine inbox journal recovers the same acknowledged message until the model confirms context',async t=>{
  const f=await setup(t);await f.ready();await f.call({...f.admit,taskId:'second-task',assignmentId:'second-assignment'});f.native.current=f.actor('worker');
  const options={api:f.api,actor:f.actor('worker'),writer:{client:'team-orchestrator',version:'0.5.42'},machineConfigRoot:join(f.root,'observations')};
  let journal=await createInboxJournal(options);let first;
  try{first=await journal.poll();assert.equal(JSON.parse(first.message.body).assignmentId,'assignment');}finally{await journal.close();}
  journal=await createInboxJournal(options);
  try{
   assert.deepEqual(await journal.poll(),first);
   await journal.attached(first.readReceiptId);await journal.attached(first.readReceiptId);
   const second=await journal.poll();assert.notEqual(second.message.message_id,first.message.message_id);
   assert.equal(JSON.parse(second.message.body).assignmentId,'second-assignment');
  }finally{await journal.close();}
 });
 test('machine inbox journal recovers a lost shared commit reply across a verified same-member rebind',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  const proxy={reconcile:request=>f.api.reconcile(request),execute:async request=>{
   const result=await f.api.execute(request);
   if(request.command.type==='readInbox')throw Object.assign(new Error('Lost reply'),{code:'STORE_COMMIT_UNKNOWN'});
   return result;
  }};
  const options={actor:f.actor('worker'),writer:{client:'team-orchestrator',version:'0.5.42'},machineConfigRoot:join(f.root,'observations')};
  let journal=await createInboxJournal({...options,api:proxy});
  try{await assert.rejects(journal.poll(),code('STORE_COMMIT_UNKNOWN'));}finally{await journal.close();}
  f.native.current=f.actor('controller');await f.bind('worker','worker',1);f.native.current=f.actor('worker');
  journal=await createInboxJournal({...options,api:f.api});
  try{
   const recovered=await journal.poll();assert.equal(JSON.parse(recovered.message.body).assignmentId,'assignment');
   await journal.attached(recovered.readReceiptId);assert.equal((await journal.poll()).message,null);
  }finally{await journal.close();}
  assert.equal(Number((await f.rows("SELECT COUNT(*) AS n FROM operations WHERE operation_id LIKE 'inbox-read-%'"))[0].n),1);
 });
 test('an uncommitted stale journal stage is retired before reading the current delivery generation',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  const options={actor:f.actor('worker'),writer:{client:'team-orchestrator',version:'0.5.42'},machineConfigRoot:join(f.root,'observations')};
  const proxy={reconcile:request=>f.api.reconcile(request),execute:async request=>{
   if(request.command.type==='readInbox')throw Object.assign(new Error('No reply before commit'),{code:'STORE_COMMIT_UNKNOWN'});
   return f.api.execute(request);
  }};
  let journal=await createInboxJournal({...options,api:proxy});
  try{await assert.rejects(journal.poll(),code('STORE_COMMIT_UNKNOWN'));}finally{await journal.close();}
  f.native.current=f.actor('head');await f.call({...f.base,type:'prepareDeliveries'});f.native.current=f.actor('worker');
  journal=await createInboxJournal({...options,api:f.api});
  try{
   assert.deepEqual(await journal.poll(),{message:null,retry:true});
   const current=await journal.poll();assert.equal(JSON.parse(current.message.body).assignmentId,'assignment');
   await journal.attached(current.readReceiptId);
  }finally{await journal.close();}
 });
 test('a machine recovery receipt cannot be confirmed by another member or revive a terminal thread',async t=>{
  const f=await setup(t);await f.ready();f.native.current=f.actor('worker');
  const options={api:f.api,writer:{client:'team-orchestrator',version:'0.5.42'},machineConfigRoot:join(f.root,'observations')};
  let journal=await createInboxJournal({...options,actor:f.actor('worker')});let read;
  try{read=await journal.poll();}finally{await journal.close();}
  f.native.current=f.actor('other');journal=await createInboxJournal({...options,actor:f.actor('other')});
  try{await assert.rejects(journal.attached(read.readReceiptId),code('API_ASSIGNEE_REQUIRED'));}finally{await journal.close();}
  f.native.current=f.actor('worker');await f.call(f.verify);await f.call(f.report);f.native.current=f.actor('head');await f.call(f.accept);
  f.native.current=f.actor('worker');journal=await createInboxJournal({...options,actor:f.actor('worker')});
  try{assert.deepEqual(await journal.poll(),{message:null,retry:true});assert.equal((await journal.poll()).message,null);}finally{await journal.close();}
 });
 test('a returned unpicked task retries as a new linked assignment and preserves the fenced predecessor',async t=>{
  const f=await setup(t);await f.ready();
  const retry={...f.base,type:'retryAssignment',assignmentId:'assignment',newAssignmentId:'retry',memberId:'other',expectedAttemptGeneration:2,expectedTargetGeneration:1,expectedTargetBindingGeneration:1};
  await assert.rejects(f.call({...retry,expectedAttemptGeneration:1}),code('API_RETURN_REQUIRED'));
  await rawWrite(f,"UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1 WHERE assignment_id='assignment'");
  await f.call({...f.base,type:'observePickupDeadlines'});
  const result=await f.call(retry);assert.equal(result.result.previousAssignmentId,'assignment');
  assert.equal(result.result.taskId,'task');assert.equal(result.result.attemptGeneration,1);
  await assert.rejects(f.call({...retry,newAssignmentId:'duplicate',expectedAttemptGeneration:3}),code('API_RETRY_EXISTS'));
  assert.equal((await f.rows("SELECT status FROM threads WHERE assignment_id='assignment'"))[0].status,'fenced');
  assert.equal((await f.rows("SELECT status FROM threads WHERE assignment_id='retry'"))[0].status,'open');
  f.native.current=f.actor('worker');await assert.rejects(f.call({...f.verify,expectedAttemptGeneration:3}),code('API_PICKUP_EXPIRED'));
  f.native.current=f.actor('other');await f.call({...f.verify,assignmentId:'retry'});await f.call({...f.report,assignmentId:'retry'});
  f.native.current=f.actor('head');await f.call({...f.accept,assignmentId:'retry'});
  assert.equal((await f.rows('SELECT status FROM tasks'))[0].status,'succeeded');
  assert.equal((await f.rows('SELECT * FROM task_acceptances'))[0].assignment_id,'retry');
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
 test('verified caller self-binding retains controller and displayed-generation checks',async t=>{
  const f=await setup(t);await f.approve();await f.call(f.fresh);
  f.native.current=f.actor('outsider');await assert.rejects(f.bind('head','outsider'),code('API_CONTROLLER_REQUIRED'));
  f.native.current=f.actor('controller');await f.bind('head','controller');
  assert.equal((await f.call({type:'inspectCaller'})).result.member.member_id,'head');
  const command={type:'bindMember',teamId:'team',memberId:'head',expectedConfigVersion:7,expectedMemberGeneration:1,expectedBindingGeneration:1,expectedControllerGeneration:1};
  for(const field of ['expectedConfigVersion','expectedMemberGeneration','expectedBindingGeneration','expectedControllerGeneration']){
   await assert.rejects(f.call({...command,[field]:99},{target:'controller'}),code('API_STALE_AUTHORITY'));
  }
  assert.equal(Number((await f.rows("SELECT generation FROM member_bindings WHERE member_id='head'"))[0].generation),1);
 });
 test('workspace discovery exposes approved teams and only the current member task boundary',async t=>{
  const f=await setup(t);await f.ready();
  f.native.current=f.actor('controller');
  await f.call({...f.fresh,teamId:'second-team',name:'Second',members:[{memberId:'second-head',name:'Second head',bossMemberId:null,role:'Review',officialText:'Second head role'}]});
  assert.deepEqual((await f.call({type:'inspectCaller'})).result.teams.map(t=>t.team_id).sort(),['second-team','team']);
  assert.equal((await f.call({type:'inspectTeam',teamId:'team'})).result.work.length,0);
  f.native.current=f.actor('outsider');
  assert.deepEqual((await f.call({type:'inspectCaller'})).result.teams,[]);
  await assert.rejects(f.call({type:'inspectTeam',teamId:'team'}),code('API_BINDING_REQUIRED'));
  for(const [who,count] of [['head',1],['worker',1],['other',0]]){
   f.native.current=f.actor(who);
   assert.deepEqual((await f.call({type:'inspectCaller'})).result.teams.map(t=>t.team_id),['team']);
   await assert.rejects(f.call({type:'inspectTeam',teamId:'second-team'}),code('API_MEMBER_SCOPE'));
   const result=(await f.call({type:'inspectTeam',teamId:'team'})).result;
   assert.equal(result.work.length,count);
   if(count)assert.equal(result.work[0].brief.expected_result,'5 with evidence');
  }
  f.native.current={...f.actor('head'),incarnationId:'replaced'};
  await assert.rejects(f.call({type:'inspectTeam',teamId:'team'}),code('API_STALE_BINDING'));
  f.native.current=f.actor('head');
  await rawWrite(f,"UPDATE members SET boss_member_id='other' WHERE member_id='worker'");
  assert.equal((await f.call({type:'inspectTeam',teamId:'team'})).result.work.length,0);
 });
 test('failed fresh-team creation rolls back all roster and approval-independent changes',async t=>{
  const f=await setup(t);await f.approve();
  await assert.rejects(f.call({...f.fresh,members:[f.fresh.members[0],{...f.fresh.members[1],name:'Head'}]}),code('STORE_MEMBER_NAME_EXISTS'));
  assert.equal((await f.rows('SELECT * FROM teams')).length,0);
  assert.equal((await f.rows('SELECT * FROM members')).length,0);
  assert.equal((await f.rows('SELECT * FROM controller_approvals')).length,1);
 });
});
