import {atom,read,update} from 'claude-code'
import {refreshSharedStore,sharedAccessState,sharedPermissionView} from './shared-store'
import type {SharedControls} from './shared-store'
import type {SharedProof} from './shared-bridge'
import {beginSharedDraft,readSharedWorkspace,patchSharedDraft,editSharedMember,addSharedMember,removeSharedMember,sharedDraftProblem,submitSharedDraft,reconcileSharedDraft,workspaceLine,workspaceText,workspaceScope} from './shared-workspace'

type Setup={scope:string;active:boolean;step:number;member:number;advanced:boolean;error:string;busy:boolean;discard:boolean;nodeDraft:string|null;orcaDraft:string|null;storeHint:boolean|null}
const initial=():Setup=>({scope:'',active:false,step:0,member:0,advanced:false,error:'',busy:false,discard:false,nodeDraft:null,orcaDraft:null,storeHint:null})
const setup=atom({plugin:'team-orchestrator',key:'teamSetup'} as const,initial())
export type SetupDependencies=SharedControls & {revalidate:()=>Promise<SharedProof>;requestId:string;onCreated:()=>Promise<void>;onClose:()=>Promise<void>;onOpenTeams:()=>Promise<void>;onClassic:()=>Promise<void>}
async function scopeNow($:any){return workspaceScope(String(await $.session.root()),String(await $.session.id()))}
async function set($:any,patch:Partial<Setup>){await update($,setup,old=>({...old,...patch}))}
export async function teamEntryState($:any){
 try{const scope=await scopeNow($),s=await read($,setup),w=await readSharedWorkspace($)
 return {draft:s.scope===scope&&s.active,knownTeam:w.scope===scope&&!!(w.createdTeamId||w.teamId),storeHint:s.scope===scope?s.storeHint:null}}catch{return {draft:false,knownTeam:false,storeHint:null}}
}
export async function observeTeamPresence($:any){
 const scope=await scopeNow($),root=String(await $.session.root())
 const exists=await $.fs.exists(`${root}/.team-orchestrator/team.sqlite`).catch(()=>false)
 await update($,setup,old=>({...((old.scope===scope)?old:initial()),scope,storeHint:!!exists}))
}
export async function startTeamSetup($:any){
 const scope=await scopeNow($),old=await read($,setup)
 if(old.scope===scope&&old.active){await patchSharedDraft($,{page:'new'});return}
 await beginSharedDraft($)
 await update($,setup,()=>({...initial(),scope,active:true,storeHint:old.scope===scope?old.storeHint:null}))
}
async function finish($:any,deps:SetupDependencies){
 const w=await readSharedWorkspace($)
 if(w.createdTeamId){await set($,{active:false,error:''});await deps.onCreated();return true}
 return false
}
async function act($:any,work:()=>Promise<void>){
 let acquired=false;await update($,setup,old=>{if(old.busy)return old;acquired=true;return {...old,busy:true,error:''}})
 if(!acquired)return
 try{await work()}catch(error){await set($,{error:error instanceof Error?error.message:String(error)})}
 finally{await set($,{busy:false})}
}

export async function teamSetupView($:any,ui:any,deps:SetupDependencies){
 const {Box,Text,Button,Input,Select}=ui
 const s=await read($,setup),w=await readSharedWorkspace($),access=await sharedAccessState($)
 const scope=await scopeNow($)
 if(s.scope!==scope||!s.active)return <Box><Text>Open Create team to start a draft in this conversation.</Text></Box>
 const pending=!!w.pending,busy=s.busy||w.busy||!!access.state.busy
 const labels=['Team','Members','Options','Review & permission']
 async function edit(patch:any){if(!(await read($,setup)).busy&&!w.pending)await patchSharedDraft($,patch)}
 function field(key:string,label:string,value:string,onInput:(value:string)=>Promise<void>,rows=1,autoFocus=false){return <Box width="100%" flexDirection="column">{rows>1&&<Text dimColor>{label}</Text>}<Input key={key} label={rows===1?`${label}: `:undefined} placeholder={rows>1?(label==='Purpose'?'Describe the work':'Add instructions'):'Enter value'} value={rows>1?workspaceText(value):workspaceLine(value)} rows={rows} autoFocus={autoFocus?true:undefined} onInput={async(value:string)=>{if(!busy)await onInput(rows>1?workspaceText(value):workspaceLine(value))}} onSubmit={()=>{}}/></Box>}
 async function next(){await act($,async()=>{
  const current=await readSharedWorkspace($),currentSetup=await read($,setup),problem=sharedDraftProblem(current,currentSetup.step)
  if(problem){const index=Number(problem.field.match(/-(\d+)$/)?.[1]??currentSetup.member);await set($,{error:problem.message,member:index,advanced:currentSetup.step===2?true:currentSetup.advanced});await $.ui.focus({requestId:deps.requestId,key:problem.field}).catch(()=>undefined);return}
  const step=Math.min(3,currentSetup.step+1);await set($,{step,error:''})
  if(step===3&&deps.enabled)await refreshSharedStore($,deps)
 })}
 async function submit(){await act($,async()=>{
  const current=await sharedAccessState($)
  if(!current.proof.ok||!current.state.checked||!current.state.approved)throw Error('Check access and allow team management before creating.')
  const fresh=await deps.revalidate()
  if(!fresh.ok||fresh.root!==current.proof.root||fresh.sessionId!==current.proof.sessionId||fresh.handle!==current.proof.handle||fresh.contextId!==current.proof.contextId)throw Error('This conversation changed. Check access before creating.')
  await deps.rememberProject?.()
  await submitSharedDraft($,{...deps,proof:current.proof,controllerGeneration:current.state.approved})
  await finish($,deps)
 })}
 async function reconcile(retry=false){await act($,async()=>{
  const current=await sharedAccessState($)
  if(!current.proof.ok)throw Error('Check project access before checking the receipt.')
  await reconcileSharedDraft($,{...deps,proof:current.proof,controllerGeneration:current.state.approved},retry)
  await finish($,deps)
 })}
 const member=w.members[s.member]??w.members[0],mi=Math.max(0,w.members.indexOf(member))
 const project=String(JSON.parse(scope)[0])
 return <Box flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}><Text weight="bold" color="cyan">Create team</Text><Text dimColor>Step {s.step+1} of 4 · {labels[s.step]}</Text></Box>
  <Box flexWrap="wrap" columnGap={1}>
   {!pending&&s.step>0&&<Button key="setup-back" label="← Back" onPress={async()=>{if(!busy)await set($,{step:s.step-1,error:''})}}/>}
   {!pending&&s.step<3&&<Button key="setup-next" label={busy?'Checking…':'Next →'} variant="primary" onPress={next}/>}
   {!pending&&s.step===3&&deps.enabled&&access.state.checked&&access.state.approved&&<Button key="workspace-create" label={busy?'Creating…':'Create team'} variant="primary" onPress={submit}/>}
  </Box>
  {s.error&&<Text color="yellow">{s.error}</Text>}
  {w.notice&&<Text color={w.error?'yellow':'green'}>{w.notice}</Text>}
  {pending?<Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
   <Text weight="bold">Creation is awaiting confirmation.</Text><Text>The original request is kept. Check its receipt before making another change.</Text>
   <Box flexWrap="wrap" columnGap={1}><Button key="workspace-reconcile" label="Check receipt" onPress={async()=>reconcile()}/>{w.retry&&<Button key="workspace-retry" label="Retry same operation" onPress={async()=>reconcile(true)}/>}</Box>
  </Box>:<Box flexDirection="column">
   {s.step===0&&<Box flexDirection="column">
    {field('workspace-team-name','Team name',w.name,value=>edit({name:value}),1,true)}
    {field('workspace-team-purpose','Purpose',w.purpose,value=>edit({purpose:value}),3)}
    <Text dimColor>A draft only. No team, approval or session is created here.</Text>
   </Box>}
   {s.step===1&&member&&<Box flexDirection="column">
    <Select key="setup-member-select" label="Edit member " value={member.memberId} options={w.members.map((m,i)=>({value:m.memberId,label:workspaceLine(`${i===0?'Head':'└'} · ${m.name} · ${m.role}`)}))} onSelect={async(value:string)=>{if(!busy)await set($,{member:w.members.findIndex(m=>m.memberId===value),error:''})}}/>
    {field(`workspace-member-name-${mi}`,'Name',member.name,value=>editSharedMember($,member.memberId,{name:value}))}
    {field(`workspace-member-role-${mi}`,'Role',member.role,value=>editSharedMember($,member.memberId,{role:value}))}
    {mi>0&&<Select key={`workspace-member-boss-${mi}`} label="Reports to " value={member.bossMemberId??undefined} options={w.members.slice(0,mi).map(m=>({value:m.memberId,label:workspaceLine(m.name)}))} onSelect={async(value:string)=>{if(!busy)await editSharedMember($,member.memberId,{bossMemberId:value})}}/>}
    {field(`workspace-member-official-${mi}`,'Official instructions',member.officialText,value=>editSharedMember($,member.memberId,{officialText:value}),3)}
    <Box flexWrap="wrap" columnGap={1}>
     {w.members.length<30&&<Button key="workspace-member-add" label="＋ Add member" onPress={async()=>{if(!busy){await addSharedMember($);await set($,{member:w.members.length})}}}/>}
     {mi>0&&<Button key={`workspace-member-remove-${mi}`} label="Remove member" onPress={async()=>{if(!busy){await removeSharedMember($,member.memberId);await set($,{member:0})}}}/>}
    </Box>
    <Text dimColor>{w.members.length} members · one head · session connection comes after creation</Text>
   </Box>}
   {s.step===2&&<Box flexDirection="column">
    {field('workspace-capacity','Capacity · 0 = unlimited',w.capacity,value=>edit({capacity:value}),1,true)}
    {field('workspace-pickup','Pickup window · minutes',w.pickup,value=>edit({pickup:value}))}
    <Button key="setup-advanced" label={s.advanced?'Advanced options ▴':'Advanced options ▾'} onPress={async()=>set($,{advanced:!s.advanced})}/>
    {s.advanced&&<Box flexDirection="column">
     {field('workspace-answer','Answer window · minutes',w.answer,value=>edit({answer:value}))}
     {field('workspace-window','Task window · minutes, empty = off',w.window,value=>edit({window:value}))}
     {field('workspace-replay','Replay interval · milliseconds',w.replay,value=>edit({replay:value}))}
     <Text dimColor>Local SQLite. Automatic close off; no automatic launch, delivery or task-window fencing in this increment.</Text>
     <Text weight="bold">Connection commands</Text><Text dimColor>Executable choices are saved for this installation.</Text>
     {field('setup-node','Node 22.13+ executable',s.nodeDraft??deps.node,value=>set($,{nodeDraft:value}))}
     <Button key="setup-save-node" label="Save Node" onPress={async()=>act($,async()=>{await deps.setNode((s.nodeDraft??deps.node).trim()||'node');await set($,{nodeDraft:null})})}/>
     {field('setup-orca','Orca executable',s.orcaDraft??deps.orca,value=>set($,{orcaDraft:value}))}
     <Button key="setup-save-orca" label="Save Orca" onPress={async()=>act($,async()=>{await deps.setOrca((s.orcaDraft??deps.orca).trim());await set($,{orcaDraft:null})})}/>
     <Button key="setup-classic" label="Open classic team setup" onPress={async()=>{if(!busy)await deps.onClassic()}}/>
    </Box>}
   </Box>}
   {s.step===3&&<Box flexDirection="column">
    <Text weight="bold">{w.name} · {w.members.length} members</Text><Text>{w.purpose}</Text>
    <Text>Capacity {w.capacity} · Pickup {w.pickup} min · Answer {w.answer} min</Text>
    <Text>Task window {w.window.trim()?`${w.window} min`:'off'} · Replay {w.replay} ms</Text>
    <Text dimColor>SQLite · automatic close off · demand launch · batch 1 · scratch/assumptions off · no exemptions</Text>
    <Text>Project: {project}</Text>
    {await sharedPermissionView($,ui,deps)}
    <Text dimColor>Creating remembers shared mode for this project. Management permission stays specific to this conversation.</Text>
    <Text dimColor>Team not created yet. Creating saves the roster; connecting and starting sessions are separate.</Text>
   </Box>}
   <Box flexWrap="wrap" columnGap={1}>
    <Button key="workspace-cancel" label="Close setup" onPress={async()=>{if(!busy)await deps.onClose()}}/>
    <Button key="tab-shared" label="Open teams" onPress={async()=>{if(!busy)await deps.onOpenTeams()}}/>
    <Button key="setup-discard" label="Discard draft…" onPress={async()=>{if(!busy)await set($,{discard:true})}}/>
   </Box>
   {s.discard&&<Box flexWrap="wrap" columnGap={1}><Text>Discard this unsaved draft?</Text><Button key="setup-keep-draft" label="Keep draft" onPress={async()=>set($,{discard:false})}/><Button key="setup-confirm-discard" label="Discard" onPress={async()=>{if(!busy){await patchSharedDraft($,{page:'home',members:[],name:'',purpose:''});await set($,{active:false,step:0,discard:false});await deps.onClose()}}}/></Box>}
  </Box>}
 </Box>
}
