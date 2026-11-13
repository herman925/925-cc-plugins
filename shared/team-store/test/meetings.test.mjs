import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {currentWakeEligibility} from '../src/wake-eligibility.mjs';
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:8,launch:'demand',batch:3,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
const code=c=>e=>e.code===`API_MEETING_${c}`;
for(const engine of ['sqlite','postgres'])describe(`${engine} durable meetings`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 async function setup(t,policy='joined'){
  const apis=[];t.after(async()=>{for(const a of apis)await a.close();});
  const f=await runtimeFixture(t,engine);
  const actor=id=>({projectRoot:f.root,machineId:'machine',provider:id==='worker'?'codex':'claude',conversationId:id,executionHostId:'local',contextId:'context',terminalHandle:`term-${id}`,incarnationId:`inc-${id}`});
  const native={current:actor('controller')};
  const open=async()=>{const api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.55'},authenticate:async()=>native.current,verifyTarget:async id=>actor(id),confirmController:async()=>true});apis.push(api);return api;};
  let api=await open();
  let n=0,generation=1;
  const base={teamId:'team',expectedConfigVersion:7,expectedMemberGeneration:1,expectedBindingGeneration:1};
  const exec=async command=>{const result=await api.execute({operationId:`meeting-op-${++n}`,command});if(result.result.meeting)generation=Number(result.result.meeting.generation);return result;};
  const call=(type,extra={})=>exec({...base,type,meetingId:'meeting',...(type==='createMeeting'?{}:{expectedMeetingGeneration:generation}),...extra});
  await api.approveController({operationId:'approve'});
  await exec({type:'createFreshTeam',teamId:'team',name:'Mixed',functionText:'Test',settings,expectedControllerGeneration:1,members:['head','worker','other'].map(id=>({memberId:id,name:id,bossMemberId:id==='head'?null:'head',role:id,officialText:`${id} role`,cli:id==='worker'?'codex':'claude'}))});
  for(const id of ['head','worker','other'])await api.execute({operationId:`bind-${id}`,command:{...base,type:'bindMember',memberId:id,expectedBindingGeneration:0,expectedControllerGeneration:1},target:id});
  native.current=actor('head');
  const create=()=>call('createMeeting',{title:'Review',startPolicy:policy,participantIds:['head','worker'],topics:[{title:'Evidence',requiredMemberIds:['worker']},{title:'Follow-up',requiredMemberIds:[]}],lineLimit:25,roundLimit:2});
  const join=()=>call('respondMeeting',{response:'joined',checkpoint:'Current atomic step finished; no assignment was changed.'});
  const inspect=()=>exec({type:'inspectMeeting',teamId:'team',meetingId:'meeting'});
  const ready=async()=>{await create();await join();await call('startMeeting');native.current=actor('worker');await join();};
  const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
  return {...f,native,actor,base,call,exec,create,join,inspect,ready,rows,open,get api(){return api;},get generation(){return generation;},restart:async()=>{await api.close();api=await open();}};
 }
 test('mixed-provider participation survives adapter restart, requires actual input, and closes with separately reviewed minutes',async t=>{
  const f=await setup(t);await f.ready();
  f.native.current=f.actor('head');await assert.rejects(f.call('advanceMeeting',{disposition:'discussed',resolution:'Done'}),code('INPUT_REQUIRED'));
  f.native.current=f.actor('worker');await f.call('contributeMeeting',{contributionId:'own',body:'I verified the evidence.'});
  const before=(await f.inspect()).result;await f.restart();assert.deepEqual((await f.inspect()).result,before);
  await f.call('proposeMeetingOutput',{outputId:'minutes',ownerMemberId:'head',outputKind:'minutes',body:'Worker verified evidence. Follow-up deferred.'});
  await assert.rejects(f.call('reviewMeetingOutput',{outputId:'minutes',decision:'accepted',note:'Self approve'}),code('CHAIR_REQUIRED'));
  f.native.current=f.actor('head');await f.call('advanceMeeting',{disposition:'discussed',resolution:'Evidence reviewed'});
  await f.call('advanceMeeting',{disposition:'deferred',resolution:'Schedule follow-up after research'});
  await assert.rejects(f.call('closeMeeting'),code('MINUTES_REQUIRED'));
  await f.call('reviewMeetingOutput',{outputId:'minutes',decision:'accepted',note:'Matches transcript and explicit deferral.'});
  assert.equal((await f.call('closeMeeting')).result.meeting.status,'closed');
  await assert.rejects(f.call('contributeMeeting',{contributionId:'late',body:'Late'}),code('STATE'));
  assert.equal((await f.rows('SELECT * FROM tasks')).length,0);
  assert.deepEqual((await f.rows('SELECT allow_agent,allow_write FROM members')).map(m=>[Number(m.allow_agent),Number(m.allow_write)]),[[0,0],[0,0],[0,0]]);
 });
 test('all-attendee policy waits; only the native recipient can respond, without head impersonation',async t=>{
  const f=await setup(t,'all');await f.create();await f.join();
  await assert.rejects(f.call('startMeeting'),code('WAITING'));
  await assert.rejects(f.call('respondMeeting',{response:'joined',checkpoint:'Pretend worker'}),code('RESPONSE_RECORDED'));
  f.native.current=f.actor('worker');await f.join();f.native.current=f.actor('head');assert.equal((await f.call('startMeeting')).result.meeting.status,'active');
 });
 test('limits, one extension, explicit deferral, outsider isolation and immutable contributions',async t=>{
  const f=await setup(t);await f.ready();
  await assert.rejects(f.call('contributeMeeting',{contributionId:'too-long',body:Array(26).fill('line').join('\n')}),code('LIMIT'));
  for(const id of ['one','two'])await f.call('contributeMeeting',{contributionId:id,body:id});
  await assert.rejects(f.call('contributeMeeting',{contributionId:'third',body:'third'}),code('LIMIT'));
  f.native.current=f.actor('head');await f.call('extendMeeting');await assert.rejects(f.call('extendMeeting'),code('LIMIT'));
  f.native.current=f.actor('worker');await f.call('contributeMeeting',{contributionId:'third',body:'third'});
  await assert.rejects(rawWrite(f,"UPDATE meeting_contributions SET body='forged'"));
  f.native.current=f.actor('other');await assert.rejects(f.inspect(),code('PARTICIPANT_REQUIRED'));
  f.native.current=f.actor('head');const r=await f.call('advanceMeeting',{disposition:'deferred',resolution:'Required participant unavailable'});assert.equal(r.result.topics[0].state,'deferred');
 });
 test('stable receipts recover exactly once and stale generations refuse a second writer',async t=>{
  const f=await setup(t);await f.ready();
  const command={...f.base,type:'contributeMeeting',meetingId:'meeting',expectedMeetingGeneration:f.generation,contributionId:'once',body:'one contribution'};
  const request={operationId:'stable',command};const result=await f.api.execute(request);
  assert.deepEqual(await f.api.reconcile(request),result);assert.deepEqual(await f.api.execute(request),result);
  await assert.rejects(f.api.execute({operationId:'stale',command:{...command,contributionId:'duplicate'}}),code('STALE'));
  assert.equal((await f.rows('SELECT * FROM meeting_contributions')).length,1);
  f.native.current=f.actor('other');await assert.rejects(f.api.reconcile(request),e=>e.code==='STORE_IDEMPOTENCY_CONFLICT');
 });
 test('reviewed role/action proposals remain records and never grant permission or create assignments',async t=>{
  const f=await setup(t);await f.ready();
  for(const kind of ['role','action'])await f.call('proposeMeetingOutput',{outputId:kind,ownerMemberId:'worker',outputKind:kind,body:'Proposal only'});
  f.native.current=f.actor('head');for(const outputId of ['role','action'])await f.call('reviewMeetingOutput',{outputId,decision:'accepted',note:'Accepted follow-up; execute through normal approval and task APIs.'});
  assert.equal((await f.rows('SELECT * FROM assignments')).length,0);assert.equal((await f.rows("SELECT official_text FROM role_documents WHERE member_id='worker'"))[0].official_text,'worker role');
 });
 test('notification preview and wake reservation never acknowledge another recipient',async t=>{
  const f=await setup(t);await f.create();
  const first=(await f.exec({...f.base,type:'prepareDeliveries'})).result.deliveries.find(d=>d.recipient.member_id==='worker');
  assert.equal((await currentWakeEligibility(f.api,'team',first)).eligible,true);
  await f.join();
  assert.equal((await currentWakeEligibility(f.api,'team',first)).reason,'meeting-notification-read-or-superseded');
  await f.exec({...f.base,type:'prepareDeliveries'});
  assert.equal((await f.rows('SELECT read_at_ms FROM meeting_notifications')).every(n=>n.read_at_ms===null),true);
  f.native.current=f.actor('worker');const team=(await f.exec({type:'inspectTeam',teamId:'team'})).result;
  assert.equal(team.meetingNotifications.length,1);const notice=team.meetingNotifications[0];
  f.native.current=f.actor('head');await f.call('acknowledgeMeetingNotification',{notificationGeneration:Number(notice.generation)});
  assert.equal((await f.rows("SELECT read_at_ms FROM meeting_notifications WHERE recipient_member_id='worker'")).every(n=>n.read_at_ms===null),true);
  f.native.current=f.actor('worker');await f.call('acknowledgeMeetingNotification',{notificationGeneration:Number(notice.generation)});
  assert.equal((await f.exec({type:'inspectTeam',teamId:'team'})).result.meetingNotifications.length,0);
  assert.equal((await f.rows("SELECT read_at_ms FROM meeting_notifications WHERE recipient_member_id='worker' AND generation=1"))[0].read_at_ms,null);
 });
 test('two independent clients racing one generation record at most one contribution',async t=>{
  const f=await setup(t);await f.ready();const second=await f.open();
  const command={...f.base,type:'contributeMeeting',meetingId:'meeting',expectedMeetingGeneration:f.generation,body:'Concurrent contribution'};
  const results=await Promise.allSettled([f.api.execute({operationId:'client-a',command:{...command,contributionId:'client-a'}}),second.execute({operationId:'client-b',command:{...command,contributionId:'client-b'}})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await f.rows('SELECT * FROM meeting_contributions')).length,1);
 });
 test('a reviewed proposal and resolved topic cannot be rewritten, including by SQL replacement',async t=>{
  const f=await setup(t);await f.ready();await f.call('proposeMeetingOutput',{outputId:'out',ownerMemberId:'worker',outputKind:'role',body:'Original proposal'});
  f.native.current=f.actor('head');await f.call('reviewMeetingOutput',{outputId:'out',decision:'accepted',note:'Record only'});
  await assert.rejects(rawWrite(f,"UPDATE meeting_outputs SET body='Rewritten'"));
  await assert.rejects(rawWrite(f,"UPDATE meeting_outputs SET state='rejected',review_note='Rewrite decision'"));
  await f.call('advanceMeeting',{disposition:'deferred',resolution:'Original reason'});
  await assert.rejects(rawWrite(f,"UPDATE meeting_topics SET resolution='Rewritten' WHERE topic_index=0"));
  await f.call('cancelMeeting');await assert.rejects(rawWrite(f,"UPDATE meetings SET status='inviting',ended_at_ms=NULL"));
  await assert.rejects(rawWrite(f,'DELETE FROM meeting_outputs'));
  if(engine==='sqlite')await assert.rejects(rawWrite(f,'INSERT OR REPLACE INTO meeting_outputs SELECT * FROM meeting_outputs'));
 });
 test('native incarnation changes invalidate meeting reads and old effect receipts',async t=>{
  const f=await setup(t);await f.ready();const request={operationId:'own-contribution',command:{...f.base,type:'contributeMeeting',meetingId:'meeting',expectedMeetingGeneration:f.generation,contributionId:'own',body:'Recorded before rebind'}};
  await f.api.execute(request);await rawWrite(f,"UPDATE member_bindings SET incarnation_id='new-process',generation=generation+1 WHERE member_id='worker'");
  await assert.rejects(f.inspect(),e=>e.code==='API_STALE_BINDING');await assert.rejects(f.api.reconcile(request),e=>e.code==='API_STALE_BINDING');
 });
 test('line limits cover all contributions by a member, rather than resetting for every message or topic',async t=>{
  const f=await setup(t);await f.ready();await f.call('contributeMeeting',{contributionId:'budget',body:Array(24).fill('line').join('\n')});
  await assert.rejects(f.call('contributeMeeting',{contributionId:'over-budget',body:'extra\nextra'}),code('LIMIT'));
  f.native.current=f.actor('head');await f.call('advanceMeeting',{disposition:'discussed',resolution:'Complete'});
  f.native.current=f.actor('worker');await assert.rejects(f.call('contributeMeeting',{contributionId:'next-topic-over-budget',body:'extra\nextra'}),code('LIMIT'));
  await f.call('contributeMeeting',{contributionId:'remaining-line',body:'last line'});
 });
 test('controller approval cannot recover private meeting summaries after losing the member binding',async t=>{
  const f=await setup(t);await f.ready();await f.api.approveController({operationId:'worker-controller'});
  const request={operationId:'private-team',command:{type:'inspectTeam',teamId:'team'}};
  const receipt=await f.api.execute(request);assert.equal(receipt.result.meetings.length,1);
  await rawWrite(f,"DELETE FROM member_bindings WHERE member_id='worker'");
  const current=await f.api.reconcile(request);
  assert.equal(current.readOnly,true);assert.deepEqual(current.result.meetings,[]);assert.deepEqual(current.result.work,[]);
  await assert.rejects(f.inspect(),e=>e.code==='API_BINDING_REQUIRED');
 });

});
