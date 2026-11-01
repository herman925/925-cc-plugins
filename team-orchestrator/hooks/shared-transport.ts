import {sharedCall} from './shared-bridge'
import type {SharedProof} from './shared-bridge'

const operationId=()=>`transport-${Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}`
// One local pump at a time; the shared reservation also serializes other clients.
// Failed/unknown sends remain outstanding and are retried at the team rate.
let pumping=false
export async function pumpSharedDeliveries($:any,proof:SharedProof,options:{node:string;orca:string}) {
 if(!proof.ok||pumping)return
 pumping=true
 try {
  const caller=await sharedCall($,proof,{operationId:operationId(),command:{type:'inspectCaller'}},options)
  const info=caller.ok?caller.result?.result:null
  if(!info?.member||!info?.binding)return
  const authority={teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation}
  const observed=await sharedCall($,proof,{operationId:operationId(),command:{...authority,type:'observePickupDeadlines'}},options)
  if(!observed.ok)return
  const response=await sharedCall($,proof,{operationId:operationId(),command:{...authority,type:'prepareDeliveries'}},options)
  if(!response.ok)return
  for(const target of response.transportTargets??[]) {
   // Only the private bridge's current native verification yields a target.
   if(target.conversationId===proof.sessionId)continue
   const pointer=JSON.stringify({teamId:info.member.team_id,deliveryId:target.deliveryId,messageId:target.messageId,threadId:target.threadId,replay:target.replay})
   await $.session.send({to:{sessionId:target.conversationId},text:`Shared team inbox has pending mail. Use shared_team to inspect your caller and read your inbox; verify an admitted assignment and read its returned role and brief before work. This wake-up is not acknowledgement.\n${pointer}`}).catch(()=>undefined)
  }
 } finally {pumping=false}
}
