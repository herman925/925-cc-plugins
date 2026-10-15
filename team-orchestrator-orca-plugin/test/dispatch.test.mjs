import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
import { nativeLaunchIntent, publicOperation } from '../src/local/native-launch.mjs';
import { createWorkService } from '../src/local/teamwork.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
// Scripted native-host boundary, separate from the product's proof reader.
const nativeHash=(method,params)=>createHash('sha256').update(JSON.stringify(canonical({method,params}))).digest('hex');
async function fixture(t,{headAgent='codex',workerAgent='claude',kind='structured'}={}) {
 const profile=await mkdtemp(join(tmpdir(),'dispatch-'));let store=await openTeamStore({userData:profile});
 const scope={workspaceId:'folder:/work',executionHostId:'local',kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex')};
 const team=store.createTeam({requestId:'team',expectedRevision:0,form:{...DEFAULT_FORM,agents:[headAgent,workerAgent,workerAgent]}},scope).teams[0];
 const head=team.members[0], member=team.members[1], launch={teamId:team.id,memberId:head.id,configVersion:1,requestId:'launch'};
 const op=store.prepareOperation(launch,{scope,nativeRequest:nativeLaunchIntent(team,head,scope),roleVersion:1,title:'Head',executionHostId:'local',runtimeId:'runtime-one'}).operation;
 const binding={status:'created',kind,handle:kind==='structured'?'chat-head':'term-head',...(kind==='structured'?{sessionId:'codex_head'}:{paneKey:'tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),briefAccepted:true};
 store.settleOperation('launch',op.nativeRequest.operationId,{...binding,public:publicOperation({...op,...binding})});
 const db=new DatabaseSync(join(profile,'orchestration.db'));
 db.exec(`PRAGMA user_version=43;
 CREATE TABLE runs(id TEXT PRIMARY KEY,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER);
 CREATE TABLE tasks(id TEXT PRIMARY KEY,run_id TEXT,spec TEXT,status TEXT,result TEXT,created_by_terminal_handle TEXT,created_by_pane_key TEXT,created_by_process_incarnation TEXT,created_by_run_generation INTEGER);
 CREATE TABLE mutation_caller_identities(transport TEXT PRIMARY KEY,caller_fingerprint TEXT);
 INSERT INTO mutation_caller_identities VALUES('local_authenticated_transport','local-fingerprint');
 CREATE TABLE mutation_receipts(caller_fingerprint TEXT,request_id TEXT,method TEXT,payload_hash TEXT,state TEXT,receipt TEXT,PRIMARY KEY(caller_fingerprint,request_id));
 CREATE TABLE dispatch_contexts(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,creator_handle TEXT,creator_pane_key TEXT,creator_orca_session_id TEXT,creator_dispatch_id TEXT,assignee_handle TEXT,assignee_pane_key TEXT,assignee_orca_session_id TEXT,process_incarnation TEXT,host_scope TEXT,status TEXT,consumer_generation INTEGER);
 CREATE TABLE worker_dispatches(dispatch_id TEXT PRIMARY KEY,worktree_id TEXT,agent_terminal_handle TEXT,state TEXT,runtime_epoch TEXT,start_options TEXT);
 CREATE TABLE attempt_observation_facts(id TEXT PRIMARY KEY,dispatch_id TEXT,task_id TEXT,authority_id TEXT,facet TEXT,payload TEXT);
 CREATE TABLE messages(id TEXT PRIMARY KEY,run_id TEXT,from_handle TEXT,sender_pane_key TEXT,type TEXT,body TEXT,payload TEXT);
 `);
 const messages=[],calls=[];let onInput=()=>{};
 const rpc=async(method,params,envelope)=>{
  calls.push(method);
  if(method==='status.get')return {runtimeId:'runtime-one',capabilities:['orchestration.contract.v1','agent-session.structured.v1','terminal.prompt-delivery.v1','agent.launch.v2','agent.launch.replay-required.v1']};
  if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:'local'}};
  if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:codex_head'};
  if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:'codex_head',worktreeId:scope.workspaceId}};
  if(method==='agentSession.history')return {ok:true,page:{sessionId:'codex_head',fence:7,submissions:[],items:[]}};
  if(method==='terminal.show')return {terminal:{handle:'term-head',worktreeId:scope.workspaceId,executionHostId:'local',connected:true,writable:true,incarnationId:'head-instance',agentIdentity:headAgent,tabId:'tab',leafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}};
  if(method==='terminal.agentStatus')return {agentStatus:{handle:'term-head',isRunningAgent:true,status:'idle'}};
  if(method==='orchestration.runShow')return {run:{id:'run-head',objective:store.listWorks()[0].nativeObjective,consumer_generation:1}};
  if(method==='orchestration.taskList')return {tasks:db.prepare('SELECT id,run_id,status FROM tasks').all()};
  if(method==='settings.get')return {settings:{}};
  if(method==='preflight.detectAgents')return ['codex','claude'];
  if(method==='agentSession.createSupport')return {supported:true};
  if(method==='agentSession.modelCatalog')return {origin:'unknown'};
  if(method==='agentSession.send'||method==='terminal.send'){
   const text=params.body?.blocks[0].text??params.text;messages.push(text);
   const work=store.listWorks()[0];
   if(!db.prepare('SELECT id FROM runs').get())db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-head',work.nativeObjective,'this_database',kind==='terminal'?'term-head':null,kind==='terminal'?binding.paneKey:null,kind==='structured'?'codex_head':null,kind==='structured'?1:null,1,0);
   await onInput(text);
   return method==='agentSession.send'?{ok:true,fence:7,value:{clientMessageId:params.envelope.clientOperationId,submission:{clientMessageId:params.envelope.clientOperationId,dispatchState:'accepted'}}}:{send:{handle:'term-head',accepted:true,prompt:{requestId:envelope.orchestrationRequestId,processIncarnation:'head-instance',stages:['input_accepted'],observation:'supported'}}};
  }
  if(method==='orchestration.workerShow'){
   const d=db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(params.dispatch),w=db.prepare('SELECT * FROM worker_dispatches WHERE dispatch_id=?').get(params.dispatch);
   return {dispatch:{id:d.id,runId:d.run_id,taskId:d.task_id,assigneeHandle:d.assignee_handle,assigneePaneKey:d.assignee_pane_key,processIncarnation:d.process_incarnation,hostScope:JSON.parse(d.host_scope),status:d.status},worker:{dispatchId:d.id,worktreeId:w.worktree_id,agentTerminalHandle:w.agent_terminal_handle,state:w.state,runtimeEpoch:w.runtime_epoch,startOptions:JSON.parse(w.start_options)},observation:{status:'live',exactWorker:true},projection:{}};
  }
  throw Error('Forbidden/unexpected native method '+method);
 };
 let works=createWorkService({store,rpc,userData:profile,consent:async()=>{}});
 const work=await works.submit({teamId:team.id,requestId:'goal',expectedRevision:store.readSnapshot().revision,objective:'Audit'});
 const actor=params=>kind==='structured'?{...params,__orcaCallerOrcaSessionId:'codex_head'}:Object.fromEntries(Object.entries(params).map(([k,v])=>[['from','callerTerminalHandle','terminal'].includes(k)?k:k,['from','callerTerminalHandle'].includes(k)?{paneLeafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}:v]));
 const from=kind==='structured'?'orca_session_id:codex_head':'term-head';
 const receipt=(requestId,method,params,result,forged=false)=>db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',requestId,method,nativeHash(method,forged?params:actor(params)),'completed',JSON.stringify(result));
 const createIntent=(protocol,{taskId='task-one',taskKey='task-key-one',memberId=member.id,forged=false}={})=>{
  const role={brief:member.brief,habits:member.habits,collaboration:member.collaboration};
  const spec=JSON.stringify({protocol:'team-dispatch/v1',workId:work.id,token:protocol.token,generation:1,taskKey,memberId,configVersion:1,roleVersion:1,role,instruction:'Inspect the checkout and report evidence.'});
  const row={id:taskId,run_id:'run-head',spec,status:'ready',result:null};
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(taskId,'run-head',spec,'ready',null,kind==='terminal'?'term-head':null,kind==='terminal'?binding.paneKey:null,kind==='terminal'?'head-instance':null,kind==='terminal'?1:null);
  receipt('create-'+taskId,'orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:from},{task:row},forged);
 };
 const start=permit=>{
  const id='dispatch-'+permit.nativeTaskId;
  const hostScope={kind:'local',hostId:'local'};
  db.prepare('INSERT INTO dispatch_contexts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'run-head',permit.nativeTaskId,kind==='terminal'?'term-head':null,kind==='terminal'?binding.paneKey:null,kind==='structured'?'codex_head':null,null,'structworker_child','child-tab:child-leaf','claude_child','child-instance',JSON.stringify(hostScope),'dispatched',1);
  db.prepare('INSERT INTO worker_dispatches VALUES(?,?,?,?,?,?)').run(id,scope.workspaceId,'structworker_child','ready','runtime-one',JSON.stringify({resolvedWorktreeId:scope.workspaceId,agent:workerAgent,worktree:scope.workspaceId}));
  db.prepare("UPDATE tasks SET status='dispatched' WHERE id=?").run(permit.nativeTaskId);
  receipt('start-'+permit.nativeTaskId,'orchestration.workerStart',{...permit.startParams,from,devMode:false},{runId:'run-head',taskId:permit.nativeTaskId,dispatchId:id,state:'ready'});
  return id;
 };
 t.after(async()=>{db.close();store.close();await rm(profile,{recursive:true,force:true});});
 return {profile,get store(){return store;},team,member,work,get works(){return works;},rpc,messages,calls,db,createIntent,start,onInput:fn=>{onInput=fn;},async restart(){store.close();store=await openTeamStore({userData:profile});works=createWorkService({store,rpc,userData:profile,consent:async()=>{}});}};
}
test('genuine supervisor intent commits admission before native member start and records execution pending acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');
 const f=await fixture(t);const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);
 const protocol=f.store.readDispatchProtocol(f.work.id);
 assert.equal(protocol.state,'accepted');assert.notEqual(protocol.token,f.store.readWork(f.work.id).protocolToken);
 f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n')){const permit=JSON.parse(text.split('\n').slice(1).join('\n'));assert.equal(f.store.listDispatches(f.work.id)[0].status,'admitted');f.start(permit);}});
 await service.check(f.work.id);await service.check(f.work.id);
 let task=f.store.listDispatches(f.work.id)[0];assert.equal(task.status,'running');assert.equal(task.memberId,f.member.id);assert.equal(task.configVersion,1);assert.equal(task.roleVersion,1);
 assert.equal(f.calls.some(method=>/workerStart|runCreate|taskCreate|orchestration.send/.test(method)),false);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
 f.db.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id=?").run(task.dispatchId);
 f.db.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id=?").run(task.dispatchId);
 f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run('report-one','run-head','structworker_child','child-tab:child-leaf','worker_done','Inspection finished with tests.',JSON.stringify({taskId:'task-one',dispatchId:task.dispatchId,outcome:'succeeded'}));
 f.db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:report-one',task.dispatchId,'task-one','run_home:run-head','worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:report-one'}));
 await service.check(f.work.id);task=f.store.listDispatches(f.work.id)[0];assert.equal(task.status,'pending_acceptance');assert.equal(task.outcome,'succeeded');assert.match(task.result,/Inspection finished/);
 await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
});
test('already-started native work is retained as unadmitted uncertainty and reserves its member without a new permit',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.start({nativeTaskId:'task-one',startParams:{task:'task-one',worktree:'folder:/work',agent:'claude',run:'run-head'}});
 await service.check(f.work.id);
 const rows=f.store.listDispatches(f.work.id);assert.equal(rows.length,1);assert.equal(rows[0].admission,'unadmitted');assert.equal(rows[0].status,'unknown');
 assert.equal(rows[0].permit.state,'unknown');assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
 f.createIntent(protocol,{taskId:'task-two',taskKey:'task-key-two'});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('forged native caller, indirect member, and revoked Run generation cannot authorize a permit',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.createIntent(protocol,{forged:true});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);assert.match(f.store.readDispatchProtocol(f.work.id).detail,/author proof/);
 f.createIntent(protocol,{taskId:'task-root',taskKey:'root',memberId:f.team.members[0].id});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);
 f.db.exec('UPDATE runs SET consumer_generation=3,coordinator_orca_session_id_generation=3');
 f.createIntent(protocol,{taskId:'after-takeover',taskKey:'after-takeover'});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('two distinct members cannot adopt the same active native session even when native receipts otherwise match',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 f.createIntent(protocol);await service.check(f.work.id);
 f.createIntent(protocol,{taskId:'task-other',taskKey:'other-member',memberId:f.team.members[2].id});await service.check(f.work.id);
 const tasks=f.store.listDispatches(f.work.id);assert.equal(tasks.length,2);assert.equal(tasks[0].status,'running');
 assert.equal(tasks[1].status,'unknown');assert.equal(tasks[1].binding,undefined);assert.match(tasks[1].detail,/another member/);
});
test('unknown permit survives worker restart and late native start settles only its saved attempt without another input',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const make=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let service=make();
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));let savedPermit;
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n')){savedPermit=JSON.parse(text.split('\n').slice(1).join('\n'));throw Error('lost permit receipt');}});
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'unknown');
 await f.restart();service=make();await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
 f.start(savedPermit);await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');assert.equal(f.store.listDispatches(f.work.id).length,1);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
});
for(const kind of ['structured','terminal'])test(`Claude supervisor to Codex member uses actual ${kind} identity and preserves native caller proof`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{headAgent:'claude',workerAgent:'codex',kind}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.startParams.agent,'codex');assert.equal(row.status,'running');
 assert.ok(f.calls.includes(kind==='terminal'?'terminal.send':'agentSession.send'));
});
test('a late native Task proves an ambiguous protocol input without resending the protocol',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PROTOCOL\n'))throw Error('lost protocol receipt');});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);assert.equal(protocol.state,'unknown');f.createIntent(protocol);
 f.onInput(()=>{});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PROTOCOL\n')).length,1);
});
test('wrong native execution host and obsolete Dispatch reports remain unconfirmed and cannot complete a member',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n')){const id=f.start(JSON.parse(text.split('\n').slice(1).join('\n')));f.db.prepare('UPDATE dispatch_contexts SET host_scope=? WHERE id=?').run(JSON.stringify({kind:'ssh',targetId:'wrong-host'}),id);}});
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.status,'unknown');assert.equal(row.binding,undefined);assert.match(row.detail,/host/);
 f.db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:old-report','old-dispatch','task-one','run_home:run-head','worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:old-report'}));
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].outcome,undefined);
});
test('SQLite admission failure sends no permit and rollback keeps the member available for the exact corrected intent',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 const fault=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>fault.close());
 fault.exec("CREATE TRIGGER refuse_admission BEFORE INSERT ON receipts WHEN NEW.id LIKE 'dispatch:%' BEGIN SELECT RAISE(ABORT,'admission disk failure'); END");
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,0);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
 fault.exec('DROP TRIGGER refuse_admission');await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
});
test('unverifiable native worker observation preserves identity but does not claim an active assignment',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const rpc=async(method,...args)=>{const value=await f.rpc(method,...args);if(method==='orchestration.workerShow')value.observation={status:'unverifiable',exactWorker:false};return value;};
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.status,'unknown');assert.equal(row.binding.handle,'structworker_child');
});
test('corrupt stored completion or protocol evidence blocks reads without inventing acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await service.check(f.work.id);
 const row=f.store.listDispatches(f.work.id)[0],fault=new DatabaseSync(join(f.profile,'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));t.after(()=>fault.close());
 const corrupt={...row,status:'pending_acceptance'};fault.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(corrupt),`dispatch:${row.id}`);
 assert.throws(()=>f.store.readSnapshot(),/damaged/);
 assert.equal(fault.prepare('SELECT json FROM receipts WHERE id=?').get(`dispatch:${row.id}`).json,JSON.stringify(corrupt));
 fault.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify(row),`dispatch:${row.id}`);
 const protocol=f.store.readDispatchProtocol(f.work.id);fault.prepare('UPDATE receipts SET json=? WHERE id=?').run(JSON.stringify({...protocol,state:'not_sent'}),`dispatch-protocol:${f.work.id}`);
 assert.throws(()=>f.store.readSnapshot(),/protocol is damaged/);
});
test('unavailable native evidence reports a bounded diagnostic without exposing the verified profile path',async()=>{
 const {readNativeDispatchEvidence}=await import('../src/local/native-dispatch.mjs');
 const result=await readNativeDispatchEvidence('/private/nonexistent-sensitive-orca-profile',{work:{}});
 assert.equal(result.state,'unverified');assert.equal(result.detail.includes('/private/'),false);
});
test('native start arriving during capability reads is not retroactively admitted from an older Task snapshot',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);let inject=false;
 const rpc=async(method,...args)=>{if(inject&&method==='preflight.detectAgents'){inject=false;f.start({nativeTaskId:'task-one',startParams:{task:'task-one',worktree:'folder:/work',agent:'claude',run:'run-head'}});}return f.rpc(method,...args);};
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));inject=true;
 await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];assert.equal(row.admission,'unadmitted');assert.equal(row.status,'unknown');
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('an observed native start after app reservation but before permit is fenced without issuing the permit',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);let inject=false;
 const works={...f.works,async verifyWork(...args){const value=await f.works.verifyWork(...args);if(inject&&f.store.listDispatches(f.work.id).length){inject=false;f.start({nativeTaskId:'task-one',startParams:{task:'task-one',worktree:'folder:/work',agent:'claude',run:'run-head'}});}return value;}};
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));inject=true;await service.check(f.work.id);
 const row=f.store.listDispatches(f.work.id)[0];assert.equal(inject,false);assert.equal(row.admission,'unadmitted');assert.equal(row.status,'unknown');assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,0);
});
test('recovery reads explicit Run and exact Dispatch, labels incomplete output and never sends or releases the attempt',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');const f=await fixture(t);
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice('TEAM_DISPATCH_PERMIT\n'.length)));});await service.check(f.work.id);await f.restart();
 let exited=false,exact=true;const readCalls=[];
 const rpc=async(method,params)=>{readCalls.push({method,params});if(method==='orchestration.workerRead')return {dispatchId:params.dispatch,source:'terminal',sourceIdentity:'native-output',sourceExact:true,contentComplete:false,warnings:['SSH transcript was clipped'],archived:true};const result=await f.rpc(method,params);if(method==='orchestration.workerShow')result.observation={status:exited?'exited':'live',exactWorker:exact};return result;};
 const recovery=createRecoveryService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});const before=f.messages.length;
 await recovery.checkWork(f.work.id);let task=f.store.dispatchProjection(f.work.id).tasks[0];assert.equal(task.recovery.state,'confirmed_effect');assert.equal(task.recovery.incomplete,true);assert.match(task.recovery.output.warnings[0],/clipped/);
 exited=true;exact=false;await recovery.checkWork(f.work.id);assert.equal(f.store.dispatchProjection(f.work.id).tasks[0].recovery.liveness,'unknown');
 exact=true;await recovery.checkWork(f.work.id);task=f.store.dispatchProjection(f.work.id).tasks[0];assert.equal(task.recovery.state,'stopped');assert.equal(task.status,'running','execution evidence does not rewrite business task facts');
 assert.equal(f.messages.length,before);assert.equal(readCalls.some(row=>/inbox|ack|send|start|launch/i.test(row.method)),false);assert.equal(readCalls.find(row=>row.method==='orchestration.taskList').params.run,'run-head');
 f.createIntent(f.store.readDispatchProtocol(f.work.id),{taskId:'blocked',taskKey:'blocked'});await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,1);
});
