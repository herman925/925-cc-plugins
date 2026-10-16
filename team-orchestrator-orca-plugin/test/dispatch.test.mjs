import {WORKER_RULES} from '../src/dispatch.mjs';
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
async function fixture(t,{headAgent='codex',workerAgent='claude',kind='structured',childKind='structured',prestarted=false,preparedKind='structured',queuedPermits=false}={}) {
 const profile=await mkdtemp(join(tmpdir(),'dispatch-'));let store=await openTeamStore({userData:profile});
 const scope={workspaceId:'folder:/work',executionHostId:'local',kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex')};
 const team=store.createTeam({requestId:'team',expectedRevision:0,form:{...DEFAULT_FORM,launchMode:prestarted?'all':'on-demand',agents:[headAgent,workerAgent,workerAgent]}},scope).teams[0];
 const head=team.members[0], member=team.members[1], launch={teamId:team.id,memberId:head.id,configVersion:1,requestId:'launch'};
 const op=store.prepareOperation(launch,{scope,nativeRequest:nativeLaunchIntent(team,head,scope),roleVersion:1,title:'Head',executionHostId:'local',runtimeId:'runtime-one'}).operation;
 const binding={status:'created',kind,handle:kind==='structured'?'chat-head':'term-head',...(kind==='structured'?{sessionId:'codex_head'}:{paneKey:'tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),briefAccepted:true};
 store.settleOperation('launch',op.nativeRequest.operationId,{...binding,public:publicOperation({...op,...binding})});
 if(prestarted){
  const input={teamId:team.id,memberId:member.id,configVersion:1,requestId:'prepared-child'},op=store.prepareOperation(input,{scope,nativeRequest:nativeLaunchIntent(team,member,scope),roleVersion:1,title:member.name,executionHostId:'local',runtimeId:'runtime-one'}).operation;
  const value={status:'created',kind:preparedKind,handle:preparedKind==='structured'?'prepared-child-handle':'structworker_child',...(preparedKind==='structured'?{sessionId:'claude_child'}:{paneKey:'child-tab:child-leaf',observation:{incarnationId:'child-instance'}}),briefAccepted:true};
  store.settleOperation(input.requestId,op.nativeRequest.operationId,{...value,public:publicOperation({...op,...value})});
 }
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
  if(method==='status.get')return {runtimeId:'runtime-one',capabilities:[...(queuedPermits?['agent-session.queued-messages.v1']:[]),'orchestration.contract.v1','agent-session.structured.v1','terminal.prompt-delivery.v1','agent.launch.v2','agent.launch.replay-required.v1']};
  if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:'local'}};
  if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:'+params.sessionId};
  if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:params.address.slice('orca_session_id:'.length),worktreeId:scope.workspaceId}};
  if(method==='agentSession.history')return {ok:true,page:{sessionId:params.sessionId,fence:7,submissions:[],items:[]}};
  if(method==='terminal.show'&&params.terminal==='structworker_child')return {terminal:{handle:'structworker_child',worktreeId:scope.workspaceId,executionHostId:'local',connected:true,writable:true,incarnationId:'child-instance',ptyId:'child-pty',agentIdentity:workerAgent,tabId:'child-tab',leafId:'child-leaf'}};
  if(method==='terminal.show')return {terminal:{handle:'term-head',worktreeId:scope.workspaceId,executionHostId:'local',connected:true,writable:true,incarnationId:'head-instance',ptyId:'head-pty',agentIdentity:headAgent,tabId:'tab',leafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}};
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
   if(queuedPermits&&text.startsWith('TEAM_DISPATCH_PERMIT')){assert.equal(params.delivery,'queue-if-active');return {ok:true,value:{clientMessageId:params.envelope.clientOperationId,queued:{messageId:'queued-'+params.envelope.clientOperationId,state:'waiting',position:1}}};}
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
 const receipt=(requestId,method,params,result,forged=false)=>db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',requestId,method,nativeHash(method,forged?params:actor(params.terminal==='structworker_child'?{...params,terminal:{paneKey:'child-tab:child-leaf'}}:params)),'completed',JSON.stringify(result));
 const createIntent=(protocol,{taskId='task-one',taskKey='task-key-one',memberId=member.id,forged=false,dependencies=[],previousAttemptId,writeScope=[]}={})=>{
  const role={brief:member.brief,habits:member.habits,collaboration:member.collaboration};
  const spec=JSON.stringify({protocol:'team-dispatch/v1',workerRules:WORKER_RULES,workId:work.id,token:protocol.token,generation:1,taskKey,memberId,configVersion:1,roleVersion:1,role,instruction:'Inspect the checkout and report evidence.',dependencies,writeScope,...(previousAttemptId?{previousAttemptId}:{})});
  const row={id:taskId,run_id:'run-head',spec,status:'ready',result:null};
  db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(taskId,'run-head',spec,'ready',null,kind==='terminal'?'term-head':null,kind==='terminal'?binding.paneKey:null,kind==='terminal'?'head-pty:head-instance':null,kind==='terminal'?1:null);
  receipt('create-'+taskId,'orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:from},{task:row},forged);
 };
 const start=permit=>{
  const id='dispatch-'+permit.nativeTaskId,chat=Boolean(permit.startParams.terminal?.startsWith('orca_session_id:')),handle=chat?permit.startParams.terminal:'structworker_child',pane=chat?null:'child-tab:child-leaf';
  const hostScope={kind:'local',hostId:'local'};
  db.prepare('INSERT INTO dispatch_contexts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,'run-head',permit.nativeTaskId,kind==='terminal'?'term-head':null,kind==='terminal'?binding.paneKey:null,kind==='structured'?'codex_head':null,null,handle,pane,childKind==='structured'?'claude_child':null,chat?null:childKind==='terminal'?'child-pty:child-instance':'child-instance',JSON.stringify(hostScope),'dispatched',1);
  db.prepare('INSERT INTO worker_dispatches VALUES(?,?,?,?,?,?)').run(id,scope.workspaceId,handle,'ready','runtime-one',JSON.stringify({resolvedWorktreeId:scope.workspaceId,agent:workerAgent,worktree:scope.workspaceId}));
  db.prepare("UPDATE tasks SET status='dispatched' WHERE id=?").run(permit.nativeTaskId);
  receipt('start-'+permit.nativeTaskId,'orchestration.workerStart',{...permit.startParams,from,devMode:false},{runId:'run-head',taskId:permit.nativeTaskId,dispatchId:id,state:'ready'});
  return id;
 };
 t.after(async()=>{db.close();store.close();await rm(profile,{recursive:true,force:true});});
 const complete=attempt=>{
  const reportId='report-'+attempt.nativeTaskId,d=db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(attempt.dispatchId);
  db.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id=?").run(attempt.dispatchId);
  db.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id=?").run(attempt.dispatchId);
  db.prepare("UPDATE tasks SET status='completed',result='Original execution result' WHERE id=?").run(attempt.nativeTaskId);
  db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(reportId,'run-head',d.assignee_handle,d.assignee_pane_key,'worker_done','Original execution result',JSON.stringify({taskId:attempt.nativeTaskId,dispatchId:attempt.dispatchId,outcome:'succeeded'}));
  db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:'+reportId,attempt.dispatchId,attempt.nativeTaskId,'run_home:run-head','worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:'+reportId}));
 };
 const review=(attempt,{decision='accept',forged=false,patch={},requestId='review-'+attempt.id}={})=>{
  const value={protocol:'team-review/v1',workId:work.id,token:attempt.token,generation:attempt.generation,taskKey:attempt.taskKey,attemptId:attempt.id,nativeTaskId:attempt.nativeTaskId,dispatchId:attempt.dispatchId,reviewToken:attempt.reviewToken,reviewerMemberId:head.id,decision,evidenceRefs:[attempt.evidenceId],summary:'Checked result and validation.',...patch};
  const result=JSON.stringify(value),task={...db.prepare('SELECT * FROM tasks WHERE id=?').get(attempt.nativeTaskId),result};
  db.prepare('UPDATE tasks SET result=? WHERE id=?').run(result,attempt.nativeTaskId);
  receipt(requestId,'orchestration.taskUpdate',{id:task.id,status:'completed',result,run:'run-head',callerTerminalHandle:from},{task},forged);
 };
 return {complete,review,profile,get store(){return store;},team,member,work,get works(){return works;},rpc,messages,calls,db,createIntent,start,onInput:fn=>{onInput=fn;},async restart(){store.close();store=await openTeamStore({userData:profile});works=createWorkService({store,rpc,userData:profile,consent:async()=>{}});}};
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
test('recovery refuses a new native incarnation under an existing Dispatch without overwriting the saved member binding',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice('TEAM_DISPATCH_PERMIT\n'.length)));});await service.check(f.work.id);
 const before=f.store.listDispatches(f.work.id)[0];f.db.exec("UPDATE dispatch_contexts SET process_incarnation='replacement-instance'");
 await createRecoveryService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}}).checkWork(f.work.id);
 const after=f.store.listDispatches(f.work.id)[0];assert.equal(after.binding.incarnationId,before.binding.incarnationId);assert.equal(after.recovery.state,'unknown');
});

test('supervisor acceptance alone releases an application dependency and survives restart with original result',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const make=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let service=make();
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});
 f.createIntent(protocol);await service.check(f.work.id);let first=f.store.listDispatches(f.work.id)[0];
 f.createIntent(protocol,{taskId:'dependent',taskKey:'dependent',dependencies:[first.taskKey]});
 f.complete(first);await service.check(f.work.id);first=f.store.listDispatches(f.work.id)[0];
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(first.status,'pending_acceptance');
 f.review(first);await service.check(f.work.id);await service.check(f.work.id);
 first=f.store.listDispatches(f.work.id)[0];assert.equal(first.status,'accepted');assert.equal(first.result,'Original execution result');assert.equal(first.review.decision,'accept');
 assert.equal(f.store.listDispatches(f.work.id).length,2);
 const dependent=f.store.listDispatches(f.work.id)[1];assert.equal(dependent.status,'running');assert.equal(dependent.startParams.terminal,'orca_session_id:claude_child');
 f.complete(dependent);await service.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[1]);await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[1].status,'accepted');
 await f.restart();service=make();await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].review.requestId,'review-'+first.id);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,2);
});
for(const kind of ['structured','terminal'])test(`rework reuses the verified retained child session under a new attempt (${kind} supervisor)`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{kind});
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});
 f.createIntent(protocol);await service.check(f.work.id);f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);
 const first=f.store.listDispatches(f.work.id)[0];f.review(first,{decision:'rework'});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id)[0].status,'rework');
 f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 const attempts=f.store.listDispatches(f.work.id);assert.equal(attempts.length,2);assert.equal(attempts[1].status,'running');
 assert.equal(attempts[1].startParams.terminal,'orca_session_id:claude_child');assert.equal(attempts[1].startParams.agent,undefined);
 assert.equal(attempts[0].result,'Original execution result');assert.equal(attempts[1].outcome,undefined);
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[1].status,'running');
 f.complete(attempts[1]);await service.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[1]);await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id)[1].status,'accepted');
});
for(const fault of ['wrong-author','wrong-work','wrong-attempt','missing-evidence','wrong-generation'])test(`${fault} review cannot accept native completion or release its dependent`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const row=f.store.listDispatches(f.work.id)[0];
 f.createIntent(protocol,{taskId:'dependent',taskKey:'dependent',dependencies:[row.taskKey]});
 const patch={'wrong-work':{workId:'another-work'},'wrong-attempt':{attemptId:'obsolete'},'missing-evidence':{evidenceRefs:[]},'wrong-generation':{generation:4}}[fault]??{};
 f.review(row,{forged:fault==='wrong-author',patch});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.store.listDispatches(f.work.id)[0].status,'pending_acceptance');assert.equal(f.store.listDispatches(f.work.id)[0].result,'Original execution result');
});
test('conflicting late decision cannot replace prior review, finish rework or permit a duplicate',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);
 const make=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});let service=make();
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];
 f.review(first,{decision:'rework'});await service.check(f.work.id);await f.restart();service=make();
 f.createIntent(protocol,{taskId:'dependent',taskKey:'dependent',dependencies:[first.taskKey]});
 f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 f.review(first,{requestId:'late-conflict'});await service.check(f.work.id);await service.check(f.work.id);
 const rows=f.store.listDispatches(f.work.id);assert.equal(rows.length,2);assert.equal(rows[0].status,'rework');assert.equal(rows[1].status,'running');assert.equal(rows[1].result,undefined);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,2);
 f.complete(rows[1]);await service.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[1]);await service.check(f.work.id);await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,3);assert.equal(f.store.listDispatches(f.work.id)[2].taskKey,'dependent');assert.equal(f.store.listDispatches(f.work.id)[2].status,'running');
});
test('unverifiable retained session keeps rework reserved and never falls back to fresh launch',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t);let unavailable=false;
 const rpc=async(method,...args)=>{if(unavailable&&method==='orchestration.partyLocation'&&args[0].address==='orca_session_id:claude_child')return {location:null,lost:'chat'};return f.rpc(method,...args);};
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];f.review(first,{decision:'rework'});await service.check(f.work.id);
 unavailable=true;f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT\n')).length,1);
 assert.match(f.store.readDispatchProtocol(f.work.id).detail,/closed|unverified/);
});

test('rework retains exact terminal process and normalizes the native target independently from its supervisor',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{childKind:'terminal'}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await service.check(f.work.id);
 f.complete(f.store.listDispatches(f.work.id)[0]);await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];f.review(first,{decision:'rework'});await service.check(f.work.id);
 f.createIntent(protocol,{taskId:'redo',previousAttemptId:first.id});await service.check(f.work.id);
 const next=f.store.listDispatches(f.work.id)[1];assert.equal(next.status,'running');assert.equal(next.startParams.terminal,'structworker_child');assert.equal(next.startParams.agent,undefined);assert.equal(next.binding.incarnationId,'child-pty:child-instance');
});
test('overall delivery requires native Head author proof and user decision; rework keeps queued goals and stale acceptance conflicts',async t=>{
 const {createLifecycleService}=await import('../src/local/lifecycle.mjs');
 const f=await fixture(t),notices=[];
 const {createDispatchService}=await import('../src/local/dispatch.mjs');await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const service=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works,notify:async n=>{notices.push(n);return {delivered:true};}}),p=f.store.readDispatchProtocol(f.work.id);
 const proposal=(id,forged=false)=>{
  const spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:p.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:id==='delivery-two'?'delivery-one':null,summary:'Audit complete',evidenceRefs:['artifact:report.md'],attemptIds:[]});
  const task={id,run_id:'run-head',spec,status:'ready'};f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,'run-head',spec,'ready',null,null,null,null,null);
  f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','create-'+id,'orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:'orca_session_id:codex_head',__orcaCallerOrcaSessionId:forged?'forged':'codex_head'}),'completed',JSON.stringify({task}));
 };
 proposal('forged',true);await service.check(f.work.id);assert.equal(f.store.readSnapshot().works[0].delivery,undefined);f.db.prepare('DELETE FROM tasks WHERE id=?').run('forged');
 proposal('delivery-one');await service.check(f.work.id);await service.check(f.work.id);
 let w=f.store.readSnapshot().works[0];assert.equal(w.delivery.id,'delivery-one');assert.equal(w.status,'awaiting_acceptance');assert.equal(notices.length,1);
 f.store.enqueueGoal({teamId:f.team.id,requestId:'next',expectedRevision:f.store.readSnapshot().revision,objective:'Next goal'});
 const rework={requestId:'user-rework',workId:w.id,deliveryId:w.delivery.id,expectedWorkVersion:w.version,decision:'rework',feedback:'Add the missing comparison'};
 await service.decide(rework);await service.decide(rework);assert.equal(f.store.readWork(w.id).status,'active');assert.equal(f.store.listGoals(f.team.id)[0].status,'queued');
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_GOAL_REWORK')).length,1);
 await assert.rejects(service.decide({...rework,requestId:'stale',decision:'accept'}),/delivery|changed|superseded/i);
 proposal('delivery-two');await service.check(w.id);w=f.store.readSnapshot().works[0];
 const accepted={requestId:'user-accept',workId:w.id,deliveryId:w.delivery.id,expectedWorkVersion:w.version,decision:'accept'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('unregistered','run-head','{}','completed',null,null,null,null,null);
 await assert.rejects(service.decide(accepted),/Unregistered native work/);assert.equal(f.store.readWork(w.id).status,'awaiting_acceptance');f.db.prepare('DELETE FROM tasks WHERE id=?').run('unregistered');
 await service.decide(accepted);await service.decide(accepted);assert.equal(f.store.readWork(w.id).status,'completed');assert.equal(f.store.listGoals(f.team.id)[0].status,'reserved');
 assert.equal(f.store.isActiveOperation(f.store.readOperation('launch')),false);assert.equal(f.store.readOperation('launch').status,'created');
 const callCount=f.calls.length;await f.works.check(w.id);await f.works.reconcile();await service.check(w.id);
 const {createQuestionService}=await import('../src/local/questions.mjs'),{createRecoveryService}=await import('../src/local/recovery.mjs');
 await createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(w.id);await createRecoveryService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}}).checkWork(w.id);await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(w.id);
 assert.equal(f.calls.length,callCount,'all closed Work observation loops are effect-free');assert.equal(f.store.readWork(w.id).status,'completed');
 await f.restart();assert.equal(f.store.readWork(w.id).status,'completed');assert.equal(f.store.readSnapshot().works[0].delivery.summary,'Audit complete');
});

test('declared overlapping paths queue until acceptance while independent members proceed without a worker cap',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.createIntent(protocol,{writeScope:[{path:'src',kind:'directory'}]});
 f.createIntent(protocol,{taskId:'overlap',taskKey:'overlap',memberId:f.team.members[2].id,writeScope:[{path:'src/app.js',kind:'file'}]});
 f.createIntent(protocol,{taskId:'independent',taskKey:'independent',memberId:f.team.members[3].id,writeScope:[{path:'docs/readme.md',kind:'file'}]});
 await service.check(f.work.id);
 assert.deepEqual(f.store.listDispatches(f.work.id).map(row=>row.taskKey),['task-key-one','independent']);
 const queued=f.store.dispatchProjection(f.work.id).queuedTasks;
 assert.equal(queued.length,1);assert.equal(queued[0].taskKey,'overlap');assert.match(queued[0].detail,/scope.*task-key-one/i);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,2);
 await f.restart();assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks[0].taskKey,'overlap');
});

for(const headAgent of ['codex','claude'])test(`prepared structured member reuses canonical session without preferences under ${headAgent} supervisor`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true,headAgent}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));let permit;
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){permit=JSON.parse(text.split('\n').slice(1).join('\n'));f.start(permit);}});
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0]?.status,'running');
 assert.equal(permit.startParams.terminal,'orca_session_id:claude_child');
 assert.deepEqual(Object.keys(permit.startParams).sort(),['run','task','terminal','worktree']);
 await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,1);
 assert.equal(f.calls.some(method=>/agent.launch|terminal.create|workerStart/.test(method)),false);
});

for(const hold of ['pending_acceptance','unknown','rework'])test(`overlapping scope remains reserved during ${hold}, accepted scope releases queued task`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){const permit=JSON.parse(text.split('\n').slice(1).join('\n'));if(permit.nativeTaskId==='task-one')f.start(permit);}});
 f.createIntent(protocol,{writeScope:[{path:'src',kind:'directory'}]});await service.check(f.work.id);
 let first=f.store.listDispatches(f.work.id)[0];
 if(hold==='unknown')f.db.prepare("UPDATE mutation_receipts SET payload_hash='unverified' WHERE request_id='start-task-one'").run();
 else {f.complete(first);await service.check(f.work.id);first=f.store.listDispatches(f.work.id)[0];if(hold==='rework'){f.review(first,{decision:'rework'});await service.check(f.work.id);}}
 f.createIntent(protocol,{taskId:'overlap',taskKey:'overlap',memberId:f.team.members[2].id,writeScope:[{path:'src/app.js',kind:'file'}]});await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);assert.match(f.store.dispatchProjection(f.work.id).queuedTasks[0].detail,/scope conflicts/);
 if(hold==='pending_acceptance'){f.review(first);await service.check(f.work.id);await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,2);assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks.length,0);}
});
for(const fault of ['closed','wrong-workspace','self','changed-preferences'])test(`prepared ${fault} member stays reserved without fresh launch`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true});
 const rpc=async(method,params,...rest)=>{
  if(params?.sessionId==='claude_child'&&method==='orchestration.sessionAddress'&&fault==='self')return {orcaSessionId:'orca_session_id:codex_head'};
  if(params?.address==='orca_session_id:claude_child'&&method==='orchestration.partyLocation'&&fault!=='self'&&fault!=='changed-preferences')return {location:fault==='closed'?null:{kind:'chat',sessionId:'claude_child',worktreeId:'foreign'}};
  return f.rpc(method,params,...rest);
 };
 if(fault==='changed-preferences'){const op=f.store.readMemberOperation(f.member.id);f.store.settleOperation(op.requestId,op.nativeRequest.operationId,{nativeRequest:{...op.nativeRequest,sessionOptions:{model:'different'}}});}
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,0);assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks.length,1);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,0);assert.equal(f.store.readMemberOperation(f.member.id).status,'created');
});

test('prepared PTY preserves native process identity and reuses without model overrides',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true,preparedKind:'terminal',childKind:'terminal'}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];assert.equal(attempt.status,'running');assert.equal(attempt.startParams.terminal,'structworker_child');assert.equal(attempt.binding.incarnationId,'child-pty:child-instance');assert.equal(Object.hasOwn(attempt.startParams,'agent'),false);
});

test('one confirmed failed member task holds its dependents but permits independent nonconflicting work',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT')){const permit=JSON.parse(text.split('\n').slice(1).join('\n'));if(permit.nativeTaskId==='task-one')f.start(permit);}});
 f.createIntent(protocol,{writeScope:[{path:'src',kind:'directory'}]});await service.check(f.work.id);const first=f.store.listDispatches(f.work.id)[0];f.complete(first);
 f.db.prepare("UPDATE dispatch_contexts SET status='failed'").run();f.db.prepare("UPDATE worker_dispatches SET state='failed'").run();f.db.prepare("UPDATE tasks SET status='failed'").run();
 f.db.prepare("UPDATE attempt_observation_facts SET payload=json_set(payload,'$.outcome','failed')").run();f.db.prepare("UPDATE messages SET payload=json_set(payload,'$.outcome','failed')").run();
 await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].outcome,'failed');
 f.createIntent(protocol,{taskId:'blocked',taskKey:'blocked',memberId:f.team.members[2].id,dependencies:[first.taskKey]});
 f.createIntent(protocol,{taskId:'independent',taskKey:'independent',memberId:f.team.members[3].id,writeScope:[{path:'docs',kind:'directory'}]});await service.check(f.work.id);
 assert.deepEqual(f.store.listDispatches(f.work.id).map(row=>row.taskKey),[first.taskKey,'independent']);assert.match(f.store.dispatchProjection(f.work.id).queuedTasks[0].detail,/dependencies/);
});

test('retiring a preparation pointer cannot authorize a second session while its Dispatch remains reserved',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{prestarted:true}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));await service.check(f.work.id);
 const prior=f.store.readMemberOperation(f.member.id);f.store.retireBinding({memberId:f.member.id,requestId:prior.requestId,instanceGeneration:prior.instanceGeneration});
 assert.throws(()=>f.store.prepareOperation({teamId:f.team.id,memberId:f.member.id,configVersion:1,requestId:'second-session'},{...prior,nativeRequest:nativeLaunchIntent(f.team,f.member,prior.scope)}),/reserved|binding/);
});

test('busy structured supervisor queues independent permits under negotiated native queue support',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{queuedPermits:true}),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);f.createIntent(protocol,{taskId:'other',taskKey:'other',memberId:f.team.members[2].id});
 await service.check(f.work.id);assert.deepEqual(f.store.listDispatches(f.work.id).map(row=>row.status),['awaiting_start','awaiting_start']);
 assert.ok(f.store.listDispatches(f.work.id).every(row=>row.detail.includes('queued')));await service.check(f.work.id);assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,2);
});

test('paused member admission queues its Task while independent members continue and resume releases the queue',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);
 f.store.setAdmission({teamId:f.team.id,memberId:f.member.id,paused:true,requestId:'pause',expectedRevision:f.store.readSnapshot().revision});f.createIntent(protocol);f.createIntent(protocol,{taskId:'independent',taskKey:'independent',memberId:f.team.members[2].id});await service.check(f.work.id);assert.deepEqual(f.store.listDispatches(f.work.id).map(a=>a.taskKey),['independent']);assert.match(f.store.dispatchProjection(f.work.id).queuedTasks[0].detail,/paused/);
 f.store.setAdmission({teamId:f.team.id,memberId:f.member.id,paused:false,requestId:'resume',expectedRevision:f.store.readSnapshot().revision});await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id).length,2);assert.equal(f.store.dispatchProjection(f.work.id).queuedTasks.length,0);
});
for(const outcome of ['stopped','assignment-only','unknown'])test(`native ${outcome} stop preserves exact Dispatch and scope; only positive process evidence proves stopped`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const {createStopService}=await import('../src/local/stop.mjs');const f=await fixture(t),service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await service.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0],stops=createStopService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}});
 const row=await stops.prepare({requestId:'stop-one',teamId:f.team.id,memberId:f.member.id,workId:f.work.id,attemptId:attempt.id}),plan=await stops.validate(row.requestId);assert.deepEqual(plan.params,{dispatch:attempt.dispatchId});assert.equal(plan.envelope.orchestrationRequestId,row.nativeRequestId);
 const receipt={dispatchId:attempt.dispatchId,state:outcome==='unknown'?'stop_unknown':'stopped',processAction:outcome==='assignment-only'?'none':'closed_agent_terminal',...(outcome==='stopped'?{close:{ptyKilled:true}}:{})};
 // Simulate native response loss: reconcile exact UUID/fingerprint from actual native-shaped ledger.
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',row.nativeRequestId,'orchestration.workerStop',nativeHash('orchestration.workerStop',plan.params),'completed',JSON.stringify(receipt));
 assert.equal((await stops.check(row.requestId)).state,outcome==='stopped'?'stopped':'unknown');assert.equal(f.store.readReceipt(`dispatch-member:${f.member.id}`).id,attempt.id);assert.deepEqual(f.store.listDispatches(f.work.id)[0],attempt);assert.equal(await stops.validate(row.requestId),null);assert.equal(f.store.workClosureBlockers(f.work.id).some(reason=>reason.includes('Stop')),outcome!=='stopped');if(outcome!=='stopped')assert.throws(()=>f.store.assertAdmission(f.team.id,f.member.id),/Stop outcome/);
});
test('stop refuses an unverified native worker observation and exact exit later reconciles an unknown request without effect',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const {createStopService}=await import('../src/local/stop.mjs');const f=await fixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await dispatch.check(f.work.id);const attempt=f.store.listDispatches(f.work.id)[0];let observation={exactWorker:false,status:'unverifiable'};
 const rpc=async(method,params)=>{const value=await f.rpc(method,params);return method==='orchestration.workerShow'?{...value,observation}:value;},stops=createStopService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),row=await stops.prepare({requestId:'uncertain-stop',teamId:f.team.id,memberId:f.member.id,workId:f.work.id,attemptId:attempt.id});await assert.rejects(stops.validate(row.requestId),/ownership/);assert.equal(f.store.readStop(row.requestId).state,'unknown');
 // A separate admitted request with lost receipt can later use the native exact-exit projection.
 // This row was refused before a plan; its missing submission is deliberately not promoted.
 assert.equal((await stops.check(row.requestId)).state,'unknown');
 observation={exactWorker:true,status:'live'};
 const other=await fixture(t),otherDispatch=createDispatchService({store:other.store,rpc:other.rpc,userData:other.profile,consent:async()=>{},works:other.works});await otherDispatch.check(other.work.id);other.createIntent(other.store.readDispatchProtocol(other.work.id));other.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))other.start(JSON.parse(text.split('\n').slice(1).join('\n')));});await otherDispatch.check(other.work.id);const active=other.store.listDispatches(other.work.id)[0],read=async(method,params)=>{const value=await other.rpc(method,params);return method==='orchestration.workerShow'?{...value,observation}:value;},service=createStopService({store:other.store,rpc:read,userData:other.profile,consent:async()=>{}}),intent=await service.prepare({requestId:'lost-stop',teamId:other.team.id,memberId:other.member.id,workId:other.work.id,attemptId:active.id});await service.validate(intent.requestId);await service.settle(intent.requestId,null,'response lost');observation={exactWorker:true,status:'exited'};assert.equal((await service.check(intent.requestId)).state,'stopped');assert.equal(other.store.readStopProof({memberId:other.member.id,attemptId:active.id,binding:active.binding}).kind,'native-worker-exit');assert.equal(await service.validate(intent.requestId),null);
});

test('native PTY-qualified terminal Task creator reconciles saved work after reload without recreating objective or Tasks',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');
 const f=await fixture(t,{kind:'terminal',childKind:'terminal'});
 const service=()=>createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service().check(f.work.id);const protocol=f.store.readDispatchProtocol(f.work.id);f.createIntent(protocol);
 f.db.prepare('UPDATE tasks SET created_by_process_incarnation=?').run('head-pty:head-instance');
 const old=f.store.readCurrentWork(f.work.id);
 f.store.updateWork(old.id,old.version,{instance:{kind:'terminal',handle:'term-head',paneKey:'tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',incarnationId:'head-instance'}});
 await f.restart();
 await f.works.check(f.work.id);
 await service().check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,1);
 assert.equal(f.store.readCurrentWork(f.work.id).instance.processIncarnation,'head-pty:head-instance');
 assert.equal(f.messages.filter(text=>text.startsWith('Team Orchestrator work protocol')).length,1);
 assert.equal(f.calls.some(method=>/workerStart|runCreate|taskCreate/.test(method)),false);
});

for(const processIdentity of ['other-pty:head-instance','head-pty:other-instance','head-instance'])test(`terminal Task creator ${processIdentity} cannot substitute for the exact native process`,async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs');const f=await fixture(t,{kind:'terminal'});
 const service=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.db.prepare('UPDATE tasks SET created_by_process_incarnation=?').run(processIdentity);
 await service.check(f.work.id);
 assert.equal(f.store.listDispatches(f.work.id).length,0);
 assert.match(f.store.readDispatchProtocol(f.work.id).detail,/creator instance/);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,0);
});

for(const patch of [{ptyId:'swapped-pty'},{incarnationId:'swapped-instance'},{ptyId:null}])test(`saved terminal observation refuses changed or missing exact identity ${JSON.stringify(patch)}`,async t=>{
 const f=await fixture(t,{kind:'terminal'});
 const rpc=async(method,...args)=>{const result=await f.rpc(method,...args);return method==='terminal.show'?{terminal:{...result.terminal,...patch}}:result;};
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 await assert.rejects(works.verifyWork(f.work.id),/incarnation|PTY/);
 const sends=f.messages.length;await works.check(f.work.id);assert.equal(f.messages.length,sends);
 assert.equal(f.store.readCurrentWork(f.work.id).run.state,'unverified');
});

test('terminal total delivery uses exact PTY-qualified creator evidence before user acceptance',async t=>{
 const {createDispatchService}=await import('../src/local/dispatch.mjs'),{createLifecycleService}=await import('../src/local/lifecycle.mjs');
 const f=await fixture(t,{kind:'terminal'});
 await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const p=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:p.token,generation:1,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId:null,summary:'Exact terminal result',evidenceRefs:['artifact:report'],attemptIds:[]});
 const task={id:'terminal-delivery',run_id:'run-head',spec,status:'ready'};
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,spec,'ready',null,'term-head','tab:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','wrong-pty:head-instance',1);
 f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','terminal-delivery-receipt','orchestration.taskCreate',nativeHash('orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:{paneLeafId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}}),'completed',JSON.stringify({task}));
 const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await lifecycle.check(f.work.id);assert.equal(f.store.readSnapshot().works[0].delivery,undefined);
 f.db.prepare('UPDATE tasks SET created_by_process_incarnation=? WHERE id=?').run('head-pty:head-instance',task.id);
 await lifecycle.check(f.work.id);const work=f.store.readSnapshot().works[0];assert.equal(work.delivery.id,task.id);
 await lifecycle.decide({requestId:'accept-terminal',workId:work.id,deliveryId:task.id,expectedWorkVersion:work.version,decision:'accept'});
 assert.equal(f.store.readCurrentWork(work.id).status,'completed');
});
