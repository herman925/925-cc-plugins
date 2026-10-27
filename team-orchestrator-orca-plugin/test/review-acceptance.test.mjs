import { rmTemp } from './temp.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {questionFixture} from './questions-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
import {createWorkService} from '../src/local/teamwork.mjs';
import {createWakeService} from '../src/local/wake.mjs';

test('a recovered native supervisor reviews the old execution using transferred authority and immutable provenance',async t=>{
 const f=await questionFixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n')[1]));});await dispatch.check(f.work.id);f.onInput(()=>{});
 const original=f.store.listDispatches(f.work.id)[0];f.complete(original);await dispatch.check(f.work.id);
 const journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 let fence=7;
 const lease=dead=>journal.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run('codex_head',JSON.stringify({schemaVersion:2,sessionId:'codex_head',provider:'codex',location:f.store.readScope(f.team.id),lease:{sessionId:'codex_head',runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1,hostId:'local',spawnToken:'native'},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));
 const rpc=async(method,params,envelope)=>{
  if(method==='agentSession.history')return {ok:true,page:{sessionId:params.sessionId,fence,submissions:[],items:[]}};
  if(method==='agentSession.restartResumable')return {sessions:[{sessionId:'codex_head',workspaceId:f.work.scope.workspaceId,executionHostId:'local',agent:'codex'}]};
  if(method==='agentSession.restartContinue')return {continued:[{sessionId:'codex_head',outcome:'continued'}]};
  const result=await f.rpc(method,params,envelope);return method==='agentSession.send'?{...result,fence}:result;
 };
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});
 lease(true);await wake.wake({teamId:f.team.id,memberId:f.team.members[0].id,requestId:'head-wake',bindingRequestId:'launch'});fence=8;lease(false);await wake.check('head-wake');
 f.db.exec("UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2 WHERE id='run-head'");await wake.bind('head-wake');
 const recovered=createDispatchService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});await recovered.check(f.work.id);
 const attempt=f.store.listDispatches(f.work.id)[0],protocol=f.store.readDispatchProtocol(f.work.id);
 assert.equal(attempt.generation,1);assert.equal(attempt.reviewAuthority.generation,2);
 const patch={token:protocol.token,generation:2,reviewToken:attempt.reviewAuthority.reviewToken};
 f.review(attempt,{requestId:'old-authority'});await recovered.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'pending_acceptance');
 f.review(attempt,{requestId:'forged-author',forged:true,patch});await recovered.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'pending_acceptance');
 f.review(attempt,{requestId:'current-author',patch});await recovered.check(f.work.id);
 const accepted=f.store.listDispatches(f.work.id)[0];assert.equal(accepted.status,'accepted');assert.equal(accepted.review.generation,2);assert.equal(accepted.generation,1);assert.equal(accepted.token,original.token);assert.equal(accepted.reviewToken,original.reviewToken);assert.equal(f.store.readWork(f.work.id).run.consumerGeneration,1);
});

import {createHash} from 'node:crypto';
import {WORKER_RULES} from '../src/dispatch.mjs';
import {createHierarchyService} from '../src/local/hierarchy.mjs';
import {createLifecycleService} from '../src/local/lifecycle.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
async function hierarchyFixture(t){
 const f=await questionFixture(t,{formOverrides:{levels:3,fan:1}}),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id),{taskKey:'nested-task'});f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n')[1]));});await dispatch.check(f.work.id);
 const parent=f.store.listDispatches(f.work.id)[0];f.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN depth INTEGER DEFAULT 1');
 const hierarchy=createHierarchyService({store:f.store,userData:f.profile,works:f.works});await hierarchy.check(f.work.id);let child=f.store.listRunWorks(f.work.id)[1];
 f.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-manager',child.nativeObjective,'this_database',null,null,'claude_child',1,1,0);await hierarchy.check(f.work.id);child=f.store.readCurrentWork(child.id);f.onInput(()=>{});await dispatch.check(child.id);
 const member=f.team.members.find(m=>m.boss===f.member.id),protocol=f.store.readDispatchProtocol(child.id);
 const receipt=(id,method,params,value)=>f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',id,method,createHash('sha256').update(JSON.stringify(canonical({method,params:{...params,__orcaCallerOrcaSessionId:'claude_child'}}))).digest('hex'),'completed',JSON.stringify(value));
 f.onInput(text=>{if(!text.startsWith('TEAM_DISPATCH_PERMIT\n'))return;const p=JSON.parse(text.split('\n')[1]),id='dispatch-'+p.nativeTaskId,handle=p.startParams.terminal??'leaf-worker',chat=handle.startsWith('orca_session_id:');
  f.db.prepare('INSERT INTO dispatch_contexts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,child.run.id,p.nativeTaskId,null,null,'claude_child',parent.dispatchId,handle,chat?null:'leaf-tab:leaf-pane','leaf-session',chat?null:'leaf-instance',JSON.stringify({kind:'local',hostId:'local'}),'dispatched',1,2);
  f.db.prepare('INSERT INTO worker_dispatches VALUES(?,?,?,?,?,?)').run(id,child.scope.workspaceId,handle,'ready','runtime-one',JSON.stringify({agent:member.agent}));
  f.db.prepare("UPDATE tasks SET status='dispatched' WHERE id=?").run(p.nativeTaskId);
  receipt('start-'+p.nativeTaskId,'orchestration.workerStart',{...p.startParams,from:'orca_session_id:claude_child',devMode:false},{runId:child.run.id,taskId:p.nativeTaskId,dispatchId:id,state:'ready'});
 });
 const assign=async(id,previousAttemptId)=>{
  const spec=JSON.stringify({protocol:'team-dispatch/v1',workerRules:WORKER_RULES,workId:child.id,token:protocol.token,generation:1,taskKey:'nested-task',memberId:member.id,configVersion:1,roleVersion:1,role:{brief:member.brief,habits:member.habits,collaboration:member.collaboration},instruction:'Implement child result',writeScope:[],dependencies:[],...(previousAttemptId?{previousAttemptId}:{})});
  f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,child.run.id,spec,'ready',null,null,null,null,null);receipt('create-'+id,'orchestration.taskCreate',{spec,run:child.run.id,callerTerminalHandle:'orca_session_id:claude_child'},{task:{id,run_id:child.run.id,spec}});await dispatch.check(child.id);return f.store.listDispatches(child.id).at(-1);
 };
 const complete=async(a,decision,service=dispatch)=>{
  const d=f.db.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(a.dispatchId),report='report-'+a.nativeTaskId;
  f.db.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id=?").run(a.dispatchId);f.db.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id=?").run(a.dispatchId);f.db.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(a.nativeTaskId);
  f.db.prepare('INSERT INTO messages(id,run_id,from_handle,sender_pane_key,type,body,payload) VALUES(?,?,?,?,?,?,?)').run(report,child.run.id,d.assignee_handle,d.assignee_pane_key,'worker_done','Leaf result',JSON.stringify({dispatchId:a.dispatchId,taskId:a.nativeTaskId,outcome:'succeeded'}));
  f.db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:'+report,a.dispatchId,a.nativeTaskId,'run_home:'+child.run.id,'worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:'+report}));await service.check(child.id);a=f.store.listDispatches(child.id).at(-1);
  const protocol=f.store.readDispatchProtocol(child.id);
  const result=JSON.stringify({protocol:'team-review/v1',workId:child.id,token:protocol.token,generation:protocol.generation,taskKey:a.taskKey,attemptId:a.id,nativeTaskId:a.nativeTaskId,dispatchId:a.dispatchId,reviewToken:a.reviewAuthority?.reviewToken??a.reviewToken,reviewerMemberId:f.member.id,decision,evidenceRefs:[a.evidenceId],summary:'Checked leaf result'});
  receipt('review-'+a.id,'orchestration.taskUpdate',{id:a.nativeTaskId,status:'completed',result,run:child.run.id,callerTerminalHandle:'orca_session_id:claude_child'},{task:{id:a.nativeTaskId,run_id:child.run.id,status:'completed',result}});await service.check(child.id);return f.store.listDispatches(child.id).at(-1);
 };
 const deliver=async()=>{
  const attempts=f.store.listTeamDispatches(f.work.id).filter(a=>a.status==='accepted'),root=f.store.readCurrentWork(f.work.id),p=f.store.readDispatchProtocol(root.id),spec=JSON.stringify({protocol:'team-delivery/v1',workId:root.id,token:p.token,generation:1,supervisorMemberId:root.supervisorMemberId,previousDeliveryId:null,summary:'Manager aggregate complete',attemptIds:attempts.map(a=>a.id),evidenceRefs:attempts.map(a=>a.evidenceId)});
  f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('deliver',root.run.id,spec,'ready',null,null,null,null,null);f.receipt('create-deliver','orchestration.taskCreate',{spec,run:root.run.id,callerTerminalHandle:f.from},{task:{id:'deliver',run_id:root.run.id,spec}});
  const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});await lifecycle.check(root.id);return {lifecycle,input:{workId:root.id,requestId:'accept-total',deliveryId:'deliver',expectedWorkVersion:f.store.readCurrentWork(root.id).version,decision:'accept'}};
 };
 return {...f,rootComplete:f.complete,dispatch,child,parent,assign,complete,deliver};
}
test('hierarchical rework accepts the replacement, then the manager and total result while preserving old evidence',async t=>{
 const f=await hierarchyFixture(t);let old=await f.assign('leaf-first');old=await f.complete(old,'rework');assert.equal(old.status,'rework');
 let replacement=await f.assign('leaf-replacement',old.id);assert.equal(replacement.status,'running');replacement=await f.complete(replacement,'accept');assert.equal(replacement.status,'accepted');
 assert.ok(f.store.workClosureBlockers(f.work.id).includes('Task nested-task: running'),'the root and child same-name tasks keep distinct acceptance obligations');
 f.rootComplete(f.parent);
 await f.dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0]);await f.dispatch.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');
 const {lifecycle,input}=await f.deliver();
 f.db.prepare("UPDATE worker_dispatches SET state='ready' WHERE dispatch_id=?").run(replacement.dispatchId);await assert.rejects(lifecycle.decide(input),/evidence|unverified|unresolved/);f.db.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id=?").run(replacement.dispatchId);
 await lifecycle.decide(input);assert.equal(f.store.readCurrentWork(f.work.id).status,'completed');assert.equal(f.store.readCurrentWork(f.child.id).status,'completed');assert.equal(f.store.listDispatches(f.child.id)[0].status,'rework');
});

test('explicit recovery resolution settles a historical descendant question without inventing an answer',async t=>{
 const f=await hierarchyFixture(t);
 const leaf=await f.assign('leaf-question');
 f.db.exec("ALTER TABLE messages ADD COLUMN to_handle TEXT; ALTER TABLE messages ADD COLUMN thread_id TEXT; CREATE TABLE question_threads(message_id TEXT PRIMARY KEY,run_id TEXT,dispatch_id TEXT,asker_handle TEXT,status TEXT,answer_message_id TEXT,answer_body TEXT,answered_by_generation INTEGER)");
 const askParams={question:'Original leaf scope',run:f.child.run.id,from:leaf.binding.handle,compatibilityCliCommand:'orca',timeoutMs:10000};
 f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run('leaf-ask',f.child.run.id,`dispatch:${leaf.dispatchId}`,null,'question',askParams.question,JSON.stringify({dispatchId:leaf.dispatchId,taskId:leaf.nativeTaskId}),`run:${f.child.run.id}`,'leaf-ask');
 f.db.prepare('INSERT INTO question_threads VALUES(?,?,?,?,?,?,?,?)').run('leaf-ask',f.child.run.id,leaf.dispatchId,leaf.binding.handle,'pending',null,null,null);
 const signed=(id,method,params,value)=>f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',id,method,createHash('sha256').update(JSON.stringify(canonical({method,params}))).digest('hex'),'completed',JSON.stringify(value));
 signed('ask-leaf','orchestration.ask',{...askParams,from:{paneKey:leaf.binding.paneKey},__orcaCallerOrcaSessionId:leaf.binding.sessionId},{messageId:'leaf-ask'});
 const qp=f.store.readDispatchProtocol(f.child.id),qspec=JSON.stringify({protocol:'team-questions/v1',kind:'relay-question',workId:f.child.id,token:qp.token,generation:qp.generation,appQuestionId:'old-choice',summary:'Original leaf scope',options:[],blockingTaskKeys:[],origin:{attemptId:leaf.id,dispatchId:leaf.dispatchId,nativeTaskId:leaf.nativeTaskId,messageId:'leaf-ask',askRequestId:'ask-leaf',askParams}});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('native-old-choice',f.child.run.id,qspec,'ready',null,null,null,null,null);
 signed('create-old-choice','orchestration.taskCreate',{spec:qspec,run:f.child.run.id,callerTerminalHandle:'orca_session_id:claude_child',__orcaCallerOrcaSessionId:'claude_child'},{task:{id:'native-old-choice',run_id:f.child.run.id,spec:qspec}});
 const {createQuestionService}=await import('../src/local/questions.mjs');await createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.child.id);
 assert.equal(f.store.listQuestions(f.child.id)[0].proof.nativeTaskId,'native-old-choice');
 const journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 let fence=7;const lease=dead=>journal.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run('claude_child',JSON.stringify({schemaVersion:2,sessionId:'claude_child',provider:'claude',location:f.child.scope,lease:{sessionId:'claude_child',runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1,hostId:'local',spawnToken:'manager'},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));
 const rpc=async(method,params,envelope)=>{
  if(method==='agentSession.history'&&params.sessionId==='claude_child')return {ok:true,page:{sessionId:params.sessionId,fence,submissions:[],items:[]}};
  if(method==='agentSession.restartResumable')return {sessions:[{sessionId:'claude_child',workspaceId:f.child.scope.workspaceId,executionHostId:'local',agent:'claude'}]};
  if(method==='agentSession.restartContinue')return {continued:[{sessionId:'claude_child',outcome:'continued'}]};
  const result=await f.rpc(method,params,envelope);return method==='agentSession.send'&&params.envelope.sessionId==='claude_child'?{...result,fence}:result;
 };
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}}),dispatch=createDispatchService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});
 lease(true);await wake.wake({teamId:f.team.id,memberId:f.member.id,requestId:'manager-wake',bindingRequestId:f.parent.id});fence=8;lease(false);await wake.check('manager-wake');await wake.bind('manager-wake');await dispatch.check(f.child.id);
 const completedLeaf=await f.complete(leaf,'accept',dispatch);assert.equal(completedLeaf.status,'accepted');
 f.rootComplete(f.parent);await dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0]);await dispatch.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'pending_acceptance');assert.ok(f.store.workClosureBlockers(f.work.id).some(r=>r.includes('User decision')));
 await assert.rejects(wake.resolveQuestion({requestId:'wrong-wake',workId:f.child.id,questionId:'old-choice',note:'Reviewed'}),/exact superseded question/);
 await wake.resolveQuestion({requestId:'manager-wake',workId:f.child.id,questionId:'old-choice',note:'Checked the superseded scope question against the handoff.'});
 await dispatch.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');assert.equal(f.store.workClosureBlockers(f.work.id).some(r=>r.includes('User decision')),false);
 const question=f.store.listQuestions(f.child.id)[0];assert.equal(question.status,'closed');assert.equal(question.answers.length,0);assert.equal(question.resolution.by,'user');
 const {input}=await f.deliver(),lifecycle=createLifecycleService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});
 const refused=()=>assert.rejects(lifecycle.decide(input),/unresolved|unregistered|evidence/);
 f.store.updateQuestion(f.child.id,question.id,q=>{delete q.resolution;});await refused();f.store.updateQuestion(f.child.id,question.id,q=>{q.resolution=question.resolution;});
 f.store.updateQuestion(f.child.id,question.id,q=>{q.resolution={...q.resolution,recoveryRequestId:'another-recovery'};});await refused();f.store.updateQuestion(f.child.id,question.id,q=>{q.resolution=question.resolution;});
 f.db.prepare("UPDATE tasks SET spec=? WHERE id='native-old-choice'").run(qspec+' ');await refused();f.db.prepare("UPDATE tasks SET spec=? WHERE id='native-old-choice'").run(qspec);
 f.db.exec("DELETE FROM tasks WHERE id='native-old-choice'");await refused();f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('native-old-choice',f.child.run.id,qspec,'ready',null,null,null,null,null);
 const originalHash=f.db.prepare("SELECT payload_hash FROM mutation_receipts WHERE request_id='create-old-choice'").get().payload_hash;
 f.db.exec("UPDATE mutation_receipts SET payload_hash='forged' WHERE request_id='create-old-choice'");await refused();f.db.prepare("UPDATE mutation_receipts SET payload_hash=? WHERE request_id='create-old-choice'").run(originalHash);
 const unknownSpec=JSON.stringify({...JSON.parse(qspec),appQuestionId:'unregistered-old-question'});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('unregistered-old-task',f.child.run.id,unknownSpec,'ready',null,null,null,null,null);signed('create-unregistered-old-task','orchestration.taskCreate',{spec:unknownSpec,run:f.child.run.id,callerTerminalHandle:'orca_session_id:claude_child',__orcaCallerOrcaSessionId:'claude_child'},{task:{id:'unregistered-old-task',run_id:f.child.run.id,spec:unknownSpec}});await refused();f.db.exec("DELETE FROM tasks WHERE id='unregistered-old-task'; DELETE FROM mutation_receipts WHERE request_id='create-unregistered-old-task'");
 f.db.prepare('INSERT INTO dispatch_contexts(id,run_id,task_id) VALUES(?,?,?)').run('hidden-question-dispatch',f.child.run.id,'native-old-choice');await refused();f.db.exec("DELETE FROM dispatch_contexts WHERE id='hidden-question-dispatch'");
 await lifecycle.decide(input);assert.equal(f.store.readCurrentWork(f.work.id).status,'completed');
});

import {readFile,rename,symlink,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {readNativeRunEvidence} from '../src/local/native-run.mjs';
import {readNativeParentEvidence} from '../src/local/native-hierarchy.mjs';
import {readNativeQuestionEvidence} from '../src/local/native-questions.mjs';
import {readNativeDispatchEvidence} from '../src/local/native-dispatch.mjs';
test('native evidence readers retain schema and profile refusals and release read-only snapshots',async t=>{
 const f=await hierarchyFixture(t),work=f.store.readCurrentWork(f.work.id),protocol=f.store.readDispatchProtocol(work.id),owner=work.instance;
 const readers=[
  [()=>readNativeRunEvidence(f.profile,{objective:work.nativeObjective,owner,runId:work.run.id}),'Native Run evidence is unavailable or incompatible. Preserve the work and reconnect its owning Orca host.','Native Run evidence is unavailable or incompatible. Preserve the work and reconnect its owning Orca host.'],
  [()=>readNativeParentEvidence(f.profile,{parentWork:work,attempt:f.parent}),'Native parent schema is unsupported.','Parent evidence path is unverified.'],
  [()=>readNativeQuestionEvidence(f.profile,{work,protocol,owner}),'Unsupported native question schema.','Invalid native evidence path.'],
  [()=>readNativeDispatchEvidence(f.profile,{work,protocol,owner,team:f.team,admitted:f.store.listDispatches(work.id)}),'Native orchestration evidence schema is unsupported.','Native evidence path is outside the verified profile.']
 ];
 const file=join(f.profile,'orchestration.db'),bytes=await readFile(file);
 for(const [read] of readers){assert.equal((await read()).state,'verified');f.db.exec('BEGIN EXCLUSIVE; ROLLBACK');}
 assert.deepEqual(await readFile(file),bytes);
 f.db.exec('PRAGMA user_version=44');
 for(const [read,detail] of readers){const result=await read();assert.equal(result.state,'unverified');assert.equal(result.detail,detail);f.db.exec('BEGIN EXCLUSIVE; ROLLBACK');}
 f.db.exec('PRAGMA user_version=43');
 // moving an open database and linking it into the profile needs a POSIX rename and symlink privilege
 if(process.platform!=='win32'){
 const outside=await mkdtemp(join(tmpdir(),'outside-native-profile-'));t.after(()=>rmTemp(outside));const moved=join(outside,'orchestration.db');
   await rename(file,moved);await symlink(moved,file);
   try{for(const [read,,detail] of readers){const result=await read();assert.equal(result.state,'unverified');assert.equal(result.detail,detail);}}
   finally{await rm(file);await rename(moved,file);}
 }
 for(const [read] of readers)assert.equal((await read()).state,'verified');
});

test('an immutable accepted native review remains historical after recovery and cannot authorize new effects',async t=>{
 const f=await questionFixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.split('\n')[1]));});await dispatch.check(f.work.id);f.onInput(()=>{});
 const original=f.store.listDispatches(f.work.id)[0];f.complete(original);await dispatch.check(f.work.id);f.review(f.store.listDispatches(f.work.id)[0],{requestId:'accepted-before-recovery'});await dispatch.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'accepted');
 const journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 let fence=7;
 const lease=dead=>journal.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run('codex_head',JSON.stringify({schemaVersion:2,sessionId:'codex_head',provider:'codex',location:f.store.readScope(f.team.id),lease:{sessionId:'codex_head',runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1,hostId:'local',spawnToken:'native'},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));
 const rpc=async(method,params,envelope)=>{
  if(method==='agentSession.history')return {ok:true,page:{sessionId:params.sessionId,fence,submissions:[],items:[]}};
  if(method==='agentSession.restartResumable')return {sessions:[{sessionId:'codex_head',workspaceId:f.work.scope.workspaceId,executionHostId:'local',agent:'codex'}]};
  if(method==='agentSession.restartContinue')return {continued:[{sessionId:'codex_head',outcome:'continued'}]};
  const result=await f.rpc(method,params,envelope);return method==='agentSession.send'?{...result,fence}:result;
 };
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});
 lease(true);await wake.wake({teamId:f.team.id,memberId:f.team.members[0].id,requestId:'head-wake',bindingRequestId:'launch'});fence=8;lease(false);await wake.check('head-wake');
 f.db.exec("UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2 WHERE id='run-head'");await wake.bind('head-wake');
 const recovered=createDispatchService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});await recovered.check(f.work.id);

 const attempt=f.store.listDispatches(f.work.id)[0],protocol=f.store.readDispatchProtocol(f.work.id),root=f.store.readCurrentWork(f.work.id);
 assert.equal(attempt.status,'accepted');assert.equal(root.run.consumerGeneration,2);
 const spec=JSON.stringify({protocol:'team-delivery/v1',workId:root.id,token:protocol.token,generation:2,supervisorMemberId:root.supervisorMemberId,previousDeliveryId:null,summary:'Completed after recovery',attemptIds:[attempt.id],evidenceRefs:[attempt.evidenceId]});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('delivery-after-recovery',root.run.id,spec,'ready',null,null,null,null,null);
 f.receipt('create-delivery-after-recovery','orchestration.taskCreate',{spec,run:root.run.id,callerTerminalHandle:f.from},{task:{id:'delivery-after-recovery',run_id:root.run.id,spec}});
 const lifecycle=createLifecycleService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});await lifecycle.check(root.id);
 const decision={workId:root.id,requestId:'accept-after-recovery',deliveryId:'delivery-after-recovery',expectedWorkVersion:f.store.readCurrentWork(root.id).version,decision:'accept'};
 const originalReceipt=f.db.prepare("SELECT * FROM mutation_receipts WHERE request_id='accepted-before-recovery'").get();f.db.exec("DELETE FROM mutation_receipts WHERE request_id='accepted-before-recovery'");await assert.rejects(lifecycle.decide(decision),/evidence/);f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run(...Object.values(originalReceipt));
 const malformed=JSON.parse(originalReceipt.receipt);malformed.task.result='not a supervisor review';f.db.prepare("UPDATE mutation_receipts SET receipt=? WHERE request_id='accepted-before-recovery'").run(JSON.stringify(malformed));await assert.rejects(lifecycle.decide(decision),/evidence/);f.db.prepare("UPDATE mutation_receipts SET receipt=? WHERE request_id='accepted-before-recovery'").run(originalReceipt.receipt);
 const originalHash=originalReceipt.payload_hash;
 f.db.exec("UPDATE mutation_receipts SET payload_hash='forged' WHERE request_id='accepted-before-recovery'");await assert.rejects(lifecycle.decide(decision),/evidence/);f.db.prepare("UPDATE mutation_receipts SET payload_hash=? WHERE request_id='accepted-before-recovery'").run(originalHash);
 await lifecycle.decide(decision);
 assert.equal(f.store.readCurrentWork(root.id).status,'completed');
 const preview=f.store.previewHistoryCleanup({selectedWorkIds:[root.id]});assert.deepEqual(preview.eligibleWorkIds,[root.id],JSON.stringify(preview.retained));
 const nativeReceipt=f.db.prepare("SELECT receipt FROM mutation_receipts WHERE request_id='accepted-before-recovery'").get().receipt;
 f.store.applyHistoryCleanup({requestId:'cleanup-recovered',previewToken:preview.previewToken,expectedStorageRevision:preview.storageRevision});assert.equal(f.db.prepare("SELECT receipt FROM mutation_receipts WHERE request_id='accepted-before-recovery'").get().receipt,nativeReceipt);assert.equal(f.store.listDispatches(root.id)[0].review.payloadHash,originalHash);

});

test('saved delivery, staffing and roster control receipts remain historical after recovery',async t=>{
 const f=await questionFixture(t),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});

 await dispatch.check(f.work.id);
 const {createStaffingService}=await import('../src/local/staffing.mjs'),staffing=createStaffingService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 const publish=(id,kind,fields)=>{const p=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-questions/v1',workId:f.work.id,token:p.token,generation:p.generation,appQuestionId:id,kind,...fields});f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,'run-head',spec,'ready',null,null,null,null,null);f.receipt('create-'+id,'orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task:{id,run_id:'run-head',spec}});};
 const {createQuestionService}=await import('../src/local/questions.mjs'),questions=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 publish('historical-choice','user-question',{summary:'Choose scope',options:['Small'],blockingTaskKeys:[]});await questions.check(f.work.id);await questions.answer({workId:f.work.id,questionId:'historical-choice',questionRevision:1,answerId:'scope-answer',body:'Small',supplement:false});publish('historical-answer-ack','answer-ack',{appQuestionId:'historical-choice',answerId:'scope-answer'});await questions.check(f.work.id);assert.equal(f.store.listQuestions(f.work.id)[0].status,'answered');
 publish('historical-staffing','staffing-proposal',{configVersion:1,roleVersion:1,proposingManagerId:f.team.members[0].id,member:{name:'Reviewer',boss:f.team.members[0].id,brief:'Review evidence.',habits:'',collaboration:'Report to manager.',agent:'claude',model:'default',effort:'default'},rationale:'Independent review',affectedTaskKeys:[]});await staffing.check(f.work.id);
 f.store.saveStaffing({requestId:'approve-historical-staffing',workId:f.work.id,proposalId:'historical-staffing',decision:'approve',configVersion:1,expectedRevision:f.store.readSnapshot().revision});await staffing.check(f.work.id);
 const delta=f.store.listRosterDeltas(f.work.id)[0];publish('historical-roster-ack','roster-ack',{deltaId:delta.id,configVersion:2});await staffing.check(f.work.id);assert.equal(f.store.listRosterDeltas(f.work.id)[0].processed,'confirmed');
 const oldRoot=f.store.readCurrentWork(f.work.id),oldProtocol=f.store.readDispatchProtocol(f.work.id),oldSpec=JSON.stringify({protocol:'team-delivery/v1',workId:oldRoot.id,token:oldProtocol.token,generation:1,supervisorMemberId:oldRoot.supervisorMemberId,previousDeliveryId:null,summary:'Initial total result',attemptIds:[],evidenceRefs:['artifact:done']});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('old-delivery',oldRoot.run.id,oldSpec,'ready',null,null,null,null,null);f.receipt('create-old-delivery','orchestration.taskCreate',{spec:oldSpec,run:oldRoot.run.id,callerTerminalHandle:f.from},{task:{id:'old-delivery',run_id:oldRoot.run.id,spec:oldSpec}});
 const oldLifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}});await oldLifecycle.check(oldRoot.id);assert.equal(f.store.deliveryProjection(oldRoot.id).delivery.id,'old-delivery');
 const journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 let fence=7;
 const lease=dead=>journal.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run('codex_head',JSON.stringify({schemaVersion:2,sessionId:'codex_head',provider:'codex',location:f.store.readScope(f.team.id),lease:{sessionId:'codex_head',runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1,hostId:'local',spawnToken:'native'},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));
 const rpc=async(method,params,envelope)=>{
  if(method==='agentSession.history')return {ok:true,page:{sessionId:params.sessionId,fence,submissions:[],items:[]}};
  if(method==='agentSession.restartResumable')return {sessions:[{sessionId:'codex_head',workspaceId:f.work.scope.workspaceId,executionHostId:'local',agent:'codex'}]};
  if(method==='agentSession.restartContinue')return {continued:[{sessionId:'codex_head',outcome:'continued'}]};
  const result=await f.rpc(method,params,envelope);return method==='agentSession.send'?{...result,fence}:result;
 };
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});
 lease(true);await wake.wake({teamId:f.team.id,memberId:f.team.members[0].id,requestId:'head-wake',bindingRequestId:'launch'});fence=8;lease(false);await wake.check('head-wake');
 f.db.exec("UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2 WHERE id='run-head'");await wake.bind('head-wake');
 const recovered=createDispatchService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});await recovered.check(f.work.id);

 const protocol=f.store.readDispatchProtocol(f.work.id),root=f.store.readCurrentWork(f.work.id);
 assert.equal(root.run.consumerGeneration,2);
 const spec=JSON.stringify({protocol:'team-delivery/v1',workId:root.id,token:protocol.token,generation:2,supervisorMemberId:root.supervisorMemberId,previousDeliveryId:'old-delivery',summary:'Completed after recovery',attemptIds:[],evidenceRefs:['artifact:done']});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('delivery-after-recovery',root.run.id,spec,'ready',null,null,null,null,null);
 f.receipt('create-delivery-after-recovery','orchestration.taskCreate',{spec,run:root.run.id,callerTerminalHandle:f.from},{task:{id:'delivery-after-recovery',run_id:root.run.id,spec}});
 const lifecycle=createLifecycleService({store:f.store,rpc,userData:f.profile,works,consent:async()=>{}});await lifecycle.check(root.id);
 const decision={workId:root.id,requestId:'accept-after-recovery',deliveryId:'delivery-after-recovery',expectedWorkVersion:f.store.readCurrentWork(root.id).version,decision:'accept'};
 for(const request of ['create-old-delivery','create-historical-staffing','create-historical-roster-ack','create-historical-choice','create-historical-answer-ack']){
  const hash=f.db.prepare('SELECT payload_hash FROM mutation_receipts WHERE request_id=?').get(request).payload_hash;
  f.db.prepare("UPDATE mutation_receipts SET payload_hash='tampered' WHERE request_id=?").run(request);await assert.rejects(lifecycle.decide(decision),/unregistered|evidence/i);f.db.prepare('UPDATE mutation_receipts SET payload_hash=? WHERE request_id=?').run(hash,request);
 }
 f.db.prepare('INSERT INTO dispatch_contexts(id,run_id,task_id) VALUES(?,?,?)').run('hidden-delivery-dispatch',root.run.id,'old-delivery');await assert.rejects(lifecycle.decide(decision),/unregistered/i);f.db.exec("DELETE FROM dispatch_contexts WHERE id='hidden-delivery-dispatch'");
 await lifecycle.decide(decision);assert.equal(f.store.readSnapshot().teams[0].members.length,5);
 assert.equal(f.store.readCurrentWork(root.id).status,'completed');

});
