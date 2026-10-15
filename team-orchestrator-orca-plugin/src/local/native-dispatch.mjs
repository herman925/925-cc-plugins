import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().filter(key=>value[key]!==undefined).map(key=>[key,canonical(value[key])])):value;
export const nativeMutationFingerprint=(method,params,owner,target)=>{
 const stable={...params}; delete stable.waitSubmitMs;
 if(owner.kind==='structured')stable.__orcaCallerOrcaSessionId=owner.sessionId;
 if(typeof stable.terminal==='string'&&target?.kind==='terminal'&&target.paneKey){const parts=target.paneKey.split(':');stable.terminal=parts.length===2&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(parts[1])?{paneLeafId:parts[1]}:{paneKey:target.paneKey};}
 for(const key of ['from','callerTerminalHandle'])if(typeof stable[key]==='string'&&owner.paneKey){
  const parts=owner.paneKey.split(':'),leaf=parts[1];
  stable[key]=parts.length===2&&parts[0]&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(leaf)?{paneLeafId:leaf}:{paneKey:owner.paneKey};
 }
 return createHash('sha256').update(JSON.stringify(canonical({method,params:stable}))).digest('hex');
};
const caller=owner=>owner.kind==='structured'?`orca_session_id:${owner.sessionId}`:owner.handle;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
function verifyIntent(task, spec, work, protocol, team, owner, receipt) {
 if(!spec||spec.protocol!=='team-dispatch/v1'||spec.workId!==work.id||spec.token!==protocol.token||spec.generation!==protocol.generation||spec.configVersion!==work.configVersion||typeof spec.taskKey!=='string'||!/^[A-Za-z0-9-]{1,120}$/.test(spec.taskKey)||typeof spec.instruction!=='string'||!spec.instruction.trim()||spec.instruction.length>8000)throw Error('Native task intent does not match this work admission protocol.');
 if(Object.keys(spec).some(key=>!['protocol','workId','token','generation','taskKey','memberId','configVersion','roleVersion','role','instruction','dependencies','previousAttemptId'].includes(key)))throw Error('Native intent has unsupported fields.');
 if(spec.dependencies!==undefined&&(!Array.isArray(spec.dependencies)||spec.dependencies.length>100||spec.dependencies.some(key=>typeof key!=='string'||!/^[A-Za-z0-9-]{1,120}$/.test(key)||key===spec.taskKey)||new Set(spec.dependencies).size!==spec.dependencies.length))throw Error('Invalid application dependencies.');
 const member=team.members.find(row=>row.id===spec.memberId);
 if(!member||member.boss!==work.supervisorMemberId||member.roleVersion!==spec.roleVersion||!same(spec.role,{brief:member.brief,habits:member.habits,collaboration:member.collaboration}))throw Error('Task member, direct supervisor or frozen role version does not match.');
 const expected=nativeMutationFingerprint('orchestration.taskCreate',{spec:task.spec,run:work.run.id,callerTerminalHandle:caller(owner)},owner);
 if(receipt.payload_hash!==expected||receipt.value?.task?.id!==task.id||receipt.value.task.spec!==task.spec||receipt.value.task.run_id!==work.run.id)throw Error('Native Task author proof is unavailable. Use the exact task-create protocol without extra flags.');
 if(owner.kind==='terminal'&&(task.created_by_terminal_handle!==owner.handle||task.created_by_pane_key!==owner.paneKey||task.created_by_process_incarnation!==owner.incarnationId||task.created_by_run_generation!==protocol.generation))throw Error('Native terminal Task creator instance is unverified.');
 return {spec,member,nativeTaskId:task.id,taskSpec:task.spec,requestId:receipt.request_id,payloadHash:receipt.payload_hash};
}
export async function readNativeDispatchEvidence(userData,{work,protocol,team,owner,admitted=[]}) {
 let db;
 try {
  const root=await realpath(userData),file=await realpath(join(root,'orchestration.db')),rel=relative(root,file);
  if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error('Native evidence path is outside the verified profile.');
  const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(file,{readOnly:true});db.exec('BEGIN');
  if(db.prepare('PRAGMA user_version').get().user_version!==43)throw Error('Native orchestration evidence schema is unsupported.');
  const run=db.prepare('SELECT id,objective,home_database,legacy,consumer_generation,coordinator_handle,coordinator_pane_key,coordinator_orca_session_id,coordinator_orca_session_id_generation FROM runs WHERE id=?').get(work.run.id);
  if(!run||run.objective!==work.nativeObjective||run.home_database!=='this_database'||run.legacy!==0||run.consumer_generation!==protocol.generation||work.run.consumerGeneration!==protocol.generation)throw Error('Native Run generation or work changed; admission is fenced.');
  if(owner.kind==='structured'?(run.coordinator_orca_session_id!==owner.sessionId||run.coordinator_orca_session_id_generation!==run.consumer_generation):(run.coordinator_handle!==owner.handle||run.coordinator_pane_key!==owner.paneKey))throw Error('Native Run owner no longer matches its supervisor.');
  const identity=db.prepare("SELECT caller_fingerprint FROM mutation_caller_identities WHERE transport='local_authenticated_transport'").get();
  if(!identity?.caller_fingerprint)throw Error('Native mutation author evidence is unavailable.');
  const receipts=(method,taskId,field='task.id')=>db.prepare(`SELECT request_id,payload_hash,state,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method=? AND state='completed' AND json_valid(receipt) AND json_extract(receipt,?)=? LIMIT 3`).all(identity.caller_fingerprint,method,`$.${field}`,taskId).map(row=>({...row,value:parse(row.receipt)}));
  const intents=[], rejected=[], observations=[],reviews=[];
  const tasks=db.prepare('SELECT id,run_id,spec,status,result,created_by_terminal_handle,created_by_pane_key,created_by_process_incarnation,created_by_run_generation FROM tasks WHERE run_id=?').all(work.run.id);
  for(const task of tasks){
   const spec=parse(task.spec);if(spec?.protocol!=='team-dispatch/v1'||spec.workId!==work.id||admitted.some(row=>row.nativeTaskId===task.id))continue;
   try{
    const proof=receipts('orchestration.taskCreate',task.id);if(proof.length!==1)throw Error('Native Task creation receipt is missing or ambiguous.');
    const intent=verifyIntent(task,spec,work,protocol,team,owner,proof[0]);
    intent.unadmitted=!['ready','pending'].includes(task.status)||Boolean(db.prepare('SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1').get(task.id));
    intents.push(intent);
   }catch(error){rejected.push({nativeTaskId:task.id,detail:error.message});}
  }
  for(const attempt of admitted){
   if(attempt.admission==='unadmitted'){observations.push({id:attempt.id,state:'unverified',detail:'This native work began before app admission; its member remains reserved for reconciliation.'});continue;}
   const starts=receipts('orchestration.workerStart',attempt.nativeTaskId,'taskId');
   if(starts.length!==1){const present=db.prepare('SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1').get(attempt.nativeTaskId);observations.push({id:attempt.id,state:starts.length||present?'unverified':'absent',detail:starts.length?'Native worker-start receipt is ambiguous.':present?'Native worker effect exists without a completed author receipt; reconcile before any new attempt.':'Waiting for the real supervisor to start the admitted Task.'});continue;}
   const start=starts[0], expected=nativeMutationFingerprint('orchestration.workerStart',{...attempt.startParams,from:caller(owner),devMode:false},owner,attempt.reuse?.binding);
   if(start.payload_hash!==expected||start.value.runId!==work.run.id||typeof start.value.dispatchId!=='string'){observations.push({id:attempt.id,state:'unverified',detail:'Native worker-start author or input does not match admission.'});continue;}
   const d=db.prepare('SELECT id,run_id,task_id,creator_handle,creator_pane_key,creator_orca_session_id,creator_dispatch_id,assignee_handle,assignee_pane_key,assignee_orca_session_id,process_incarnation,host_scope,status,consumer_generation FROM dispatch_contexts WHERE id=?').get(start.value.dispatchId);
   const worker=d&&db.prepare('SELECT dispatch_id,worktree_id,agent_terminal_handle,state,runtime_epoch,start_options FROM worker_dispatches WHERE dispatch_id=?').get(d.id);
   const host=parse(d?.host_scope), options=parse(worker?.start_options),hostMatches=work.scope.executionHostId==='local'?host?.kind==='local'&&host.hostId==='local':host?.kind==='ssh'&&`ssh:${encodeURIComponent(host.targetId)}`===work.scope.executionHostId;
   if(!d||d.run_id!==work.run.id||d.task_id!==attempt.nativeTaskId||!worker||worker.worktree_id!==work.scope.workspaceId||worker.agent_terminal_handle!==d.assignee_handle||!hostMatches||(attempt.reuse?(d.assignee_orca_session_id?d.assignee_orca_session_id!==attempt.reuse.binding.sessionId:d.assignee_handle!==attempt.reuse.binding.handle||d.process_incarnation!==attempt.reuse.binding.incarnationId):options?.agent!==attempt.startParams.agent)||(owner.kind==='structured'?d.creator_orca_session_id!==owner.sessionId:d.creator_handle!==owner.handle||d.creator_pane_key!==owner.paneKey)){observations.push({id:attempt.id,state:'unverified',detail:'Native Dispatch creator, member instance or execution host is unverified.'});continue;}
   const reusedChat=attempt.reuse?.terminal===`orca_session_id:${d.assignee_orca_session_id}`&&d.assignee_handle===attempt.reuse.terminal&&Number.isSafeInteger(attempt.reuse.sessionFence);
   if(!d.assignee_handle||(!reusedChat&&(!d.assignee_pane_key||!d.process_incarnation))||(owner.kind==='structured'?d.assignee_orca_session_id===owner.sessionId:d.assignee_pane_key===owner.paneKey)){observations.push({id:attempt.id,state:'unverified',detail:'Native worker instance evidence is incomplete.'});continue;}
   const binding={kind:d.assignee_orca_session_id?'structured':'terminal',handle:d.assignee_handle,paneKey:d.assignee_pane_key,incarnationId:d.process_incarnation,...(reusedChat?{sessionFence:attempt.reuse.sessionFence}:{}),...(d.assignee_orca_session_id?{sessionId:d.assignee_orca_session_id}:{}),workspaceId:worker.worktree_id,executionHostId:work.scope.executionHostId,runtimeId:worker.runtime_epoch};
   const facts=db.prepare("SELECT id,task_id,authority_id,payload FROM attempt_observation_facts WHERE dispatch_id=? AND facet='worker_report'").all(d.id);
   let completion;
   for(const fact of facts){
    const report=parse(fact.payload);if(fact.task_id!==attempt.nativeTaskId||fact.authority_id!==`run_home:${work.run.id}`||!fact.id.startsWith('worker_report:')||report?.status!=='accepted'||report.reportId!==fact.id||!['succeeded','failed'].includes(report.outcome))continue;
    const message=db.prepare('SELECT id,run_id,from_handle,sender_pane_key,type,body,payload FROM messages WHERE id=?').get(fact.id.slice('worker_report:'.length)),payload=parse(message?.payload);
    if(message?.run_id!==work.run.id||message.type!=='worker_done'||payload?.dispatchId!==d.id||payload.taskId!==attempt.nativeTaskId||payload.outcome!==report.outcome||message.from_handle!==d.assignee_handle||message.sender_pane_key!==d.assignee_pane_key)continue;
    const expectedStatus=report.outcome==='succeeded'?'completed':'failed';
    if(d.status!==expectedStatus||worker.state!==report.outcome)continue;
    completion={outcome:report.outcome,result:String(message.body??'').slice(0,16000),evidenceId:fact.id};break;
   }
   observations.push({id:attempt.id,state:'verified',dispatchId:d.id,creatorDispatchId:d.creator_dispatch_id,binding,nativeState:worker.state,startRequestId:start.request_id,startPayloadHash:start.payload_hash,...(completion?{completion}:{})});
  }
  for(const attempt of admitted){
   if(!attempt.evidenceId||!attempt.reviewToken)continue;
   const proofs=db.prepare("SELECT request_id,payload_hash,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method='orchestration.taskUpdate' AND state='completed' AND json_valid(receipt) AND json_extract(receipt,'$.task.id')=? ORDER BY rowid LIMIT 101").all(identity.caller_fingerprint,attempt.nativeTaskId);
   if(proofs.length>100){rejected.push({detail:'Review receipt history exceeds the verification bound.'});continue;}
   for(const proof of proofs){
    const task=parse(proof.receipt)?.task,review=parse(task?.result);
    if(review?.protocol!=='team-review/v1')continue;
    const status=attempt.outcome==='succeeded'?'completed':'failed';
    const expected=nativeMutationFingerprint('orchestration.taskUpdate',{id:attempt.nativeTaskId,status,result:task.result,run:work.run.id,callerTerminalHandle:caller(owner)},owner);
    if(proof.payload_hash!==expected||task.run_id!==work.run.id||task.status!==status||review.workId!==work.id||review.token!==protocol.token||review.generation!==protocol.generation||review.taskKey!==attempt.taskKey||review.attemptId!==attempt.id||review.nativeTaskId!==attempt.nativeTaskId||review.dispatchId!==attempt.dispatchId||review.reviewToken!==attempt.reviewToken||review.reviewerMemberId!==attempt.supervisorMemberId||!team.members.some(m=>m.id===attempt.memberId&&m.boss===review.reviewerMemberId)||!['accept','rework'].includes(review.decision)||!Array.isArray(review.evidenceRefs)||review.evidenceRefs.length>100||!review.evidenceRefs.includes(attempt.evidenceId)||review.evidenceRefs.some(ref=>typeof ref!=='string'||!ref||ref.length>2000)||typeof review.summary!=='string'||!review.summary.trim()||review.summary.length>8000){rejected.push({detail:'Supervisor review author, attempt or validation evidence is unverified.'});continue;}
    reviews.push({attemptId:attempt.id,requestId:proof.request_id,payloadHash:proof.payload_hash,reviewerMemberId:review.reviewerMemberId,decision:review.decision,evidenceRefs:review.evidenceRefs,summary:review.summary,generation:protocol.generation});
   }
  }
  return {state:'verified',intents,rejected,observations,reviews};
 }catch(error){return {state:'unverified',detail:error.code?'Native Task evidence is unavailable or incompatible. Preserve the work and reconnect its owning runtime.':String(error.message??'Native evidence unavailable').slice(0,1200),intents:[],observations:[],rejected:[]};}
 finally{if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}
