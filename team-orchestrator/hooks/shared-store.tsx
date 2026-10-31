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
type SharedUi = {busy:string;notice:string;tone:string;details:boolean;connection:boolean;nodeDraft:string|null;orcaDraft:string|null;checked:boolean;approved:number|null}
const uiState = atom({plugin:'team-orchestrator',key:'sharedStoreUi'} as const,{busy:'',notice:'',tone:'gray',details:false,connection:false,nodeDraft:null,orcaDraft:null,checked:false,approved:null} as SharedUi)
export type SharedControls = {enabled:boolean;node:string;orca:string;setEnabled:(enabled:boolean)=>Promise<void>;setNode:(value:string)=>Promise<void>;setOrca:(value:string)=>Promise<void>}
type SharedAccess = {enabled:boolean;node:string;orca:string;revalidate:()=>Promise<SharedProof>}
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

export async function startSharedStore($:any,_enabled:boolean) {
  // Register the catalogue at startup, when the host supports registration.
  // The live option gates every call, so switching On never needs a reload.
  await $.tool.register({name:'shared_team',description:'Opt-in fresh-team shared-store preview. Enable the preview with Team Orchestrator Settings, then approve this conversation using the Shared store panel. Typed operations only. Create a fresh team, bind verified local Claude sessions, inspectTeam/inspectCaller, admitAssignment to a direct report, verifyAssignment (read its returned role and brief before work), reportOutcome, inspectAssignment, then acceptTask as the head. Outcome does not accept a task. Preserve operationId on retries; reconcile:true only inspects its receipt. No raw SQL, caller identity or approval flags. Only bindMember accepts target: a native session reference to verify, never caller proof.',inputSchema:{type:'object',additionalProperties:false,properties:{operationId:{type:'string'},command:commandSchema,target:{type:'object',additionalProperties:false,properties:{projectRoot:{type:'string'},conversationId:{type:'string'},terminalHandle:{type:'string'},contextId:{type:'string'}},required:['projectRoot','conversationId','terminalHandle','contextId']},reconcile:{type:'boolean'}},required:['operationId','command']}})
}
export async function callSharedStore($:any,e:any,enabled:boolean,dependencies:{proof:SharedProof;node:string;orca:string}) {
  if(!enabled)return {deny:'The shared-store preview is disabled.'}
  // These are the only fields crossing the model boundary. Actor facts are
  // freshly derived below and never read from model tool arguments.
  const request={operationId:e.operationId,command:e.command,...(e.target!==undefined?{target:e.target}:{})}
  const value=await sharedCall($,dependencies.proof,request,{node:dependencies.node,orca:dependencies.orca,mode:e.reconcile===true?'reconcile':'execute'})
  return {result:JSON.stringify(value),...(!value.ok?{isError:true}:{})}
}

// Explicit actions own all I/O. Repeated renders only read display state.
export async function refreshSharedStore($:any,dependencies:SharedAccess) {
 if(!dependencies.enabled || !await beginSharedAction($,'verify'))return
 await update($,uiState,old=>({...old,checked:false,approved:null}))
 await setSharedStoreProof($,{ok:false,reason:'Checking this project and conversation…'})
 try {
  const proof=await dependencies.revalidate();await setSharedStoreProof($,proof)
  if(!proof.ok){await sharedFeedback($,'Connection could not be verified. Open Details for the reason.','yellow');return}
  const result=await sharedCall($,proof,{operationId:`inspect-${id()}`,command:{type:'inspectCaller'}},dependencies)
  await update($,status,()=>JSON.stringify(result))
  if(result.ok || result.error?.code==='STORE_NOT_FOUND') {
   const generation=result.ok?result.result?.result?.controllerGeneration:null
   await update($,uiState,old=>({...old,checked:true,approved:Number.isSafeInteger(generation)&&generation>0?generation:null}))
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
   await update($,uiState,old=>({...old,checked:false,approved:null,nodeDraft:kind==='node'?null:old.nodeDraft,orcaDraft:kind==='orca'?null:old.orcaDraft}))
   await sharedFeedback($,kind==='enabled'?(value?'Preview is on. Check access before approving.':'Preview is off. Your saved approval is kept.'):'Connection option saved.','green')
  } catch(error) {await update($,status,()=>JSON.stringify({error:{code:'CONFIG_SAVE_FAILED',message:String(error)}}));await sharedFeedback($,'Option could not be saved. Your previous setting is still in use.','red')}
  finally {await update($,uiState,old=>({...old,busy:''}))}
 }
 return <Box borderStyle={compact?undefined:'round'} borderColor="gray" paddingX={compact?0:1} flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}>
   <Text weight="bold">{compact?'Preview':'Shared-store preview'}</Text>
   <Button key="shared-preview-on" label={dependencies.enabled?'● On':'○ On'} variant={dependencies.enabled?'primary':undefined} onPress={async()=>{if(!dependencies.enabled)await change('enabled',true)}}/>
   <Button key="shared-preview-off" label={!dependencies.enabled?'● Off':'○ Off'} variant={!dependencies.enabled?'primary':undefined} onPress={async()=>{if(dependencies.enabled)await change('enabled',false)}}/>
   {!compact&&<Button key="shared-connection" label={state.connection?'Connection ▴':'Connection ▾'} onPress={async()=>{await update($,uiState,old=>({...old,connection:!old.connection}))}}/>}
  </Box>
  {!compact&&<Text dimColor>Fresh scratch teams · approval is a separate action</Text>}
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

export async function sharedStoreView($:any,ui:any,dependencies:SharedAccess & SharedControls) {
 const {Box,Text,Button}=ui
 const proof=await read($,displayedProof),state=await read($,uiState),message=await read($,status)
 const approve=async()=>{
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
 const ready=dependencies.enabled&&proof.ok&&state.checked
 const approved=ready?state.approved:null
 const label=!dependencies.enabled?'OFF':state.busy==='verify'?'CHECKING':approved?'APPROVED':ready?'NEEDS APPROVAL':'CHECK ACCESS'
 const color=approved?'green':!dependencies.enabled?'gray':'yellow'
 const actions=<Box flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}>
   {dependencies.enabled&&<Button key="shared-refresh" label={state.busy==='verify'?'Checking…':'Check access'} onPress={async()=>refreshSharedStore($,dependencies)}/>}
   {ready&&!approved&&<Button key="shared-approve-controller" label={state.busy==='approve'?'Approving…':'Approve controller'} variant="primary" onPress={approve}/>}
  </Box>
  <Box flexWrap="wrap" columnGap={1}>
   <Button key="shared-connection" label={state.connection?'Connection ▴':'Connection ▾'} onPress={async()=>{await update($,uiState,old=>({...old,connection:!old.connection}))}}/>
   <Button key="shared-details" label={state.details?'Details ▴':'Details ▾'} onPress={async()=>{await update($,uiState,old=>({...old,details:!old.details}))}}/>
  </Box>
 </Box>
 return <Box flexDirection="column">
  <Box borderStyle="round" borderColor={color} paddingX={1} flexDirection="column">
   <Box flexWrap="wrap" columnGap={1}><Text weight="bold" color="cyan">Shared workspace</Text><Text color={color} weight="bold">● {label}</Text></Box>
   <Text dimColor>{proof.ok?`Project: ${proof.root.replaceAll('\\','/').split('/').filter(Boolean).slice(-1)[0]||proof.root}`:'Project not verified · use Check access when On'}</Text>
   {await sharedStoreOptionsView($,ui,dependencies,false,true,actions)}
   {state.notice?<Text color={state.tone}>{state.notice}</Text>:<Text dimColor>{approved?'Controller approved for this conversation':ready?'Approval grants project team management':state.busy==='verify'?'Checking project, conversation and saved approval…':'Fresh scratch teams · approval is a separate action'}</Text>}
  </Box>
  {state.details&&<Box borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
   <Text weight="bold">Connection details</Text>
   <Text>{proof.ok?`Project: ${proof.root}\nConversation: ${proof.sessionId}\nTerminal: ${proof.handle}`:proof.reason}</Text>
   {message&&<Text dimColor>{message}</Text>}
  </Box>}
 </Box>
}
