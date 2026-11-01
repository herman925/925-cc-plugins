// The shared batch owns acknowledgement. Machine receipts only remember the
// read operation until its returned message has entered a native model turn.
import {randomUUID} from 'node:crypto';
import {openMachineStore} from './machine-store.mjs';
import {controllerId} from './api-domain.mjs';
import {refusal} from './errors.mjs';

export async function createInboxJournal({api,actor,writer,machineConfigRoot}) {
 const info=(await api.execute({operationId:`inbox-caller-${randomUUID()}`,command:{type:'inspectCaller'}})).result;
 if(!info.member||!info.binding)return null;
 const capability=randomUUID(),caller={principalId:controllerId(actor),capability};
 const local=await openMachineStore({projectId:info.projectId,machineId:actor.machineId,machineConfigRoot,writer,create:true,caller,
  authorize:request=>request.caller.capability===capability && ['createMachineStore','machineMutate','readMachine'].includes(request.kind)});
 const identity={memberId:info.member.member_id,sessionId:actor.conversationId,bindingGeneration:info.binding.generation};
 const authority={teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation};
 const mutate=(operationId,mutation)=>local.execute({operationId,caller,mutations:[{...identity,...mutation}]});
 const finish=async(stage,detail)=>{
  if(await local.readReceipt({receiptId:`context-${stage.receipt_id}`,caller}))return;
  await mutate(`context-${stage.receipt_id}-${identity.bindingGeneration}`,{type:'recordLocalReceipt',receiptId:`context-${stage.receipt_id}`,sharedDeliveryId:stage.shared_delivery_id,observationKind:'acknowledged',detail});
 };
 try {
  const old=await local.readMember({memberId:identity.memberId,caller});
  if(!old||old.session_id!==identity.sessionId||old.binding_generation!==identity.bindingGeneration)
   await mutate(`inbox-bind-${identity.memberId}-${identity.bindingGeneration}`,{type:'bindMember',expectedGeneration:old?.generation??0});
 }catch(error){await local.close();throw error;}
 return Object.freeze({
  async poll() {
   let stage=await local.readPendingInbox({...identity,caller});
   if(!stage) {
    const [message]=(await api.execute({operationId:`inbox-peek-${randomUUID()}`,command:{type:'inspectInbox',teamId:authority.teamId,recipientMemberId:identity.memberId}})).result.messages;
    if(!message)return {message:null};
    const id=`inbox-read-${randomUUID()}`;
    const request={operationId:id,command:{...authority,type:'readInbox',deliveryId:message.delivery_id,expectedDeliveryGeneration:message.delivery_generation}};
    await mutate(id,{type:'recordLocalReceipt',receiptId:id,sharedDeliveryId:message.delivery_id,observationKind:'read',detail:{kind:'inbox-staged',request}});
    stage=await local.readPendingInbox({...identity,caller});
   }
   let detail;try{detail=JSON.parse(stage.detail_json);}catch{throw refusal('API_INBOX_JOURNAL_INVALID','Local staged inbox read is malformed; it was preserved.');}
   if(detail?.kind!=='inbox-staged'||detail.request?.operationId!==stage.receipt_id||detail.request.command?.type!=='readInbox'||detail.request.command.deliveryId!==stage.shared_delivery_id||detail.request.command.teamId!==authority.teamId)
    throw refusal('API_INBOX_JOURNAL_INVALID','Local inbox read does not match this member and delivery; it was preserved.');
   // Reconcile first: even if the shared batch was acknowledged before a crash,
   // its exact message remains recoverable by this operation id.
   let receipt=await api.reconcile(detail.request);
   if(receipt.status==='unknown') {
    try{receipt=await api.execute(detail.request);}
    catch(error) {
     if(!['API_INBOX_ORDER','API_STALE_AUTHORITY'].includes(error.code))throw error;
     // An old generation cannot now win its conditional read. Retire this
     // uncommitted stage; a later poll stages current state with a fresh id.
     await finish(stage,{kind:'inbox-obsolete',reason:error.code});
     return {message:null,retry:true};
    }
   }
   const current=(await api.execute({operationId:`inbox-state-${randomUUID()}`,command:{type:'inspectDelivery',teamId:authority.teamId,deliveryId:stage.shared_delivery_id}})).result;
   if(current.delivery.status==='fenced'||current.thread.status!=='open'||current.delivery.consumer_generation!==current.run.consumer_generation) {
    await finish(stage,{kind:'inbox-obsolete',reason:'delivery_settled'});return {message:null,retry:true};
   }
   return {message:receipt.result.message,readReceiptId:stage.receipt_id};
  },
  async attached(readReceiptId) {
   if(typeof readReceiptId!=='string'||!/^inbox-read-[a-f0-9-]{36}$/.test(readReceiptId))throw refusal('API_INPUT_INVALID','Invalid local inbox read id.');
   const stage=await local.readReceipt({receiptId:readReceiptId,caller});
   if(!stage||stage.member_id!==identity.memberId||stage.session_id!==identity.sessionId)throw refusal('API_ASSIGNEE_REQUIRED','This local read belongs to another conversation or member.');
   await finish(stage,{kind:'inbox-context'});return {confirmed:true};
  },
  close:()=>local.close(),
 });
}
