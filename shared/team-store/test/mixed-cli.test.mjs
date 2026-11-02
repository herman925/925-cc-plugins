import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';

const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:8,launch:'demand',batch:3,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
const code=expected=>error=>error.code===expected;
for(const engine of ['sqlite','postgres'])for(const headProvider of ['codex','claude'])test(`${engine}: ${headProvider} head coordinates the other CLI through recipient-owned delivery and separate acceptance`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 let api;t.after(()=>api?.close());
 const f=await runtimeFixture(t,engine),workerProvider=headProvider==='codex'?'claude':'codex';
 const actor=(provider,name)=>({projectRoot:f.root,machineId:'machine',provider,conversationId:name,executionHostId:'local',contextId:'context',terminalHandle:`${provider}-${name}`,incarnationId:`${provider}-${name}-incarnation`});
 const head=actor(headProvider,'same-id'),worker=actor(workerProvider,'same-id');
 let current=head;
 api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.54'},authenticate:async()=>current,verifyTarget:async name=>name==='head'?head:worker,confirmController:async({approval})=>approval==='fixture-native-user-action'});
 let n=0;const call=command=>api.execute({operationId:`mixed-${++n}`,command});
 await api.approveController({operationId:'approve',approval:'fixture-native-user-action'});
 const members=[{memberId:'head',name:'Head',bossMemberId:null,role:'Review',officialText:'Review only',cli:headProvider},{memberId:'worker',name:'Worker',bossMemberId:'head',role:'Work',officialText:'Read role and brief before work',cli:workerProvider}];
 await assert.rejects(call({type:'createFreshTeam',teamId:'bad',name:'Bad',functionText:'',settings,expectedControllerGeneration:1,members:[{...members[0],cli:'unverified-cli'}]}),code('API_INPUT_INVALID'));
 await call({type:'createFreshTeam',teamId:'team',name:'Mixed',functionText:'Native coordination foundation',settings,expectedControllerGeneration:1,members});
 const snapshot=(await call({type:'inspectTeam',teamId:'team'})).result,version=snapshot.team.config_version;
 assert.equal(snapshot.members.find(m=>m.member_id==='head').cli,headProvider);assert.equal(snapshot.members.find(m=>m.member_id==='worker').cli,workerProvider);
 const binding=memberId=>({type:'bindMember',teamId:'team',memberId,expectedConfigVersion:version,expectedMemberGeneration:1,expectedBindingGeneration:0,expectedControllerGeneration:1});
 await assert.rejects(api.execute({operationId:'wrong-provider',command:binding('head'),target:'worker'}),code('API_PROVIDER_MISMATCH'));
 await api.execute({operationId:'bind-head',command:binding('head'),target:'head'});await api.execute({operationId:'bind-worker',command:binding('worker'),target:'worker'});
 const authority={teamId:'team',expectedConfigVersion:version,expectedMemberGeneration:1,expectedBindingGeneration:1};
 await call({...authority,type:'admitAssignment',runId:'run',taskId:'task',assignmentId:'assignment',memberId:'worker',instructions:'Return 5.',expectedResult:'5',expectedTargetGeneration:1,expectedTargetBindingGeneration:1});
 const pending=(await call({type:'inspectInbox',teamId:'team',recipientMemberId:'worker'})).result.messages[0];
 await assert.rejects(call({...authority,type:'readInbox',deliveryId:pending.delivery_id,expectedDeliveryGeneration:pending.delivery_generation}),code('API_INBOX_ORDER'));
 current=worker;assert.equal((await call({type:'inspectCaller'})).result.member.member_id,'worker');
 const read={operationId:'worker-read',command:{...authority,type:'readInbox',deliveryId:pending.delivery_id,expectedDeliveryGeneration:pending.delivery_generation}};
 const receipt=await api.execute(read);assert.equal(receipt.result.message.kind,'dispatch');assert.deepEqual(await api.reconcile(read),receipt);
 const pickup=await call({...authority,type:'verifyAssignment',assignmentId:'assignment',expectedAttemptGeneration:1});assert.equal(pickup.result.role.official_text,members[1].officialText);assert.equal(pickup.result.brief.instructions,'Return 5.');
 await call({...authority,type:'reportOutcome',assignmentId:'assignment',expectedAttemptGeneration:2,outcome:'succeeded',summary:'5',evidence:'2 + 3 = 5'});
 const accept={...authority,type:'acceptTask',assignmentId:'assignment',expectedAttemptGeneration:3,decision:'accepted',reason:'Independent arithmetic review'};
 await assert.rejects(call(accept),code('API_HEAD_REQUIRED'));
 const before=(await call({type:'inspectAssignment',teamId:'team',assignmentId:'assignment'})).result;assert.equal(before.task.status,'open');assert.equal(before.acceptance,null);
 current=head;
 await assert.rejects(api.reconcile(read),code('STORE_IDEMPOTENCY_CONFLICT'));
 const returned=(await call({type:'inspectInbox',teamId:'team',recipientMemberId:'head'})).result.messages[0];assert.equal(returned.kind,'worker_done');
 await call({...authority,type:'readInbox',deliveryId:returned.delivery_id,expectedDeliveryGeneration:returned.delivery_generation});await call(accept);
 const after=(await call({type:'inspectAssignment',teamId:'team',assignmentId:'assignment'})).result;assert.equal(after.task.status,'succeeded');assert.equal(after.attempt.generation,3);assert.equal(after.acceptance.accepted_by_member_id,'head');
 // Provider is part of the principal. The same conversation string under a
 // different provider cannot recover controller approval or a member binding.
 current={...head,provider:'unknown'};const unknown=(await call({type:'inspectCaller'})).result;assert.equal(unknown.controllerGeneration,null);assert.equal(unknown.member,null);
});
