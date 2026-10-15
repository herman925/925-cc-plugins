import {readNativeDispatchEvidence} from '../src/local/native-dispatch.mjs';
import {WORKER_RULES} from '../src/dispatch.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionFixture} from './questions-fixture.mjs';
const memberInput=f=>({name:'Reviewer',boss:f.team.members[0].id,brief:'Review evidence.',habits:'',collaboration:'Report to direct manager.',agent:'claude',model:'default',effort:'default'});
const direct=f=>({requestId:'add-reviewer',workId:f.work.id,expectedRevision:f.store.readSnapshot().revision,configVersion:1,member:memberInput(f)});
test('user direct add atomically saves a fresh member, effective Work roster and pending delivery without launching',async t=>{
 const f=await questionFixture(t),before=f.calls.length,input=direct(f);
 const saved=f.store.saveStaffing(input),team=f.store.readSnapshot().teams[0];
 assert.equal(team.members.length,5);assert.equal(team.members.at(-1).id,saved.memberId);
 assert.match(saved.memberId,/^[a-f0-9-]{36}$/);assert.equal(team.members.at(-1).roleVersion,1);
 assert.equal(f.store.effectiveTeamForWork(f.work.id).configVersion,2);
 assert.equal(f.store.readWork(f.work.id).configVersion,1);
 assert.equal(f.store.readTeamVersion(team.id,1).members.length,4);
 assert.equal(f.store.listRosterDeltas(f.work.id)[0].state,'queued');
 assert.deepEqual(f.store.saveStaffing(input),saved);assert.equal(f.calls.length,before);
 assert.throws(()=>f.store.saveStaffing({...input,member:{...input.member,name:'Other'}}),/identity conflicts/i);
});
import {createStaffingService} from '../src/local/staffing.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
const publish=(f,kind,fields,{taskId='staffing-one',forged=false}={})=>{
 const p=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-questions/v1',workId:f.work.id,token:p.token,generation:1,appQuestionId:taskId,kind,...fields}),row={id:taskId,run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(taskId,'run-head',spec,'ready',null,null,null,null,null);
 f.receipt('create-'+taskId,'orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task:row},forged);
};
const service=f=>createStaffingService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
test('only native manager Task proof creates a pending proposal, with atomic approval deduplicated across panels',async t=>{
 const f=await questionFixture(t);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 publish(f,'staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:memberInput(f),rationale:'Need an independent review.',affectedTaskKeys:[]});
 publish(f,'staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:{...memberInput(f),name:'Forged'},rationale:'Forgery',affectedTaskKeys:[]},{taskId:'forged',forged:true});
 await service(f).check(f.work.id);assert.equal(f.store.listStaffingProposals(f.work.id).length,1);assert.equal(f.store.readSnapshot().teams[0].members.length,4);
 const input={...direct(f),proposalId:'staffing-one',decision:'approve'};delete input.member;
 const a=f.store.saveStaffing(input),b=f.store.saveStaffing({...input,requestId:'second-panel'});
 assert.equal(a.memberId,b.memberId);assert.equal(f.store.readSnapshot().teams[0].members.length,5);
 assert.equal(f.store.listStaffingProposals(f.work.id)[0].decision.from,'user');
 assert.throws(()=>f.store.saveStaffing({...input,requestId:'reject-after',decision:'reject'}),/already decided/i);
});
test('roster delivery is a versioned real user input; native accepted is separate from proven manager processing',async t=>{
 const f=await questionFixture(t);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 f.store.saveStaffing(direct(f));await service(f).check(f.work.id);
 const delta=f.store.listRosterDeltas(f.work.id)[0];assert.equal(delta.state,'accepted');assert.equal(delta.processed,'unconfirmed');
 const message=f.messages.find(v=>v.startsWith('TEAM_ROSTER_DELTA\n'));assert.ok(message);const body=JSON.parse(message.split('\n')[1]);
 assert.equal(body.configVersion,2);assert.equal(body.children.at(-1).name,'Reviewer');assert.equal(body.supervisorMemberId,f.team.members[0].id);
 publish(f,'roster-ack',{deltaId:delta.id,configVersion:2},{taskId:'roster-ack'});await service(f).check(f.work.id);
 assert.equal(f.store.listRosterDeltas(f.work.id)[0].processed,'confirmed');
 await service(f).check(f.work.id);assert.equal(f.messages.filter(v=>v.startsWith('TEAM_ROSTER_DELTA\n')).length,1);
});
test('new approved member receives normal direct-parent admission using effective version while earlier attempts retain provenance',async t=>{
 const f=await questionFixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await dispatch.check(f.work.id);
 f.store.saveStaffing(direct(f));await service(f).check(f.work.id);
 const member=f.store.effectiveTeamForWork(f.work.id).members.at(-1),p=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-dispatch/v1',workId:f.work.id,token:p.token,generation:1,taskKey:'new-member-task',memberId:member.id,configVersion:2,roleVersion:1,role:{brief:member.brief,habits:member.habits,collaboration:member.collaboration},instruction:'Review findings.',workerRules:WORKER_RULES,writeScope:[]}),row={id:'new-member-task',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.run_id,spec,'ready',null,null,null,null,null);f.receipt('create-new-member','orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task:row});
 await dispatch.check(f.work.id);const attempts=f.store.listDispatches(f.work.id);
 assert.equal(attempts.length,2);assert.equal(attempts[0].configVersion,1);assert.equal(attempts[1].configVersion,2);assert.equal(attempts[1].permit.state,'accepted');
});
test('role changes advance the approved effective version for future tasks without changing old role history',async t=>{
 const f=await questionFixture(t);f.store.saveStaffing(direct(f));const before=f.store.readSnapshot();
 f.store.updateRole({requestId:'role-update',expectedRevision:before.revision,teamId:f.team.id,memberId:f.member.id,brief:'New review policy',habits:'',collaboration:''});
 assert.equal(f.store.effectiveTeamForWork(f.work.id).configVersion,3);assert.equal(f.store.effectiveTeamForWork(f.work.id).members.find(m=>m.id===f.member.id).roleVersion,2);assert.notEqual(f.store.readRoleVersion(f.member.id,1).brief,'New review policy');assert.equal(f.store.readWork(f.work.id).configVersion,1);
});
test('unknown roster delivery survives restart without another native send or member allocation',async t=>{
 const f=await questionFixture(t);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 f.store.saveStaffing(direct(f));f.onInput(text=>{if(text.startsWith('TEAM_ROSTER_DELTA'))throw Error('Lost receipt');});await service(f).check(f.work.id);assert.equal(f.store.listRosterDeltas(f.work.id)[0].state,'unknown');await f.restart();await service(f).check(f.work.id);assert.equal(f.messages.filter(t=>t.startsWith('TEAM_ROSTER_DELTA')).length,1);assert.equal(f.store.readSnapshot().teams[0].members.length,5);
});
test('invalid parent, stale configuration and closed Work cannot add; rejected proposal retains user evidence',async t=>{
 const f=await questionFixture(t);assert.throws(()=>f.store.saveStaffing({...direct(f),member:{...memberInput(f),boss:null}}),/direct manager/);
 await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 publish(f,'staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:memberInput(f),rationale:'Review.',affectedTaskKeys:[]});await service(f).check(f.work.id);
 const input={...direct(f),proposalId:'staffing-one',decision:'reject'};delete input.member;f.store.saveStaffing(input);assert.equal(f.store.listStaffingProposals(f.work.id)[0].status,'rejected');assert.equal(f.store.readSnapshot().teams[0].members.length,4);
 assert.throws(()=>f.store.saveStaffing({...direct(f),requestId:'stale-add',configVersion:99}),/configuration changed/);
 f.store.updateWork(f.work.id,f.store.readWork(f.work.id).version,{status:'completed'});assert.throws(()=>f.store.saveStaffing({...direct(f),requestId:'closed-add'}),/closed/);
});
import {openTeamStore} from '../src/local/store.mjs';
import {nativeLaunchIntent,publicOperation} from '../src/local/native-launch.mjs';
test('two independent SQLite panel connections confirm one proposal to one fresh member',async t=>{
 const f=await questionFixture(t);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 publish(f,'staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:memberInput(f),rationale:'Review.',affectedTaskKeys:[]});await service(f).check(f.work.id);
 const second=await openTeamStore({userData:f.profile});t.after(()=>second.close());const input={requestId:'panel-a',workId:f.work.id,proposalId:'staffing-one',decision:'approve',configVersion:1,expectedRevision:f.store.readSnapshot().revision};
 const a=f.store.saveStaffing(input),b=second.saveStaffing({...input,requestId:'panel-b'});assert.equal(a.memberId,b.memberId);assert.equal(second.readSnapshot().teams[0].members.length,5);
});
test('full-mode added preparation is included in closure and its exact reservation retires only after roster processing',async t=>{
 const f=await questionFixture(t,{formOverrides:{launchMode:'all'}});await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 const added=f.store.saveStaffing(direct(f)),team=f.store.effectiveTeamForWork(f.work.id),member=team.members.at(-1),scope=f.store.readScope(team.id);
 assert.ok(f.store.workClosureBlockers(f.work.id).some(s=>s.includes('preparation')));
 const operation=f.store.prepareOperation(added.launch,{scope,nativeRequest:nativeLaunchIntent(team,member,scope),roleVersion:1,title:member.name,executionHostId:'local',runtimeId:'runtime-one'}).operation;
 const patch={status:'created',kind:'structured',sessionId:'new-reviewer-session',handle:'new-reviewer-handle',briefAccepted:true};f.store.settleOperation(operation.requestId,operation.nativeRequest.operationId,{...patch,public:publicOperation({...operation,...patch})});
 await service(f).check(f.work.id);const delta=f.store.listRosterDeltas(f.work.id)[0];assert.ok(f.store.workClosureBlockers(f.work.id).some(s=>s.includes('manager processing')));
 publish(f,'roster-ack',{deltaId:delta.id,configVersion:2},{taskId:'closure-roster-ack'});await service(f).check(f.work.id);
 const native=await readNativeDispatchEvidence(f.profile,{work:f.store.readCurrentWork(f.work.id),protocol:f.store.readDispatchProtocol(f.work.id),team,owner:(await f.works.verifyWork(f.work.id)).instance});assert.deepEqual(native.unmanaged,[]);
 f.store.recordDelivery(f.work.id,{id:'delivery',previousDeliveryId:null,summary:'Ready',evidenceRefs:['validation'],attemptIds:[],generation:1,supervisorMemberId:f.team.members[0].id,proof:{requestId:'delivery-proof',payloadHash:'fixture'}});
 f.store.decideWork({requestId:'accept-staffed-work',workId:f.work.id,deliveryId:'delivery',expectedWorkVersion:f.store.readWork(f.work.id).version,decision:'accept'});
 assert.equal(f.store.readWork(f.work.id).status,'completed');assert.equal(f.store.readMemberOperation(member.id),null);assert.equal(f.store.readSnapshot().teams[0].members.length,5);
});
