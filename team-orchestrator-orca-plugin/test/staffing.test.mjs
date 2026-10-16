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
 const next=f.store.prepareOperation({...added.launch,requestId:'next-work-preparation'},{scope,nativeRequest:nativeLaunchIntent(team,member,scope),roleVersion:1,title:member.name,executionHostId:'local',runtimeId:'runtime-one'});assert.equal(next.fresh,true);assert.equal(next.operation.instanceGeneration,2);
});
import {createHierarchyService} from '../src/local/hierarchy.mjs';
test('lower manager genuine Run proposes a direct child and receives the versioned roster under that same parent',async t=>{
 const f=await questionFixture(t,{formOverrides:{structure:'organisation',levels:3,fan:4,groups:'One, Two'}}),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n')[1]));});await dispatch.check(f.work.id);f.onInput(()=>{});f.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN depth INTEGER DEFAULT 1');
 const hierarchy=createHierarchyService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await hierarchy.check(f.work.id);let child=f.store.listRunWorks(f.work.id).find(w=>w.supervisorMemberId===f.member.id);
 f.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-manager',child.nativeObjective,'this_database',null,null,'claude_child',1,1,0);await hierarchy.check(f.work.id);child=f.store.readCurrentWork(child.id);await dispatch.check(child.id);
 const p=f.store.readDispatchProtocol(child.id),spec=JSON.stringify({protocol:'team-questions/v1',kind:'staffing-proposal',workId:child.id,token:p.token,generation:1,appQuestionId:'lower-staffing',proposingManagerId:f.member.id,configVersion:1,roleVersion:1,member:{...memberInput(f),boss:f.member.id},rationale:'Department review',affectedTaskKeys:[]}),row={id:'lower-staffing-task',run_id:child.run.id,spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(row.id,row.run_id,spec,'ready',null,null,null,null,null);f.receipt('lower-staffing-receipt','orchestration.taskCreate',{spec,run:child.run.id,callerTerminalHandle:'orca_session_id:claude_child',__orcaCallerOrcaSessionId:'claude_child'},{task:row},true);
 await service(f).check(f.work.id);const proposal=f.store.listStaffingProposals(f.work.id)[0];assert.equal(proposal.proposingManagerId,f.member.id);assert.equal(proposal.contextId,child.id);
 const added=f.store.saveStaffing({requestId:'approve-lower',workId:f.work.id,proposalId:proposal.id,decision:'approve',expectedRevision:f.store.readSnapshot().revision,configVersion:1});await service(f).check(f.work.id);
 assert.equal(f.store.readOwningWork(f.work.id,added.memberId).id,child.id);assert.equal(f.store.effectiveTeamForWork(child.id).configVersion,2);
 const delta=f.store.listRosterDeltas(f.work.id).find(d=>d.supervisorMemberId===f.member.id);assert.equal(delta.contextId,child.id);assert.equal(delta.state,'accepted');assert.equal(delta.nativeSend.params.envelope.sessionId,'claude_child');
 const member=f.store.effectiveTeamForWork(child.id).members.find(m=>m.id===added.memberId),taskSpec=JSON.stringify({protocol:'team-dispatch/v1',workId:child.id,token:p.token,generation:1,taskKey:'review-new',memberId:member.id,configVersion:2,roleVersion:1,role:{brief:member.brief,habits:member.habits,collaboration:member.collaboration},instruction:'Review.',workerRules:WORKER_RULES,writeScope:[]}),task={id:'lower-new-task',run_id:child.run.id,spec:taskSpec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,task.spec,'ready',null,null,null,null,null);f.receipt('lower-new-task-receipt','orchestration.taskCreate',{spec:taskSpec,run:child.run.id,callerTerminalHandle:'orca_session_id:claude_child',__orcaCallerOrcaSessionId:'claude_child'},{task},true);await dispatch.check(child.id);
 const attempt=f.store.listDispatches(child.id)[0];assert.equal(attempt.memberId,added.memberId);assert.equal(attempt.supervisorMemberId,f.member.id);assert.equal(attempt.configVersion,2);assert.equal(attempt.permit.state,'accepted');
});
test('an unused department without a native Run does not permanently block closure after a roster amendment',async t=>{
 const f=await questionFixture(t,{formOverrides:{structure:'organisation',levels:3,fan:4,groups:'One, Two'}});await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 f.store.saveStaffing({...direct(f),member:{...memberInput(f),boss:f.member.id}});await service(f).check(f.work.id);
 const headDelta=f.store.listRosterDeltas(f.work.id).find(d=>d.supervisorMemberId===f.team.members[0].id);publish(f,'roster-ack',{deltaId:headDelta.id,configVersion:2},{taskId:'unused-branch-ack'});await service(f).check(f.work.id);
 assert.deepEqual(f.store.staffingClosureBlockers(f.work.id),[]);assert.ok(f.store.listRosterDeltas(f.work.id).some(d=>d.state==='queued'&&d.processed==='unconfirmed'));
});

async function pendingProposal(t){
 const f=await questionFixture(t);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 publish(f,'staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:memberInput(f),rationale:'Optional independent review.',affectedTaskKeys:[]});await service(f).check(f.work.id);return f;
}
function acceptWork(f){
 f.store.recordDelivery(f.work.id,{id:'optional-staffing-delivery',summary:'Completed without optional staffing',evidenceRefs:['validated-results'],attemptIds:[],generation:1,proof:{requestId:'delivery-proof',payloadHash:'a'.repeat(64)}});
 return f.store.decideWork({requestId:'accept-optional-staffing',workId:f.work.id,deliveryId:'optional-staffing-delivery',expectedWorkVersion:f.store.readWork(f.work.id).version,decision:'accept'});
}
test('accepted closure expires optional pending staffing without inventing a user staffing decision',async t=>{
 const f=await pendingProposal(t),before=f.store.listStaffingProposals(f.work.id)[0],stale={requestId:'late-approve',workId:f.work.id,proposalId:before.id,decision:'approve',configVersion:1,expectedRevision:f.store.readSnapshot().revision};
 const second=await openTeamStore({userData:f.profile});t.after(()=>second.close());const decision=acceptWork(f),proposal=second.listStaffingProposals(f.work.id)[0];
 assert.equal(proposal.status,'expired');assert.deepEqual(proposal.expiry,{kind:'accepted-work-closure',workId:f.work.id,deliveryId:decision.deliveryId,decisionRequestId:decision.requestId,recordedAt:decision.recordedAt});
 assert.deepEqual({...proposal,status:'pending',expiry:undefined},{...before,expiry:undefined});assert.equal(proposal.decision,undefined);
 assert.throws(()=>second.saveStaffing(stale),/closed/);assert.throws(()=>second.saveStaffing({...stale,requestId:'late-reject',decision:'reject'}),/closed/);assert.equal(second.readSnapshot().teams[0].members.length,4);
 const preview=f.store.previewHistoryCleanup({selectedWorkIds:[f.work.id]});assert.deepEqual(preview.eligibleWorkIds,[f.work.id],JSON.stringify(preview.retained));
 f.store.applyHistoryCleanup({requestId:'clean-expired-staffing',previewToken:preview.previewToken,expectedStorageRevision:preview.storageRevision});assert.deepEqual(f.store.listStaffingProposals(f.work.id)[0],proposal);
});
test('reopening legacy accepted history reconciles only a proven original pending proposal',async t=>{
 const f=await pendingProposal(t),original=f.store.listStaffingProposals(f.work.id)[0];acceptWork(f);
 // A pre-fix store retained the original pending record across accepted closure.
 f.store.writeReceipt(`staffing-proposal:${f.work.id}:${original.id}`,original);
 await f.restart();const proposal=f.store.listStaffingProposals(f.work.id)[0];assert.equal(proposal.status,'expired');assert.deepEqual(proposal.proof,original.proof);assert.equal(proposal.fingerprint,original.fingerprint);
 assert.deepEqual(f.store.previewHistoryCleanup({selectedWorkIds:[f.work.id]}).eligibleWorkIds,[f.work.id]);const revision=f.store.readSnapshot().revision;
 await f.restart();assert.deepEqual(f.store.listStaffingProposals(f.work.id)[0],proposal);assert.equal(f.store.readSnapshot().revision,revision);
});
test('live pending proposals and unknown or unproven closed graphs retain their original decision protection',async t=>{
 for(const kind of ['live','unknown','missing-acceptance','changed-native-proof'])await t.test(kind,async t=>{
  const f=await pendingProposal(t),original=f.store.listStaffingProposals(f.work.id)[0],key=`staffing-proposal:${f.work.id}:${original.id}`;
  if(kind==='unknown')f.store.writeReceipt(key,{...original,status:'unknown'});
  if(kind==='changed-native-proof')f.store.writeReceipt(key,{...original,proof:{...original.proof,payloadHash:'different-native-proof'}});
  if(kind==='missing-acceptance'){
   const work=f.store.readWork(f.work.id);f.store.writeReceipt(`work:${work.id}`,{...work,status:'completed',closedAt:new Date().toISOString(),handoff:{summary:'Unproven closure',deliveryId:'unproven',evidenceRefs:[]}});
  }else if(kind!=='live')acceptWork(f);
  const before=f.store.listStaffingProposals(f.work.id)[0];await f.restart();assert.deepEqual(f.store.listStaffingProposals(f.work.id)[0],before);
  assert.equal(f.store.previewHistoryCleanup({selectedWorkIds:[f.work.id]}).eligibleWorkIds.length,0);
 });
});
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
test('a storage failure expiring the proposal rolls back the entire delivery acceptance',async t=>{
 const f=await pendingProposal(t);f.store.recordDelivery(f.work.id,{id:'optional-staffing-delivery',summary:'Ready',evidenceRefs:['validated-results'],attemptIds:[],generation:1,proof:{requestId:'delivery-proof',payloadHash:'a'.repeat(64)}});
 const db=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>db.close());
 db.exec("CREATE TRIGGER fail_expiry BEFORE UPDATE ON receipts WHEN NEW.id LIKE 'staffing-proposal:%' AND json_extract(NEW.json,'$.status')='expired' BEGIN SELECT RAISE(ABORT,'expiry disk full'); END");
 const before=f.store.readSnapshot(),input={requestId:'atomic-accept',workId:f.work.id,deliveryId:'optional-staffing-delivery',expectedWorkVersion:f.store.readWork(f.work.id).version,decision:'accept'};
 assert.throws(()=>f.store.decideWork(input),/expiry disk full/);assert.deepEqual(f.store.readSnapshot(),before);assert.equal(f.store.readWorkDecision(input.requestId),null);assert.equal(f.store.readMemberOperation(f.team.members[0].id).requestId,'launch');
 db.exec('DROP TRIGGER fail_expiry');f.store.decideWork(input);assert.equal(f.store.listStaffingProposals(f.work.id)[0].status,'expired');
});
test('expired proposal retains an unconfirmed display notification without reserving completed history',async t=>{
 const f=await questionFixture(t);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 publish(f,'staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:memberInput(f),rationale:'Optional review.',affectedTaskKeys:[]});
 await createStaffingService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{},notify:async()=>({delivered:false})}).check(f.work.id);
 const eventKey=`question-event:${f.work.id}:staffing-staffing-one`,event=f.store.readReceipt(eventKey);assert.equal(event.state,'unconfirmed');acceptWork(f);
 const preview=f.store.previewHistoryCleanup({selectedWorkIds:[f.work.id]});assert.deepEqual(preview.eligibleWorkIds,[f.work.id],JSON.stringify(preview.retained));assert.deepEqual(f.store.readReceipt(eventKey),event);
 f.store.updateQuestionEvent(f.work.id,event.id,{nativeSend:{method:'agentSession.send'}});assert.equal(f.store.previewHistoryCleanup({selectedWorkIds:[f.work.id]}).eligibleWorkIds.length,0);
});
