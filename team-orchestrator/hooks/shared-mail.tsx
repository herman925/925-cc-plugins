import {atom,read,update} from 'claude-code'
import {sharedCall} from './shared-bridge'
import type {WorkspaceDependencies} from './shared-workspace'

export type SharedMailState={scope:string;busy:boolean;checked:boolean;message:any;error:string}
const state=atom({plugin:'team-orchestrator',key:'sharedMail'} as const,{scope:'',busy:false,checked:false,message:null,error:''} as SharedMailState)
const keyOf=(deps:WorkspaceDependencies)=>JSON.stringify([deps.proof.root,deps.proof.sessionId,deps.proof.contextId,deps.proof.handle])
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
const READ_PROMPT='Read my next shared-team inbox message using shared_inbox_read. After reading it, confirm its readReceiptId with shared_inbox_seen. Follow my current member role and the admitted assignment; review a worker outcome before accepting it.'
export async function sharedMailView($:any,ui:any,deps:WorkspaceDependencies,members:any[]) {
 const {Box,Text,Button}=ui,scope=keyOf(deps),saved=await read($,state)
 const current=saved.scope===scope?saved:{scope,busy:false,checked:false,message:null,error:''}
 const refresh=async()=>{
  let acquired=false
  await update($,state,old=>{if(old.scope===scope&&old.busy)return old;acquired=true;return {...current,busy:true,error:''}})
  if(!acquired)return
  try {
   const proof=await deps.revalidate()
   if(!proof.ok||JSON.stringify([proof.root,proof.sessionId,proof.contextId,proof.handle])!==scope)throw Error('This conversation changed. Check project access again.')
   const caller=await sharedCall($,proof,{operationId:`mail-${id()}`,command:{type:'inspectCaller'}},deps),member=caller.result?.result?.member
   if(!caller.ok||!member)throw Error('Connect this conversation to a team member before opening its inbox.')
   const response=await sharedCall($,proof,{operationId:`mail-${id()}`,command:{type:'inspectInbox',teamId:member.team_id,recipientMemberId:member.member_id}},deps)
   if(!response.ok)throw Error(response.error?.message||'The inbox could not be checked.')
   await update($,state,old=>old.scope===scope?{scope,busy:false,checked:true,message:response.result?.result?.messages?.[0]??null,error:''}:old)
  }catch(error){await update($,state,old=>old.scope===scope?{...old,busy:false,error:error instanceof Error?error.message:String(error)}:old)}
 }
 const sender=String(members.find(m=>m.member_id===current.message?.sender_member_id)?.name||'Team member').replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,'')
 const kind=current.message?.kind==='dispatch'?'Task assignment':current.message?.kind==='worker_done'?'Outcome to review':'Team message'
 return <Box borderStyle="round" borderColor={current.message?'cyan':'gray'} paddingX={1} flexDirection="column">
  <Box flexWrap="wrap" columnGap={1} justifyContent="space-between"><Text weight="bold">Your inbox</Text><Button key="workspace-mail-refresh" label={current.busy?'Checking…':current.checked?'Refresh inbox':'Check inbox'} onPress={refresh}/></Box>
  {current.error&&<Text color="yellow">{current.error}</Text>}
  {current.message?<Box flexDirection="column"><Text color="cyan">● {kind}</Text><Text dimColor>From {sender}</Text></Box>:current.checked?<Text dimColor>No new unread messages.</Text>:<Text dimColor>Check for the next message addressed to this conversation.</Text>}
  <Button key="workspace-mail-read" label="Read in conversation" variant={current.message?'primary':undefined} onPress={async()=>{await $.prompt.submit({text:READ_PROMPT})}}/>
 </Box>
}
