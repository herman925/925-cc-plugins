import {realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
import {withNativeRuntime} from './native-runtime.mjs';
import {readNativeLaunchLedger} from './native-launch-ledger.mjs';
import {launchReceipt,publicOperation} from './native-launch.mjs';
import {readNativeDispatchEvidence} from './native-dispatch.mjs';
const stamp=()=>new Date().toISOString();
const detail=error=>String(error?.message??error).slice(0,1200);
// A released lease alone is not death. Historical, unfenced evidence cannot discharge a current owner.
export async function readSessionDeath(userData,sessionId,ownerFence,scope){
 let db;
 try{
  if(!Number.isSafeInteger(ownerFence)||ownerFence<1||!isAbsolute(userData||''))return null;
  const profile=await realpath(userData),path=await realpath(join(profile,'agent-session-journal.db')),rel=relative(profile,path);
  if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))return null;
  const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(path,{readOnly:true});
  if(db.prepare('PRAGMA user_version').get().user_version!==4)return null;
  const raw=db.prepare('SELECT record_json FROM agent_session_records WHERE session_id=?').get(sessionId)?.record_json;
  if(typeof raw!=='string'||raw.length>262144)return null;
  const record=JSON.parse(raw),lease=record.lease,death=lease?.deathEvidence;
  if(record.schemaVersion!==2||record.location?.workspaceId!==scope?.workspaceId||record.location?.executionHostId!==scope?.executionHostId||record.sessionId!==sessionId||lease?.sessionId!==sessionId||lease.runtimeFence!==ownerFence||lease.claimStatus!=='released'||lease.handoffStage||lease.handoffOperationId||lease.ownerProcess||lease.reservedSpawnToken||lease.unreconciled===true||death?.ownerFence!==ownerFence||!['exit-observed','pid-absent','identity-mismatch'].includes(death.kind)||!Number.isSafeInteger(death.observedAt)||death.observedAt>Date.now()+300000)return null;
  return {kind:death.kind,ownerFence,observedAt:death.observedAt};
 }catch{return null;}finally{db?.close();}
}
export function createRecoveryService({store,rpc,userData,consent}){
 const queues=new Map();
 const serial=(key,action)=>{const pending=(queues.get(key)??Promise.resolve()).catch(()=>{}).then(action);queues.set(key,pending);pending.finally(()=>{if(queues.get(key)===pending)queues.delete(key);}).catch(()=>{});return pending;};
 async function host(scope){
  if(!scope.executionHostId.startsWith('ssh:'))return null;
  const state=(await rpc('ssh.getState',{targetId:decodeURIComponent(scope.executionHostId.slice(4))}))?.state;
  if(state?.status!=='connected'||!Number.isSafeInteger(state.connectionGeneration))throw Error('Saved SSH host is disconnected or its generation is unknown; remote output is incomplete.');
  return state.connectionGeneration;
 }
 async function checkOperation(requestId){
  const operation=store.readOperation(requestId);if(!operation)return null;
  let patch={},recovery={state:operation.status==='created'?'confirmed_effect':'unknown',liveness:'unknown',source:'saved-operation',observedAt:stamp(),detail:'Persisted intent retained. Missing evidence never authorizes a second launch.'};
  try{
   await consent();
   if(operation.status==='unknown'){
    const ledger=await readNativeLaunchLedger(userData,operation.nativeRequest);
    if(ledger.state==='succeeded'){patch={...launchReceipt(ledger.result,operation),error:undefined};recovery={...recovery,state:'confirmed_effect',source:'native-launch-ledger',detail:'Original native launch receipt recovered; current execution is separate.'};}
    else {recovery.detail=ledger.detail;patch.error=ledger.detail;}
   }
   const saved={...operation,...patch};
   if(saved.status==='created'){
    recovery.detail='Native session creation is confirmed; current execution remains unverified.';
    const status=await rpc('status.get');
    await withNativeRuntime(rpc,status?.runtimeId,async()=>{
     const generation=await host(saved.scope);
     if(generation!==null&&saved.hostGeneration!=null&&generation!==saved.hostGeneration)throw Error('Saved SSH connection generation changed; observations remain incomplete.');
     const selected=(await rpc('worktree.show',{worktree:saved.scope.workspaceId.startsWith('folder:')?saved.scope.workspaceId:`id:${saved.scope.workspaceId}`}))?.worktree;
     if(selected?.id!==saved.scope.workspaceId||(selected.hostId??selected.identity?.executionHostId)!==saved.scope.executionHostId)throw Error('Saved member project or execution host changed.');
     if(saved.kind==='structured'){
      const instance=store.listWorks().find(work=>work.binding.requestId===requestId)?.instance;
      const death=await readSessionDeath(userData,saved.sessionId,instance?.fence??saved.observation?.ownerFence,saved.scope);
      if(death)recovery={...recovery,state:'stopped',liveness:'stopped',source:'native-owner-death',death,detail:'Native death evidence names the exact saved owner fence. The member reservation remains until an authorized lifecycle action.'};
     }else{
      const instance=store.listWorks().find(work=>work.binding.requestId===requestId)?.instance;
      const expected=instance?.incarnationId??saved.observation?.incarnationId;
      const shown=(await rpc('terminal.show',{terminal:saved.handle}))?.terminal;
      if(!expected||shown?.incarnationId!==expected||shown.handle!==saved.handle||shown.worktreeId!==saved.scope.workspaceId||shown.executionHostId!==saved.scope.executionHostId||`${shown.tabId}:${shown.leafId}`!==saved.paneKey)throw Error('Exact saved terminal incarnation is unverified. Inspect its native session; absence does not prove stopped.');
      if(shown.connected===true){recovery={...recovery,liveness:'live',source:'native-terminal',detail:'Exact terminal instance is connected. Provider readiness and task acceptance are separate.'};}
     }
     if(await host(saved.scope)!==generation)throw Error('SSH generation changed during observation; output is incomplete.');
     const final=await rpc('status.get');if(final?.runtimeId!==status.runtimeId)throw Error('Native runtime changed during reconciliation.');
    });
   }
  }catch(error){recovery={...recovery,state:(patch.status??operation.status)==='created'?'confirmed_effect':'unknown',liveness:'unknown',incomplete:true,detail:detail(error)};}
  patch.recovery=recovery;patch.public=publicOperation({...operation,...patch});
  try{return store.settleOperation(requestId,operation.nativeRequest.operationId,patch,operation.version??1);}catch{return store.readOperation(requestId);}
 }
 async function checkWork(workId){
  const work=store.readWork(workId),protocol=store.readDispatchProtocol(workId);
  if(!work||!protocol||!work.instance||!work.run.id)return store.dispatchProjection(workId);
  const attempts=store.listDispatches(workId),team=store.readTeamVersion(work.teamId,work.configVersion);
  const evidence=()=>readNativeDispatchEvidence(userData,{work,protocol,team,owner:work.instance,admitted:attempts});
  const observations=new Map();
  try{
   await consent();const status=await rpc('status.get');
   await withNativeRuntime(rpc,status?.runtimeId,async()=>{
    const generation=await host(work.scope);
    if(generation!==null&&work.binding.hostGeneration!=null&&generation!==work.binding.hostGeneration)throw Error('Saved SSH connection generation changed; observations remain incomplete.');
    const native=await evidence();if(native.state!=='verified')throw Error(native.detail);
    const run=(await rpc('orchestration.runShow',{id:work.run.id}))?.run;
    if(run?.id!==work.run.id||run.consumer_generation!==work.run.consumerGeneration||run.objective!==work.nativeObjective)throw Error('Saved Run owner generation changed; current authority is unverified.');
    const tasks=await rpc('orchestration.taskList',{run:work.run.id,brief:true});
    if(!Array.isArray(tasks?.tasks)||tasks.tasks.some(task=>task.run_id!==work.run.id))throw Error('Native Task evidence is not scoped to the saved Run.');
    for(const attempt of attempts){
     const found=native.observations.find(row=>row.id===attempt.id);
     let recovery={state:'unknown',liveness:'unknown',observedAt:stamp(),source:'native-dispatch-ledger',detail:found?.detail??'Native execution evidence is unavailable; the member remains reserved.'};
     if(!tasks.tasks.some(task=>task.id===attempt.nativeTaskId)){observations.set(attempt.id,{recovery:{...recovery,detail:'Saved native Task is absent from this Run snapshot. Its execution and reservation remain unresolved.'}});continue;}
     if(found?.state!=='verified'){
      if(found?.state==='absent'&&attempt.permit.state==='not_sent')recovery={...recovery,state:'intent',detail:'Permit intent has not been sent. Native absence is not proof that an older execution stopped.'};
      observations.set(attempt.id,{recovery});continue;
     }
     if(attempt.binding&&['kind','handle','sessionId','paneKey','incarnationId','runtimeId','workspaceId','executionHostId'].some(key=>attempt.binding[key]!==found.binding[key]))throw Error('Saved member execution instance changed; prior binding remains reserved.');
     const hostMatches=host=>work.scope.executionHostId==='local'?host?.kind==='local'&&host.hostId==='local':host?.kind==='ssh'&&`ssh:${encodeURIComponent(host.targetId)}`===work.scope.executionHostId;
     const matches=shown=>hostMatches(shown?.dispatch?.hostScope)&&(shown.dispatch.creatorDispatchId??null)===(found.creatorDispatchId??null)&&shown?.dispatch?.id===found.dispatchId&&shown.dispatch.runId===work.run.id&&shown.dispatch.taskId===attempt.nativeTaskId&&shown.dispatch.assigneeHandle===found.binding.handle&&shown.dispatch.assigneePaneKey===found.binding.paneKey&&shown.dispatch.processIncarnation===found.binding.incarnationId&&shown.worker?.dispatchId===found.dispatchId&&shown.worker.worktreeId===work.scope.workspaceId&&shown.worker.runtimeEpoch===found.binding.runtimeId;
     // workerShow/Read can reconcile old native starting/stopping states into unknown.
     let shown=await rpc('orchestration.workerShow',{dispatch:found.dispatchId});
     if(!matches(shown))throw Error('Native worker identity changed; the saved attempt remains reserved.');
     let output={incomplete:true,warnings:['Current output is unavailable.']};
     try{
      const read=await rpc('orchestration.workerRead',{dispatch:found.dispatchId,source:'auto',limit:40});
      if(read?.dispatchId!==found.dispatchId)throw Error('Native output belongs to another Dispatch.');
      output={source:read.source,sourceIdentity:typeof read.sourceIdentity==='string'?read.sourceIdentity.slice(0,512):undefined,archived:read.archived===true,incomplete:read.sourceExact!==true||read.contentComplete!==true||Boolean(read.fallbackReason)||Boolean(read.clipping?.length)||Boolean(read.warnings?.length)||read.transcript?.limited===true,warnings:(Array.isArray(read.warnings)?read.warnings:[]).slice(0,8).map(value=>String(value).slice(0,500)),...(read.fallbackReason?{fallbackReason:String(read.fallbackReason).slice(0,200)}:{})};
     }catch(error){output.warnings=[detail(error)];}
     shown=await rpc('orchestration.workerShow',{dispatch:found.dispatchId});if(!matches(shown))throw Error('Native worker changed during output read.');
     const exact=shown.observation?.exactWorker===true,liveness=exact&&['live','exited'].includes(shown.observation.status)?shown.observation.status==='exited'?'stopped':'live':'unknown';
     recovery={...recovery,state:liveness==='stopped'?'stopped':'confirmed_effect',liveness,incomplete:output.incomplete,output,runtimeId:status.runtimeId,hostGeneration:generation,detail:liveness==='stopped'?'Exact native worker observation confirms this execution exited. Its reservation is retained for authorized lifecycle handling.':liveness==='live'?'Exact native worker is live. Provider readiness and direct-supervisor acceptance remain separate.':'Native Dispatch effect is confirmed; current execution is unknown. Missing or changed identity never proves death.'};
     observations.set(attempt.id,{recovery,dispatchId:found.dispatchId,binding:found.binding});
    }
    const final=await evidence();if(final.state!=='verified')throw Error(final.detail);
    for(const [id,patch] of observations)if(patch.binding){const latest=final.observations.find(row=>row.id===id);if(latest?.state!=='verified'||latest.dispatchId!==patch.dispatchId||JSON.stringify(latest.binding)!==JSON.stringify(patch.binding))throw Error('Native Dispatch evidence changed during recovery.');}
    if(await host(work.scope)!==generation)throw Error('SSH disconnected or changed generation during read; output is incomplete.');
    if((await rpc('status.get'))?.runtimeId!==status.runtimeId)throw Error('Native runtime epoch changed during recovery.');
   });
  }catch(error){observations.clear();for(const attempt of attempts)observations.set(attempt.id,{recovery:{state:'unknown',liveness:'unknown',source:'reconciliation',observedAt:stamp(),incomplete:true,detail:detail(error)}});}
  for(const attempt of attempts){const patch=observations.get(attempt.id);if(patch)try{store.updateDispatch(attempt.id,attempt.version,patch,work.version);}catch{/* A newer panel/attempt wins; preserve it untouched. */}}
  return store.dispatchProjection(workId);
 }
 return {
  checkWork:id=>serial(`work:${id}`,()=>checkWork(id)),
  checkOperation:id=>serial(`operation:${id}`,()=>checkOperation(id)),
  async reconcile(){for(const operation of store.listOperations())if(store.isActiveOperation(operation))await this.checkOperation(operation.requestId);for(const work of store.listWorks())await this.checkWork(work.id);},
 };
}
