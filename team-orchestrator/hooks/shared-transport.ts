import {sharedCall} from './shared-bridge'
import type {SharedProof} from './shared-bridge'

const operationId=()=>`transport-${Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}`
// One local pump at a time; the shared reservation also serializes other clients.
// Failed/unknown sends remain outstanding and are retried at the team rate.
let pumping=false
let queued=false
// A native UI/tool callback has a short host budget. Confirm its durable receipt
// first; transport belongs to a separate host timer, with the periodic pump as
// recovery if a reload cancels this timer. No delivery is acknowledged here.
export function queueSharedDeliveries($:any,proof:SharedProof,options:{node:string;orca:string}) {
 if(!proof.ok||queued)return
 queued=true
 $.clock.after(1,()=>{queued=false;void pumpSharedDeliveries($,proof,options).catch(()=>undefined)})
}
export async function pumpSharedDeliveries($:any,proof:SharedProof,options:{node:string;orca:string}) {
 if(!proof.ok||pumping)return
 pumping=true
 try {
  const caller=await sharedCall($,proof,{operationId:operationId(),command:{type:'inspectCaller'}},options)
  const info=caller.ok?caller.result?.result:null
  if(info?.controllerGeneration)for(const team of info.teams??[]){
   const snapshot=await sharedCall($,proof,{operationId:operationId(),command:{type:'inspectTeam',teamId:team.team_id}},options);
   const data=snapshot.ok?snapshot.result?.result:null;
   for(const launch of data?.launches??[]){
    if(launch.status!=='queued')continue;const member=data.members.find((m:any)=>m.member_id===launch.member_id);if(!member||member.cli==='codex')continue;
    await sharedCall($,proof,{operationId:operationId(),command:{type:'reserveLaunch',teamId:team.team_id,memberId:member.member_id,launchId:launch.launch_id,expectedConfigVersion:data.team.config_version,expectedMemberGeneration:member.generation,expectedControllerGeneration:info.controllerGeneration}},{...options,mode:'launchMember'});
   }
  }
  if(!info?.member||!info?.binding)return
  const authority={teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation}
  const observed=await sharedCall($,proof,{operationId:operationId(),command:{...authority,type:'observeDeadlines'}},options)
  if(!observed.ok)return
  const response=await sharedCall($,proof,{operationId:operationId(),command:{...authority,type:'prepareDeliveries'}},options)
  if(!response.ok)return
  for(const target of response.transportTargets??[]) {
   // Only the private bridge's current native verification yields a target.
   if(target.conversationId===proof.sessionId&&!target.noticeId&&!target.meetingId)continue
   if(target.provider==='codex'){
    const pointer=JSON.stringify({teamId:info.member.team_id,...(target.meetingId?{meetingId:target.meetingId,notificationGeneration:target.notificationGeneration}:target.noticeId?{noticeId:target.noticeId}:{deliveryId:target.deliveryId,messageId:target.messageId,threadId:target.threadId})})
    await $.process.run([options.orca,'orchestration','send','--to',target.terminalHandle,'--from',proof.handle,'--type','status','--subject','Shared team update','--body',`A shared-team record is waiting. Use shared_inbox_read, or inspectMeeting for a meeting. Finish your current step before joining and respond only for yourself. This is a pointer, not permission or acknowledgement. ${pointer}`,'--json'],{timeoutMs:15000}).catch(()=>undefined)
    continue
   }
   if(target.meetingId){await $.session.send({to:{sessionId:target.conversationId},text:`A meeting record is waiting. Use shared_team inspectMeeting; finish your current step before respondMeeting. Join and contribute only for yourself. Reading this pointer is not joining or acknowledgement. ${JSON.stringify({teamId:info.member.team_id,meetingId:target.meetingId,notificationGeneration:target.notificationGeneration})}`}).catch(()=>undefined);continue}
   if(target.noticeId){await $.session.send({to:{sessionId:target.conversationId},text:`Shared-team deadline notice is waiting. Inspect your team with shared_team inspectTeam; read its notices, then acknowledgeNotice with the exact noticeId and your current member/config/binding versions. A notice grants no permission. ${JSON.stringify({teamId:info.member.team_id,noticeId:target.noticeId})}`}).catch(()=>undefined);continue}
   const pointer=JSON.stringify({teamId:info.member.team_id,deliveryId:target.deliveryId,messageId:target.messageId,threadId:target.threadId,replay:target.replay})
   await $.session.send({to:{sessionId:target.conversationId},text:`Shared team inbox has pending mail. Use shared_inbox_read to recover your next message, then confirm its readReceiptId with shared_inbox_seen. For a dispatch, inspect your caller with shared_team, verify the admitted assignment and read its returned role and brief before work. This wake-up is not acknowledgement.\n${pointer}`}).catch(()=>undefined)
  }
 } finally {pumping=false}
}
