import {homedir} from 'node:os';
import {join} from 'node:path';
import {createOwnedProviderWake} from './owned-provider-wake.mjs';
import {createWakeRouter} from './wake-routing.mjs';
import {currentWakeEligibility} from './wake-eligibility.mjs';
import {wakePointer,wakePrompt} from './orca-wake.mjs';
export async function wakeOwnedRecipients(deliveries,{actor,request,api,teamId,journalRoot=join(homedir(),'.team-orchestrator','wake-receipts')}){
 if(!api||!teamId)return deliveries.map(()=>({state:'needs-reconciliation',reason:'eligibility-context-unavailable',observedAt:Date.now()}));
 const receipts=[];
 for(const delivery of deliveries){
  let sessions;try{sessions=await request('list',{},false);}catch{receipts.push({state:'needs-reconciliation',reason:'owned-inventory-unverified',observedAt:Date.now()});continue;}
  const pointer=wakePointer(delivery),binding=delivery.recipient,session=sessions.find(row=>row.identity?.provider===binding.provider&&row.identity?.conversationId===binding.conversation_id),checkEligible=()=>currentWakeEligibility(api,teamId,delivery);
  const transport={inspect:async()=>{if(!session)throw Error('Owned target unavailable.');const row=await request('inspect',{launchId:session.launchId},false);return {identity:Object.fromEntries(['projectRoot','machineId','provider','conversationId','incarnationId','terminalHandle','contextId'].map(key=>[key,row.identity[key]])),state:row.nativeState,pendingReview:row.pendingReview};},submit:async({identity,requestId,text})=>{if(text!==wakePrompt(pointer))throw Error('Only the canonical inbox-check pointer can be submitted.');return request('sendWake',{launchId:session.launchId,identity,requestId,pointer},false);}};
  const primary={id:'provider-direct',availability:async()=>session?{state:'available'}:{state:'unavailable',reason:'owned-input-unavailable'},wake:createOwnedProviderWake({transport,journalRoot,checkEligible})};
  receipts.push(await createWakeRouter({primary,journalRoot,checkEligible})(delivery,{projectRoot:actor.projectRoot,machineId:actor.machineId}));
 }
 return receipts;
}
