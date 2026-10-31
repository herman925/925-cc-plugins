import { atom, read, update } from 'claude-code'
import { notReadOnly } from './guard'

// This extends the Mod's existing best-effort literal path/shell checks. It is
// not an OS sandbox against arbitrary code running as the same account.
export function sharedStoreProtection(tool:string,path:string,command:string):string|undefined {
 const p=path.replace(/\\/g,'/').toLowerCase()
 const c=command.replace(/\\/g,'/').toLowerCase()
 const privateData=/(?:^|\/)team-orchestrator\/controller-actions(?:\/|$)/.test(p)
 if(privateData || /team-orchestrator\/controller-actions/.test(c))return 'Controller approval tickets are private to the panel; model tools cannot read or write them.'
 if(['Write','Edit','NotebookEdit'].includes(tool) && /(?:^|\/)\.team-orchestrator(?:\/|$)/.test(p))return 'Shared team state is changed only through the typed shared_team API.'
 if(['Bash','PowerShell'].includes(tool)){
  if(/mod-bridge\.[cm]?js|createTeamApi|controller-actions/i.test(command))return 'The shared-store bridge is private to the Mod; use the typed shared_team tool.'
  if(/\.team-orchestrator(?:[\/\s'";]|$)/.test(c) && notReadOnly(command)!=='')return 'Shared team state is changed only through the typed shared_team API.'
 }
 return undefined
}

export type SharedProof = { ok: true; root: string; sessionId: string; handle: string; contextId: string } | { ok: false; reason: string }
const status = atom({plugin:'team-orchestrator',key:'sharedStoreStatus'} as const,'')
const displayedProof = atom({plugin:'team-orchestrator',key:'sharedStoreProof'} as const,{ok:false,reason:'Open Shared store to verify this conversation.'} as SharedProof)
export async function setSharedStoreProof($:any,proof:SharedProof) { await update($,displayedProof,()=>proof) }
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
const proofOf = (proof: Extract<SharedProof,{ok:true}>) => ({projectRoot:proof.root,conversationId:proof.sessionId,terminalHandle:proof.handle,contextId:proof.contextId})
const stringField={type:'string'}
const versionField={type:'integer',minimum:1}
const commandSchema={type:'object',additionalProperties:false,properties:{
 type:{type:'string',enum:['createFreshTeam','bindMember','inspectTeam','inspectCaller','inspectAssignment','admitAssignment','verifyAssignment','reportOutcome','acceptTask','revokeController']},
 ...Object.fromEntries(['teamId','name','functionText','memberId','runId','taskId','assignmentId','instructions','expectedResult','summary','evidence','reason','controllerId'].map(k=>[k,stringField])),
 ...Object.fromEntries(['expectedConfigVersion','expectedMemberGeneration','expectedControllerGeneration','expectedTargetGeneration','expectedTargetBindingGeneration','expectedAttemptGeneration'].map(k=>[k,versionField])),
 expectedBindingGeneration:{type:'integer',minimum:0},outcome:{type:'string',enum:['succeeded','failed']},decision:{type:'string',enum:['accepted','rejected']},
 members:{type:'array',items:{type:'object',additionalProperties:false,properties:{memberId:stringField,name:stringField,bossMemberId:{type:['string','null']},role:stringField,officialText:stringField},required:['memberId','name','bossMemberId','role','officialText']}},
 settings:{type:'object',additionalProperties:false,properties:{autoClose:{type:'boolean'},idleMinutes:{type:'integer',minimum:0},reopen:{type:'string',enum:['resume','fresh']},maxOpen:{type:'integer',minimum:0},launch:{type:'string',enum:['demand','all']},batch:versionField,autoScratch:{type:'boolean'},assumptions:{type:'boolean'},scratchDir:stringField,pickupWindowMinutes:versionField,answerWindowMinutes:versionField,taskWindowMinutes:{type:['integer','null'],minimum:1},replayIntervalMs:versionField,exemptMemberIds:{type:'array',items:stringField}},required:['autoClose','idleMinutes','reopen','maxOpen','launch','batch','autoScratch','assumptions','scratchDir','pickupWindowMinutes','answerWindowMinutes','taskWindowMinutes','replayIntervalMs','exemptMemberIds']}
},required:['type']}

export async function sharedCall($:any, proof:SharedProof, request:any, options:{node:string;orca:string;mode?:string;uiApprovalId?:string}) {
 if(!proof.ok)return {ok:false,error:{code:'API_NATIVE_UNVERIFIED',message:proof.reason}}
 const envelope={mode:options.mode??'execute',proof:proofOf(proof),request,orcaCommand:options.orca,...(options.uiApprovalId?{uiApprovalId:options.uiApprovalId}:{})}
 const result=await $.process.run([options.node,`${$.plugin.root}/store/mod-bridge.mjs`],{stdin:JSON.stringify(envelope),timeoutMs:30000}).catch(()=>undefined)
 if(!result)return {ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'The shared store adapter did not answer. Preserve the operation id and reconcile; do not repeat external effects.'}}
 try{
  const value=JSON.parse(String(result.stdout).trim())
  if(typeof value.ok!=='boolean' || (value.ok && result.exitCode!==0))throw Error()
  return value
 }catch{return {ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'The shared store adapter returned no confirmed receipt. Reconcile the same operation id.'}}}
}

export async function startSharedStore($:any,enabled:boolean) {
  if(enabled)await $.tool.register({name:'shared_team',description:'Opt-in fresh-team shared-store preview. Typed operations only. An outside-roster controller must first be approved using /team → Shared store. Create a fresh team, bind verified local Claude sessions, inspectTeam/inspectCaller, admitAssignment to a direct report, verifyAssignment (read its returned role and brief before work), reportOutcome, inspectAssignment, then acceptTask as the head. Outcome does not accept a task. Preserve operationId on retries; reconcile:true only inspects its receipt. No raw SQL, caller identity or approval flags. Only bindMember accepts target: a native session reference to verify, never caller proof.',inputSchema:{type:'object',additionalProperties:false,properties:{operationId:{type:'string'},command:commandSchema,target:{type:'object',additionalProperties:false,properties:{projectRoot:{type:'string'},conversationId:{type:'string'},terminalHandle:{type:'string'},contextId:{type:'string'}},required:['projectRoot','conversationId','terminalHandle','contextId']},reconcile:{type:'boolean'}},required:['operationId','command']}})
}
export async function callSharedStore($:any,e:any,enabled:boolean,dependencies:{proof:SharedProof;node:string;orca:string}) {
  if(!enabled)return {deny:'The shared-store preview is disabled.'}
  // These are the only fields crossing the model boundary. Actor facts are
  // freshly derived below and never read from model tool arguments.
  const request={operationId:e.operationId,command:e.command,...(e.target!==undefined?{target:e.target}:{})}
  const value=await sharedCall($,dependencies.proof,request,{node:dependencies.node,orca:dependencies.orca,mode:e.reconcile===true?'reconcile':'execute'})
  return {result:JSON.stringify(value),...(!value.ok?{isError:true}:{})}
}

export async function sharedStoreView($:any,ui:any,dependencies:{enabled:boolean;revalidate:()=>Promise<SharedProof>;node:string;orca:string}) {
 const {Box,Text,Button}=ui
 // Rendering reads display state only. Native subprocess/registry verification
 // belongs to the explicit tab/approval actions, not every animation frame.
 const proof=await read($,displayedProof)
 const message=await read($,status)
 const approve=async()=>{
  if(!dependencies.enabled||!proof.ok)return
  // A concrete panel click mints a short-lived machine-local approval ticket.
  // A model-supplied `approve:true` or unrelated AskUserQuestion cannot mint it.
  const current=await dependencies.revalidate()
  if(!current.ok || JSON.stringify(proofOf(current))!==JSON.stringify(proofOf(proof)))return update($,status,()=> 'The displayed caller changed. Reopen the panel before approving.')
  const token=id(),config=String((await $.env.get('CLAUDE_CONFIG_DIR').catch(()=>''))??'') || `${String((await $.env.get('USERPROFILE').catch(()=>''))??'') || String((await $.env.get('HOME').catch(()=>''))??'')}/.claude`
  if(!config || config==='/.claude')return update($,status,()=> 'Local configuration directory is unverified.')
  const ticket=`${config}/team-orchestrator/controller-actions/${token}.json`
  await $.fs.write(ticket,JSON.stringify({action:'approveController',id:token,createdAt:Date.now(),...proofOf(current)}))
  const result=await sharedCall($,current,{operationId:`controller-${token}`},{node:dependencies.node,orca:dependencies.orca,mode:'approveController',uiApprovalId:token})
  // Expiration and exact scope are checked by the bridge. Keep unknown receipts
  // for diagnosis; never claim a failed transport means no approval was written.
  await update($,status,()=>JSON.stringify(result))
 }
 return <Box flexDirection="column" paddingX={1}>
  <Text weight="bold">Shared store preview — fresh teams</Text>
  <Text>{proof.ok?`Project: ${proof.root}\nConversation: ${proof.sessionId}\nTerminal: ${proof.handle}`:proof.reason}</Text>
  <Text>Approving this conversation permits project team management. Other approved controllers keep their approval. Approval survives resuming this same verified conversation on this machine. Member tool grants remain separate.</Text>
  {dependencies.enabled&&proof.ok?<Button key="shared-approve-controller" label="Approve this conversation as project controller" onPress={approve}/>:<Text>{dependencies.enabled?'Controller approval is unavailable until native verification succeeds.':'Enable Shared store preview in /config to try a fresh scratch team.'}</Text>}
  <Text>{String(message)}</Text>
 </Box>
}
