import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {access} from 'node:fs/promises';
import {createTeamApi} from '../api.mjs';
import {createCodexObserver} from '../src/codex-observer.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';

const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:2,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:60000,exemptMemberIds:[]};
async function fixture(t,engine,observerOptions={}){
 const {apiDecorator=api=>api,...rest}=observerOptions;
 const cleanups=[];t.after(async()=>{for(const close of cleanups)await close();});
 const f=await runtimeFixture(t,engine);
 const actor=id=>({projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:id,executionHostId:'local',contextId:'context',terminalHandle:`term-${id}`,incarnationId:`inc-${id}`});
 const current={actor:actor('head')},metadata={threadId:'head'},wake=[];
 const api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>current.actor,confirmController:async()=>true,confirmManagement:async()=>true,verifyTarget:async target=>actor(target.conversationId)});
 cleanups.push(()=>api.close());
 await api.approveController({operationId:'approve'});
 await api.manageTeam({operationId:'create',command:{type:'createFreshTeam',teamId:'team',name:'Observer',functionText:'Observer acceptance',settings,members:[{memberId:'head',name:'Head',bossMemberId:null,role:'Coordinate',officialText:'Review outcomes.',cli:'codex'},{memberId:'worker',name:'Worker',bossMemberId:'head',role:'Verify',officialText:'Read admitted work.',cli:'codex'}],expectedControllerGeneration:1}});
 for(const id of ['head','worker'])await api.manageTeam({operationId:`bind-${id}`,command:{type:'bindMember',teamId:'team',memberId:id,expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:0,expectedControllerGeneration:1},target:{projectRoot:f.root,conversationId:id,terminalHandle:`term-${id}`,contextId:'context'}});
 const authority={teamId:'team',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:1};
 await api.execute({operationId:'admit',command:{...authority,type:'admitAssignment',runId:'run',taskId:'task',assignmentId:'assignment',memberId:'worker',instructions:'Return 2 + 3.',expectedResult:'5',expectedTargetGeneration:1,expectedTargetBindingGeneration:1}});
 const observedReservations=new WeakSet();
 const native={verifyCaller:async supplied=>{assert.deepEqual(supplied,metadata);return {...current.actor};},wake:async deliveries=>{for(const delivery of deliveries)if(!observedReservations.has(delivery)){observedReservations.add(delivery);wake.push(delivery);}return deliveries.map(()=>({queued:true}));}};
 const observer=createCodexObserver({native,writer:SHARED_WRITER,timers:clock(),createApi:async options=>apiDecorator(await createTeamApi({...options,...f.options})),...rest});
 cleanups.unshift(()=>observer.close());
 const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
 return {...f,api,actor,current,metadata,wake,native,observer,rows};
}
function clock(){
 let now=0,serial=0;const pending=new Map();
 return {setTimeout(callback,delay){const id=++serial;pending.set(id,{callback,at:now+delay});return id;},clearTimeout(id){pending.delete(id);},async advance(delay){const end=now+delay;for(;;){const next=[...pending].filter(([,item])=>item.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;pending.delete(next[0]);await next[1].callback();}now=end;}};
}
for(const engine of ['sqlite','postgres'])describe(`${engine} Codex observation`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 test('an idle team produces no durable polling receipts after its recipient reads the mail',async t=>{
  const f=await fixture(t,engine);f.current.actor=f.actor('worker');
  const [delivery]=await f.rows('SELECT * FROM deliveries');
  await f.api.execute({operationId:'settled-for-idle',command:{type:'readInbox',teamId:'team',deliveryId:delivery.delivery_id,expectedDeliveryGeneration:Number(delivery.generation),expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:1}});
  f.current.actor=f.actor('head');f.observer.activate(f.metadata,f.current.actor);
  const before=(await f.rows('SELECT count(*) AS n FROM operations'))[0].n;
  for(let i=0;i<20;i++)await f.observer.pump();
  assert.equal((await f.rows('SELECT count(*) AS n FROM operations'))[0].n,before);
  assert.equal(f.observer.status().state,'active');
 });
 test('an unbound native conversation waits without expiring another member work',async t=>{
  const f=await fixture(t,engine);await rawWrite(f,'UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1');
  f.current.actor=f.actor('unbound');f.observer.activate(f.metadata,f.current.actor);await f.observer.pump();
  assert.equal(f.observer.status().state,'waiting-for-member');assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,0);assert.equal(f.wake.length,0);
 });
 test('a lost reservation reply is reconciled before attention is sent, without reserving it twice',async t=>{
  let lost=false,operationId;
  const f=await fixture(t,engine,{apiDecorator:api=>({...api,execute:async request=>{
   const answer=await api.execute(request);
   if(request.command.type==='prepareDeliveries'&&!lost){lost=true;operationId=request.operationId;throw Object.assign(Error('Lost committed reply'),{code:'STORE_COMMIT_UNKNOWN'});}
   return answer;
  }})});
  f.observer.activate(f.metadata,f.current.actor);
  await assert.rejects(f.observer.pump(),{code:'STORE_COMMIT_UNKNOWN'});assert.equal(f.wake.length,0);
  await f.observer.pump();
  assert.ok(operationId);assert.equal(f.wake.length,1);
  const [delivery]=await f.rows('SELECT status,replay_count FROM deliveries');
  assert.equal(Number(delivery.replay_count),1);assert.equal(delivery.status,'outstanding');
 });
 test('lead status reports blocked wake delivery separately from an active observer and marks old observations stale',async t=>{
  const f=await fixture(t,engine);
  f.native.wake=async(deliveries,metadata,context)=>{
   assert.equal(context.teamId,'team');assert.equal(typeof context.api.inspectWake,'function');
   return deliveries.map(()=>({state:'host-update-required',observedAt:Date.now()}));
  };
  f.observer.activate(f.metadata,f.current.actor);await f.observer.pump();
  const status=f.observer.status();assert.equal(status.state,'active');assert.equal(status.wakeReceipts[0].state,'host-update-required');assert.equal(status.wakeObservationsStale,false);
  await f.observer.close();assert.equal(f.observer.status().wakeObservationsStale,true);
 });
 test('a lost reservation remains recoverable after a valid team configuration edit',async t=>{
  let lost=false;
  const f=await fixture(t,engine,{apiDecorator:api=>({...api,execute:async request=>{const result=await api.execute(request);if(request.command.type==='prepareDeliveries'&&!lost){lost=true;throw Object.assign(Error('Lost reply'),{code:'STORE_COMMIT_UNKNOWN'});}return result;}})});
  f.observer.activate(f.metadata,f.current.actor);await assert.rejects(f.observer.pump(),{code:'STORE_COMMIT_UNKNOWN'});
  await f.api.manageTeam({operationId:'edit-after-lost',command:{type:'editTeam',teamId:'team',expectedControllerGeneration:1,expectedConfigVersion:5,changes:[{type:'updateTeam',name:'Still observer',functionText:'Updated purpose'}]}});
  await f.observer.pump();assert.equal(f.wake.length,1);assert.equal(f.observer.status().state,'active');
 });
 test('repeated observation preserves unread mail and lets only its recipient acknowledge it',async t=>{
  const f=await fixture(t,engine);f.observer.activate(f.metadata,f.current.actor);
  await f.observer.pump();await f.observer.pump();assert.equal(f.wake.length,1);
  await rawWrite(f,'UPDATE deliveries SET last_replayed_at_ms=last_replayed_at_ms-60001');
  await f.observer.pump();assert.equal(f.wake.length,2);assert.equal(f.wake[1].replay,true);
  const [delivery]=await f.rows('SELECT * FROM deliveries');assert.equal(delivery.status,'outstanding');
  const request={operationId:'recipient-read',command:{type:'readInbox',teamId:'team',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:1,deliveryId:delivery.delivery_id,expectedDeliveryGeneration:Number(delivery.generation)}};
  await assert.rejects(f.api.execute(request),{code:'API_INBOX_ORDER'});
  f.current.actor=f.actor('worker');await f.api.execute(request);
  assert.equal((await f.rows('SELECT status FROM deliveries'))[0].status,'acknowledged');
 });
 test('overlapping passes share one reservation and shutdown drains the pending native send',async t=>{
  const timers=clock(),f=await fixture(t,engine,{timers});
  let release,entered;const atWake=new Promise(resolve=>entered=resolve),blocked=new Promise(resolve=>release=resolve);
  f.native.wake=async deliveries=>{f.wake.push(...deliveries);entered();await blocked;};
  f.observer.activate(f.metadata,f.current.actor);
  const first=f.observer.pump();await atWake;const second=f.observer.pump();assert.equal(first,second);
  let stopped=false;const closing=f.observer.close().then(()=>stopped=true);
  await Promise.resolve();assert.equal(stopped,false);release();await Promise.all([first,second,closing]);
  assert.equal(f.wake.length,1);await timers.advance(90000);assert.equal(f.wake.length,1);assert.equal(f.observer.status().state,'stopped');
 });
 test('Codex mutations return their receipt before deferred observation and status reports the active loop',async t=>{
  const timers=clock(),f=await fixture(t,engine,{timers});
  const adapter=await createCodexAdapter({}, {createIdentity:async()=>f.native,createApi:options=>createTeamApi({...options,...f.options}),createObserver:options=>createCodexObserver({...options,timers})});
  t.after(()=>adapter.close());
  const status=await adapter.call('shared_team_status',{},f.metadata);assert.equal(status.observation.state,'scheduled');
  const receipt=await adapter.call('shared_team',{operationId:'explicit-observe',command:{type:'observeDeadlines',teamId:'team',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:1}},f.metadata);
  assert.equal(receipt.operationId,'explicit-observe');assert.equal(f.wake.length,0);
  await timers.advance(1);assert.equal(f.wake.length,1);
  assert.equal((await adapter.call('shared_team_status',{},f.metadata)).observation.state,'active');
  await adapter.close();await timers.advance(60000);assert.equal(f.wake.length,1);
 });
 test('an active Codex observer expires missed pickups once and leaves notification ownership with recipients',async t=>{
  const f=await fixture(t,engine);
  await rawWrite(f,'UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1');
  f.observer.activate(f.metadata,f.current.actor);
  await f.observer.pump();await f.observer.pump();
  assert.equal((await f.rows('SELECT returned_to_member_id FROM assignments'))[0].returned_to_member_id,'head');
  assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,1);
  const notices=await f.rows('SELECT * FROM deadline_notices');assert.equal(notices.length,1);assert.equal(notices[0].read_at_ms,null);
  assert.ok(f.wake.some(item=>item.noticeId===notices[0].notice_id));
 });
 test('the periodic loop observes idle work without another tool call and stops when closed',async t=>{
  const timers=clock(),f=await fixture(t,engine,{timers});
  await rawWrite(f,'UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1');
  f.observer.activate(f.metadata,f.current.actor);
  await timers.advance(29999);assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,0);
  await timers.advance(1);assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,1);
  await f.observer.close();const count=f.wake.length;await timers.advance(90000);assert.equal(f.wake.length,count);
 });
 test('a changed native identity suspends automatic observation until a fresh verified activation',async t=>{
  const timers=clock(),f=await fixture(t,engine,{timers}),original={...f.current.actor};
  await rawWrite(f,'UPDATE assignments SET pickup_deadline_ms=admitted_at_ms+1');
  f.observer.activate(f.metadata,original);f.current.actor={...original,incarnationId:'different-native-process'};
  await timers.advance(30000);assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,0);
  f.current.actor=original;await timers.advance(60000);
  assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,0);
  assert.equal(f.observer.status().state,'suspended');
  f.observer.activate(f.metadata,original);assert.equal(f.observer.status().lastFailure.code,'API_OBSERVER_SCOPE_CHANGED');await timers.advance(30000);
  assert.equal((await f.rows('SELECT * FROM assignment_returns')).length,1);
  assert.equal(f.observer.status().lastError,null);
  assert.equal(f.observer.status().lastFailure,null,'verified recovery clears the previous failure rather than reporting it as current');
 });
});
test('observation never creates a missing SQLite store',async t=>{
 const f=await runtimeFixture(t,'sqlite'),actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'native',executionHostId:'local',contextId:'context',terminalHandle:'terminal',incarnationId:'incarnation'},metadata={threadId:'native'};
 const observer=createCodexObserver({timers:clock(),native:{verifyCaller:async()=>actor,wake:async()=>assert.fail('No notification without a store')}});t.after(()=>observer.close());
 observer.activate(metadata,actor);await assert.rejects(observer.pump(),{code:'STORE_NOT_FOUND'});
 assert.equal(observer.status().state,'waiting-for-store');await assert.rejects(access(f.path),{code:'ENOENT'});
});
