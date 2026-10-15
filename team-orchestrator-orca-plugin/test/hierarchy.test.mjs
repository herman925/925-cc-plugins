import {WORKER_RULES} from '../src/dispatch.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionFixture} from './questions-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';

test('a genuinely assigned manager owns a separate Run in one TeamWork and stale parent fences children',async t=>{
 const f=await questionFixture(t,{formOverrides:{structure:'organisation',levels:3,fan:4,groups:'One, Two'}});
 const dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});
 await dispatch.check(f.work.id);const parent=f.store.listDispatches(f.work.id)[0];assert.equal(parent.status,'running');
 f.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN depth INTEGER DEFAULT 1');
 const {createHierarchyService}=await import('../src/local/hierarchy.mjs');
 const hierarchy=createHierarchyService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await hierarchy.check(f.work.id);
 let child=f.store.listRunWorks(f.work.id).find(w=>w.supervisorMemberId===f.member.id);
 assert.ok(child);assert.equal(f.store.listWorks().length,1);assert.equal(child.teamWorkId,f.work.id);
 assert.equal(child.parent.attemptId,parent.id);assert.equal(child.parent.dispatchId,parent.dispatchId);
 assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');
 f.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-manager',child.nativeObjective,'this_database',null,null,'claude_child',1,1,0);
 await hierarchy.check(f.work.id);child=f.store.readWork(child.id);
 assert.equal(child.run.id,'run-manager');assert.equal(child.run.state,'verified');
 assert.equal(f.store.readOwningWork(f.work.id,f.team.members.find(m=>m.boss===f.member.id).id).id,child.id);
 assert.equal(f.store.readSnapshot().works[0].nativeRuns.length,2);
 f.db.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id=?").run(parent.dispatchId);
 await assert.rejects(f.works.verifyWork(child.id),/parent|Parent/);
});

test('native child depth and creator must match its actual manager parent before acceptance',async t=>{
 const f=await questionFixture(t,{formOverrides:{structure:'organisation',levels:3,fan:4,groups:'One, Two'}});
 const dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});
 await dispatch.check(f.work.id);const parent=f.store.listDispatches(f.work.id)[0];
 f.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN depth INTEGER DEFAULT 1');
 const {createHierarchyService}=await import('../src/local/hierarchy.mjs');const hierarchy=createHierarchyService({store:f.store,userData:f.profile,works:f.works});
 await hierarchy.check(f.work.id);let child=f.store.listRunWorks(f.work.id)[1];
 f.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-manager',child.nativeObjective,'this_database',null,null,'claude_child',1,1,0);
 await hierarchy.check(f.work.id);child=f.store.readWork(child.id);
 f.onInput(()=>{});await dispatch.check(child.id);
 const protocol=f.store.readDispatchProtocol(child.id),member=f.team.members.find(m=>m.boss===f.member.id);
 const spec=JSON.stringify({protocol:'team-dispatch/v1',workerRules:WORKER_RULES,workId:child.id,token:protocol.token,generation:1,taskKey:'nested-task',memberId:member.id,configVersion:1,roleVersion:1,role:{brief:member.brief,habits:member.habits,collaboration:member.collaboration},instruction:'Implement child result',writeScope:[],dependencies:[]});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('task-child','run-manager',spec,'ready',null,null,null,null,null);
 const {createHash}=await import('node:crypto');const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const receipt=(id,method,params,value)=>f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint',id,method,createHash('sha256').update(JSON.stringify(canonical({method,params:{...params,__orcaCallerOrcaSessionId:'claude_child'}}))).digest('hex'),'completed',JSON.stringify(value));
 receipt('create-child','orchestration.taskCreate',{spec,run:'run-manager',callerTerminalHandle:'orca_session_id:claude_child'},{task:{id:'task-child',run_id:'run-manager',spec}});
 f.onInput(text=>{if(!text.startsWith('TEAM_DISPATCH_PERMIT\n'))return;const p=JSON.parse(text.slice(text.indexOf('\n')+1));assert.equal(f.store.listDispatches(child.id)[0].status,'admitted');assert.equal(p.startParams.parent,undefined);
  f.db.prepare('INSERT INTO dispatch_contexts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('dispatch-child','run-manager','task-child',null,null,'claude_child',null,'terminal-leaf','leaf-tab:leaf-pane',null,'leaf-instance',JSON.stringify({kind:'local',hostId:'local'}),'dispatched',1,1);
  f.db.prepare('INSERT INTO worker_dispatches VALUES(?,?,?,?,?,?)').run('dispatch-child',f.store.readWork(f.work.id).scope.workspaceId,'terminal-leaf','ready','runtime-one',JSON.stringify({agent:member.agent}));
  receipt('start-child','orchestration.workerStart',{...p.startParams,from:'orca_session_id:claude_child',devMode:false},{runId:'run-manager',taskId:'task-child',dispatchId:'dispatch-child',state:'ready'});
 });
 await dispatch.check(child.id);
 assert.equal(f.store.listDispatches(child.id)[0].status,'unknown','fresh Run must not reset native creator depth');
 f.db.prepare('UPDATE dispatch_contexts SET creator_dispatch_id=?,depth=2 WHERE id=?').run(parent.dispatchId,'dispatch-child');
 await dispatch.check(child.id);let task=f.store.listDispatches(child.id)[0];assert.equal(task.status,'running');assert.equal(task.depth,2);assert.equal(task.creatorDispatchId,parent.dispatchId);
 assert.ok(f.store.workClosureBlockers(f.work.id).some(s=>s.includes('nested-task')));
 assert.equal(f.store.listTeamDispatches(f.work.id).length,2);assert.equal(f.store.listWorks().length,1);
 const {createQuestionService}=await import('../src/local/questions.mjs');const questions=createQuestionService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 const questionIntent=(context,actor,id,fields)=>{const body=JSON.stringify({protocol:'team-questions/v1',workId:context.id,token:f.store.readDispatchProtocol(context.id).token,generation:1,appQuestionId:id,summary:'Choose leaf scope',options:['Small'],blockingTaskKeys:[],...fields});const taskId='question-'+id;f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(taskId,context.run.id,body,'ready',null,null,null,null,null);const params={spec:body,run:context.run.id,callerTerminalHandle:'orca_session_id:'+actor};if(actor==='claude_child')receipt('create-'+taskId,'orchestration.taskCreate',params,{task:{id:taskId,run_id:context.run.id,spec:body}});else f.receipt('create-'+taskId,'orchestration.taskCreate',params,{task:{id:taskId,run_id:context.run.id,spec:body}});};
 questionIntent(child,'claude_child','illegal-lower-user',{kind:'user-question'});await questions.check(child.id);
 assert.equal(f.store.listQuestions(child.id).length,0,'a lower manager cannot ask the user directly');
 f.db.exec(`ALTER TABLE messages ADD COLUMN to_handle TEXT; ALTER TABLE messages ADD COLUMN thread_id TEXT; CREATE TABLE question_threads(message_id TEXT PRIMARY KEY,run_id TEXT,dispatch_id TEXT,asker_handle TEXT,status TEXT,answer_message_id TEXT,answer_body TEXT,answered_by_generation INTEGER)`);
 const ask=(a,id)=>{const params={question:'Need scope',run:a.runId,from:a.binding.handle,compatibilityCliCommand:'orca',timeoutMs:10000};f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run(id,a.runId,`dispatch:${a.dispatchId}`,null,'question','Need scope',JSON.stringify({taskId:a.nativeTaskId,dispatchId:a.dispatchId}),`run:${a.runId}`,id);f.db.prepare('INSERT INTO question_threads VALUES(?,?,?,?,?,?,?,?)').run(id,a.runId,a.dispatchId,a.binding.handle,'pending',null,null,null);const nativeParams={...params,from:{paneKey:a.binding.paneKey},...(a.binding.sessionId?{__orcaCallerOrcaSessionId:a.binding.sessionId}:{})};f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','ask-'+id,'orchestration.ask',createHash('sha256').update(JSON.stringify(canonical({method:'orchestration.ask',params:nativeParams}))).digest('hex'),'completed',JSON.stringify({messageId:id}));return {attemptId:a.id,dispatchId:a.dispatchId,nativeTaskId:a.nativeTaskId,messageId:id,askRequestId:'ask-'+id,askParams:params};};
 const leafOrigin=ask(task,'leaf-ask'),managerOrigin=ask(parent,'manager-ask');
 questionIntent(child,'claude_child','leaf-choice',{kind:'relay-question',origin:leafOrigin});await questions.check(child.id);
 assert.equal(f.store.listQuestions(child.id)[0].to,'manager');
 const root=f.store.readWork(f.work.id);questionIntent(root,'codex_head','root-choice',{kind:'user-question',origin:managerOrigin,relay:{workId:child.id,appQuestionId:'leaf-choice'}});await questions.check(root.id);
 await assert.rejects(questions.answer({workId:child.id,questionId:'leaf-choice',questionRevision:1,answerId:'bypass',body:'Small',supplement:false}),/highest|Highest/);
 await questions.answer({workId:root.id,questionId:'root-choice',questionRevision:1,answerId:'choice-answer',body:'Small',supplement:false});
 const answer=(a,id)=>{f.db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)').run(id+'-answer',a.runId,`run:${a.runId}`,null,'message','Small',null,`dispatch:${a.dispatchId}`,id);f.db.prepare("UPDATE question_threads SET status='answered',answer_message_id=?,answer_body='Small',answered_by_generation=1 WHERE message_id=?").run(id+'-answer',id);};
 answer(parent,'manager-ask');await questions.check(root.id);assert.equal(f.store.listQuestions(root.id)[0].status,'pending','upstream reply alone cannot finish leaf relay');
 answer(task,'leaf-ask');await questions.check(child.id);await questions.check(root.id);
 assert.equal(f.store.listQuestions(child.id)[0].status,'answered');assert.equal(f.store.listQuestions(root.id)[0].status,'answered');
 assert.equal(f.messages.filter(m=>m.startsWith('TEAM_USER_ANSWER')).length,1,'only the root receives user input; native managers perform the replies');

 f.db.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id='dispatch-child'").run();f.db.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id='dispatch-child'").run();
 f.db.prepare('INSERT INTO messages(id,run_id,from_handle,sender_pane_key,type,body,payload) VALUES(?,?,?,?,?,?,?)').run('child-done','run-manager','terminal-leaf','leaf-tab:leaf-pane','worker_done','Child evidence',JSON.stringify({dispatchId:'dispatch-child',taskId:'task-child',outcome:'succeeded'}));
 f.db.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run('worker_report:child-done','dispatch-child','task-child','run_home:run-manager','worker_report',JSON.stringify({status:'accepted',outcome:'succeeded',reportId:'worker_report:child-done'}));
 await dispatch.check(child.id);task=f.store.listDispatches(child.id)[0];assert.equal(task.status,'pending_acceptance');assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');
 const result=JSON.stringify({protocol:'team-review/v1',workId:child.id,token:protocol.token,generation:1,taskKey:task.taskKey,attemptId:task.id,nativeTaskId:task.nativeTaskId,dispatchId:task.dispatchId,reviewToken:task.reviewToken,reviewerMemberId:f.member.id,decision:'accept',evidenceRefs:[task.evidenceId],summary:'Validated leaf result'});
 receipt('review-child','orchestration.taskUpdate',{id:'task-child',status:'completed',result,run:'run-manager',callerTerminalHandle:'orca_session_id:claude_child'},{task:{id:'task-child',run_id:'run-manager',status:'completed',result}});
 await dispatch.check(child.id);assert.equal(f.store.listDispatches(child.id)[0].status,'accepted');assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');
 f.complete(parent);await dispatch.check(root.id);let completedParent=f.store.listDispatches(root.id)[0];assert.equal(completedParent.status,'pending_acceptance');
 f.review(completedParent);await dispatch.check(root.id);assert.equal(f.store.listDispatches(root.id)[0].status,'accepted');
 await f.works.verifyWork(child.id,false,{allowSettledParent:true});
 const {createLifecycleService}=await import('../src/local/lifecycle.mjs');const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 const attempts=f.store.listTeamDispatches(root.id),delivery=JSON.stringify({protocol:'team-delivery/v1',workId:root.id,token:f.store.readDispatchProtocol(root.id).token,generation:1,supervisorMemberId:root.supervisorMemberId,previousDeliveryId:null,summary:'Manager aggregate delivered',evidenceRefs:attempts.map(a=>a.evidenceId),attemptIds:attempts.map(a=>a.id)});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('total-delivery','run-head',delivery,'ready',null,null,null,null,null);f.receipt('create-total','orchestration.taskCreate',{spec:delivery,run:'run-head',callerTerminalHandle:'orca_session_id:codex_head'},{task:{id:'total-delivery',run_id:'run-head',spec:delivery}});
 await lifecycle.check(root.id);
 await assert.rejects(lifecycle.decide({workId:root.id,requestId:'close-all',deliveryId:'total-delivery',expectedWorkVersion:f.store.readWork(root.id).version,decision:'accept'}),/Descendant Run/,'unregistered native lower-manager user question cannot disappear from closure');

 assert.equal(f.calls.some(m=>['orchestration.workerStart','orchestration.runCreate','orchestration.send'].includes(m)),false);
});

test('11 and 21 member presets retain each reporting path in both launch modes without a worker count cap',async()=>{
 const {PRESETS,DEFAULT_FORM,planTeam}=await import('../src/team.mjs');const {initialMembers}=await import('../src/launch.mjs');const {dispatchInstructions}=await import('../src/local/dispatch.mjs');
 for(const [index,total,managers] of [[1,11,3],[2,21,5]])for(const mode of ['on-demand','all']){
  const team=planTeam({...DEFAULT_FORM,...PRESETS[index].form,launchMode:mode});assert.equal(team.members.length,total);assert.equal(initialMembers(team).length,mode==='all'?total:managers);
  const root=team.members[0];let scheduled=0;
  for(const manager of team.members.filter(m=>team.members.some(c=>c.boss===m.id))){const wire=JSON.parse(dispatchInstructions({id:'context-'+manager.id,teamWorkId:'one-work',supervisorMemberId:manager.id,run:{id:'run-'+manager.id},configVersion:1},team,{token:'token',generation:1}).split('\n')[1]);assert.equal(wire.workerRules,WORKER_RULES);assert.equal(wire.children.length,manager.id===root.id?managers-1:4);scheduled+=wire.children.length;for(const child of wire.children)assert.equal(team.members.find(m=>m.id===child.memberId).boss,manager.id);}
  assert.equal(scheduled,total-1);assert.match(WORKER_RULES,/Do not self-create provider-native subagents/);
 }
});

test('nested manager resume and parent recovery retain original lineage while using current Run epochs',async t=>{
 const f=await questionFixture(t,{formOverrides:{levels:3,fan:1,launchMode:'all'}}),dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await dispatch.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT\n'))f.start(JSON.parse(text.slice(text.indexOf('\n')+1)));});await dispatch.check(f.work.id);
 const parent=f.store.listDispatches(f.work.id)[0];f.db.exec('ALTER TABLE dispatch_contexts ADD COLUMN depth INTEGER DEFAULT 1');
 const {createHierarchyService}=await import('../src/local/hierarchy.mjs'),hierarchy=createHierarchyService({store:f.store,userData:f.profile,works:f.works});await hierarchy.check(f.work.id);let child=f.store.listRunWorks(f.work.id)[1];f.db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-manager',child.nativeObjective,'this_database',null,null,'claude_child',1,1,0);await hierarchy.check(f.work.id);child=f.store.readWork(child.id);f.onInput(()=>{});
 const {DatabaseSync}=await import('node:sqlite'),{join}=await import('node:path'),journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 const fences=new Map(),scope=f.store.readScope(f.team.id);
 const lease=(session,provider,dead,fence)=>{fences.set(session,fence);journal.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run(session,JSON.stringify({schemaVersion:2,sessionId:session,provider,location:scope,lease:{sessionId:session,runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1,hostId:'local',spawnToken:'native'},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));};
 const rpc=async(method,params,envelope)=>{if(method==='agentSession.history'&&fences.has(params.sessionId))return {ok:true,page:{sessionId:params.sessionId,fence:fences.get(params.sessionId),submissions:[],items:[]}};if(method==='agentSession.restartResumable')return {sessions:params.sessionIds.map(sessionId=>({sessionId,workspaceId:scope.workspaceId,executionHostId:'local',agent:sessionId==='codex_head'?'codex':'claude'}))};if(method==='agentSession.restartContinue')return {continued:params.sessionIds.map(sessionId=>({sessionId,outcome:sessionId==='leaf-recover'?'refused':'continued'}))};return f.rpc(method,params,envelope);};
 const {createWorkService}=await import('../src/local/teamwork.mjs'),{createWakeService}=await import('../src/local/wake.mjs'),works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works});
 lease('claude_child','claude',true,7);assert.equal((await wake.wake({teamId:f.team.id,memberId:f.member.id,requestId:'manager-wake',bindingRequestId:parent.id})).state,'accepted');lease('claude_child','claude',false,8);await wake.check('manager-wake');await wake.bind('manager-wake');
 assert.equal(f.store.readWake('manager-wake').state,'bound');assert.equal(f.store.readCurrentWork(child.id).instance.fence,8);assert.equal(f.store.readWork(child.id).instance.fence,7);assert.equal(f.store.listRunWorks(f.work.id)[1].instance.fence,8);await works.verifyWork(child.id);
 lease('codex_head','codex',true,7);assert.equal((await wake.wake({teamId:f.team.id,memberId:f.team.members[0].id,requestId:'root-wake',bindingRequestId:'launch'})).state,'accepted');lease('codex_head','codex',false,8);await wake.check('root-wake');f.db.prepare('UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2 WHERE id=?').run('run-head');await wake.bind('root-wake');
 assert.equal(f.store.readWork(f.work.id).run.consumerGeneration,1);assert.equal(f.store.readCurrentWork(f.work.id).run.consumerGeneration,2);assert.equal(f.store.readCurrentWork(child.id).parent.generation,1);assert.equal(f.store.readCurrentWork(child.id).parentAuthority.generation,2);await works.verifyWork(child.id);
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works});await service.check(child.id);assert.equal(f.store.readDispatchProtocol(child.id).state,'accepted');
 const {nativeLaunchIntent,publicOperation}=await import('../src/local/native-launch.mjs'),leaf=f.team.members.find(m=>m.boss===f.member.id);
 let prepared=f.store.prepareOperation({teamId:f.team.id,memberId:leaf.id,requestId:'leaf-prepared',configVersion:1},{scope,nativeRequest:nativeLaunchIntent(f.team,leaf,scope),runtimeId:'runtime-one',roleVersion:1,title:leaf.name,executionHostId:'local'}).operation;
 const patch={status:'created',kind:'structured',handle:'leaf-chat',sessionId:'leaf-recover',observation:{ownerFence:7}};f.store.settleOperation(prepared.requestId,prepared.nativeRequest.operationId,{...patch,public:publicOperation({...prepared,...patch})});lease('leaf-recover','claude',true,7);
 assert.equal((await wake.wake({teamId:f.team.id,memberId:leaf.id,requestId:'leaf-wake',bindingRequestId:'leaf-prepared'})).state,'needs_decision');assert.equal(f.store.readWake('leaf-wake').managerRequest.workId,child.id);
 await assert.rejects(wake.handoff('leaf-wake'),/genuine direct manager/);
 const p=f.store.readDispatchProtocol(child.id),spec=JSON.stringify({protocol:'team-questions/v1',kind:'recovery-handoff',workId:child.id,token:p.token,generation:1,appQuestionId:'leaf-wake',memberId:leaf.id,oldRequestId:'leaf-prepared',decision:'replace',summary:'Checked original leaf session and its stop evidence',evidence:['native-owner-death:7']});
 f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run('leaf-handoff','run-manager',spec,'ready',null,null,null,null,null);
 const {createHash}=await import('node:crypto'),canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const params={spec,run:'run-manager',callerTerminalHandle:'orca_session_id:claude_child',__orcaCallerOrcaSessionId:'claude_child'};f.db.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('local-fingerprint','create-handoff','orchestration.taskCreate',createHash('sha256').update(JSON.stringify(canonical({method:'orchestration.taskCreate',params}))).digest('hex'),'completed',JSON.stringify({task:{id:'leaf-handoff',run_id:'run-manager',spec}}));
 assert.equal((await wake.handoff('leaf-wake')).state,'approved');assert.equal(f.store.readWake('leaf-wake').handoff.runId,'run-manager');assert.equal(f.store.readWake('leaf-wake').handoff.reviewer,f.member.id);

});
