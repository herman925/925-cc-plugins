import { atom, read, update } from 'claude-code'
import { notReadOnly } from './guard'
import {sharedCall} from './shared-bridge'
import type {SharedProof} from './shared-bridge'
import {pumpSharedDeliveries} from './shared-transport'
import {sharedWorkspaceView,refreshSharedWorkspace,readSharedWorkspace} from './shared-workspace'
export {sharedCall} from './shared-bridge'
export type {SharedProof} from './shared-bridge'

// This extends the Mod's existing best-effort literal path/shell checks. It is
// not an OS sandbox against arbitrary code running as the same account.
export function sharedStoreProtection(tool:string,path:string,command:string):string|undefined {
 const p=path.replace(/\\/g,'/').toLowerCase()
 const c=command.replace(/\\/g,'/').toLowerCase()
 const privateData=/(?:^|\/)team-orchestrator\/controller-actions(?:\/|$)/.test(p)
 if(privateData || /team-orchestrator\/controller-actions/.test(c))return 'Controller approval tickets are private to the panel; model tools cannot read or write them.'
 if(/(?:^|\/)team-orchestrator\/[^/]+\/machine\.sqlite(?:-wal|-shm|-journal)?(?:$|[\s'";])/.test(p)||/team-orchestrator\/[^/]+\/machine\.sqlite/.test(c))return 'Machine observations and inbox recovery receipts are private to the adapter; use shared_team.'
 if(['Write','Edit','NotebookEdit'].includes(tool) && /(?:^|\/)\.team-orchestrator(?:\/|$)/.test(p))return 'Shared team state is changed only through the typed shared_team API.'
 if(['Bash','PowerShell'].includes(tool)){
  if(/mod-bridge\.[cm]?js|createTeamApi|controller-actions/i.test(command))return 'The shared-store bridge is private to the Mod; use the typed shared_team tool.'
  if(/\.team-orchestrator(?:[\/\s'";]|$)/.test(c) && notReadOnly(command)!=='')return 'Shared team state is changed only through the typed shared_team API.'
 }
 return undefined
}

const status = atom({plugin:'team-orchestrator',key:'sharedStoreStatus'} as const,'')
const displayedProof = atom({plugin:'team-orchestrator',key:'sharedStoreProof'} as const,{ok:false,reason:'Open Team workspace to verify this conversation.'} as SharedProof)
type SharedUi = {busy:string;notice:string;tone:string;details:boolean;connection:boolean;access:boolean;nodeDraft:string|null;orcaDraft:string|null;checked:boolean;approved:number|null;member:boolean}
const uiState = atom({plugin:'team-orchestrator',key:'sharedStoreUi'} as const,{busy:'',notice:'',tone:'gray',details:false,connection:false,access:false,nodeDraft:null,orcaDraft:null,checked:false,approved:null,member:false} as SharedUi)
export type SharedControls = {enabled:boolean;preferenceError?:string;node:string;orca:string;setEnabled:(enabled:boolean)=>Promise<void>;rememberProject?:()=>Promise<void>;setNode:(value:string)=>Promise<void>;setOrca:(value:string)=>Promise<void>}
export type SharedAccess = {enabled:boolean;node:string;orca:string;revalidate:()=>Promise<SharedProof>}
export async function setSharedStoreProof($:any,proof:SharedProof) { await update($,displayedProof,()=>proof) }
async function beginSharedAction($:any,action:string) {
 let acquired=false
 await update($,uiState,old=>{if(old.busy)return old;acquired=true;return {...old,busy:action,notice:''}})
 return acquired
}
async function sharedFeedback($:any,notice:string,tone='gray') { await update($,uiState,old=>({...old,notice,tone})) }
const id = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
const proofOf = (proof: Extract<SharedProof,{ok:true}>) => ({projectRoot:proof.root,conversationId:proof.sessionId,terminalHandle:proof.handle,contextId:proof.contextId})
const stringField={type:'string'}
const versionField={type:'integer',minimum:1}
const commandSchema={type:'object',additionalProperties:false,properties:{
 type:{type:'string',enum:['createFreshTeam','bindMember','inspectTeam','inspectCaller','inspectAssignment','inspectInbox','inspectDelivery','readInbox','admitAssignment','retryAssignment','verifyAssignment','reportOutcome','acceptTask','revokeController']},
 ...Object.fromEntries(['teamId','name','functionText','memberId','runId','taskId','assignmentId','newAssignmentId','deliveryId','recipientMemberId','instructions','expectedResult','summary','evidence','reason','controllerId'].map(k=>[k,stringField])),
 ...Object.fromEntries(['expectedConfigVersion','expectedMemberGeneration','expectedControllerGeneration','expectedTargetGeneration','expectedTargetBindingGeneration','expectedAttemptGeneration','expectedDeliveryGeneration'].map(k=>[k,versionField])),
 expectedBindingGeneration:{type:'integer',minimum:0},outcome:{type:'string',enum:['succeeded','failed']},decision:{type:'string',enum:['accepted','rejected']},
 members:{type:'array',items:{type:'object',additionalProperties:false,properties:{memberId:stringField,name:stringField,bossMemberId:{type:['string','null']},role:stringField,officialText:stringField},required:['memberId','name','bossMemberId','role','officialText']}},
 settings:{type:'object',additionalProperties:false,properties:{autoClose:{type:'boolean'},idleMinutes:{type:'integer',minimum:0},reopen:{type:'string',enum:['resume','fresh']},maxOpen:{type:'integer',minimum:0},launch:{type:'string',enum:['demand','all']},batch:versionField,autoScratch:{type:'boolean'},assumptions:{type:'boolean'},scratchDir:stringField,pickupWindowMinutes:versionField,answerWindowMinutes:versionField,taskWindowMinutes:{type:['integer','null'],minimum:1},replayIntervalMs:versionField,exemptMemberIds:{type:'array',items:stringField}},required:['autoClose','idleMinutes','reopen','maxOpen','launch','batch','autoScratch','assumptions','scratchDir','pickupWindowMinutes','answerWindowMinutes','taskWindowMinutes','replayIntervalMs','exemptMemberIds']}
},required:['type']}


export async function startSharedStore($:any,_enabled:boolean) {
  // Register the catalogue at startup, when the host supports registration.
  // The live option gates every call, so switching On never needs a reload.
  await $.tool.register({name:'shared_team',description:'Shared-team API. Create team configures this project and requests management permission. inspectCaller discovers your verified member, binding and config versions. inspectInbox(teamId,recipientMemberId) previews the oldest pending delivery. readInbox(teamId,deliveryId,expectedDeliveryGeneration plus your member/config/binding versions) reads and acknowledges ONLY your own oldest delivery. Preserve its operationId: after an unknown/lost reply reconcile:true recovers the exact message; do not use a new id or assume it was unread. A wake-up is only a pointer, never acknowledgement or a new assignment. For dispatch, verifyAssignment and read its returned role/brief before work; reportOutcome with evidence; the head alone acceptTask. Admission/outcome queue durable mail. No raw SQL, caller proof or approval flags. Only bindMember accepts target, a native session reference to verify.',inputSchema:{type:'object',additionalProperties:false,properties:{operationId:{type:'string'},command:commandSchema,target:{type:'object',additionalProperties:false,properties:{projectRoot:{type:'string'},conversationId:{type:'string'},terminalHandle:{type:'string'},contextId:{type:'string'}},required:['projectRoot','conversationId','terminalHandle','contextId']},reconcile:{type:'boolean'}},required:['operationId','command']}})
  await $.tool.register({name:'shared_inbox_seen',description:'Confirm you read automatically attached shared-team inbox context. Use its exact readReceiptId. This clears only your machine recovery receipt; it grants no permission and accepts no task. If context is replayed, confirm the same id again.',inputSchema:{type:'object',additionalProperties:false,properties:{readReceiptId:{type:'string'}},required:['readReceiptId']}})
  await $.tool.register({name:'shared_inbox_read',description:'Read your next shared-team message, recovering the same message after an interrupted delivery. After reading it, confirm readReceiptId with shared_inbox_seen. For dispatch, verifyAssignment and read its official role and brief before task work; worker_done requires the admitting head to review and accept separately. An empty message means no mail; retry:true means poll again. No task or permission is created by reading.',inputSchema:{type:'object',additionalProperties:false,properties:{}}})
}
export async function callSharedStore($:any,e:any,enabled:boolean,dependencies:{proof:SharedProof;node:string;orca:string}) {
  if(!enabled)return {deny:'Shared workspace is disabled for this project. Open Create team to configure it.'}
  // These are the only fields crossing the model boundary. Actor facts are
  // freshly derived below and never read from model tool arguments.
  const request={operationId:e.operationId,command:e.command,...(e.target!==undefined?{target:e.target}:{})}
  const value=await sharedCall($,dependencies.proof,request,{node:dependencies.node,orca:dependencies.orca,mode:e.reconcile===true?'reconcile':'execute'})
  if(value.ok&&['admitAssignment','retryAssignment','reportOutcome','readInbox'].includes(e.command?.type))await pumpSharedDeliveries($,dependencies.proof,dependencies).catch(()=>undefined)
  return {result:JSON.stringify(value),...(!value.ok?{isError:true}:{})}
}

// Explicit actions own all I/O. Repeated renders only read display state.
export async function refreshSharedStore($:any,dependencies:SharedAccess) {
 if(!dependencies.enabled || !await beginSharedAction($,'verify'))return
 await update($,uiState,old=>({...old,checked:false,approved:null,member:false}))
 await setSharedStoreProof($,{ok:false,reason:'Checking this project and conversation…'})
 try {
  const proof=await dependencies.revalidate();await setSharedStoreProof($,proof)
  if(!proof.ok){await sharedFeedback($,'Connection could not be verified. Open Details for the reason.','yellow');return}
  const result=await sharedCall($,proof,{operationId:`inspect-${id()}`,command:{type:'inspectCaller'}},dependencies)
  await update($,status,()=>JSON.stringify(result))
  if(result.ok || result.error?.code==='STORE_NOT_FOUND') {
   const generation=result.ok?result.result?.result?.controllerGeneration:null
   await update($,uiState,old=>({...old,checked:true,approved:Number.isSafeInteger(generation)&&generation>0?generation:null,member:!!result.result?.result?.member}))
  } else await sharedFeedback($,'Access could not be checked. Open Details, then check again.','yellow')
 } catch {await sharedFeedback($,'Connection check did not finish. Check again when ready.','yellow')}
 finally {await update($,uiState,old=>({...old,busy:''}))}
}

export async function sharedStoreOptionsView($:any,ui:any,dependencies:SharedControls,expanded=false,compact=false,actions:any=null) {
 const {Box,Text,Button,Input}=ui
 const state=await read($,uiState)
 const change=async(kind:string,value:any)=>{
  if(!await beginSharedAction($,'save'))return
  try {
   if(kind==='enabled')await dependencies.setEnabled(value)
   else if(kind==='node')await dependencies.setNode(String(value).trim()||'node')
   else await dependencies.setOrca(String(value).trim())
   await update($,uiState,old=>({...old,checked:false,approved:null,member:false,nodeDraft:kind==='node'?null:old.nodeDraft,orcaDraft:kind==='orca'?null:old.orcaDraft}))
   await sharedFeedback($,kind==='enabled'?(value?'Preview is on. Check access before approving.':'Preview is off. Your saved approval is kept.'):'Connection option saved.','green')
  } catch(error) {await update($,status,()=>JSON.stringify({error:{code:'CONFIG_SAVE_FAILED',message:String(error)}}));await sharedFeedback($,'Option could not be saved. Your previous setting is still in use.','red')}
  finally {await update($,uiState,old=>({...old,busy:''}))}
 }
 return <Box borderStyle={compact?undefined:'round'} borderColor="gray" paddingX={compact?0:1} flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}>
   <Text weight="bold">{compact?'Workspace mode':'Shared workspace for this project'}</Text>
   <Button key="shared-preview-on" label={dependencies.enabled?'● On':'○ On'} variant={dependencies.enabled?'primary':undefined} onPress={async()=>{if(!dependencies.enabled)await change('enabled',true)}}/>
   <Button key="shared-preview-off" label={!dependencies.enabled?'● Off':'○ Off'} variant={!dependencies.enabled?'primary':undefined} onPress={async()=>{if(dependencies.enabled)await change('enabled',false)}}/>
   {!compact&&<Button key="shared-connection" label={state.connection?'Connection ▴':'Connection ▾'} onPress={async()=>{await update($,uiState,old=>({...old,connection:!old.connection}))}}/>}
  </Box>
  {!compact&&<Text dimColor>Project preference · management permission is separate</Text>}
  {dependencies.preferenceError&&<Text color="yellow">{dependencies.preferenceError}</Text>}
  {actions}
  {(expanded||state.connection)&&<Box flexDirection="column">
   <Box flexWrap="wrap" columnGap={1}>
    <Text weight="bold">{'Node'.padEnd(5)}</Text>
    <Box flexGrow={1}><Input key="shared-node-input" value={state.nodeDraft??dependencies.node} placeholder="node or full executable path" onInput={async(value:string)=>{await update($,uiState,old=>({...old,nodeDraft:value}))}} onSubmit={async()=>change('node',(await read($,uiState)).nodeDraft??dependencies.node)}/></Box>
    <Button key="shared-node-save" label="Save Node" onPress={async()=>change('node',(await read($,uiState)).nodeDraft??dependencies.node)}/>
   </Box>
   <Text dimColor>Node 22.13 or newer</Text>
   <Box flexWrap="wrap" columnGap={1}>
    <Text weight="bold">{'Orca'.padEnd(5)}</Text>
    <Box flexGrow={1}><Input key="shared-orca-input" value={state.orcaDraft??dependencies.orca} placeholder="Detect automatically" onInput={async(value:string)=>{await update($,uiState,old=>({...old,orcaDraft:value}))}} onSubmit={async()=>change('orca',(await read($,uiState)).orcaDraft??dependencies.orca)}/></Box>
    <Button key="shared-orca-save" label="Save Orca" onPress={async()=>change('orca',(await read($,uiState)).orcaDraft??dependencies.orca)}/>
   </Box>
  </Box>}
  {state.busy==='save'&&<Text color="cyan">Saving option…</Text>}
  {!compact&&state.notice&&<Text color={state.tone}>{state.notice}</Text>}
 </Box>
}

export async function approveSharedController($:any,dependencies:SharedAccess) {
 const proof=await read($,displayedProof),state=await read($,uiState)
  if(!dependencies.enabled||!proof.ok||!state.checked||state.approved||!await beginSharedAction($,'approve'))return
  try {
   const current=await dependencies.revalidate()
   if(!current.ok || JSON.stringify(proofOf(current))!==JSON.stringify(proofOf(proof))){await update($,uiState,old=>({...old,checked:false,approved:null}));await sharedFeedback($,'This conversation changed. Check access again before approving.','yellow');return}
   const token=id(),config=String((await $.env.get('CLAUDE_CONFIG_DIR').catch(()=>''))??'') || `${String((await $.env.get('USERPROFILE').catch(()=>''))??'') || String((await $.env.get('HOME').catch(()=>''))??'')}/.claude`
   if(!config || config==='/.claude'){await sharedFeedback($,'Local configuration folder could not be verified.','red');return}
   // Only this explicit approval action mints the scoped, expiring ticket.
   const ticket=`${config}/team-orchestrator/controller-actions/${token}.json`
   await $.fs.write(ticket,JSON.stringify({action:'approveController',id:token,createdAt:Date.now(),...proofOf(current)}))
   const result=await sharedCall($,current,{operationId:`controller-${token}`},{...dependencies,mode:'approveController',uiApprovalId:token})
   await update($,status,()=>JSON.stringify(result))
   const generation=result.ok?result.result?.result?.controllerGeneration:null
   if(Number.isSafeInteger(generation)&&generation>0){await update($,uiState,old=>({...old,checked:true,approved:generation}));await sharedFeedback($,'Controller approved for this conversation.','green')}
   else {await update($,uiState,old=>({...old,checked:false,approved:null}));await sharedFeedback($,'Approval is not confirmed. Check access before retrying.','yellow')}
  } catch {await update($,uiState,old=>({...old,checked:false,approved:null}));await sharedFeedback($,'Approval did not return a confirmed result. Check access before retrying.','yellow')}
  finally {await update($,uiState,old=>({...old,busy:''}))}
 }

export async function sharedStoreView($:any,ui:any,dependencies:SharedAccess & SharedControls,onNewTeam?:()=>Promise<void>) {
 const {Box,Text,Button}=ui
 const proof=await read($,displayedProof),state=await read($,uiState),message=await read($,status)
 const ready=dependencies.enabled&&proof.ok&&state.checked
 const approved=ready?state.approved:null
 const label=!dependencies.enabled?'OFF':state.busy==='verify'?'CHECKING':approved?'APPROVED':ready&&state.member?'MEMBER':ready?'NEEDS APPROVAL':'CHECK ACCESS'
 const color=approved||ready&&state.member?'green':!dependencies.enabled?'gray':'yellow'
 const accessAction=async(approve=false)=>{
  if(approve)await approveSharedController($,dependencies);else await refreshSharedStore($,dependencies)
  const current=await sharedAccessState($)
  if(current.proof.ok&&current.state.checked&&(current.state.approved||current.state.member))await refreshSharedWorkspace($,{...dependencies,proof:current.proof,controllerGeneration:current.state.approved})
 }
 const actions=<Box flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}>
   {dependencies.enabled&&<Button key="shared-refresh" label={state.busy==='verify'?'Checking…':'Check access'} onPress={async()=>accessAction()}/>}
   {ready&&!approved&&<Button key="shared-approve-controller" label={state.busy==='approve'?'Approving…':state.member?'Allow management (optional)':'Allow team management'} variant={state.member?undefined:'primary'} onPress={async()=>accessAction(true)}/>}
  </Box>
  <Box flexWrap="wrap" columnGap={1}>
   <Button key="shared-connection" label={state.connection?'Connection ▴':'Connection ▾'} onPress={async()=>{await update($,uiState,old=>({...old,connection:!old.connection}))}}/>
   <Button key="shared-details" label={state.details?'Details ▴':'Details ▾'} onPress={async()=>{await update($,uiState,old=>({...old,details:!old.details}))}}/>
  </Box>
 </Box>
 const authorized=!!(approved||ready&&state.member)
 const expanded=!authorized||state.access===true
 const project=proof.ok?proof.root.replaceAll('\\','/').split('/').filter(Boolean).slice(-1)[0]||proof.root:'Project access'
 return <Box flexDirection="column">
  <Box flexWrap="wrap" columnGap={1} justifyContent="space-between">
   <Text dimColor>{Array.from(project).length>16?`${Array.from(project).slice(0,16).join('')}…`:project}</Text>
   {authorized?<Button key="shared-access" label={`${label}${expanded?' · Hide access':' · Access'}`} onPress={async()=>update($,uiState,old=>({...old,access:!expanded}))}/>:<Text color={color}>{label}</Text>}
  </Box>
  {expanded&&<Box borderStyle="single" borderColor={color} paddingX={1} flexDirection="column">
   {proof.ok&&<Text dimColor>{proof.root}</Text>}
   {!authorized&&<Text>{!dependencies.enabled?'Enable shared workspace for this project, or start a team draft.':ready?'Allow management for this conversation to manage shared teams.':'Check this project and conversation before continuing.'}</Text>}
   {await sharedStoreOptionsView($,ui,dependencies,false,true,actions)}
   {state.notice&&<Text color={state.tone}>{state.notice}</Text>}
   {ready&&state.member&&!approved&&<Text dimColor>Member access verified · management approval is optional.</Text>}
  </Box>}
  {!expanded&&state.notice&&['red','yellow'].includes(state.tone)&&<Text color={state.tone}>{state.notice}</Text>}
  {onNewTeam&&!authorized&&!(await readSharedWorkspace($)).pending&&<Button key="workspace-start-setup" label="Create team" variant="primary" onPress={onNewTeam}/>}
  {ready&&proof.ok&&authorized&&await sharedWorkspaceView($,ui,{...dependencies,proof,controllerGeneration:approved,onNewTeam})}
  {expanded&&state.details&&<Box flexDirection="column">
   <Text weight="bold">Connection details</Text>
   <Text>{proof.ok?`Project: ${proof.root}\nConversation: ${proof.sessionId}\nTerminal: ${proof.handle}`:proof.reason}</Text>
   {message&&<Text dimColor>{message.includes('"code":"STORE_NOT_FOUND"')?'No shared store yet. Allow team management to set up this project.':message}</Text>}
  </Box>}
 </Box>
}

export async function sharedAccessState($:any) {return {proof:await read($,displayedProof),state:await read($,uiState),message:await read($,status)}}

export async function sharedPermissionView($:any,ui:any,dependencies:SharedAccess & SharedControls) {
 const {Box,Text,Button}=ui
 const access=await sharedAccessState($),{proof,state,message}=access
 return <Box borderStyle="round" borderColor={state.approved?'green':'cyan'} paddingX={1} flexDirection="column">
  <Text weight="bold">Project access</Text>
  {dependencies.preferenceError&&<Text color="yellow">{dependencies.preferenceError}</Text>}
  <Text>{proof.ok?proof.root:'Project identity will be checked before permission is requested.'}</Text>
  {!dependencies.enabled?<Box flexDirection="column"><Text>Use shared teams in this project. Other projects keep their defaults.</Text><Button key="setup-enable-project" label="Use shared workspace for this project" variant="primary" onPress={async()=>{try{await dependencies.setEnabled(true);await refreshSharedStore($,{...dependencies,enabled:true})}catch(error){await sharedFeedback($,String(error),'yellow')}}}/></Box>
  :!state.checked?<Box flexDirection="column"><Button key="shared-refresh" label={state.busy?'Checking…':'Check project access'} variant="primary" onPress={async()=>refreshSharedStore($,dependencies)}/>{!proof.ok&&<Text color="yellow">{proof.reason}</Text>}</Box>
  :state.approved?<Text color="green">✓ Management allowed for this conversation.</Text>
  :<Box flexDirection="column"><Text>Allow this conversation to set up and manage teams in this project. Other approved conversations keep their access. Worker file and Agent permissions stay separate.</Text><Button key="shared-approve-controller" label={state.busy==='approve'?'Allowing…':'Allow team management'} variant="primary" onPress={async()=>approveSharedController($,dependencies)}/></Box>}
  {state.notice&&<Text color={state.tone}>{state.notice}</Text>}
  <Button key="shared-details" label={state.details?'Hide details':'Connection details'} onPress={async()=>{await update($,uiState,old=>({...old,details:!old.details}))}}/>
  {state.details&&<Box flexDirection="column"><Text>{proof.ok?`Conversation: ${proof.sessionId}\nTerminal: ${proof.handle}`:proof.reason}</Text>{message&&<Text dimColor>{message.includes('"code":"STORE_NOT_FOUND"')?'Project setup has not been created. Allow management here to continue.':message}</Text>}</Box>}
 </Box>
}
