import {atom,read,update} from 'claude-code'
import {refreshSharedStore,sharedAccessState,sharedPermissionView} from './shared-store'
import type {SharedControls} from './shared-store'
import type {SharedProof} from './shared-bridge'
import {TEAM_TEMPLATES,templateMembers} from './team-templates'
import {draftId,draftMembers,draftFingerprint,interviewPrompt,interviewDraft} from './creation-draft'
import {beginSharedDraft,readSharedWorkspace,patchSharedDraft,editSharedMember,addSharedMember,removeSharedMember,sharedDraftProblem,submitSharedDraft,reconcileSharedDraft,workspaceLine,workspaceText,workspaceScope} from './shared-workspace'

type Setup={scope:string;active:boolean;step:number;member:number;advanced:boolean;error:string;busy:boolean;discard:boolean;nodeDraft:string|null;orcaDraft:string|null;storeHint:boolean|null;memberOpen:boolean;template:string;interviewId:string;interviewSnapshot:string}
const initial=():Setup=>({scope:'',active:false,step:0,member:0,advanced:false,error:'',busy:false,discard:false,nodeDraft:null,orcaDraft:null,storeHint:null,memberOpen:false,template:'',interviewId:'',interviewSnapshot:''})
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
export async function closeSetupMenus($:any){await set($,{memberOpen:false,template:''})}
export async function applyTeamInterview($:any,input:any){
 const scope=await scopeNow($);let acquired=false
 await update($,setup,old=>{if(old.busy)return old;acquired=true;return {...old,busy:true}})
 if(!acquired)throw Error('The draft is busy. Try again after its current action settles.')
 try{
  const s=await read($,setup),w=await readSharedWorkspace($)
  if(s.scope!==scope||!s.active||!s.interviewId||input.interviewId!==s.interviewId)throw Error('Start Interview me from this conversation before proposing a draft.')
  if(w.scope!==scope||w.busy||w.pending)throw Error('Resolve the current operation before replacing a draft.')
  if(draftFingerprint(w)!==s.interviewSnapshot)throw Error('The draft changed during the interview. Your edits were kept; restart Interview me to use them.')
  const patch=interviewDraft(input)
  await patchSharedDraft($,{...patch,page:'new',notice:'Interview proposal ready. Review it before allowing management or creating.',error:false})
  await set($,{step:3,member:0,memberOpen:false,template:'',interviewId:'',interviewSnapshot:'',error:''})
 }finally{await set($,{busy:false})}
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
 function field(key:string,label:string,value:string,onInput:(value:string)=>Promise<void>,rows=1,autoFocus=false){return <Box width="100%" flexDirection="column">{rows>1&&<Text dimColor>{label}</Text>}<Input key={key} label={rows===1?label:undefined} placeholder={rows>1?(label==='Purpose'?'Describe the work':'Add instructions'):'Enter value'} value={rows>1?workspaceText(value):workspaceLine(value)} rows={rows} autoFocus={autoFocus?true:undefined} onInput={async(value:string)=>{if(!busy)await onInput(rows>1?workspaceText(value):workspaceLine(value))}} onSubmit={()=>{}}/></Box>}
 async function next(){await act($,async()=>{
  const current=await readSharedWorkspace($),currentSetup=await read($,setup),problem=sharedDraftProblem(current,currentSetup.step)
  if(problem){const index=Number(problem.field.match(/-(\d+)$/)?.[1]??currentSetup.member);await set($,{error:problem.message,member:index,advanced:currentSetup.step===2?true:currentSetup.advanced});await $.ui.focus({requestId:deps.requestId,key:problem.field}).catch(()=>undefined);return}
  const step=Math.min(3,currentSetup.step+1);await set($,{step,error:'',memberOpen:false,template:''})
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
 const template=TEAM_TEMPLATES.find(t=>t.label===s.template)
 async function useTemplate(){await act($,async()=>{
  const current=await readSharedWorkspace($),currentSetup=await read($,setup),selection=TEAM_TEMPLATES.find(t=>t.label===currentSetup.template)
  if(!selection||current.pending)throw Error('Choose a template after the pending operation settles.')
  await patchSharedDraft($,{name:selection.form.team,members:draftMembers(templateMembers(selection,current.purpose)),notice:'Template applied. Names, roles and reporting lines remain editable.',error:false})
  await set($,{template:'',member:0,memberOpen:false,interviewId:'',interviewSnapshot:''})
 })}
 async function interview(){await act($,async()=>{
  const current=await readSharedWorkspace($),currentSetup=await read($,setup)
  if(current.pending||current.busy||currentSetup.interviewId)throw Error('Finish or cancel the current proposal before starting another interview.')
  const id=draftId();await set($,{interviewId:id,interviewSnapshot:draftFingerprint(current),template:'',memberOpen:false})
  try{const submitted=await $.prompt.submit({text:interviewPrompt(id,current)});if(submitted?.drop)throw Error(`Interview did not start: ${submitted.drop}`)}catch(error){await set($,{interviewId:'',interviewSnapshot:''});throw error}
 })}

 return <Box flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}><Text weight="bold" color="cyan">Create team</Text><Text dimColor>Step {s.step+1} of 4 · {labels[s.step]}</Text></Box>
  <Box flexWrap="wrap" columnGap={1}>
   {!pending&&s.step>0&&<Button key="setup-back" label="← Back" onPress={async()=>{if(!busy)await set($,{step:s.step-1,error:'',memberOpen:false,template:''})}}/>}
   {!pending&&s.step<3&&<Button key="setup-next" label={busy?'Checking…':'Next →'} variant="primary" onPress={next}/>}
   {!pending&&s.step===3&&deps.enabled&&access.state.checked&&access.state.approved&&<Button key="workspace-create" label={busy?'Creating…':'Create team'} variant="primary" onPress={submit}/>}
  </Box>
  {s.error&&<Text color="yellow">{s.error}</Text>}
  {w.notice&&<Text color={w.error?'yellow':'green'}>{w.notice}</Text>}
  {s.interviewId&&<Box flexDirection="column"><Text dimColor>Interview in this conversation. Its proposal returns here for review; editing this draft will require restarting the interview.</Text><Button key="setup-interview-cancel" label="Cancel proposal" onPress={async()=>{if(!busy)await set($,{interviewId:'',interviewSnapshot:''})}}/></Box>}
  {pending?<Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
   <Text weight="bold">Creation is awaiting confirmation.</Text><Text>The original request is kept. Check its receipt before making another change.</Text>
   <Box flexWrap="wrap" columnGap={1}><Button key="workspace-reconcile" label="Check receipt" onPress={async()=>reconcile()}/>{w.retry&&<Button key="workspace-retry" label="Retry same operation" onPress={async()=>reconcile(true)}/>}</Box>
  </Box>:<Box flexDirection="column">
   {s.step===0&&<Box flexDirection="column">
    <Text weight="bold">Start with a template</Text>
    <Box flexWrap="wrap" columnGap={1}>{TEAM_TEMPLATES.map(t=><Button key={`setup-template-${t.label}`} label={t.label} variant={s.template===t.label?'primary':undefined} onPress={async()=>{if(!busy)await set($,{template:s.template===t.label?'':t.label})}}/>)}</Box>
    {template&&<Box flexDirection="column"><Text>{template.hint} · {templateMembers(template,w.purpose).length} members</Text>{template.form.ceo==='1'&&<Text dimColor>Named reporting branches in one shared roster.</Text>}<Text dimColor>Use template replaces this draft's name and members. Purpose and options stay.</Text><Box flexWrap="wrap" columnGap={1}><Button key="setup-template-apply" label="Use template" onPress={useTemplate}/><Button key="setup-template-cancel" label="Cancel template" onPress={async()=>set($,{template:''})}/></Box></Box>}
    {!s.interviewId&&<Button key="setup-interview" label="Interview me" onPress={interview}/>}

    {field('workspace-team-name','Team name',w.name,value=>edit({name:value}),1,true)}
    {field('workspace-team-purpose','Purpose',w.purpose,value=>edit({purpose:value}),3)}
    <Text dimColor>A draft only. No team, approval or session is created here.</Text>
   </Box>}
   {s.step===1&&member&&<Box flexDirection="column">
    <Button key="setup-member-select" label={`Edit member: ${workspaceLine(member.name)} ${s.memberOpen?'▴':'▾'}`} onPress={async()=>{if(!busy)await set($,{memberOpen:!s.memberOpen})}}/>
    {s.memberOpen&&<Box flexDirection="column">{w.members.map((m,i)=><Button key={`setup-member-option-${m.memberId}`} label={`${i===s.member?'● ':''}${workspaceLine(m.name)}`} onPress={async()=>{if(!busy)await set($,{member:i,memberOpen:false,error:''})}}/>)}<Button key="setup-member-close" label="Close member picker" onPress={async()=>set($,{memberOpen:false})}/></Box>}
    {mi===0&&<Text dimColor>Team head · reports to you</Text>}
    {field(`workspace-member-name-${mi}`,'Name',member.name,value=>editSharedMember($,member.memberId,{name:value}))}
    {field(`workspace-member-role-${mi}`,'Role',member.role,value=>editSharedMember($,member.memberId,{role:value}))}
    {mi>0&&<Select key={`workspace-member-boss-${mi}`} label="Reports to " value={member.bossMemberId??undefined} options={w.members.slice(0,mi).map(m=>({value:m.memberId,label:workspaceLine(m.name)}))} onSelect={async(value:string)=>{if(!busy)await editSharedMember($,member.memberId,{bossMemberId:value})}}/>}
    {field(`workspace-member-official-${mi}`,'Official instructions',member.officialText,value=>editSharedMember($,member.memberId,{officialText:value}),3)}
    <Box flexWrap="wrap" columnGap={1}>
     {w.members.length<30&&<Button key="workspace-member-add" label="＋ Add member" onPress={async()=>{if(!busy){await addSharedMember($);await set($,{member:w.members.length,memberOpen:false})}}}/>}
     {mi>0&&<Button key={`workspace-member-remove-${mi}`} label="Remove member" onPress={async()=>{if(!busy){await removeSharedMember($,member.memberId);await set($,{member:0,memberOpen:false})}}}/>}
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
    <Text weight="bold">{w.name} · {w.members.length} members</Text><Text>{w.purpose}</Text><Button key="setup-review-members" label="Review members" onPress={async()=>{if(!busy)await set($,{step:1,memberOpen:false})}}/>
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
   {s.discard&&<Box flexWrap="wrap" columnGap={1}><Text>Discard this unsaved draft?</Text><Button key="setup-keep-draft" label="Keep draft" onPress={async()=>set($,{discard:false})}/><Button key="setup-confirm-discard" label="Discard" onPress={async()=>{if(!busy){await patchSharedDraft($,{page:'home',members:[],name:'',purpose:''});await set($,{active:false,step:0,discard:false,memberOpen:false,template:'',interviewId:'',interviewSnapshot:''});await deps.onClose()}}}/></Box>}
  </Box>}
 </Box>
}
