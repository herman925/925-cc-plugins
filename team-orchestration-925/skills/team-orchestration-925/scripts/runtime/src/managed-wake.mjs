// Adapter boundary for an ALREADY reviewed and owned managed execution.
// Neither this factory nor the router starts/adopts/resumes a worker. An Orca
// transport must supply an exact-execution, non-follow-up delivery contract;
// bare orchestration.send is deliberately not supplied as a default transport.
import {createOwnedProviderWake} from './owned-provider-wake.mjs';
const same=(a,b)=>JSON.stringify(Object.keys(a).sort().map(k=>[k,a[k]]))===JSON.stringify(Object.keys(b??{}).sort().map(k=>[k,b[k]]));
export function createManagedWakeBackend({id,transport,journalRoot,checkEligible,now}){
 if(!['orca-managed','provider-managed'].includes(id))throw Error('Unknown managed execution backend.');
 if(typeof transport?.inspect!=='function'||typeof transport?.submit!=='function')throw Error('An enrolled owned execution transport is required.');
 const wake=createOwnedProviderWake({transport,journalRoot,checkEligible,...(now?{now}:{})});
 return Object.freeze({id,async availability(delivery,scope){
  try{
   const b=delivery.recipient,expected={projectRoot:scope.projectRoot,machineId:scope.machineId,provider:b.provider,conversationId:b.conversation_id,incarnationId:b.incarnation_id,terminalHandle:b.terminal_handle,contextId:b.context_id};
   const current=await transport.inspect();
   if(!same(expected,current.identity))return {state:'blocked',reason:'managed-execution-identity-changed'};
   if(current.pendingReview)return {state:'blocked',reason:'managed-execution-awaiting-human'};
   if(current.state!=='idle')return {state:'blocked',reason:'managed-execution-not-idle'};
   return {state:'available'};
  }catch{return {state:'unknown',reason:'managed-execution-unverified'};}
 },wake});
}
