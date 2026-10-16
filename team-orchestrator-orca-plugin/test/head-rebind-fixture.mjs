import assert from 'node:assert/strict';
export async function authorizedHeadRebind(t,f,{summary='Preserve accepted corrected work and its authenticated withdrawal.',evidenceRefs=['worker_report:report-corrected']}={}){
 const {DatabaseSync}=await import('node:sqlite'),{join}=await import('node:path'),{createWakeService}=await import('../src/local/wake.mjs'),{createWorkService}=await import('../src/local/teamwork.mjs'),{publicOperation}=await import('../src/local/native-launch.mjs');
 const scope=f.store.readScope(f.team.id),old=f.store.readOperation('launch'),journal=new DatabaseSync(join(f.profile,'agent-session-journal.db'));t.after(()=>journal.close());
 journal.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 if(old.kind==='structured')journal.prepare('INSERT INTO agent_session_records VALUES(?,?)').run(old.sessionId,JSON.stringify({schemaVersion:2,sessionId:old.sessionId,provider:'codex',location:scope,lease:{sessionId:old.sessionId,runtimeFence:7,claimStatus:'released',deathEvidence:{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}}}));
 let oldTerminalExited=false;const rpc=async(method,params,envelope)=>{
  if(method==='terminal.show'&&old.kind==='terminal'&&params.terminal===old.handle){const result=await f.rpc(method,params,envelope);return {terminal:{...result.terminal,connected:!oldTerminalExited,writable:!oldTerminalExited}};}
  if(method==='agentSession.restartResumable')return {sessions:[{sessionId:old.sessionId,workspaceId:scope.workspaceId,executionHostId:'local',agent:'codex'}]};
  if(method==='agentSession.restartContinue')return {continued:[{sessionId:old.sessionId,outcome:'refused'}]};
  if(method==='orchestration.runShow')return {run:f.db.prepare('SELECT * FROM runs WHERE id=?').get(params.id)};
  if(method==='agentSession.history'&&params.sessionId==='codex_recovered')return {ok:true,page:{sessionId:params.sessionId,fence:8,submissions:[],items:[]}};
  const result=await f.rpc(method,params,envelope);return method==='agentSession.send'&&params.envelope.sessionId==='codex_recovered'?{...result,fence:8}:result;
 };
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),wake=createWakeService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works});
 if(old.kind==='terminal'){const {createStopService}=await import('../src/local/stop.mjs'),stops=createStopService({store:f.store,rpc,userData:f.profile,consent:async()=>{}});const stop=await stops.prepare({requestId:'stop-old-head',teamId:f.team.id,memberId:f.team.members[0].id,operationRequestId:'launch'});await stops.validate(stop.requestId);await stops.settle(stop.requestId,{postStopVerified:true,stoppedPtyIds:['head-pty']});oldTerminalExited=true;}
 const input={teamId:f.team.id,memberId:f.team.members[0].id,requestId:'head-recovery',bindingRequestId:'launch'};
 assert.equal((await wake.wake(input)).state,'needs_decision');
 await wake.decide({requestId:input.requestId,version:f.store.readWake(input.requestId).version,decision:'replace',summary,evidenceRefs});
 const fresh=await wake.prepareFresh(input.requestId),patch={status:'created',kind:'structured',handle:'chat-recovered',sessionId:'codex_recovered',observation:{state:'unknown',ownerFence:8}};
 f.store.settleOperation(fresh.operation.requestId,fresh.operation.nativeRequest.operationId,{...patch,public:publicOperation({...fresh.operation,...patch})},fresh.operation.version);
 journal.prepare('INSERT INTO agent_session_records VALUES(?,?)').run('codex_recovered',JSON.stringify({schemaVersion:2,sessionId:'codex_recovered',provider:'codex',location:scope,lease:{sessionId:'codex_recovered',runtimeFence:8,claimStatus:'live',ownerProcess:{pid:1,hostId:'local',spawnToken:'recovered-owner'}}}));
 f.db.prepare('UPDATE runs SET coordinator_handle=NULL,coordinator_pane_key=NULL,coordinator_orca_session_id=?,coordinator_orca_session_id_generation=2,consumer_generation=2 WHERE id=?').run('codex_recovered','run-head');
 assert.equal((await wake.bind(input.requestId)).state,'bound');assert.equal(f.store.readCurrentWork(f.work.id).epoch,1);
 const {createDispatchService}=await import('../src/local/dispatch.mjs');await createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works}).check(f.work.id);
 const protocol=f.store.readDispatchProtocol(f.work.id);assert.notEqual(protocol.token,f.protocol.token);assert.equal(protocol.generation,2);
 return {rpc,works,protocol};
}
