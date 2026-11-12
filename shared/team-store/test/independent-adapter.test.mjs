import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCodexAdapter} from '../codex-mcp.mjs';
const actor={projectRoot:'C:/fixture',machineId:'machine',provider:'codex',conversationId:'thread',executionHostId:'local',contextId:'project',terminalHandle:'codex-thread:thread',incarnationId:'process'};
const refusal=()=>Object.assign(Error('Native project inspection unavailable.'),{code:'API_NATIVE_SCOPE_UNVERIFIED'});
test('ordinary independent nonmembers keep normal tools without gaining team authority when scope inspection fails',async()=>{
 let strict=0,opened=0;const adapter=await createCodexAdapter({hostMode:'independent',observation:false},{createIdentity:async()=>({hostKind:'independent',verifyGuardCaller:async()=>actor,verifyCaller:async()=>{strict++;throw refusal();}}),inspectGuard:async()=>({member:null}),createApi:async()=>{opened++;throw Error('No team API may open.');}});
 try{
  assert.deepEqual(await adapter.call('team_guard',{tool:'apply_patch',input:{command:'ordinary fixture patch'}},{}),{});assert.equal(strict,0);assert.equal(opened,0);
  assert.equal((await adapter.call('team_guard',{tool:'exec_command',input:{cmd:'Get-Content C:/private/machine.sqlite'}},{})).hookSpecificOutput.permissionDecision,'deny');
  await assert.rejects(adapter.call('shared_team_status',{},{}),{code:'API_NATIVE_SCOPE_UNVERIFIED'});assert.equal(strict,1);
 }finally{await adapter.close();}
});
test('independent members and pending launches cannot escape strict native project verification',async()=>{
 for(const authority of [{member:{member_id:'head'}},{member:null,pendingLaunchId:'reserved'}]){
  const adapter=await createCodexAdapter({hostMode:'independent',observation:false},{createIdentity:async()=>({verifyGuardCaller:async()=>actor,verifyCaller:async()=>{throw refusal();}}),inspectGuard:async()=>authority});
  await assert.rejects(adapter.call('team_guard',{tool:'apply_patch',input:{}},{}),{code:'API_NATIVE_SCOPE_UNVERIFIED'});await adapter.close();
 }
});
test('a stale independent member retains exactly reviewed recovery and read-only guard access',async()=>{
 const adapter=await createCodexAdapter({hostMode:'independent',observation:false},{createIdentity:async()=>({verifyGuardCaller:async()=>actor,verifyCaller:async()=>{throw refusal();}}),inspectGuard:async()=>{throw Object.assign(Error('Resumed execution'),{code:'API_STALE_BINDING'});}});
 try{assert.deepEqual(await adapter.call('team_guard',{tool:'shared_team_manage',input:{command:{type:'bindMember'}}},{}),{});assert.equal((await adapter.call('team_guard',{tool:'apply_patch',input:{}},{})).hookSpecificOutput.permissionDecision,'deny');}
 finally{await adapter.close();}
});
test('independent status exposes management separately from unavailable automatic launch and closes its inspector',async()=>{
 let closed=0;const native={hostKind:'independent',verifyCaller:async()=>actor,launchWorkers:false,close:async()=>closed++};
 const adapter=await createCodexAdapter({hostMode:'independent',observation:false},{createIdentity:async()=>native,createApi:async()=>({execute:async()=>({result:{member:null,teams:[]}}),close:async()=>{}})});
 const status=await adapter.call('shared_team_status',{},{});assert.equal(status.host,'independent');assert.equal(status.actions.standalone,true);assert.equal(status.actions.automaticCodexLaunch,false);await adapter.close();assert.equal(closed,1);
});
