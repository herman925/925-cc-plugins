import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
import { nativeLaunchIntent, publicOperation } from '../src/local/native-launch.mjs';
const baseScope = { workspaceId: 'folder:/work', executionHostId: 'local', kind: 'folder', displayName: 'Work', workspaceKey: createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex') };
export async function fixture(t, kind = 'structured', executionHostId = 'local') {
 const scope={...baseScope,executionHostId,workspaceKey:createHash('sha256').update(JSON.stringify([baseScope.workspaceId,executionHostId])).digest('hex')};
 const profile = await mkdtemp(join(tmpdir(), 'team-work-')); let store = await openTeamStore({ userData: profile });
 t.after(async () => { store.close(); await rm(profile, { recursive:true, force:true }); });
 const team = store.createTeam({ requestId:'team', expectedRevision:0, form:DEFAULT_FORM }, scope).teams[0]; const head = team.members[0];
 const launch = { teamId:team.id,memberId:head.id,configVersion:1,requestId:'launch' };
 const operation = store.prepareOperation(launch, { scope, nativeRequest:nativeLaunchIntent(team,head,scope), roleVersion:1,title:'Squad/Head',executionHostId,runtimeId:'runtime-one' }).operation;
 const patch = { status:'created', kind,handle:kind==='structured'?'chat-head':'term-head',...(kind==='structured'?{sessionId:'session-head'}:{paneKey:'tab:leaf'}),briefAccepted:true,prompt:{delivery:'submit',outcome:'journaled',messageId:'role-message'} };
 store.settleOperation('launch',operation.nativeRequest.operationId,{...patch,public:publicOperation({...operation,...patch})});
 return { profile,team,head,scope,get store(){return store;}, async restart(){store.close();store=await openTeamStore({userData:profile});} };
}
test('one durable TeamWork freezes configuration and supervisor binding, refuses concurrent goals and survives restart', async t => {
 const f=await fixture(t); const input={teamId:f.team.id,requestId:'objective-one',expectedRevision:f.store.readSnapshot().revision,objective:'Audit checkout'};
 const created=f.store.prepareWork(input);
 assert.equal(created.fresh,true); assert.equal(created.work.configVersion,1); assert.equal(created.work.roleVersion,1); assert.equal(created.work.supervisorMemberId,f.head.id);
 assert.equal(created.work.binding.sessionId,'session-head'); assert.equal(created.work.scope.workspaceId,'folder:/work');
 assert.equal(f.store.prepareWork(input).fresh,false);
 assert.throws(()=>f.store.prepareWork({...input,requestId:'second',objective:'Another goal'}),/active|progress/);
 assert.throws(()=>f.store.prepareWork({...input,objective:'Changed input'}),/conflict/);
 await f.restart(); assert.equal(f.store.readWork(created.work.id).objective,'Audit checkout');
 assert.equal(f.store.listWorks().length,1);
});
test('objective user input is durably journaled once and only native owner evidence binds a Run',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const {DatabaseSync}=await import('node:sqlite');const f=await fixture(t);
 const native=new DatabaseSync(join(f.profile,'orchestration.db'));t.after(()=>native.close());
 native.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER); PRAGMA user_version=43');
 const calls=[];let sends=0,snapshotRace=false;
 const rpc=async(method,params)=>{
  calls.push(method);
  if(method==='status.get')return {runtimeId:'runtime-one',capabilities:['orchestration.contract.v1','agent-session.structured.v1']};
  if(method==='worktree.show')return {worktree:{id:'folder:/work',hostId:'local'}};
  if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:session-head'};
  if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:'session-head',worktreeId:'folder:/work'}};
  if(method==='agentSession.history')return {ok:true,page:{sessionId:'session-head',fence:7,submissions:[],items:[]}};
  if(method==='agentSession.send'){
   sends++;assert.equal(f.store.listWorks()[0].input.state,'sending');assert.equal(params.body.role,'user');assert.equal(params.envelope.expectedRuntimeFence,7);
   const work=f.store.listWorks()[0];native.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run-head',work.nativeObjective,'this_database',null,null,'wrong-owner',1,1,0);
   return {ok:true,fence:7,value:{clientMessageId:params.envelope.clientOperationId,submission:{clientMessageId:params.envelope.clientOperationId,dispatchState:'pending',providerItemId:null}}};
  }
  if(method==='orchestration.runShow')return {run:{id:'run-head',objective:f.store.listWorks()[0].nativeObjective,consumer_generation:1}};
  if(method==='orchestration.taskList'){if(snapshotRace)native.exec('UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2');return {tasks:[]};}
  throw Error('Unexpected native method '+method);
 };
 const service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const input={teamId:f.team.id,requestId:'objective',expectedRevision:f.store.readSnapshot().revision,objective:'Audit checkout'};
 const work=await service.submit(input);assert.equal(work.input.state,'accepted');assert.equal(work.run.state,'unverified');assert.equal(work.processing.state,'unknown');
 await service.submit(input);assert.equal(sends,1);
 native.exec("UPDATE runs SET coordinator_orca_session_id='session-head'");
 const observed=await service.check(work.id);assert.equal(observed.run.state,'verified');assert.equal(observed.run.id,'run-head');assert.deepEqual(observed.snapshot.tasks,[]);
 assert.ok(!calls.some(method=>/runCreate|runUse|check|ack/.test(method)));assert.equal(JSON.stringify(observed).includes(f.store.readWork(work.id).protocolToken),false);
 snapshotRace=true;const raced=await service.check(work.id);assert.equal(raced.run.state,'unverified');assert.equal(raced.run.consumerGeneration,1);assert.equal(raced.snapshot.stale,true);snapshotRace=false;
 native.exec('UPDATE runs SET consumer_generation=3');
 assert.equal((await service.check(work.id)).run.state,'unverified');
 native.exec('UPDATE runs SET coordinator_orca_session_id_generation=3');
 assert.equal((await service.check(work.id)).run.state,'fenced');
});
test('first objective delivers updated role text as a handoff but cannot silently change the prepared agent',async t=>{
 const {objectiveInstructions}=await import('../src/local/teamwork.mjs');const f=await fixture(t);
 f.store.updateRole({requestId:'new-role',expectedRevision:f.store.readSnapshot().revision,teamId:f.team.id,memberId:f.head.id,brief:'New explicit handoff role',habits:'Review before acceptance',collaboration:'Escalate risks'});
 const input={teamId:f.team.id,requestId:'first-work',expectedRevision:f.store.readSnapshot().revision,objective:'Audit checkout'};
 const {work}=f.store.prepareWork(input);assert.equal(work.roleVersion,2);assert.equal(work.binding.roleVersion,1);
 assert.match(objectiveInstructions(work,f.store.readTeamVersion(work.teamId,work.configVersion)),/New explicit handoff role/);
 const other=await fixture(t);
 other.store.updateAgentPreferences({requestId:'different-agent',expectedRevision:other.store.readSnapshot().revision,teamId:other.team.id,memberId:other.head.id,agent:'claude',model:'default',effort:'default'});
 assert.throws(()=>other.store.prepareWork({teamId:other.team.id,requestId:'wrong-prepared',expectedRevision:other.store.readSnapshot().revision,objective:'Goal'}),/prepared.*preferences|preparation.*preferences/i);
});
function userRpc(f,{send,kind='structured',incarnation=()=> 'instance-one',afterHistory=()=>{},permission=false}={}){
 return async(method,params,envelope)=>{
  if(method==='status.get')return {runtimeId:'runtime-one',capabilities:['orchestration.contract.v1','agent-session.structured.v1','terminal.prompt-delivery.v1']};
  if(method==='worktree.show')return {worktree:{id:'folder:/work',hostId:'local'}};
  if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:session-head'};
  if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:'session-head',worktreeId:'folder:/work'}};
  if(method==='agentSession.history'){afterHistory();return {ok:true,page:{sessionId:'session-head',fence:7,submissions:[],items:[]}};}
  if(method==='terminal.agentStatus')return {agentStatus:{handle:'term-head',isRunningAgent:true,status:permission?'permission':'idle'}};
  if(method==='terminal.show')return {terminal:{handle:'term-head',worktreeId:'folder:/work',executionHostId:'local',connected:true,writable:true,incarnationId:incarnation(),agentIdentity:'codex',tabId:'tab',leafId:'leaf'}};
  if(method==='agentSession.send'||method==='terminal.send')return send(method,params,envelope);
  throw Error('Unexpected native method '+method);
 };
}
test('unknown objective delivery survives restart and check/repeated submission never sends again',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const f=await fixture(t);let sends=0;
 const rpc=userRpc(f,{send:async()=>{sends++;throw Error('transport unknown');}});
 let service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const input={teamId:f.team.id,requestId:'unknown-work',expectedRevision:f.store.readSnapshot().revision,objective:'Audit checkout'};
 const first=await service.submit(input);assert.equal(first.input.state,'unknown');assert.equal(sends,1);
 await f.restart();service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 assert.equal((await service.submit(input)).id,first.id);assert.equal((await service.check(first.id)).input.state,'unknown');
 await assert.rejects(service.retry(first.id),/may have been submitted/);assert.equal(sends,1);
});
test('revoked consent between binding reads and objective write prevents the effect',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const f=await fixture(t);let approved=true,sends=0;
 const rpc=userRpc(f,{afterHistory:()=>{approved=false;},send:async()=>{sends++;}});
 const service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{if(!approved)throw Error('Consent revoked');}});
 const work=await service.submit({teamId:f.team.id,requestId:'revoked',expectedRevision:f.store.readSnapshot().revision,objective:'Audit'});
 assert.equal(work.input.state,'not_sent');assert.match(work.error,/Consent revoked/);assert.equal(sends,0);
});
test('terminal objectives use fixed actual user input and native prompt incarnation evidence',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const f=await fixture(t,'terminal');let sends=0,incarnation='instance-one';
 const rpc=userRpc(f,{incarnation:()=>incarnation,send:async(method,params,envelope)=>{
  sends++;assert.equal(method,'terminal.send');assert.equal(params.terminal,'term-head');assert.equal(params.from,undefined);assert.match(envelope.orchestrationRequestId,/^[0-9a-f-]{36}$/);
  assert.equal(f.store.listWorks()[0].nativeSend.envelope.orchestrationRequestId,envelope.orchestrationRequestId);
  return {send:{handle:'term-head',accepted:true,prompt:{requestId:envelope.orchestrationRequestId,processIncarnation:incarnation,stages:['input_accepted','turn_started'],observation:'supported'}}};
 }});
 const service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const work=await service.submit({teamId:f.team.id,requestId:'terminal-work',expectedRevision:f.store.readSnapshot().revision,objective:'Audit'});
 assert.equal(work.input.state,'accepted');assert.equal(work.processing.state,'observed');assert.equal(work.run.state,'unverified');
 incarnation='replacement';assert.match((await service.check(work.id)).error,/incarnation changed/);assert.equal(sends,1);
});
test('nested TeamWork scope corruption blocks reads without replacing evidence',async t=>{
 const {DatabaseSync}=await import('node:sqlite');const f=await fixture(t);
 const {work}=f.store.prepareWork({teamId:f.team.id,requestId:'corrupt',expectedRevision:f.store.readSnapshot().revision,objective:'Audit'});
 const corrupted=structuredClone(work);corrupted.scope.workspaceId='folder:/wrong-project';
 const db=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>db.close());
 db.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(corrupted),`work:${work.id}`);
 assert.throws(()=>f.store.readSnapshot(),/TeamWork evidence is damaged/);assert.throws(()=>f.store.readWork(work.id),/TeamWork evidence is damaged/);
 assert.equal(db.prepare('SELECT json FROM receipts WHERE id=?').get(`work:${work.id}`).json,JSON.stringify(corrupted));
});
test('structured unknown dispatch evidence is retained without claiming input or processing acceptance',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const f=await fixture(t);
 const rpc=userRpc(f,{send:async(_,params)=>({ok:true,fence:7,value:{clientMessageId:params.envelope.clientOperationId,submission:{clientMessageId:params.envelope.clientOperationId,dispatchState:'unknown',providerItemId:null}}})});
 const service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const work=await service.submit({teamId:f.team.id,requestId:'native-unknown',expectedRevision:f.store.readSnapshot().revision,objective:'Audit'});
 assert.equal(work.input.state,'unknown');assert.equal(f.store.readWork(work.id).input.dispatchState,'unknown');assert.equal(work.processing.state,'unknown');
});
test('a prepared terminal waiting for permission receives no objective input',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const f=await fixture(t,'terminal');let sends=0;
 const rpc=userRpc(f,{permission:true,send:async()=>{sends++;}}),service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const work=await service.submit({teamId:f.team.id,requestId:'permission-work',expectedRevision:f.store.readSnapshot().revision,objective:'Audit'});
 assert.equal(work.input.state,'not_sent');assert.match(work.error,/permission/);assert.equal(sends,0);
});
test('failed durable submission intent prevents native input and preserves the original work',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const {DatabaseSync}=await import('node:sqlite');const f=await fixture(t);let sends=0;
 const db=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>db.close());
 db.exec("CREATE TRIGGER refuse_send BEFORE UPDATE ON receipts WHEN NEW.id LIKE 'work:%' AND json_extract(NEW.json,'$.input.state')='sending' BEGIN SELECT RAISE(ABORT, 'write failure fixture'); END");
 const service=createWorkService({store:f.store,userData:f.profile,consent:async()=>{},rpc:userRpc(f,{send:async()=>{sends++;}})});
 const work=await service.submit({teamId:f.team.id,requestId:'write-fail',expectedRevision:f.store.readSnapshot().revision,objective:'Audit'});
 assert.equal(work.input.state,'not_sent');assert.match(work.error,/write failure/);assert.equal(sends,0);
 assert.equal(f.store.readWork(work.id).nativeSend,undefined);
});
test('conditional retirement and late receipts preserve the new active member generation across restart',async t=>{
 const f=await fixture(t),old=f.store.readOperation('launch');
 assert.equal(f.store.retireBinding({memberId:f.head.id,requestId:'launch',instanceGeneration:old.instanceGeneration}),true);
 const input={teamId:f.team.id,memberId:f.head.id,configVersion:1,requestId:'replacement'};
 const next=f.store.prepareOperation(input,{...old,nativeRequest:{...old.nativeRequest,operationId:'new-native-operation'}}).operation;
 assert.equal(next.instanceGeneration,old.instanceGeneration+1);
 assert.equal(f.store.retireBinding({memberId:f.head.id,requestId:'launch',instanceGeneration:old.instanceGeneration}),false);
 f.store.settleOperation('launch',old.nativeRequest.operationId,{warning:'Late old receipt retained for history'});
 await f.restart();
 assert.equal(f.store.readSnapshot().teams[0].launch.members[f.head.id].requestId,'replacement');
 assert.equal(f.store.readOperation('launch').warning,'Late old receipt retained for history');
 assert.throws(()=>f.store.settleOperation('replacement',next.nativeRequest.operationId,{warning:'stale panel'},next.version-1),/changed|stale/);
});
test('TeamWork observation cannot span runtime metadata rotation under the same parent PID',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs'),{createNativeRpc}=await import('../src/local/native-runtime.mjs'),{createServer}=await import('node:net'),{writeFile}=await import('node:fs/promises');const f=await fixture(t);
 const endpoint=join(f.profile,'runtime.sock');let epoch='runtime-one';const methods=[];
 const metadata=()=>writeFile(join(f.profile,'orca-runtime.json'),JSON.stringify({runtimeId:epoch,pid:process.pid,authToken:'fixture-only',transports:[{kind:'unix',endpoint}]}));
 const server=createServer(socket=>socket.once('data',chunk=>{const request=JSON.parse(chunk.toString().trim());methods.push(request.method);socket.end(JSON.stringify({id:request.id,ok:true,result:{runtimeId:epoch,capabilities:['orchestration.contract.v1','agent-session.structured.v1']},_meta:{runtimeId:epoch}})+'\n');}));
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));await metadata();let checks=0;
 const rpc=createNativeRpc({userData:f.profile,parentPid:process.pid,consent:async()=>{if(++checks===4){epoch='runtime-two';await metadata();}}});
 const service=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const work=await service.submit({teamId:f.team.id,requestId:'rotating',expectedRevision:f.store.readSnapshot().revision,objective:'Observe safely'});
 assert.equal(work.status,'needs_attention');assert.equal(work.input.state,'not_sent');assert.match(work.error,/epoch changed/);assert.deepEqual(methods,['status.get']);
 assert.equal(f.store.readWork(work.id).binding.runtimeId,'runtime-one');
});
test('two SQLite panel connections cannot settle an obsolete observation over a newer member record',async t=>{
 const f=await fixture(t),second=await openTeamStore({userData:f.profile});t.after(()=>second.close());const observed=f.store.readOperation('launch');
 second.settleOperation('launch',observed.nativeRequest.operationId,{recovery:{state:'confirmed_effect',observedAt:'newer'}},observed.version);
 assert.throws(()=>f.store.settleOperation('launch',observed.nativeRequest.operationId,{recovery:{state:'stopped',observedAt:'older'}},observed.version),/changed|stale/);
 assert.equal(f.store.readOperation('launch').recovery.observedAt,'newer');
});
test('SSH generation rotation during supervisor observation prevents sending the objective',async t=>{
 const {createWorkService}=await import('../src/local/teamwork.mjs');const f=await fixture(t,'structured','ssh:saved-host');let generation=1,sends=0;
 const rpc=async(method)=>{
  if(method==='status.get')return {runtimeId:'runtime-one',capabilities:['orchestration.contract.v1','agent-session.structured.v1']};
  if(method==='worktree.show')return {worktree:{id:f.scope.workspaceId,hostId:f.scope.executionHostId}};
  if(method==='ssh.getState')return {state:{status:'connected',connectionGeneration:generation}};
  if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:session-head'};
  if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:'session-head',worktreeId:f.scope.workspaceId}};
  if(method==='agentSession.history'){generation=2;return {ok:true,page:{sessionId:'session-head',fence:7}};}
  if(method==='agentSession.send'){sends++;throw Error('An epoch-spanning input must not be submitted');}
  throw Error('Unexpected read');
 };
 const work=await createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}).submit({teamId:f.team.id,requestId:'ssh-rotate',expectedRevision:f.store.readSnapshot().revision,objective:'Keep remote scope'});
 assert.equal(sends,0);assert.equal(work.input.state,'not_sent');assert.match(work.error,/SSH.*generation|SSH.*changed/i);
});
test('queued goals are durable, idempotent and do not consume a preparation session or start another Work',async t=>{
 const f=await fixture(t),input={teamId:f.team.id,requestId:'queue-one',expectedRevision:f.store.readSnapshot().revision,objective:'Second goal'};
 const first=f.store.enqueueGoal(input);assert.equal(first.status,'queued');assert.equal(f.store.enqueueGoal(input).id,first.id);
 assert.equal(f.store.listWorks().length,0);assert.equal(f.store.readOperation('launch').status,'created');
 const second=f.store.enqueueGoal({...input,requestId:'queue-two',expectedRevision:f.store.readSnapshot().revision,objective:'Third goal'});
 await f.restart();assert.deepEqual(f.store.listGoals(f.team.id).map(row=>row.objective),['Second goal','Third goal']);assert.notEqual(second.id,first.id);
 assert.throws(()=>f.store.enqueueGoal({...input,objective:'Conflicting goal'}),/conflict/);
});
test('acceptance reserves two queued objectives in order and each consumes a fresh preparation and handoff',async t=>{
 const f=await fixture(t),start=objective=>f.store.prepareWork({teamId:f.team.id,requestId:'first-work',expectedRevision:f.store.readSnapshot().revision,objective}).work;
 let w=start('First objective');w=f.store.updateWork(w.id,w.version,{run:{state:'verified',id:'first-run',consumerGeneration:1},instance:{kind:'structured',sessionId:'session-head',liveSessionId:'session-head',fence:7},status:'active'});
 for(const [requestId,objective] of [['second-goal','Second objective'],['third-goal','Third objective']])f.store.enqueueGoal({teamId:f.team.id,requestId,objective,expectedRevision:f.store.readSnapshot().revision});
 const accept=()=>{f.store.recordDelivery(w.id,{id:'delivery-'+w.id,previousDeliveryId:null,summary:'Approved handoff',evidenceRefs:['artifact:report'],attemptIds:[],generation:1,proof:{requestId:'native-proof',payloadHash:'a'.repeat(64)}});w=f.store.readWork(w.id);return f.store.decideWork({workId:w.id,requestId:'accept-'+w.id,deliveryId:'delivery-'+w.id,expectedWorkVersion:w.version,decision:'accept'});};
 accept();const old=w.id,goal=f.store.nextGoal(f.team.id);
 assert.throws(()=>f.store.prepareWork({teamId:f.team.id,requestId:'bypass-queue',expectedRevision:f.store.readSnapshot().revision,objective:'Other'}),/queued|transition/i);
 assert.throws(()=>f.store.updateRole({teamId:f.team.id,memberId:f.head.id,requestId:'race-role',expectedRevision:f.store.readSnapshot().revision,brief:'Changed',habits:'',collaboration:''}),/transition/i);
 const fresh=f.store.prepareOperation({teamId:f.team.id,memberId:f.head.id,configVersion:1,requestId:goal.launchRequests[f.head.id]},{scope:f.scope,nativeRequest:nativeLaunchIntent(f.team,f.head,f.scope),roleVersion:1,title:'Head',executionHostId:'local',runtimeId:'runtime-one'}).operation;
 const patch={status:'created',kind:'structured',handle:'chat-second',sessionId:'session-second',briefAccepted:true};f.store.settleOperation(fresh.requestId,fresh.nativeRequest.operationId,{...patch,public:publicOperation({...fresh,...patch})});
 w=f.store.prepareWork({teamId:f.team.id,requestId:goal.workRequestId,expectedRevision:f.store.readSnapshot().revision,objective:goal.objective}).work;
 assert.equal(w.handoff.summary,'Approved handoff');assert.notEqual(w.id,old);assert.equal(w.binding.sessionId,'session-second');assert.equal(w.run.state,'unverified');assert.equal(f.store.nextGoal(f.team.id),null);assert.equal(f.store.listGoals(f.team.id)[1].status,'queued');
 const {objectiveInstructions}=await import('../src/local/teamwork.mjs');assert.match(objectiveInstructions(w,f.team),/Approved handoff/);assert.match(objectiveInstructions(w,f.team),/folder:\/work/);
 w=f.store.updateWork(w.id,w.version,{run:{state:'verified',id:'second-run',consumerGeneration:1},instance:{kind:'structured',sessionId:'session-second',liveSessionId:'session-second',fence:1},status:'active'});accept();assert.equal(f.store.nextGoal(f.team.id).objective,'Third objective');
 await f.restart();assert.equal(f.store.listWorks().length,2);assert.equal(f.store.listWorks().filter(w=>w.status!=='completed').length,0);assert.notEqual(f.store.nextGoal(f.team.id).launchRequests[f.head.id],fresh.requestId);
});
