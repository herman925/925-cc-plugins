import {sharedCall} from './shared-bridge'
import type {SharedProof} from './shared-bridge'

const operationId=()=>`transport-${Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}`
// One local pump at a time; the shared reservation also serializes other clients.
// Failed/unknown sends remain outstanding and are retried at the team rate.
let pumping=false
let queued=false
let wakeObservation:{scope:string;checkedAt:number;results:any[]}|undefined
let pendingWake:{scope:string;ownerMemberId:string;request:any}|undefined
const scopeKey=(proof:SharedProof)=>proof.ok?JSON.stringify([proof.root,proof.sessionId,proof.handle,proof.contextId]):''
export function sharedWakeObservation(proof:SharedProof){
 if(!proof.ok||wakeObservation?.scope!==scopeKey(proof))return undefined
 return {checkedAt:wakeObservation.checkedAt,stale:Date.now()-wakeObservation.checkedAt>90000,results:wakeObservation.results}
}
export function sharedWakeContext(proof:SharedProof){
 const observed=sharedWakeObservation(proof)
 return observed?'Machine-local automatic inbox wake-up observations. Check timestamps and stale before reporting current delivery. host-update-required sends no input; needs-reconciliation preserves the original request. A recorded turn start is not inbox progress or task pickup. Inspect actual inbox/assignment receipts; never repair this by inventing assignments, changing permissions or answering another session’s approval.\n'+JSON.stringify(observed):undefined
}
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
  if(!info?.member||!info?.binding){if(wakeObservation?.scope===scopeKey(proof))wakeObservation=undefined;if(pendingWake?.scope===scopeKey(proof))pendingWake=undefined;return}
  if(pendingWake&&(pendingWake.scope!==scopeKey(proof)||pendingWake.ownerMemberId!==info.member.member_id||pendingWake.request.command.teamId!==info.member.team_id)){pendingWake=undefined;wakeObservation=undefined}
  const authority={teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation}
  const observed=await sharedCall($,proof,{operationId:operationId(),command:{...authority,type:'observeDeadlines'}},options)
  if(!observed.ok)return
  const reservation={operationId:operationId(),command:{...authority,type:'prepareDeliveries'}}
  const response=await sharedCall($,proof,reservation,options)
  if(!response.ok)return
  // The private child re-verifies this native parent, reconciles the committed
  // reservation and checks current membership/binding before an idle wake.
  // Model tool arguments never become prompt targets or prompt text.
  if((response.result?.result?.deliveries??[]).some((d:any)=>['claude','codex'].includes(d.recipient?.provider)))pendingWake={scope:scopeKey(proof),ownerMemberId:info.member.member_id,request:reservation}
  if(pendingWake?.scope===scopeKey(proof)){
   const result=await $.process.run([options.node,`${$.plugin.root}/store/mod-wake.mjs`],{stdin:JSON.stringify({proof:{projectRoot:proof.root,conversationId:proof.sessionId,terminalHandle:proof.handle,contextId:proof.contextId},request:pendingWake.request,orcaCommand:options.orca}),timeoutMs:30000}).catch(()=>undefined)
   let results:any[]=[{state:'needs-reconciliation',reason:'native-helper-outcome-unverified',observedAt:Date.now()}]
   try{const value=JSON.parse(String(result?.stdout));if(result?.exitCode===0&&value.ok===true&&Array.isArray(value.result?.results))results=value.result.results.slice(0,20)}catch{}
   const previous=wakeObservation
   wakeObservation={scope:scopeKey(proof),checkedAt:Date.now(),results}
   const blocked=results.find(r=>['host-update-required','needs-reconciliation','needs-attention'].includes(r.state))
   if(blocked&&(previous?.scope!==scopeKey(proof)||JSON.stringify(previous?.results.map(r=>r.state))!==JSON.stringify(results.map(r=>r.state))))try{await $.ui.toast(`Inbox wake-up: ${blocked.state}. Inspect Team workspace; no permission or assignment was changed.`)}catch{}
   if(results.every(r=>r.state==='settled-or-ineligible'))pendingWake=undefined
  }
 } finally {pumping=false}
}
