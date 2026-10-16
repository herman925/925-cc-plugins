import {WORKER_RULES} from '../src/dispatch.mjs';
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
export const nativeHash=(method,params)=>createHash('sha256').update(JSON.stringify(canonical({method,params}))).digest('hex');
export async function fixture(t,{headAgent='codex',workerAgent='claude',kind='structured',childKind='structured',prestarted=false,preparedKind='structured',queuedPermits=false}={}) {
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
 return {receipt,from,complete,review,profile,get store(){return store;},team,member,work,get works(){return works;},rpc,messages,calls,db,createIntent,start,onInput:fn=>{onInput=fn;},async restart(){store.close();store=await openTeamStore({userData:profile});works=createWorkService({store,rpc,userData:profile,consent:async()=>{}});}};
}
