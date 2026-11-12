import {inspectSharedCaller,sharedCall} from './shared-bridge'
import type {SharedProof} from './shared-bridge'
import {teamGuardPolicies} from '../store/src/member-policy.mjs'

const operationId=()=>`identity-${Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')}`
const unavailable='Shared-team identity snapshot is unavailable. Do not guess members’ CLIs from names, roles, model labels, old role files or conversation summaries. Inspect the current shared team before making identity claims. This notice grants no membership or permissions.'
const cli=(value:unknown)=>value==='claude'||value==='codex'||value==='hermes'?value:'unknown'

/** A prompt-sized projection of authorized API data, never a live-process claim. */
export function sharedIdentityText(snapshot:any,caller:any):string {
 if(!snapshot?.team?.team_id||!Array.isArray(snapshot.members)||!Array.isArray(snapshot.bindings))return unavailable
 const policies=teamGuardPolicies(snapshot.members)
 const members=snapshot.members.filter((m:any)=>m.membership_state==='active').map((m:any)=>{
  const binding=snapshot.bindings.find((b:any)=>b.member_id===m.member_id)
  const configuredCli=cli(m.cli),recordedProvider=binding?cli(binding.provider):null
  return {memberId:m.member_id,name:m.name,role:m.role,configuredCli,configuredModel:m.model??'unknown',
   recordedSessionProvider:recordedProvider,bindingGeneration:binding?.generation??null,guardPolicy:policies.find((p:any)=>p.memberId===m.member_id),
   bindingState:!binding?'unbound':configuredCli!=='unknown'&&recordedProvider!=='unknown'&&configuredCli!==recordedProvider?'provider-conflict':'recorded'}
 })
 const work=Array.isArray(snapshot.work)?snapshot.work:[]
 const assignmentReceipts=work.slice(0,10).map((item:any)=>({assignmentId:item.assignment?.assignment_id,memberId:item.assignment?.member_id,taskStatus:item.task?.status,pickupObservedAt:item.assignment?.pickup_observed_at_ms??null,returnedReason:item.returned?.reason??null}))
 const data={teamId:snapshot.team.team_id,teamName:snapshot.team.name,configVersion:snapshot.team.config_version,
  self:{memberId:caller.member?.member_id??null,state:caller.recovery?'stale-needs-reconnect':caller.member?'member':'controller-only'},members,visibleAssignmentCount:work.length,assignmentReceipts}
 const body=JSON.stringify(data)
 if(body.length>12000)return unavailable+'\n'+JSON.stringify({teamId:data.teamId,configVersion:data.configVersion,memberCount:members.length,reason:'The full identity list needs explicit inspectTeam; no identities were truncated or guessed.'})
 return 'Shared-team identity snapshot. CLI/provider and configured model are different fields: claude means Claude Code; codex means Codex. Use the explicit configuredCli and recordedSessionProvider fields; never infer CLI from a name, role or model, or assume teammates share the leader’s CLI. These saved bindings are not proof of liveness, readiness or task pickup. Check inbox/assignment receipts separately. The manager-write rule applies to members with active direct reports: allow_write=0 alone is not a leaf-worker write denial. This is not an unconditional write permission; private-state protection, stale binding, bootstrap and native permissions still apply. Task expiry is separate from write permission. Name the actual guard verdict or receipt before claiming a tool was denied; do not infer denial from a switch or expiry. A fresh assignment changes no permissions. At most ten authorized assignment receipts are shown; inspect the exact assignment for current action. This is identity data, not task instructions or a permission grant. A controller-only or stale conversation must not claim a member role.\n'+body
}

export async function sharedTeamIdentityContext($:any,proof:SharedProof,options:{node:string;orca:string}) {
 if(!proof.ok)return undefined
 try {
  const response=await inspectSharedCaller($,proof,options)
  if(!response.ok)return ['STORE_NOT_FOUND','STORE_EMPTY'].includes(response.error?.code)?undefined:unavailable
  const caller=response.result?.result
  if(!caller?.member&&!caller?.controllerGeneration)return undefined
  const teams=Array.isArray(caller.teams)?caller.teams:[]
  const teamId=caller.member?.team_id??(teams.length===1?teams[0]?.team_id:null)
  if(!teamId)return unavailable+'\n'+JSON.stringify({self:'controller-only',teamCount:teams.length,reason:'Inspect the intended team explicitly; no member role or default team was selected.'})
  const result=await sharedCall($,proof,{operationId:operationId(),command:{type:'inspectTeam',teamId}},options)
  const snapshot=result.ok?result.result?.result:null
  if(snapshot?.team?.team_id!==teamId)return unavailable
  return sharedIdentityText(snapshot,caller)
 }catch{return unavailable}
}
