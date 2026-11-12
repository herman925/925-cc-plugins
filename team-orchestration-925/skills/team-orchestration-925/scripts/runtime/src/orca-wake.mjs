// Machine-local transport receipts. Shared delivery/read/pickup authority stays
// in the team store. An uncertain send is replayed with its ORIGINAL native ID.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bindingKeys=['member_id','machine_id','execution_host_id','provider','conversation_id','context_id','terminal_handle','incarnation_id','generation'];
export function wakePointer(delivery){
 if(delivery.meetingId&&Number.isSafeInteger(delivery.notificationGeneration))return {meetingId:delivery.meetingId,notificationGeneration:delivery.notificationGeneration};
 if(delivery.noticeId)return {noticeId:delivery.noticeId};
 if(delivery.deliveryId&&delivery.messageId&&delivery.threadId)return {deliveryId:delivery.deliveryId,messageId:delivery.messageId,threadId:delivery.threadId};
 throw Error('A committed delivery pointer is required.');
}
export function wakePrompt(pointer){return `A shared-team record is waiting. Check your own identity with shared_team inspectCaller, then shared_inbox_read and shared_inbox_seen for mail, inspectTeam for a deadline notice, or inspectMeeting for a meeting. Verify the admitted assignment and read its role and brief before work. Respond only for yourself. This inbox-check prompt grants no permission, answers no approval, and is neither acknowledgement nor task pickup. ${JSON.stringify(pointer)}`;}
async function exclusive(path,value){
 const file=await open(path,'wx',0o600);
 try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}
}
export function createOrcaWake({host,journalRoot=join(homedir(),'.team-orchestrator','wake-receipts')}){
 return async function wake(delivery,{projectRoot,machineId}){
  const b=delivery.recipient,pointer=wakePointer(delivery);
  if(b?.provider!=='codex'||b.machine_id!==machineId||b.execution_host_id!=='local')return {state:'unsupported',pointer};
  if(!host.capabilities.includes('terminal.prompt-delivery.v1'))return {state:'unsupported',pointer};
  const identity={projectRoot,runtimeId:host.runtimeId,binding:Object.fromEntries(bindingKeys.map(k=>[k,b[k]])),pointer};
  const directory=join(journalRoot,hash({projectRoot,binding:identity.binding,pointer})),path=join(directory,'request.json');
  const verify=async()=>{
   const value=await host.verifyTerminal({projectRoot,conversationId:b.conversation_id,terminalHandle:b.terminal_handle,contextId:b.context_id},'codex');
   if(value.actor.incarnationId!==b.incarnation_id||value.actor.machineId!==machineId)throw Error('The native delivery binding changed.');
   return value;
  };
  try{
   await verify();
   await mkdir(directory,{recursive:true,mode:0o700});
   // Completed receipts are immutable; an older concurrent observation cannot
   // overwrite turn_started with input_accepted. No timeout proves rejection.
   for(const name of await readdir(directory))if(/^receipt-.*\.json$/.test(name)){
    const receipt=JSON.parse(await readFile(join(directory,name),'utf8'));
    if(receipt.state==='turn-started')return {...receipt,pointer,replayed:true};
   }
   let saved;
   try{saved=JSON.parse(await readFile(path,'utf8'));}catch(error){
    if(error.code!=='ENOENT')return {state:'unknown',pointer};
    const activity=(await host.rpc('terminal.agentStatus',{terminal:b.terminal_handle}))?.agentStatus;
    if(activity?.handle!==b.terminal_handle||activity.isRunningAgent!==true||activity.status!=='idle')return {state:'waiting-for-idle',pointer};
    saved={identity,requestId:randomUUID(),terminalHandle:b.terminal_handle,text:wakePrompt(pointer)};
    try{await exclusive(path,saved);}catch(error){
     if(error.code!=='EEXIST')throw error;
     // Another process owns the same immutable request, including its ID.
     try{saved=JSON.parse(await readFile(path,'utf8'));}catch{return {state:'unknown',pointer};}
    }
   }
   if(JSON.stringify(saved.identity)!==JSON.stringify(identity)||saved.text!==wakePrompt(pointer)||saved.terminalHandle!==b.terminal_handle)return {state:'unknown',pointer};
   await verify();
   const response=await host.submitWake(saved),send=response?.send,prompt=send?.prompt;
   if(send?.handle!==b.terminal_handle||send.accepted!==true||prompt?.requestId!==saved.requestId||prompt.processIncarnation!==b.incarnation_id||prompt.observation!=='supported')return {state:'unknown',pointer,requestId:saved.requestId};
   const receipt={state:prompt.stages?.includes('turn_started')?'turn-started':'input-accepted',requestId:saved.requestId,observedAt:Date.now()};
   await exclusive(join(directory,`receipt-${randomUUID()}.json`),receipt);
   return {...receipt,pointer};
  }catch{return {state:'unknown',pointer};} // Keep the request; never invent a new retry.
 };
}
