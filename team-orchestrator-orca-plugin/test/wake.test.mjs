import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {openTeamStore} from '../src/local/store.mjs';import {DEFAULT_FORM} from '../src/team.mjs';import {nativeLaunchIntent,publicOperation} from '../src/local/native-launch.mjs';
import {createWakeService} from '../src/local/wake.mjs';
async function fixture(t,agent='codex',kind='structured'){
 const profile=await mkdtemp(join(tmpdir(),'wake118-')),store=await openTeamStore({userData:profile});t.after(async()=>{store.close();await rm(profile,{recursive:true,force:true});});
 const scope={workspaceId:'folder:/work',executionHostId:'local',kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex')};
 const team=store.createTeam({requestId:'team',expectedRevision:0,form:{...DEFAULT_FORM,agents:[agent,agent,agent]}},scope).teams[0],member=team.members[0];
 let op=store.prepareOperation({teamId:team.id,memberId:member.id,requestId:'launch',configVersion:1},{scope,nativeRequest:nativeLaunchIntent(team,member,scope),runtimeId:'runtime',roleVersion:1,title:'Head',executionHostId:'local',hostGeneration:null}).operation;
 const patch=kind==='structured'?{status:'created',kind:'structured',handle:'chat',sessionId:'session-118',observation:{state:'unknown',ownerFence:7}}:{status:'created',kind:'terminal',handle:'term-118',paneKey:'tab:leaf',observation:{incarnationId:'incarnation-118'}};op=store.settleOperation('launch',op.nativeRequest.operationId,{...patch,public:publicOperation({...op,...patch})});
 const db=new DatabaseSync(join(profile,'agent-session-journal.db'));t.after(()=>db.close());db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 let dead=false,offers=true,outcome='continued',fence=7;const calls=[];
 const write=()=>kind==='structured'&&db.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run(op.sessionId,JSON.stringify({schemaVersion:2,sessionId:op.sessionId,provider:agent,location:scope,lease:{sessionId:op.sessionId,runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1,hostId:'local',spawnToken:'native-spawn'},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));write();
 const rpc=async(method,params)=>{calls.push({method,params});if(method==='terminal.show')return {terminal:{handle:'term-118',worktreeId:scope.workspaceId,executionHostId:'local',tabId:'tab',leafId:'leaf',incarnationId:'incarnation-118',ptyId:'pty-118',agentIdentity:agent,connected:!dead,writable:!dead}};if(method==='status.get')return {runtimeId:'runtime'};if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:'local'}};if(method==='agentSession.restartResumable')return {sessions:offers?[{sessionId:op.sessionId,workspaceId:scope.workspaceId,executionHostId:'local',agent}]:[],failed:[]};if(method==='agentSession.restartContinue'){if(outcome==='throw')throw Error('lost receipt');return {resumed:[],continued:[{sessionId:op.sessionId,outcome}]};}if(method==='agentSession.history')return {ok:true,page:{sessionId:op.sessionId,fence}};throw Error('Unsupported fixture method '+method);};
 const service=createWakeService({store,rpc,userData:profile,consent:async()=>{}});
 return {profile,store,scope,team,member,op,rpc,calls,service,input:{teamId:team.id,memberId:member.id,requestId:'wake-1',bindingRequestId:'launch'},set dead(value){dead=value;write();},set offers(value){offers=value;},set outcome(value){outcome=value;},set fence(value){fence=value;write();}};
}
test('a live or unknown old owner blocks wake without launching or deleting the member',async t=>{
 const f=await fixture(t);const result=await f.service.wake(f.input);
 assert.equal(result.state,'blocked');assert.match(result.detail,/stopped|death/);assert.equal(f.store.readSnapshot().teams[0].members[0].id,f.member.id);
 assert.equal(f.calls.some(c=>/restartContinue|send|launchReplay|ensureAgentSession/.test(c.method)),false);
});
for(const agent of ['codex','claude'])test(`${agent} restart continuation uses only the saved conversation and persists its accepted effect without claiming ready`,async t=>{
 const f=await fixture(t,agent);f.dead=true;const result=await f.service.wake(f.input);
 assert.equal(result.state,'accepted');assert.equal(result.memberId,f.member.id);assert.deepEqual(f.calls.find(c=>c.method==='agentSession.restartContinue').params,{sessionIds:['session-118']});
 assert.equal(f.calls.some(c=>c.method==='agentSession.restartResume'),false);
 await f.service.wake(f.input);assert.equal(f.calls.filter(c=>c.method==='agentSession.restartContinue').length,1);
 assert.equal(f.store.readWake('wake-1').oldBinding.requestId,'launch');
});
test('lost continuation receipt and duplicate panels retain one unknown reservation with no fallback',async t=>{
 const f=await fixture(t);f.dead=true;f.outcome='throw';await Promise.all([f.service.wake(f.input),f.service.wake(f.input)]);
 assert.equal(f.store.readWake('wake-1').state,'unknown');assert.equal(f.calls.filter(c=>c.method==='agentSession.restartContinue').length,1);
 await assert.rejects(f.service.wake({...f.input,requestId:'second'}),/recovery/);
 assert.equal(f.calls.some(c=>c.method==='agent.launchReplay'),false);
});
test('a manually closed Codex or Claude conversation receives durable native user input when no restart offer exists',async t=>{
 const f=await fixture(t);f.dead=true;f.offers=false;
 const service=createWakeService({store:f.store,userData:f.profile,consent:async()=>{},rpc:async(method,params)=>{
  if(method==='agentSession.send'){assert.equal(f.store.readWake('wake-1').state,'submitted');assert.equal(params.envelope.sessionId,'session-118');assert.equal(params.envelope.expectedRuntimeFence,7);return {ok:true,fence:8,value:{clientMessageId:params.envelope.clientOperationId,submission:{dispatchState:'accepted'}}};}return f.rpc(method,params);
 }});
 assert.equal((await service.wake(f.input)).state,'accepted');assert.equal(f.store.readWake('wake-1').nativeAction.method,'agentSession.send');
});
test('verified resumed owner installs a new member instance while late old launch evidence cannot retarget it',async t=>{
 const f=await fixture(t);f.dead=true;await f.service.wake(f.input);f.fence=8;f.dead=false;
 const result=await f.service.check('wake-1');assert.equal(result.state,'resumed');
 const current=f.store.readMemberOperation(f.member.id);assert.equal(current.memberId,f.member.id);assert.equal(current.instanceGeneration,2);assert.notEqual(current.requestId,f.op.requestId);
 const old=f.store.readOperation('launch');f.store.settleOperation(old.requestId,old.nativeRequest.operationId,{warning:'late old report'},old.version);
 assert.equal(f.store.readSnapshot().teams[0].launch.members[f.member.id].requestId,current.requestId);
});
test('highest supervisor native refusal requires an explicit saved human handoff before fresh replacement',async t=>{
 const f=await fixture(t);f.dead=true;f.outcome='refused';await f.service.wake(f.input);
 assert.equal(f.store.readWake('wake-1').state,'needs_decision');
 await assert.rejects(f.service.prepareFresh('wake-1'),/decision|handoff/);
 await f.service.decide({requestId:'wake-1',version:f.store.readWake('wake-1').version,decision:'replace',summary:'Continue the pending objective after checking its saved evidence.',evidenceRefs:['native-owner-death:7']});
 const row=f.store.readWake('wake-1');assert.equal(row.handoff.reviewer,'user');assert.equal(row.handoff.summary,'Continue the pending objective after checking its saved evidence.');
 const fresh=await f.service.prepareFresh('wake-1');assert.equal(fresh.operation.memberId,f.member.id);assert.equal(fresh.operation.instanceGeneration,2);assert.notEqual(fresh.operation.nativeRequest.operationId,f.op.nativeRequest.operationId);assert.match(fresh.operation.nativeRequest.prompt.text,/Continue the pending objective/);
 assert.equal(f.store.readOperation('launch').sessionId,'session-118');
});
test('resumed highest supervisor only regains work authority after genuine native Run ownership; original epoch stays immutable',async t=>{
 const f=await fixture(t),work=f.store.prepareWork({teamId:f.team.id,requestId:'goal',expectedRevision:f.store.readSnapshot().revision,objective:'Finish the saved goal'}).work;
 f.store.updateWork(work.id,work.version,{instance:{kind:'structured',liveSessionId:'session-118',sessionId:'canonical-head',fence:7},run:{state:'verified',id:'run-one',consumerGeneration:1}});
 f.dead=true;await f.service.wake(f.input);f.fence=8;f.dead=false;await f.service.check('wake-1');
 const db=new DatabaseSync(join(f.profile,'orchestration.db'));t.after(()=>db.close());db.exec("PRAGMA user_version=43; CREATE TABLE runs(id TEXT,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER)");
 db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run-one',work.nativeObjective,'this_database',null,null,'wrong-head',1,1,0);
 const service=createWakeService({store:f.store,userData:f.profile,consent:async()=>{},rpc:async(method,params)=>{if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:canonical-head'};if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:'session-118',worktreeId:f.scope.workspaceId}};if(method==='orchestration.runShow')return {run:{id:'run-one',objective:work.nativeObjective,consumer_generation:1}};return f.rpc(method,params);}});
 await service.bind('wake-1');assert.equal(f.store.readCurrentWork(work.id).binding.requestId,'launch');
 db.exec("UPDATE runs SET coordinator_orca_session_id='canonical-head'");await service.bind('wake-1');
 assert.equal(f.store.readCurrentWork(work.id).instance.fence,8);assert.equal(f.store.readCurrentWork(work.id).binding.instanceGeneration,2);assert.equal(f.store.readWork(work.id).binding.requestId,'launch');assert.equal(f.store.readWork(work.id).instance.fence,7);
});
import {questionFixture} from './questions-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
test('subordinate fresh replacement accepts only its real direct manager native checked handoff',async t=>{
 const f=await questionFixture(t,{formOverrides:{launchMode:'all'}}),scope=f.store.readScope(f.team.id),member=f.member;
 const dispatch=createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});await dispatch.check(f.work.id);
 const op=f.store.prepareOperation({teamId:f.team.id,memberId:member.id,requestId:'child-launch',configVersion:1},{scope,nativeRequest:nativeLaunchIntent(f.team,member,scope),runtimeId:'runtime-one',roleVersion:1,title:'Child',executionHostId:'local'}).operation;
 const patch={status:'created',kind:'structured',handle:'child',sessionId:'child-live',observation:{ownerFence:7}};f.store.settleOperation(op.requestId,op.nativeRequest.operationId,{...patch,public:publicOperation({...op,...patch})});
 const db=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>db.close());db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');db.prepare('INSERT INTO agent_session_records VALUES(?,?)').run('child-live',JSON.stringify({schemaVersion:2,sessionId:'child-live',provider:'claude',location:scope,lease:{sessionId:'child-live',runtimeFence:7,claimStatus:'released',deathEvidence:{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}}}));
 const rpc=async(method,params,envelope)=>{if(method==='agentSession.restartResumable')return {sessions:[{sessionId:'child-live',workspaceId:scope.workspaceId,executionHostId:'local',agent:member.agent}]};if(method==='agentSession.restartContinue')return {continued:[{sessionId:'child-live',outcome:'refused'}]};return f.rpc(method,params,envelope);};
 const service=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});await service.wake({teamId:f.team.id,memberId:member.id,requestId:'child-wake',bindingRequestId:op.requestId});
 await assert.rejects(service.decide({requestId:'child-wake'}),/direct manager/);await assert.rejects(service.handoff('child-wake'),/genuine direct manager/);
 const spec=JSON.stringify({protocol:'team-questions/v1',kind:'recovery-handoff',workId:f.work.id,token:f.store.readDispatchProtocol(f.work.id).token,generation:1,appQuestionId:'child-wake',memberId:member.id,oldRequestId:op.requestId,decision:'replace',summary:'Checked the original task and native stop evidence.',evidence:['original-task','native-owner-death:7']});
 const task={id:'handoff-task',run_id:'run-head',spec};f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(task.id,task.run_id,spec,'ready',null,null,null,null,null);f.receipt('handoff-request','orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task});
 assert.equal((await service.handoff('child-wake')).state,'approved');assert.equal(f.store.readWake('child-wake').handoff.reviewer,f.team.members[0].id);
 const fresh=await service.prepareFresh('child-wake');assert.equal(fresh.operation.memberId,member.id);assert.equal(fresh.operation.instanceGeneration,2);
});
test('an old supervisor question stays blocked until an explicit user recovery resolution preserves its unanswered history',async t=>{
 const f=await fixture(t),work=f.store.prepareWork({teamId:f.team.id,requestId:'goal',expectedRevision:f.store.readSnapshot().revision,objective:'Finish'}).work;
 f.store.updateWork(work.id,work.version,{instance:{kind:'structured',liveSessionId:'session-118',sessionId:'canonical',fence:7},run:{state:'verified',id:'run',consumerGeneration:1}});
 f.store.ingestQuestion(work.id,{spec:{kind:'user-question',appQuestionId:'old-question',summary:'Old choice',options:[],blockingTaskKeys:[]}});
 f.dead=true;await f.service.wake(f.input);f.fence=8;f.dead=false;await f.service.check('wake-1');
 const wake=f.store.readWake('wake-1');f.store.rebindWake('wake-1',wake.version,work.id,{kind:'structured',liveSessionId:'session-118',sessionId:'canonical',fence:8},{state:'verified',id:'run',consumerGeneration:1});
 assert.ok(f.store.workClosureBlockers(work.id).some(r=>r.includes('User decision')));
 await f.service.resolveQuestion({requestId:'wake-1',workId:work.id,questionId:'old-question',note:'Superseded question reviewed; the recovered supervisor will ask again if needed.'});
 const q=f.store.listQuestions(work.id)[0];assert.equal(q.status,'closed');assert.equal(q.answers.length,0);assert.equal(q.resolution.by,'user');assert.equal(q.resolution.recoveryRequestId,'wake-1');assert.equal(f.store.workClosureBlockers(work.id).some(r=>r.includes('User decision')),false);
});
import {createStopService} from '../src/local/stop.mjs';
for(const agent of ['codex','claude'])test(`${agent} terminal wake consumes exact native stop evidence and never invents a provider session ID`,async t=>{
 const f=await fixture(t,agent,'terminal'),stops=createStopService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{}});
 assert.equal((await f.service.wake(f.input)).state,'blocked');
 const stop=await stops.prepare({requestId:'stop-terminal',teamId:f.team.id,memberId:f.member.id,operationRequestId:'launch'});await stops.validate(stop.requestId);await stops.settle(stop.requestId,{postStopVerified:true,stoppedPtyIds:['pty-118']});f.dead=true;
 assert.equal((await f.service.wake(f.input)).state,'needs_decision');assert.equal(f.calls.some(c=>c.method==='terminal.ensureAgentSession'||c.method==='agent.launchReplay'),false);
 const row=f.store.readWake('wake-1');assert.equal(row.proof.stop.kind,'native-exact-stop');
 await f.service.decide({requestId:'wake-1',version:row.version,decision:'replace',summary:'Checked exact terminal stop and original task.',evidenceRefs:['stop-terminal']});
 const fresh=await f.service.prepareFresh('wake-1');assert.equal(fresh.operation.instanceGeneration,2);assert.equal(fresh.operation.nativeRequest.agent,agent);assert.equal(fresh.operation.nativeRequest.resumeFrom,undefined);
});
for(const agent of ['codex','claude'])test(`${agent} idle replacement retires only the app recipient and preserves original native history`,async t=>{
 const f=await fixture(t,agent),other=agent==='codex'?'claude':'codex';let idle=true;
 const rpc=async(method,params)=>method==='agentSession.history'?{ok:true,page:{sessionId:f.op.sessionId,fence:7,latestTurn:{itemId:'turn',turn:{state:idle?'completed':'running'}},backgroundTasks:null,queuedMessages:[],submissions:[]}}:f.rpc(method,params);
 const service=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 const input={...f.input,expectedRevision:f.store.readSnapshot().revision,agent:other,model:'default',effort:'default',summary:'Checked all accepted results. Continue with the current saved role.',evidenceRefs:['saved-results']};
 idle=false;await assert.rejects(service.requestReplacement(input),/idle|execution/);assert.equal(f.store.readMemberOperation(f.member.id).requestId,'launch');
 idle=true;const row=await service.requestReplacement(input);assert.equal(row.state,'approved');assert.equal(f.store.readSnapshot().teams[0].admission.members[f.member.id],true);
 const fresh=await service.prepareFresh(row.requestId);assert.equal(fresh.operation.nativeRequest.agent,other);assert.equal(fresh.operation.configVersion,2);assert.equal(fresh.operation.memberId,f.member.id);assert.equal(fresh.operation.instanceGeneration,2);
 assert.equal(f.store.readOperation('launch').status,'created');assert.equal(f.store.readOperation('launch').nativeRequest.agent,agent);assert.equal(f.calls.some(c=>/restartContinue|close|stop|cancel/.test(c.method)),false);
 f.store.settleOperation('launch',f.op.nativeRequest.operationId,{warning:'late old evidence'});assert.equal(f.store.readMemberOperation(f.member.id).requestId,fresh.operation.requestId);
 idle=false;await assert.rejects(service.validateFresh(row.requestId),/idle|execution/);
});
test('active supervisor idle retirement rechecks its original native authority before launch without reviving old send authority',async t=>{
 const f=await questionFixture(t),op=f.store.readOperation('launch');const db=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>db.close());db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');db.prepare('INSERT INTO agent_session_records VALUES(?,?)').run(op.sessionId,JSON.stringify({schemaVersion:2,sessionId:op.sessionId,provider:'codex',location:op.scope,lease:{sessionId:op.sessionId,runtimeFence:7,claimStatus:'live',ownerProcess:{pid:1,hostId:'local',spawnToken:'owner'}}}));
 const rpc=async(method,params,envelope)=>method==='agentSession.history'?{ok:true,page:{sessionId:op.sessionId,fence:7,latestTurn:{itemId:'done-turn',turn:{state:'completed'}},backgroundTasks:null,queuedMessages:[],submissions:[]}}:f.rpc(method,params,envelope);
 const service=createWakeService({store:f.store,rpc,userData:f.profile,works:f.works,consent:async()=>{}});
 await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,works:f.works,consent:async()=>{}}).check(f.work.id);
 const input={requestId:'active-idle',teamId:f.team.id,memberId:f.team.members[0].id,bindingRequestId:'launch',expectedRevision:f.store.readSnapshot().revision,agent:'claude',model:'default',effort:'default',summary:'Review the existing native Run and preserve the objective.',evidenceRefs:['run-head']};
 await service.requestReplacement(input);await service.prepareFresh(input.requestId);await service.validateFresh(input.requestId);
 await assert.rejects(f.works.verifyWork(f.work.id,true),/binding changed/);assert.throws(()=>f.store.assertAdmission(f.team.id,f.member.id),/replacement/);
 assert.equal(f.store.readWork(f.work.id).configVersion,1);assert.equal(f.store.effectiveTeamForWork(f.work.id).configVersion,2);assert.equal(f.store.readWork(f.work.id).binding.requestId,'launch');assert.equal(f.store.readWake(input.requestId).state,'replacing');
});
test('unknown Stop cannot be discharged by idle replacement',async t=>{
 const f=await fixture(t);f.store.prepareStop({requestId:'unknown-stop'},{memberId:f.member.id,teamId:f.team.id,operationRequestId:'launch',instanceGeneration:1});
 const rpc=async(method,params)=>method==='agentSession.history'?{ok:true,page:{sessionId:f.op.sessionId,fence:7,latestTurn:{turn:{state:'completed'}},backgroundTasks:null,queuedMessages:[],submissions:[]}}:f.rpc(method,params),service=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});
 await assert.rejects(service.requestReplacement({...f.input,expectedRevision:f.store.readSnapshot().revision,agent:'claude',model:'default',effort:'default',summary:'A requested change',evidenceRefs:['history']}),/Unresolved Stop/);
 assert.equal(f.store.readSnapshot().teams[0].configVersion,1);assert.equal(f.store.readMemberOperation(f.member.id).requestId,'launch');
});
test('fresh handoff uses saved updated role while retaining old launch role provenance',async t=>{
 const f=await fixture(t);f.dead=true;f.outcome='refused';await f.service.wake(f.input);const row=f.store.readWake('wake-1');await f.service.decide({requestId:row.requestId,version:row.version,decision:'replace',summary:'Read the saved role before taking over.',evidenceRefs:['role-update']});
 f.store.updateRole({requestId:'new-role',expectedRevision:f.store.readSnapshot().revision,teamId:f.team.id,memberId:f.member.id,brief:'CURRENT ROLE CHECKS',habits:'Verify results',collaboration:'Direct manager only'});
 const fresh=await f.service.prepareFresh(row.requestId);assert.equal(fresh.operation.roleVersion,2);assert.equal(fresh.operation.configVersion,2);assert.match(fresh.operation.nativeRequest.prompt.text,/CURRENT ROLE CHECKS/);assert.equal(f.store.readOperation('launch').roleVersion,1);
});
