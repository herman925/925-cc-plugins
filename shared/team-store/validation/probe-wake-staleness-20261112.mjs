// Audit reproduction, not a conformance assertion of desired behavior.
// Disposable native-host and database fixtures only; never sends an Orca prompt.
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrcaWake} from '../src/orca-wake.mjs';
import {wakeModDeliveries} from '../mod-wake.mjs';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';

const root=await realpath(await mkdtemp(join(tmpdir(),'team-wake-audit-'))),report=[];
async function transport(name,run){
 const sent=[],hostRequests=new Map();let lost=false;
 const recipient={member_id:'w',machine_id:'machine',execution_host_id:'local',provider:'codex',conversation_id:'thread',context_id:'context',terminal_handle:'terminal',incarnation_id:'inc',generation:1};
 const host={runtimeId:'epoch',capabilities:['terminal.prompt-delivery.v1'],verifyTerminal:async()=>({actor:{incarnationId:'inc',machineId:'machine'}}),rpc:async()=>({agentStatus:{handle:'terminal',isRunningAgent:true,status:'idle'}}),submitWake:async request=>{
  sent.push(request);hostRequests.set(request.requestId,request.text);
  if(lost){lost=false;throw Error('Accepted prompt; transport reply lost.');}
  return {send:{handle:'terminal',accepted:true,prompt:{requestId:request.requestId,processIncarnation:'inc',observation:'supported',stages:['input_accepted','turn_started']}}};
 }};
 const wake=createOrcaWake({host,journalRoot:join(root,name)}),delivery={deliveryId:'d',messageId:'m',threadId:'t',recipient},scope={projectRoot:root,machineId:'machine'};
 await run({wake,delivery,scope,host,sent,hostRequests,lose:()=>lost=true});
}
let api;
try{
 await transport('unread-after-start',async f=>{
  const first=await f.wake(f.delivery,f.scope),later=await f.wake(f.delivery,f.scope);
  assert.equal(first.state,'turn-started');assert.equal(later.replayed,true);assert.equal(f.sent.length,1);
  report.push({case:'turn-ended-without-inbox-progress',laterState:later.state,replayed:later.replayed,nativeRequests:f.hostRequests.size,observation:'No read/ack progress is consulted; the completed wake suppresses another prompt for this binding and delivery.'});
 });
 await transport('binding-generation',async f=>{
  f.lose();const first=await f.wake(f.delivery,f.scope);
  const rebound=await f.wake({...f.delivery,recipient:{...f.delivery.recipient,generation:2}},f.scope);
  assert.equal(first.state,'unknown');assert.equal(rebound.state,'turn-started');assert.equal(f.hostRequests.size,2);
  report.push({case:'same-native-process-new-binding-generation-after-lost-reply',states:[first.state,rebound.state],nativeRequests:f.hostRequests.size,observation:'The same delivery and unchanged native process get a second request ID because binding generation changes the journal key.'});
 });
 await transport('host-epoch',async f=>{
  f.lose();await f.wake(f.delivery,f.scope);f.host.runtimeId='new-epoch';
  const later=await f.wake(f.delivery,f.scope);
  assert.equal(later.state,'unknown');assert.equal(f.sent.length,1);
  report.push({case:'pending-request-host-restart',laterState:later.state,nativeRequests:f.hostRequests.size,observation:'Safely stops; no automatic epoch reconciliation or recovery is implemented.'});
 });
 await transport('replacement-at-send',async f=>{
  const submit=f.host.submitWake;
  f.host.submitWake=async request=>{const response=await submit(request);response.send.prompt.processIncarnation='replacement-inc';return response;};
  const result=await f.wake(f.delivery,f.scope);
  assert.equal(result.state,'unknown');assert.equal(f.hostRequests.size,1);
  report.push({case:'replacement-between-verification-and-submit-fixture',laterState:result.state,nativeRequests:f.hostRequests.size,observation:'The adapter detects the changed receipt only after the simulated host effect. Actual host race not exercised; initial send carries no expected target incarnation field.'});
 });
 const project=join(root,'project');await (await import('node:fs/promises')).mkdir(project);
 const actor=id=>({projectRoot:project,machineId:'machine',provider:id==='head'?'claude':'codex',conversationId:id,executionHostId:'local',contextId:'context',terminalHandle:`term-${id}`,incarnationId:`inc-${id}`});
 const apiOptions={projectRoot:project,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>actor('head'),confirmController:async()=>true,verifyTarget:async input=>actor(input.conversationId)};
 api=await createTeamApi(apiOptions);
 await api.approveController({operationId:'approve'});
 const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:2,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:60000,exemptMemberIds:[]};
 await api.manageTeam({operationId:'create',command:{type:'createFreshTeam',teamId:'team',name:'Audit fixture',functionText:'Check stale pointers.',settings,members:[{memberId:'head',name:'Head',bossMemberId:null,role:'Coordinate',officialText:'Review.',cli:'claude'},{memberId:'worker',name:'Worker',bossMemberId:'head',role:'Research',officialText:'Read first.',cli:'codex'}],expectedControllerGeneration:1}});
 for(const id of ['head','worker'])await api.manageTeam({operationId:`bind-${id}`,command:{type:'bindMember',teamId:'team',memberId:id,expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:0,expectedControllerGeneration:1},target:{projectRoot:project,conversationId:id,terminalHandle:`term-${id}`,contextId:'context'}});
 const authority={teamId:'team',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:1};
 await api.execute({operationId:'admit',command:{...authority,type:'admitAssignment',runId:'run',taskId:'task',assignmentId:'assignment',memberId:'worker',instructions:'Return fixture evidence.',expectedResult:'fixture',expectedTargetGeneration:1,expectedTargetBindingGeneration:1}});
 const request={operationId:'reserve',command:{...authority,type:'prepareDeliveries'}};await api.execute(request);
 // The real recipient acknowledges the original delivery before the private
 // transport replays that earlier committed reservation.
 const workerApi=await createTeamApi({...apiOptions,authenticate:async()=>actor('worker')});
 try{
  const inbox=(await workerApi.execute({operationId:'inbox',command:{teamId:'team',type:'inspectInbox',recipientMemberId:'worker'}})).result;
  const entry=inbox.messages?.[0]??inbox[0];
  assert.ok(entry,'Fixture must inspect a real outstanding message.');
  await workerApi.execute({operationId:'read',command:{...authority,type:'readInbox',deliveryId:entry.delivery_id,expectedDeliveryGeneration:Number(entry.delivery_generation)}});
 }finally{await workerApi.close();}
 const nudges=[];
 const result=await wakeModDeliveries({proof:{projectRoot:project,conversationId:'head',terminalHandle:'term-head',contextId:'context'},request,orcaCommand:'never-invoked'}, {
  createNative:async()=>({verifyCaller:async()=>actor('head')}),createApi:options=>createTeamApi({...apiOptions,...options}),createHost:async()=>({}),createWake:()=>async delivery=>{nudges.push(delivery);return {state:'turn-started'};}
 });
 assert.equal(result.results.length,1);
 report.push({case:'old-reservation-after-recipient-already-read',nativeAdapterInvocations:nudges.length,observation:'Reconciliation and binding checks pass; delivery outstanding/read state is not rechecked before the nudge.'});
 console.log(JSON.stringify({scope:'disposable native-host and SQLite fixtures; no real sessions changed',report},null,2));
}finally{await api?.close();await rm(root,{recursive:true,force:true});}
