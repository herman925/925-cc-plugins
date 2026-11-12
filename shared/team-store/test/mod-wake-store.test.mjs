import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {wakeModDeliveries} from '../mod-wake.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';

for(const engine of ['sqlite','postgres'])test(`${engine}: native Mod wake reconciles a real reservation without acknowledging or starting task work`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const apis=[];t.after(async()=>{for(const api of apis)await api.close();});
 const f=await runtimeFixture(t,engine);
 const actor=id=>({projectRoot:f.root,machineId:'machine',provider:id==='head'?'claude':'codex',conversationId:id,executionHostId:'local',contextId:'context',terminalHandle:`term-${id}`,incarnationId:`inc-${id}`});
 const api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>actor('head'),confirmController:async()=>true,verifyTarget:async input=>actor(input.conversationId)});apis.push(api);
 await api.approveController({operationId:'approve'});
 const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:2,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:60000,exemptMemberIds:[]};
 await api.manageTeam({operationId:'create',command:{type:'createFreshTeam',teamId:'team',name:'Mixed native fixture',functionText:'Verify transport separately from pickup.',settings,members:[{memberId:'head',name:'Claude head',bossMemberId:null,role:'Coordinate',officialText:'Review.',cli:'claude'},{memberId:'worker',name:'Codex worker',bossMemberId:'head',role:'Research',officialText:'Read role and brief.',cli:'codex'}],expectedControllerGeneration:1}});
 for(const id of ['head','worker'])await api.manageTeam({operationId:`bind-${id}`,command:{type:'bindMember',teamId:'team',memberId:id,expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:0,expectedControllerGeneration:1},target:{projectRoot:f.root,conversationId:id,terminalHandle:`term-${id}`,contextId:'context'}});
 const authority={teamId:'team',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:1};
 const caller=(await api.execute({operationId:'caller-policy',command:{type:'inspectCaller'}})).result;
 assert.equal(caller.guardPolicy.managerWriteRule,'requires-write-grant');
 const inspected=(await api.execute({operationId:'team-policy',command:{type:'inspectTeam',teamId:'team'}})).result;
 const workerPolicy=inspected.guardPolicies.find(p=>p.memberId==='worker');
 assert.equal(workerPolicy.managerWriteRule,'not-blocked-by-manager-rule');assert.equal(workerPolicy.standingWritesEnabled,false);
 await api.execute({operationId:'admit',command:{...authority,type:'admitAssignment',runId:'run',taskId:'task',assignmentId:'assignment',memberId:'worker',instructions:'Return a fixture answer.',expectedResult:'fixture',expectedTargetGeneration:1,expectedTargetBindingGeneration:1}});
 const request={operationId:'reservation',command:{...authority,type:'prepareDeliveries'}};
 const reservation=await api.execute(request);assert.equal(reservation.result.deliveries.length,1);
 const proof={projectRoot:f.root,conversationId:'head',terminalHandle:'term-head',contextId:'context'},woken=[];
 const dependencies={createNative:async()=>({verifyCaller:async input=>{assert.deepEqual(input,proof);return actor('head');}}),createApi:options=>createTeamApi({...options,...f.options}),createHost:async()=>({}),createWake:()=>async delivery=>{woken.push(delivery);return {state:'input-accepted',requestId:'fixture'};}};
 const result=await wakeModDeliveries({proof,request,orcaCommand:'fixture-never-executed'},dependencies);
 assert.equal(result.results[0]?.state,'input-accepted');assert.equal(woken.length,1);assert.deepEqual(woken,reservation.result.deliveries);
 const db=await f.raw();try{
  assert.equal((await db.query('SELECT status FROM deliveries'))[0].status,'outstanding');
  assert.equal((await db.query('SELECT pickup_observed_at_ms FROM assignments'))[0].pickup_observed_at_ms,null);
 }finally{await db.close();}
 const unknown=await wakeModDeliveries({proof,request:{...request,operationId:'never-reserved'},orcaCommand:'fixture'},dependencies);
 assert.equal(unknown.state,'unconfirmed');assert.equal(woken.length,1);
});
