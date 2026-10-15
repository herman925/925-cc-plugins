import {publicOperation} from './native-launch.mjs';
import {randomUUID,createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const publicWake=row=>{if(!row)return null;const {oldBinding,nativeAction,fingerprint,managerRequest,...value}=row;return {...value,...(managerRequest?{managerRequest:{state:managerRequest.state,reviewer:managerRequest.reviewer}}:{}),oldRequestId:oldBinding.requestId,oldInstanceGeneration:oldBinding.instanceGeneration??1};};
export function wakeStore({db,readPrivate,putPrivate,atomic,readOperation,persistOperation,readWork,persistWork,readCurrentWork,replacementTeam,assertReplacementIdle}){
 function currentPointer(old){
  const pointer=readPrivate(`binding:${old.memberId}`);if(!old.sourceAttemptId)return pointer;
  if(pointer?.requestId!==old.sourceOperationRequestId)return null;
  return {requestId:readPrivate(`dispatch-member:${old.memberId}`)?.id,instanceGeneration:old.instanceGeneration};
 }
 function updateRecipients(old,operation){
  for(const saved of db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%'").all()){
   const work=JSON.parse(saved.json);if(work.teamId!==old.teamId||work.status==='completed')continue;
   const rows=work.currentRecipientBindings??work.recipientBindings??[work.binding],prior=rows.find(r=>r.memberId===old.memberId);
   if(prior&&prior.requestId!==old.requestId&&prior.requestId!==old.sourceOperationRequestId)continue;
   work.currentRecipientBindings=rows.filter(r=>r.memberId!==old.memberId).concat(operation);work.version++;persistWork(work);
  }
 }
 const readWake=id=>readPrivate(`wake:${id}`);
 return {
  readWake,
  listWakes:()=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().map(r=>JSON.parse(r.json)),
  prepareWake(input,operation,proof,nativeAction){return atomic(()=>{
   const prior=readWake(input.requestId),fingerprint=digest(input);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Recovery request conflicts with saved input.');return {row:prior,fresh:false};}
   const current=operation.sourceAttemptId?readPrivate(`dispatch:${operation.sourceAttemptId}`):readOperation(operation.requestId),pointer=currentPointer(operation);
   if(current?.version!==operation.version||pointer?.requestId!==operation.requestId||(pointer.instanceGeneration??1)!==(operation.instanceGeneration??1))throw Error('Member binding changed during recovery.');
   if(readPrivate(`wake-member:${operation.memberId}`))throw Error('This member already has an unresolved recovery. Check its saved result.');
   const row={...input,fingerprint,oldBinding:operation,proof,nativeAction,state:nativeAction?'reserved':'needs_decision',version:1,createdAt:new Date().toISOString()};
   putPrivate(`wake:${input.requestId}`,row);putPrivate(`wake-member:${operation.memberId}`,{requestId:input.requestId});return {row,fresh:true};
  });},
  rebindWake(id,version,workId,instance,run){return atomic(()=>{
   const row=readWake(id),raw=readWork(workId),work=readCurrentWork(workId),binding=row?.newInstance&&readOperation(row.newInstance.requestId);
   if(!row||row.version!==version||!['resumed','replacing'].includes(row.state)||!binding||binding.status!=='created'||work?.supervisorMemberId!==row.memberId||work.binding.requestId!==row.oldBinding.requestId||work.status==='completed'||run.state!=='verified'||(work.run.id&&run.id!==work.run.id))throw Error('Recovery does not match this ongoing supervisor epoch.');
   raw.supervisorHistory??=[];raw.supervisorHistory.push({binding:work.binding,instance:work.instance,run:work.run,recoveryRequestId:id,endedAt:new Date().toISOString()});
   for(const saved of db.prepare("SELECT id,json FROM receipts WHERE id LIKE 'dispatch:%'").all()){
    const attempt=JSON.parse(saved.json);if(attempt.workId!==workId||attempt.supervisorMemberId!==row.memberId||attempt.review)continue;
    attempt.originalSupervisorInstance??=work.instance;attempt.reviewAuthority={recoveryRequestId:id,reviewerMemberId:row.memberId,generation:run.consumerGeneration,reviewToken:randomUUID(),previousGeneration:attempt.generation,handoff:row.handoff??{decision:'native-resume',death:row.proof.death}};attempt.version++;putPrivate(saved.id,attempt);
   }
   raw.currentSupervisor={binding,instance,run,status:'active',input:{state:'not_sent'},processing:{state:'unknown'},nativeSend:undefined,error:undefined,recoveryRequestId:id,epoch:(work.epoch??0)+1};raw.version++;persistWork(raw);
   for(const saved of db.prepare("SELECT id,json FROM receipts WHERE id LIKE 'delivery:%'").all()){const delivery=JSON.parse(saved.json);if(delivery.workId===workId&&delivery.status==='pending'){delivery.status='superseded';delivery.recoveryRequestId=id;putPrivate(saved.id,delivery);}}
   const protocol=readPrivate(`dispatch-protocol:${workId}`);if(protocol){putPrivate(`dispatch-protocol-history:${workId}:${protocol.token}`,protocol);db.prepare('DELETE FROM receipts WHERE id=?').run(`dispatch-protocol:${workId}`);}
   row.state='bound';row.newInstance={...row.newInstance,workId,runId:run.id,consumerGeneration:run.consumerGeneration};row.version++;putPrivate(`wake:${id}`,row);db.prepare('DELETE FROM receipts WHERE id=?').run(`wake-member:${row.memberId}`);return row;
  });},
  finishIdleReplacement(id){return atomic(()=>{
   const row=readWake(id),op=row?.newInstance&&readOperation(row.newInstance.requestId);
   if(row?.mode!=='idle-replacement'||row.state!=='replacing'||op?.status!=='created')return row;
   const pointer=readPrivate(`binding:${row.memberId}`);if(pointer?.requestId!==op.requestId)throw Error('Current replacement binding changed.');
   assertReplacementIdle(row.memberId);row.state='bound';row.version++;putPrivate(`wake:${id}`,row);db.prepare('DELETE FROM receipts WHERE id=?').run(`wake-member:${row.memberId}`);return row;
  });},
  prepareWakeReplacement(id,version,intent){return atomic(()=>{
   const row=readWake(id);if(!row||row.version!==version||row.state!=='approved'||!row.handoff)throw Error('A checked handoff decision is required.');
   const old=row.oldBinding,pointer=currentPointer(old);
   if(pointer?.requestId!==old.requestId||(pointer.instanceGeneration??1)!==(old.instanceGeneration??1))throw Error('Member binding changed before replacement.');
   if(row.mode==='idle-replacement')assertReplacementIdle(old.memberId);
   const team=replacementTeam(old.teamId),member=team?.members.find(m=>m.id===old.memberId);if(!member||intent.configVersion!==team.configVersion||intent.roleVersion!==member.roleVersion)throw Error('Replacement configuration changed; review the saved handoff again.');
   const operation={...intent,requestId:`replace-${id}`,memberId:old.memberId,teamId:old.teamId,configVersion:intent.configVersion,status:'unknown',effectState:'intent',instanceGeneration:(old.instanceGeneration??1)+1,version:1,replaces:old.requestId,wakeRequestId:id,createdAt:new Date().toISOString()};operation.public=publicOperation(operation);
   putPrivate(`binding-generation:${old.memberId}`,{generation:operation.instanceGeneration});putPrivate(`binding:${old.memberId}`,{requestId:operation.requestId,instanceGeneration:operation.instanceGeneration});persistOperation(operation);updateRecipients(old,operation);
   row.state='replacing';row.newInstance={requestId:operation.requestId,instanceGeneration:operation.instanceGeneration};row.version++;putPrivate(`wake:${id}`,row);return {operation,fresh:true};
  });},
  publishWake(id,version,instance){return atomic(()=>{
   const row=readWake(id),old=row?.oldBinding,pointer=old&&currentPointer(old);
   if(!row||row.version!==version||!['accepted','unknown'].includes(row.state)||pointer?.requestId!==old.requestId||(pointer.instanceGeneration??1)!==(old.instanceGeneration??1))throw Error('Recovery member instance changed.');
   const operation={...old,requestId:`wake-${id}`,instanceGeneration:(old.instanceGeneration??1)+1,version:1,runtimeId:row.proof.runtimeId,wakeRequestId:id,resumedFrom:old.requestId,recovery:undefined,observation:{state:'observed',ownerFence:instance.fence,detail:'Native owner acquired a newer execution fence after the exact prior owner stopped.'}};
   if(operation.sourceAttemptId){operation.originAttemptId=operation.sourceAttemptId;delete operation.sourceAttemptId;delete operation.sourceDispatchId;delete operation.sourceWorkId;}
   operation.public=publicOperation(operation);
   putPrivate(`binding-generation:${old.memberId}`,{generation:operation.instanceGeneration});putPrivate(`binding:${old.memberId}`,{requestId:operation.requestId,instanceGeneration:operation.instanceGeneration});persistOperation(operation);updateRecipients(old,operation);
   row.state='resumed';row.newInstance={requestId:operation.requestId,instanceGeneration:operation.instanceGeneration,...instance};row.version++;putPrivate(`wake:${id}`,row);db.prepare('DELETE FROM receipts WHERE id=?').run(`wake-member:${old.memberId}`);return row;
  });},
  claimWake(id){return atomic(()=>{const row=readWake(id);if(row?.state!=='reserved')return false;row.state='submitted';row.version++;putPrivate(`wake:${id}`,row);return true;});},
  updateWake(id,version,patch){return atomic(()=>{const row=readWake(id);if(!row||row.version!==version)throw Error('Recovery changed; reload saved evidence.');if(Object.keys(patch).some(k=>!['state','detail','receipt','newInstance','handoff','decision','nativeAction','notification','managerRequest'].includes(k)))throw Error('Immutable recovery identity cannot change.');Object.assign(row,patch,{version:version+1});putPrivate(`wake:${id}`,row);return row;});}
 };
}
