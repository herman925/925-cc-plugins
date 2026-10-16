import {WORKER_RULES} from '../dispatch.mjs';
import {canonical,nativeMutationFingerprint} from './native-mutation.mjs';
const parse=value=>{try{return JSON.parse(value);}catch{return null;}};
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const fields=['protocol','workId','token','generation','supervisorMemberId','nativeTaskId','taskKey','memberId','replacementNativeTaskId','reason'];
const caller=owner=>owner.kind==='structured'?`orca_session_id:${owner.sessionId}`:owner.handle;

// This discharges only a never-admitted typo. It never supplies an executable intent.
export function readIntentWithdrawals({db,tasks,work,protocol,team,owner,admitted,identity,receipts,verifyIntent,history=[]}) {
 const withdrawn=[],rejected=[];
 if(!history.length&&!tasks.some(task=>parse(task.result)?.protocol==='team-intent-withdrawal/v1'))return {withdrawn,rejected};
 const byId=new Map(tasks.map(task=>[task.id,task]));
 const starts=db.prepare("SELECT state,receipt FROM mutation_receipts WHERE caller_fingerprint=? AND method IN ('orchestration.workerStart','orchestration.dispatch','orchestration.federationAttachStart')").all(identity.caller_fingerprint);
 for(const task of tasks){
  const result=parse(task.result),saved=history.find(row=>row.nativeTaskId===task.id);
  if(result?.protocol!=='team-intent-withdrawal/v1'&&!saved)continue;
  try{
   const original=parse(task.spec);
   if(!result||Object.keys(result).length!==fields.length||fields.some(key=>!Object.hasOwn(result,key))||result.protocol!=='team-intent-withdrawal/v1'||result.reason!=='missing-worker-rules'||result.workId!==work.id||result.token!==protocol.token||result.generation!==protocol.generation||result.supervisorMemberId!==work.supervisorMemberId||result.nativeTaskId!==task.id||result.taskKey!==original?.taskKey||result.memberId!==original?.memberId||typeof result.replacementNativeTaskId!=='string'||result.replacementNativeTaskId.length>120||result.replacementNativeTaskId===task.id||task.status!=='failed'||task.result.length>8000)throw Error('Withdrawal does not match the current supervisor and failed original intent.');
   if(!original||Object.hasOwn(original,'workerRules')||admitted.some(row=>row.nativeTaskId===task.id)||db.prepare('SELECT id FROM dispatch_contexts WHERE task_id=? LIMIT 1').get(task.id))throw Error('Only a missing-rules intent with no admission or past Dispatch can be withdrawn.');
   for(const start of starts){
    const value=parse(start.receipt),taskId=value?.taskId??value?.task?.id;
    // An unattributable start (including a malformed completed receipt) cannot
    // prove this Task effect-free. Do not turn a missing result into no effects.
    if(taskId===task.id||typeof taskId!=='string'||!taskId)throw Error('Native start evidence is present or unresolved; withdrawal is refused.');
   }
   const created=receipts('orchestration.taskCreate',task.id);
   if(created.length!==1)throw Error('Original Task creation proof is missing or ambiguous.');
   verifyIntent(task,{...original,workerRules:WORKER_RULES},work,protocol,team,owner,created[0]);
   const replacement=byId.get(result.replacementNativeTaskId),replacementSpec=parse(replacement?.spec);
   if(!replacement||replacement.run_id!==task.run_id||!same({...original,workerRules:WORKER_RULES},replacementSpec))throw Error('Replacement must preserve the exact business intent and add the approved workerRules.');
   const replacementCreated=receipts('orchestration.taskCreate',replacement.id);
   if(replacementCreated.length!==1)throw Error('Replacement Task creation proof is missing or ambiguous.');
   verifyIntent(replacement,replacementSpec,work,protocol,team,owner,replacementCreated[0]);
   const updates=receipts('orchestration.taskUpdate',task.id),update=updates[0];
   const expected=nativeMutationFingerprint('orchestration.taskUpdate',{id:task.id,status:'failed',result:task.result,run:work.run.id,callerTerminalHandle:caller(owner)},owner);
   if(updates.length!==1||update.payload_hash!==expected||update.value?.task?.id!==task.id||update.value.task.run_id!==work.run.id||update.value.task.status!=='failed'||update.value.task.spec!==task.spec||update.value.task.result!==task.result)throw Error('Withdrawal needs the exact authenticated owning supervisor Task update.');
   const record={workId:work.id,nativeTaskId:task.id,replacementNativeTaskId:replacement.id,taskKey:original.taskKey,memberId:original.memberId,reason:result.reason,generation:protocol.generation,epoch:work.epoch??0,originalSpec:task.spec,replacementSpec:replacement.spec,result:task.result,createProof:{requestId:created[0].request_id,payloadHash:created[0].payload_hash},replacementProof:{requestId:replacementCreated[0].request_id,payloadHash:replacementCreated[0].payload_hash},updateProof:{requestId:update.request_id,payloadHash:update.payload_hash}};
   if(saved&&!same(saved,record))throw Error('Recorded withdrawal evidence changed.');
   withdrawn.push(record);
  }catch(error){rejected.push({nativeTaskId:task.id,detail:error.message});}
 }
 const duplicates=new Set(withdrawn.filter(row=>withdrawn.some(other=>other.nativeTaskId!==row.nativeTaskId&&other.replacementNativeTaskId===row.replacementNativeTaskId)).map(row=>row.nativeTaskId));
 for(const row of history)if(!byId.has(row.nativeTaskId))rejected.push({nativeTaskId:row.nativeTaskId,detail:'Recorded withdrawn Task is missing.'});
 for(const id of duplicates)rejected.push({nativeTaskId:id,detail:'Multiple withdrawn intents cannot share a replacement.'});
 return {withdrawn:withdrawn.filter(row=>!duplicates.has(row.nativeTaskId)),rejected};
}
