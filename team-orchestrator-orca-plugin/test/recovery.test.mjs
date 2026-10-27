import { rmTemp } from './temp.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {openTeamStore} from '../src/local/store.mjs';import {DEFAULT_FORM} from '../src/team.mjs';import {nativeLaunchIntent,publicOperation} from '../src/local/native-launch.mjs';
import {createRecoveryService} from '../src/local/recovery.mjs';
async function fixture(t,{host='local'}={}){
 const profile=await mkdtemp(join(tmpdir(),'recovery117-'));let store=await openTeamStore({userData:profile});
 t.after(async()=>{store.close();await rmTemp(profile);});
 const scope={workspaceId:'folder:/work',executionHostId:host,kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work',host])).digest('hex')};
 const team=store.createTeam({requestId:'team',expectedRevision:0,form:DEFAULT_FORM},scope).teams[0],member=team.members[0];
 const op=store.prepareOperation({teamId:team.id,memberId:member.id,requestId:'launch',configVersion:1},{scope,nativeRequest:nativeLaunchIntent(team,member,scope),runtimeId:'old-runtime',roleVersion:1,title:'Head',executionHostId:host,hostGeneration:host==='local'?null:1}).operation;
 const calls=[];let epoch='old-runtime',offline=false;
 const rpc=async(method,params)=>{calls.push({method,params});if(offline)throw Error('SSH connection interrupted; incomplete observation');if(method==='status.get')return {runtimeId:epoch};if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:host}};throw Error('No current native evidence');};
 return {profile,scope,team,member,op,rpc,calls,get store(){return store;},set offline(value){offline=value;},set epoch(value){epoch=value;},service(){return createRecoveryService({store,rpc,userData:profile,consent:async()=>{}});},async restart(){store.close();store=await openTeamStore({userData:profile});}};
}
test('worker crash, sleep, runtime restart and reread retain uncertain launch reservation without any launch effect',async t=>{
 const f=await fixture(t);f.store.settleOperation('launch',f.op.nativeRequest.operationId,{effectState:'submitted'},f.op.version);await f.restart();await f.service().reconcile();
 assert.equal(f.store.readOperation('launch').recovery.state,'unknown');
 f.offline=true;await f.service().reconcile();f.offline=false;f.epoch='restarted-runtime';await f.restart();await f.service().reconcile();
 assert.equal(f.store.readOperation('launch').status,'unknown');assert.equal(f.store.isActiveOperation(f.store.readOperation('launch')),true);
 assert.ok(f.store.readOperation('launch').recovery.observedAt);
 assert.equal(f.calls.some(row=>/send|launchReplay|restartContinue|inbox|ack/i.test(row.method)),false);
 assert.throws(()=>f.store.prepareOperation({teamId:f.team.id,memberId:f.member.id,requestId:'duplicate',configVersion:1},{scope:f.scope}),/binding|launch/);
});
test('released structured lease needs exact saved owner-fence death evidence; history and missing rows never prove stopped',async t=>{
 const f=await fixture(t),patch={status:'created',kind:'structured',handle:'chat',sessionId:'session',observation:{state:'unknown',ownerFence:7}};
 f.store.settleOperation('launch',f.op.nativeRequest.operationId,{...patch,public:publicOperation({...f.op,...patch})});
 const db=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>db.close());db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 const lease={sessionId:'session',runtimeFence:7,claimStatus:'released',handoffStage:null,ownerProcess:null,reservedSpawnToken:null,deathEvidence:null};
 const write=()=>db.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run('session',JSON.stringify({schemaVersion:2,sessionId:'session',location:{workspaceId:f.scope.workspaceId,executionHostId:f.scope.executionHostId},lease}));
 write();await f.service().reconcile();assert.equal(f.store.readOperation('launch').recovery.state,'confirmed_effect');assert.equal(f.store.readOperation('launch').recovery.liveness,'unknown');
 lease.deathEvidence={kind:'exit-observed',ownerFence:6,observedAt:Date.now()};write();await f.service().reconcile();assert.notEqual(f.store.readOperation('launch').recovery.state,'stopped');
 lease.deathEvidence.ownerFence=7;lease.runtimeFence=8;write();await f.service().reconcile();assert.equal(f.store.readOperation('launch').recovery.state,'stopped');assert.equal(f.store.isActiveOperation(f.store.readOperation('launch')),true);
});
test('SSH disconnect and sleep during observation retain the exact member and mark output incomplete until reread',async t=>{
 const f=await fixture(t,{host:'ssh:remote%20one'}),patch={status:'created',kind:'terminal',handle:'terminal',paneKey:'tab:leaf',observation:{state:'unknown',incarnationId:'native-instance'}};
 f.store.settleOperation('launch',f.op.nativeRequest.operationId,{...patch,public:publicOperation({...f.op,...patch})});let disconnected=true,reads=0;
 const rpc=async(method,params)=>{if(method==='ssh.getState'){assert.equal(params.targetId,'remote one');reads++;return {state:{status:disconnected&&reads%2===0?'disconnected':'connected',connectionGeneration:1}};}if(method==='terminal.show')return {terminal:{handle:'terminal',incarnationId:'native-instance',ptyId:'recovery-pty',worktreeId:f.scope.workspaceId,executionHostId:f.scope.executionHostId,tabId:'tab',leafId:'leaf',connected:true}};return f.rpc(method,params);};
 let recovery=createRecoveryService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});await recovery.reconcile();let op=f.store.readOperation('launch');assert.equal(op.recovery.incomplete,true);assert.equal(op.recovery.liveness,'unknown');assert.equal(op.status,'created');
 await f.restart();disconnected=false;recovery=createRecoveryService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});await recovery.reconcile();op=f.store.readOperation('launch');assert.equal(op.recovery.liveness,'live');assert.equal(op.instanceGeneration,1);assert.equal(f.store.isActiveOperation(op),true);
});
test('a durable launch intent that never passed native admission remains distinct from an ambiguous submitted operation',async t=>{
 const f=await fixture(t);await f.service().reconcile();assert.equal(f.store.readOperation('launch').recovery.state,'intent');assert.equal(f.store.readOperation('launch').error,undefined);
 const op=f.store.readOperation('launch');f.store.settleOperation('launch',op.nativeRequest.operationId,{effectState:'submitted'},op.version);
 await f.service().reconcile();assert.equal(f.store.readOperation('launch').recovery.state,'unknown');assert.equal(f.store.isActiveOperation(f.store.readOperation('launch')),true);
});
test('legacy terminal recovery enriches exact PTY once and refuses a swapped PTY with the same raw incarnation',async t=>{
 const f=await fixture(t),patch={status:'created',kind:'terminal',handle:'terminal',paneKey:'tab:leaf',observation:{state:'unknown',incarnationId:'native-instance'}};
 f.store.settleOperation('launch',f.op.nativeRequest.operationId,{...patch,public:publicOperation({...f.op,...patch})});
 let ptyId='repo::/work@@original';
 const rpc=async(method,...args)=>method==='terminal.show'?{terminal:{handle:'terminal',incarnationId:'native-instance',ptyId,worktreeId:f.scope.workspaceId,executionHostId:f.scope.executionHostId,tabId:'tab',leafId:'leaf',connected:true}}:f.rpc(method,...args);
 const service=createRecoveryService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 await service.checkOperation('launch');
 assert.equal(f.store.readOperation('launch').observation.processIncarnation,'repo::/work@@original:native-instance');
 assert.equal(f.store.readOperation('launch').public.observation.ptyId,undefined);
 ptyId='repo::/work@@swapped';await service.checkOperation('launch');
 assert.equal(f.store.readOperation('launch').recovery.liveness,'unknown');
 assert.equal(f.store.readOperation('launch').observation.processIncarnation,'repo::/work@@original:native-instance');
});
test('created terminal clears only stale ledger absence after exact live proof, retaining provider and wrong-identity warnings',async t=>{
 const f=await fixture(t),absent='Original native launch ledger row is absent; no launch was retried.';
 const patch={status:'created',kind:'terminal',handle:'terminal',paneKey:'tab:leaf',error:absent,warning:'Native prompt delivery is unconfirmed.',observation:{state:'unknown',incarnationId:'native-instance',ptyId:'known-pty',processIncarnation:'known-pty:native-instance'}};
 f.store.settleOperation('launch',f.op.nativeRequest.operationId,{...patch,public:publicOperation({...f.op,...patch})});
 let ptyId='wrong-pty';const rpc=async(method,...args)=>method==='terminal.show'?{terminal:{handle:'terminal',incarnationId:'native-instance',ptyId,worktreeId:f.scope.workspaceId,executionHostId:f.scope.executionHostId,tabId:'tab',leafId:'leaf',connected:true}}:f.rpc(method,...args);
 const service=createRecoveryService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 await service.checkOperation('launch');assert.equal(f.store.readOperation('launch').error,absent);assert.equal(f.store.readOperation('launch').recovery.liveness,'unknown');
 ptyId='known-pty';await service.checkOperation('launch');const saved=f.store.readOperation('launch');
 assert.equal(saved.error,undefined);assert.equal(saved.public.error,undefined);assert.equal(saved.recovery.liveness,'live');assert.equal(saved.warning,patch.warning);assert.equal(saved.observation.state,'unknown');
 f.store.settleOperation('launch',saved.nativeRequest.operationId,{error:'Unresolved provider authentication failure.'},saved.version);
 await service.checkOperation('launch');assert.equal(f.store.readOperation('launch').error,'Unresolved provider authentication failure.');
});
test('late pending recovery cannot overwrite a newer successful launch settlement',async t=>{
 const f=await fixture(t);f.store.settleOperation('launch',f.op.nativeRequest.operationId,{effectState:'submitted'},f.op.version);
 let release,entered;const barrier=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{entered=resolve;});t.after(()=>release());
 const service=createRecoveryService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{entered();await barrier;}});
 const recovery=service.checkOperation('launch');await waiting;
 const current=f.store.readOperation('launch'),patch={status:'created',kind:'terminal',handle:'terminal',paneKey:'tab:leaf',error:undefined};
 f.store.settleOperation('launch',current.nativeRequest.operationId,{...patch,public:publicOperation({...current,...patch})},current.version);
 release();await recovery;const saved=f.store.readOperation('launch');
 assert.equal(saved.status,'created');assert.equal(saved.error,undefined);assert.equal(saved.recovery,undefined);assert.equal(f.calls.length,0);
});
