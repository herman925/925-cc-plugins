import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {openTeamStore} from '../src/local/store.mjs';
import {DEFAULT_FORM} from '../src/team.mjs';
async function fixture(t){const profile=await mkdtemp(join(tmpdir(),'stop-'));const store=await openTeamStore({userData:profile});t.after(async()=>{store.close();await rm(profile,{recursive:true,force:true});});const scope={workspaceId:'folder:/work',executionHostId:'local',kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex')};const team=store.createTeam({requestId:'team',expectedRevision:0,form:DEFAULT_FORM},scope).teams[0];return {store,team,scope,profile};}
test('pause admission persists, is independently scoped, and resumes without changing members',async t=>{const {store,team}=await fixture(t);const members=team.members;store.setAdmission({teamId:team.id,memberId:members[1].id,paused:true,requestId:'pause',expectedRevision:1});assert.throws(()=>store.assertAdmission(team.id,members[1].id),/paused/);assert.doesNotThrow(()=>store.assertAdmission(team.id,members[0].id));assert.deepEqual(store.readSnapshot().teams[0].members,members);store.setAdmission({teamId:team.id,memberId:members[1].id,paused:false,requestId:'resume',expectedRevision:2});assert.doesNotThrow(()=>store.assertAdmission(team.id,members[1].id));});
import {nativeLaunchIntent,publicOperation} from '../src/local/native-launch.mjs';
import {createStopService} from '../src/local/stop.mjs';
async function stopFixture(t){const f=await fixture(t),{store,team,scope}=f,member=team.members[0];const input={teamId:team.id,memberId:member.id,configVersion:1,requestId:'launch'},op=store.prepareOperation(input,{scope,title:'Head',executionHostId:'local',runtimeId:'runtime',nativeRequest:nativeLaunchIntent(team,member,scope)}).operation;const value={status:'created',kind:'terminal',handle:'term',paneKey:'tab:leaf',observation:{incarnationId:'incarnation'}};store.settleOperation('launch',op.nativeRequest.operationId,{...value,public:publicOperation({...op,...value})});let incarnation='incarnation';const rpc=async method=>{if(method==='status.get')return {runtimeId:'runtime'};if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:'local'}};if(method==='terminal.show')return {terminal:{handle:'term',incarnationId:incarnation,tabId:'tab',leafId:'leaf',worktreeId:scope.workspaceId,executionHostId:'local',ptyId:'pty-one',connected:true}};throw Error('Unexpected native call '+method);};return {...f,member,rpc,replace:()=>incarnation='new-instance',input:{teamId:team.id,memberId:member.id,operationRequestId:'launch',requestId:'stop-one'}};}
test('explicit terminal stop saves intent and requires exact native post-stop proof; duplicate never resubmits',async t=>{const f=await stopFixture(t),service=createStopService({...f,consent:async()=>{}});const row=await service.prepare(f.input);assert.equal(row.state,'intent');const plan=await service.validate(row.requestId);assert.deepEqual(plan.params,{worktree:'folder:/work',expectedPtyIds:['pty-one'],keepHistory:true,targetOnly:true});assert.equal(f.store.readStop(row.requestId).state,'submitted');const receipt=await service.settle(row.requestId,{stoppedPtyIds:['pty-one'],postStopVerified:true});assert.equal(receipt.state,'stopped');assert.equal((await service.prepare({...f.input,requestId:'duplicate'})).requestId,row.requestId);assert.equal(await service.validate(row.requestId),null);assert.equal(f.store.readMemberOperation(f.member.id).requestId,'launch');});
test('unknown terminal stop retains its member and never becomes a fresh stop on duplicate or check',async t=>{const f=await stopFixture(t),service=createStopService({...f,consent:async()=>{}}),row=await service.prepare(f.input);await service.validate(row.requestId);assert.equal((await service.settle(row.requestId,{stoppedPtyIds:['pty-one'],postStopVerified:false})).state,'unknown');assert.equal((await service.prepare({...f.input,requestId:'again'})).requestId,row.requestId);assert.equal(await service.validate(row.requestId),null);assert.equal((await service.check(row.requestId)).state,'unknown');assert.equal(f.store.readStopProof({memberId:f.member.id,requestId:'launch',instanceGeneration:1}),null);});
test('a replaced native incarnation refuses stop and preserves the original reservation',async t=>{const f=await stopFixture(t),service=createStopService({...f,consent:async()=>{}}),row=await service.prepare(f.input);f.replace();await assert.rejects(service.validate(row.requestId),/incarnation/);assert.equal(f.store.readStop(row.requestId).state,'unknown');assert.equal(f.store.readMemberOperation(f.member.id).requestId,'launch');});
test('revoked authority before stop submission preserves its durable unknown intent',async t=>{const f=await stopFixture(t);let enabled=true;const service=createStopService({...f,consent:async()=>{if(!enabled)throw Error('Consent revoked');}}),row=await service.prepare(f.input);enabled=false;await assert.rejects(service.validate(row.requestId),/Consent revoked/);assert.equal(f.store.readStop(row.requestId).state,'unknown');assert.equal(await service.validate(row.requestId),null);});
import {createServer} from 'node:net';
import {writeFile} from 'node:fs/promises';
import {installAdapter} from '../src/local/adapter.mjs';
import {createExecutor} from '../src/local/executor.mjs';
test('panel owner revocation in flight preserves intent, sends no follow-up, and reauthorization reconciles without repeating stop',async t=>{
 const f=await stopFixture(t);globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore();let enabled=true,writes=0;
 const endpoint=join(f.profile,'runtime.sock'),server=createServer(socket=>{let input='';socket.on('data',chunk=>{input+=chunk;if(!input.includes('\n'))return;const request=JSON.parse(input);if(request.method==='terminal.show'){socket.end(JSON.stringify({id:request.id,ok:true,result:{terminal:{handle:'term',incarnationId:'incarnation',ptyId:'pty-one',tabId:'tab',leafId:'leaf',worktreeId:f.scope.workspaceId,executionHostId:'local'}},_meta:{runtimeId:'runtime'}})+'\n');return;}writes++;assert.equal(request.method,'terminal.stopExact');assert.equal(request.authToken,'secret');assert.deepEqual(request.params.expectedPtyIds,['pty-one']);enabled=false;socket.end(JSON.stringify({id:request.id,ok:true,result:{postStopVerified:true,stoppedPtyIds:['pty-one']},_meta:{runtimeId:'runtime'}})+'\n');});});await new Promise(r=>server.listen(endpoint,r));t.after(()=>new Promise(r=>server.close(r)));
 await writeFile(join(f.profile,'orca-runtime.json'),JSON.stringify({pid:process.pid,runtimeId:'runtime',authToken:'secret',transport:{kind:'unix',endpoint}}));
 const host={call:async()=>{if(!enabled)throw Error('revoked');return {value:null};}},executor=createExecutor(host,async()=>({worktree:{id:f.scope.workspaceId,hostId:'local'}}),{store:f.store,nativeRpc:f.rpc,internalKey:'key',userData:f.profile});
 const handlers=new Map(),ipcMain={_invokeHandlers:handlers,handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)},frame={},event={senderFrame:frame,sender:{id:1,mainFrame:frame}};
 handlers.set('plugins:readPanelEntry',async()=>({sessionToken:'panel'}));handlers.set('plugins:panelAction',async()=>({ok:enabled,error:'owner revoked'}));handlers.set('plugins:invokeCommand',async(_,message)=>executor.execute(message.args));handlers.set('runtime:call',async()=>{throw Error('Stop must use native UUID-capable socket');});
 await installAdapter({ipcMain,app:{getPath:()=>f.profile}},{version:'test',identity:'stop-test',internalKey:'key'});t.after(()=>globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore());
 const call=()=>handlers.get('plugins:panelAction')(event,{sessionToken:'panel',action:'workspace.readContext',params:{teamWorker:{protocol:1,nonce:'nonce',commandId:'team.control',args:{op:'stopMember',params:f.input}}}});
 assert.equal((await call()).ok,false);assert.equal(writes,1);assert.equal(f.store.readStop('stop-one').state,'submitted');enabled=true;const restored=await call();assert.equal(restored.ok,true);assert.equal(restored.value.value.stops[0].state,'unknown');assert.equal(writes,1);assert.equal(f.store.readStop('stop-one').state,'unknown');assert.equal(f.store.readMemberOperation(f.member.id).requestId,'launch');
});
test('native unsupported method refusal is shown distinctly from uncertain stop delivery',async t=>{const f=await stopFixture(t),service=createStopService({...f,consent:async()=>{}}),row=await service.prepare(f.input);await service.validate(row.requestId);assert.equal((await service.settle(row.requestId,null,{native:true,code:'method_not_supported',message:'Exact stop unavailable'})).state,'unsupported');assert.equal(f.store.readStopProof({memberId:f.member.id,requestId:'launch',instanceGeneration:1}),null);});
import {fixture as dispatchFixture} from './dispatch-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
async function activeStopFixture(t){
 const f=await dispatchFixture(t,{childKind:'terminal'}),dispatches=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatches.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatches.check(f.work.id);
 const attempt=f.store.listDispatches(f.work.id)[0],input={requestId:'active-stop',teamId:f.team.id,memberId:f.member.id,workId:f.work.id,attemptId:attempt.id};
 return {...f,get store(){return f.store;},attempt,input,make:()=>createStopService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}})};
}
test('explicit recovery preserves the unknown stop and replays its exact native operation once per saved user action',async t=>{
 const f=await activeStopFixture(t),service=f.make(),row=await service.prepare(f.input),plan=await service.validate(row.requestId);
 await service.settle(row.requestId,null,{native:true,message:'obsolete contract: No effects applied'});const unknown=f.store.readStop(row.requestId);
 assert.equal(await service.validate(row.requestId),null);await service.check(row.requestId);assert.equal(f.store.readStop(row.requestId).state,'unknown');
 const input={requestId:'recover-one',stopRequestId:row.requestId,version:unknown.version};
 const recovered=await service.recover(input);assert.deepEqual(recovered.plan,plan);assert.equal(recovered.requestId,row.requestId);
 const saved=f.store.readStop(row.requestId);assert.equal(saved.nativeRequestId,row.nativeRequestId);assert.deepEqual(saved.target,row.target);assert.equal(saved.state,'submitted');
 const history=f.store.readReceipt('stop-recovery:recover-one');assert.deepEqual(history.previous,unknown);assert.equal(history.previous.state,'unknown');
 assert.equal((await service.recover(input)).plan,null);
 await service.settle(row.requestId,{dispatchId:f.attempt.dispatchId,state:'stopped',close:{ptyKilled:true}});assert.equal(f.store.readStop(row.requestId).state,'stopped');assert.equal((await service.recover(input)).plan,null);
});
test('concurrent explicit recovery claims only once, survives worker restart, and never treats text or an absent ledger as exit',async t=>{
 const f=await activeStopFixture(t),service=f.make(),row=await service.prepare(f.input);await service.validate(row.requestId);await service.settle(row.requestId,null,{message:'No effects applied'});
 const input={requestId:'concurrent-recovery',stopRequestId:row.requestId,version:f.store.readStop(row.requestId).version};
 const outcomes=await Promise.all([service.recover(input),service.recover(input)]);assert.equal(outcomes.filter(v=>v.plan).length,1);
 await service.settle(row.requestId,null,{native:true,code:'operation_unknown',message:'Pending native mutation'});
 assert.equal(f.store.readStop(row.requestId).state,'unknown');assert.equal(f.store.readStopProof({memberId:f.member.id,attemptId:f.attempt.id,binding:f.attempt.binding}),null);
 await f.restart();const restarted=createStopService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}});assert.equal((await restarted.recover(input)).plan,null);assert.equal((await restarted.check(row.requestId)).state,'unknown');
 await assert.rejects(restarted.recover({...input,version:input.version+1}),/conflicts/);
});
for(const fault of ['changed-dispatch','changed-native-epoch','changed-host','changed-run','revoked','missing-capability','forged-plan','native-ownership-refusal'])test(`stop recovery preserves uncertainty for ${fault}`,async t=>{
 const f=await activeStopFixture(t),service=f.make(),row=await service.prepare(f.input);await service.validate(row.requestId);await service.settle(row.requestId,null,{message:'No effects applied'});
 const prior=f.store.readStop(row.requestId),input={requestId:'recover-fault',stopRequestId:row.requestId,version:prior.version};
 if(fault==='changed-dispatch')f.db.exec("UPDATE dispatch_contexts SET process_incarnation='different-process'");
 if(fault==='changed-run')f.db.exec('UPDATE runs SET consumer_generation=2');
 if(fault==='forged-plan')await assert.rejects(service.recover({...input,params:{dispatch:'other'}}),/saved unknown/);
 else if(fault==='native-ownership-refusal'){
  const result=await service.recover(input);assert.equal(result.plan.method,'orchestration.workerStop');await service.settle(row.requestId,{dispatchId:f.attempt.dispatchId,state:'stop_unknown',processAction:'refused_external_resource'});assert.equal((await service.check(row.requestId)).state,'unknown');assert.equal(f.calls.includes('terminal.stopExact'),false);return;
 }else{
  const rpc=async(method,params)=>{const value=await f.rpc(method,params);if(method==='status.get'&&fault==='changed-native-epoch')value.runtimeId='new-runtime';if(method==='status.get'&&fault==='missing-capability')value.capabilities=[];if(method==='worktree.show'&&fault==='changed-host')value.worktree.hostId='ssh:other';return value;};
  const changed=createStopService({store:f.store,rpc,userData:f.profile,consent:async()=>{if(fault==='revoked')throw Error('revoked');}});await assert.rejects(changed.recover(input));
 }
 assert.deepEqual(f.store.readStop(row.requestId),prior);assert.equal(f.store.readReceipt('stop-recovery:recover-fault'),null);
});
test('public recovery broker reuses the native UUID and refuses panel overrides and revoked ownership before socket effects',async t=>{
 const f=await activeStopFixture(t),service=f.make(),saved=await service.prepare(f.input),plan=await service.validate(saved.requestId);await service.settle(saved.requestId,null,{message:'Historical unknown'});
 const input={requestId:'broker-recovery',stopRequestId:saved.requestId,version:f.store.readStop(saved.requestId).version},requests=[];let enabled=true;
 const endpoint=join(f.profile,'runtime.sock'),server=createServer(socket=>socket.once('data',chunk=>{const request=JSON.parse(chunk.toString().trim());requests.push(request);socket.end(JSON.stringify({id:request.id,ok:false,error:{code:'operation_unknown',message:'Pending durable native request'},_meta:{runtimeId:'runtime-one'}})+'\n');}));await new Promise(r=>server.listen(endpoint,r));t.after(()=>new Promise(r=>server.close(r)));
 await writeFile(join(f.profile,'orca-runtime.json'),JSON.stringify({pid:process.pid,runtimeId:'runtime-one',authToken:'secret',transport:{kind:'unix',endpoint}}));
 const executor=createExecutor({call:async()=>({value:null})},async()=>({worktree:{id:f.scope.workspaceId,hostId:'local'}}),{store:f.store,nativeRpc:f.rpc,internalKey:'key',userData:f.profile});
 const handlers=new Map(),ipcMain={_invokeHandlers:handlers,handle:(n,fn)=>handlers.set(n,fn),removeHandler:n=>handlers.delete(n)},frame={},event={senderFrame:frame,sender:{id:1,mainFrame:frame}};
 handlers.set('plugins:readPanelEntry',async()=>({sessionToken:'panel'}));handlers.set('plugins:panelAction',async()=>({ok:enabled,error:'owner revoked'}));handlers.set('plugins:invokeCommand',async(_,message)=>executor.execute(message.args));handlers.set('runtime:call',async()=>{throw Error('Stop must use native UUID-capable socket');});
 await installAdapter({ipcMain,app:{getPath:()=>f.profile}},{version:'test',identity:'recover-stop-test',internalKey:'key'});t.after(()=>globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore());
 const call=params=>handlers.get('plugins:panelAction')(event,{sessionToken:'panel',action:'workspace.readContext',params:{teamWorker:{protocol:1,nonce:'nonce',commandId:'team.control',args:{op:'recoverStop',params}}}});
 for(const override of [{orchestrationContractVersion:1},{caller:'forged'},{method:'terminal.stopExact'}])assert.equal((await call({...input,...override})).ok,false);
 enabled=false;assert.equal((await call(input)).ok,false);assert.equal(requests.length,0);enabled=true;
 assert.equal((await call(input)).ok,true);assert.equal(requests.length,1);assert.equal(requests[0].orchestrationContractVersion,1);assert.equal(requests[0].orchestrationRequestId,saved.nativeRequestId);assert.deepEqual(requests[0].params,plan.params);assert.equal(requests[0].method,plan.method);assert.equal(requests[0].from,undefined);
 assert.equal(f.store.readStop(saved.requestId).state,'unknown');assert.equal((await call(input)).ok,true);assert.equal(requests.length,1);assert.equal(f.store.readReceipt('stop-recovery:broker-recovery').previous.state,'unknown');
});
