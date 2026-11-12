import {sharedMeetingsView} from './shared-meetings'
import {atom,read,update} from 'claude-code'
import {sharedCall,sharedReviewedEdit,inspectSharedCaller} from './shared-bridge'
import {beginTeamEdit,teamEditCommand,sharedTeamEditView} from './shared-team-edit'
import type {SharedProof} from './shared-bridge'
import {queueSharedDeliveries,sharedWakeObservation} from './shared-transport'
import {sharedQuestionsView} from './shared-questions'
import {sharedMailView} from './shared-mail'
import {USER_QUESTION_GUIDANCE} from './question-guidance'

export type MemberDraft={memberId:string;name:string;bossMemberId:string|null;role:string;officialText:string;cli?:'claude'|'codex'}
type Pending={request:any;label:string;management?:boolean}
export type Workspace={scope:string;busy:boolean;notice:string;error:boolean;caller:any;teams:any[];teamId:string;createdTeamId:string;snapshot:any;page:string;members:MemberDraft[];name:string;purpose:string;pickup:string;answer:string;window:string;replay:string;capacity:string;sessions:any[];sessionChoice:string;memberChoice:string;taskChoice:string;about:boolean;bindingMember:string;assignmentMember:string;instructions:string;expectedResult:string;selectedAssignment:string;reason:string;summary:string;evidence:string;verified:any;pending:Pending|null;retry:boolean;gateChoice:string;gateNote:string;gateDraft:{replaceId:string;question:string;options:string[]}|null;editor:any|null}
export type WorkspaceDependencies={enabled:boolean;node:string;orca:string;proof:Extract<SharedProof,{ok:true}>;controllerGeneration:number|null;revalidate:()=>Promise<SharedProof>;onNewTeam?:()=>Promise<void>}
type Dependencies=WorkspaceDependencies
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
const initial=():Workspace=>({scope:'',busy:false,notice:'',error:false,caller:null,teams:[],teamId:'',createdTeamId:'',snapshot:null,page:'home',members:[],name:'',purpose:'',pickup:'2',answer:'3',window:'',replay:'1000',capacity:'8',sessions:[],sessionChoice:'0',memberChoice:'',taskChoice:'',about:false,bindingMember:'',assignmentMember:'',instructions:'',expectedResult:'',selectedAssignment:'',reason:'',summary:'',evidence:'',verified:null,pending:null,retry:false,gateChoice:'',gateNote:'',gateDraft:null,editor:null})
const state=atom({plugin:'team-orchestrator',key:'sharedWorkspace'} as const,initial())
const valueOf=(response:any)=>response?.result?.result
const scopeOf=(proof:Extract<SharedProof,{ok:true}>)=>workspaceScope(proof.root,proof.sessionId)
export function workspaceScope(root:string,sessionId:string){return JSON.stringify([root.replace(/\\/g,'/'),sessionId])}
const referenceOf=(p:Extract<SharedProof,{ok:true}>)=>({projectRoot:p.root,conversationId:p.sessionId,terminalHandle:p.handle,contextId:p.contextId})
const uncertain=(response:any)=>['API_BRIDGE_UNKNOWN','STORE_COMMIT_UNKNOWN','STORE_ROLLBACK_UNKNOWN'].includes(String(response?.error?.code))
const failure=(r:any)=>`${r?.error?.message||'The operation was refused.'}${r?.error?.code?` (${r.error.code})`:''}`
// Native Input values are single-line text. Control keys or pasted line breaks
// must not poison a saved draft and cause the host to reject the entire panel.
export function workspaceLine(value:string){return String(value).replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,'')}
export function workspaceText(value:string){return String(value).replace(/\r\n?/g,'\n').replace(/\t/g,' ').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g,'')}
const fieldError=(message:string)=>{throw Error(message)}
const numberField=(text:string,label:string,min=1)=>{text=workspaceLine(text);if(!/^\d+$/.test(text.trim())||!Number.isSafeInteger(Number(text))||Number(text)<min)fieldError(`${label} must be a whole number of at least ${min}.`);return Number(text)}
async function set($:any,patch:Partial<Workspace>){await update($,state,old=>({...old,...patch}))}

async function lock($:any){let locked=false;await update($,state,old=>{if(old.busy)return old;locked=true;return {...old,busy:true,notice:'',error:false}});return locked}
async function proofNow(deps:Dependencies){
 if(!deps.enabled)throw Error('Turn the preview on before continuing.')
 const current=await deps.revalidate()
 if(!current.ok)throw Error(current.reason)
 if(JSON.stringify(referenceOf(current))!==JSON.stringify(referenceOf(deps.proof)))throw Error('The native conversation changed. Check access again.')
 return current
}
async function request($:any,deps:Dependencies,command:any,extra:any={}){
 return sharedCall($,await proofNow(deps),{operationId:`workspace-read-${uid()}`,command,...extra},deps)
}
async function load($:any,deps:Dependencies,preferred?:string){
 const caller=await inspectSharedCaller($,await proofNow(deps),deps)
 if(!caller.ok)throw Error(failure(caller))
 const info=valueOf(caller),old=await read($,state),teams=Array.isArray(info?.teams)?info.teams:[]
 const teamId=[preferred,old.teamId,info?.member?.team_id,teams[0]?.team_id].find(id=>id&&teams.some((t:any)=>t.team_id===id))||''
 // Drop old authority immediately, including when the subsequent read fails.
 await set($,{caller:info,teams,teamId,snapshot:null,sessions:[],verified:null})
 if(teamId){const team=await request($,deps,{type:'inspectTeam',teamId});if(!team.ok)throw Error(failure(team));const snapshot=valueOf(team);await set($,{snapshot,...(!old.caller&&!info?.controllerGeneration&&info?.member&&!snapshot?.members?.some((m:any)=>m.boss_member_id===info.member.member_id&&m.membership_state==='active')?{page:'tasks'}:{})})}
}
async function action($:any,work:()=>Promise<void>){
 if(!await lock($))return
 try{await work()}catch(error){await set($,{notice:error instanceof Error?error.message:String(error),error:true})}
 finally{await set($,{busy:false})}
}
async function committed($:any,deps:Dependencies,pending:Pending,result:any){
 const command=pending.request.command
 const notify=/Meeting/.test(command.type)||['admitAssignment','retryAssignment','reportOutcome','resolveGate','askQuestion','answerQuestion'].includes(command.type)
 const patch:Partial<Workspace>={pending:null,retry:false,page:'home',notice:`${pending.label} confirmed.`,error:false}
 if(command.type==='editTeam')patch.editor=null
 if(command.type==='createFreshTeam'){patch.teamId=command.teamId;patch.createdTeamId=command.teamId;patch.memberChoice='';patch.taskChoice='';patch.selectedAssignment='';patch.about=false;patch.notice='Team created. Launch a member or connect an existing session to start using tasks.'}
 if(command.type==='admitAssignment'){patch.selectedAssignment=command.assignmentId;patch.taskChoice=command.assignmentId;patch.reason='';patch.summary='';patch.evidence='';patch.verified=null}
 if(command.type==='retryAssignment'){patch.selectedAssignment=command.newAssignmentId;patch.taskChoice=command.newAssignmentId;patch.reason='';patch.summary='';patch.evidence='';patch.verified=null;patch.page='review'}
 if(command.type==='verifyAssignment'){patch.selectedAssignment=command.assignmentId;patch.verified=result;patch.page='review'}
 if(command.type==='reportOutcome'||command.type==='acceptTask')patch.selectedAssignment=command.assignmentId
 if(['openGate','replaceGate','resolveGate'].includes(command.type)){patch.page='review';patch.gateDraft=null;patch.gateNote='';patch.notice=command.type==='resolveGate'?(result.resumed?'Decision saved · task resumed.':'Decision saved · task remains blocked.'):'Decision gate saved · task blocked.'}
 await set($,patch)
 try{await load($,deps,command.teamId)}catch(error){await set($,{notice:`${pending.label} confirmed. Refresh the workspace to read the latest state.`,error:false});return}
 finally{if(notify)queueSharedDeliveries($,deps.proof,deps)}
 if(command.type==='verifyAssignment')await set($,{verified:result,page:'review'})
}
async function mutate($:any,deps:Dependencies,command:any,label:string,target?:any,management=false){
 const old=await read($,state)
 if(old.pending)throw Error('Check the pending operation receipt before making another change.')
 const proof=await proofNow(deps)
 const pending={request:{operationId:`workspace-${uid()}`,command,...(target?{target}:{})},label,...(management?{management:true}:{})}
 await set($,{pending,retry:false})
 let response:any
 try{response=management?await sharedReviewedEdit($,proof,pending.request,deps):await sharedCall($,proof,pending.request,deps)}catch(error){await set($,{pending:null});throw error}
 if(response.ok){await committed($,deps,pending,valueOf(response));return}
 if(uncertain(response)){await set($,{notice:`${label} is not confirmed. Check its receipt before making another change.`,error:true});return}
 await set($,{pending:null});throw Error(failure(response))
}
function authority(s:Workspace){
 const member=s.caller?.member,binding=s.caller?.binding
 if(!s.snapshot||member?.team_id!==s.teamId||!binding)throw Error('This conversation must be bound to a member of this team. Refresh after binding.')
 return {teamId:s.teamId,expectedConfigVersion:s.snapshot.team.config_version,expectedMemberGeneration:member.generation,expectedBindingGeneration:binding.generation}
}
function freshMembers():MemberDraft[]{
 const head=uid()
 return [{memberId:head,name:'Head',bossMemberId:null,role:'Lead and review',officialText:`Lead this team, delegate work to direct reports and review their evidence before accepting outcomes.\n\n${USER_QUESTION_GUIDANCE}`},{memberId:uid(),name:'Worker',bossMemberId:head,role:'Implement and verify',officialText:'Read your official role and admitted task brief before working. Report an explicit outcome with evidence to your direct head. Your head decides acceptance.'}]
}

export async function sharedWorkspaceView($:any,ui:any,deps:Dependencies){
 const {Box,Text,Button,Input,Select}=ui
 const wake=sharedWakeObservation(deps.proof)
 let s=await read($,state)
 const scope=scopeOf(deps.proof)
 if(s.scope!==scope){
  if(s.pending)return <Box borderStyle="round" borderColor="yellow" paddingX={1}><Text>A change from another conversation is still unconfirmed. Return to that conversation and check its receipt.</Text></Box>
  s={...initial(),scope}
 }
 function input(key:string,label:string,value:string,onInput:(v:string)=>any,placeholder=''){return <Box width="100%" flexDirection="column"><Input key={key} label={label} value={workspaceLine(value)} placeholder={placeholder||'Enter value'} onInput={(text:string)=>onInput(workspaceLine(text))} onSubmit={()=>{}}/></Box>}
 const edit=(key:keyof Workspace,value:any)=>set($,{[key]:value})
 function button(key:string,label:string,onPress:()=>Promise<any>,primary=false){return <Button key={key} label={workspaceLine(label)} variant={primary?'primary':undefined} onPress={async()=>{
  const current=await read($,state)
  if(current.busy)return
  if(current.scope!==scope){if(current.pending)return;await update($,state,()=>({...initial(),scope}))}
  await onPress()
 }}/>}
 const refresh=()=>action($,async()=>{await load($,deps);await set($,{notice:'Workspace refreshed.',error:false})})
 const snapshot=s.snapshot,members=snapshot?.members??[],bindings=snapshot?.bindings??[],work=snapshot?.work??[]
 const me=s.caller?.member?.team_id===s.teamId?s.caller.member:null
 const controller=Number.isSafeInteger(s.caller?.controllerGeneration)?s.caller.controllerGeneration:deps.controllerGeneration
 const direct=members.filter((m:any)=>me&&m.boss_member_id===me.member_id&&m.membership_state==='active')
 const selected=work.find((w:any)=>w.assignment.assignment_id===s.selectedAssignment)
 const retryReports=direct.filter((m:any)=>bindings.some((b:any)=>b.member_id===m.member_id))
 const retryMember=retryReports.find((m:any)=>m.member_id===s.assignmentMember)||retryReports.find((m:any)=>m.member_id===selected?.assignment.member_id)||retryReports[0]
 const memberMissing=!!s.memberChoice&&!members.some((m:any)=>m.member_id===s.memberChoice)
 const chosenMember=memberMissing?undefined:members.find((m:any)=>m.member_id===s.memberChoice)||direct[0]||me||members[0]
 const taskMissing=!!s.taskChoice&&!work.some((item:any)=>item.assignment.assignment_id===s.taskChoice)
 const chosenTask=taskMissing?undefined:work.find((item:any)=>item.assignment.assignment_id===s.taskChoice)||selected||work[0]
 const taskStatus=(item:any)=>item.acceptance?.decision==='rejected'?'Rejected':item.acceptance?item.task.status:item.returned||item.assignment.pickup_expired_at_ms?'Returned to head':item.task.status==='blocked'?'Decision needed':item.attempt.outcome?'Needs review':item.assignment.pickup_observed_at_ms?'In progress':'Awaiting pickup'
 const gates=selected?.gates??[],activeGates=gates.filter((g:any)=>!g.superseded_by_gate_id),gate=activeGates.find((g:any)=>g.gate_id===s.gateChoice)||activeGates.find((g:any)=>g.status==='open')||activeGates[0]
 const decidingHead=!!me&&selected?.assignment.assigned_by_member_id===me.member_id&&direct.some((m:any)=>m.member_id===selected.assignment.member_id)&&!work.some((w:any)=>w.assignment.previous_assignment_id===selected.assignment.assignment_id)
 const humanDecision=decidingHead&&me.boss_member_id===null
 const gateOptions=(value:any):string[]=>{try{const options=JSON.parse(value?.options_json);return Array.isArray(options)&&options.length>=2&&options.every((v:any)=>typeof v==='string'&&v.length)&&new Set(options).size===options.length?options:[]}catch{return []}}
 const gateAnswer=(value:any)=>{try{const answer=JSON.parse(value?.resolution_json);return typeof answer?.choice==='string'?`${answer.choice}${typeof answer.note==='string'&&answer.note?` · ${answer.note}`:''}`:'Recorded decision'}catch{return 'Recorded decision'}}
 const taskLabels=work.map((item:any)=>workspaceLine(`${members.find((m:any)=>m.member_id===item.assignment.member_id)?.name||'Member'} · ${taskStatus(item)} · ${Array.from(String(item.brief.instructions)).slice(0,40).join('')}`))
 const taskOptions=work.map((item:any,index:number)=>{
  const peers=work.filter((_:any,i:number)=>taskLabels[i]===taskLabels[index]),id=String(item.assignment.assignment_id)
  let length=6;while(peers.some((other:any)=>other.assignment.assignment_id!==id&&String(other.assignment.assignment_id).slice(-length)===id.slice(-length)))length+=2
  return {value:id,label:`${taskLabels[index]}${peers.length>1?` · #${id.slice(-length)}`:''}`}
 })
 const pending=s.pending
 const resume=(retry=false)=>action($,async()=>{
  const current=await read($,state),p=current.pending;if(!p)return
  const proof=await proofNow(deps)
  const response=p.management?(retry?await sharedReviewedEdit($,proof,p.request,deps):await sharedCall($,proof,p.request,{...deps,mode:'reconcileManagement'})):await sharedCall($,proof,p.request,{...deps,mode:retry?'execute':'reconcile'})
  if(response.ok&&response.result?.status!=='unknown'){await committed($,deps,p,valueOf(response));return}
  await set($,{retry:response.ok&&response.result?.status==='unknown',notice:response.ok?'No committed receipt found yet. Check again or retry the same operation.':failure(response),error:!response.ok})
 })
 return <Box flexDirection="column">
   {s.teams.length>0&&<Select key="workspace-team-select" label="Team " value={s.teamId} options={s.teams.map((team:any)=>({value:team.team_id,label:workspaceLine(team.name)}))} onSelect={async(value:string)=>action($,async()=>{await set($,{page:'home',memberChoice:'',taskChoice:'',selectedAssignment:'',reason:''});await load($,deps,value)})}/>}
  <Box flexWrap="wrap" columnGap={1}>
   {button('workspace-refresh',s.busy?'Working…':'Refresh',refresh)}
   {snapshot&&button('workspace-about',s.about?'Hide team info':'Team info',async()=>edit('about',!s.about))}
   {snapshot&&s.caller?.controllerGeneration&&!pending&&button('workspace-edit-team',s.page==='edit-team'?'Close edit':'Edit team',async()=>{if(s.editor?.teamId===s.teamId)await set($,{page:s.page==='edit-team'?'home':'edit-team'});else await set($,{editor:beginTeamEdit(snapshot,s.caller.controllerGeneration),page:'edit-team'})})}
   {!!controller&&!pending&&button('workspace-new',s.teams.length?'New team':'Create team',async()=>{if(deps.onNewTeam)await deps.onNewTeam();else await beginSharedDraft($)},s.teams.length===0)}
  </Box>
  {pending&&<Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
   <Text weight="bold" color="yellow">● {pending.label}: awaiting receipt</Text>
   <Text>Other changes are paused until this operation is confirmed.</Text>
   <Box flexWrap="wrap" columnGap={1}>{button('workspace-reconcile','Check receipt',()=>resume())}{s.retry&&button('workspace-retry','Retry same operation',()=>resume(true))}</Box>
  </Box>}
  {s.notice&&<Text color={s.error?'yellow':'green'}>{s.notice}</Text>}
  {wake&&<Box borderStyle="round" borderColor="yellow" flexDirection="column" paddingX={1}>
   <Text weight="bold">Project dispatcher · {wake.lastError||wake.dispatcher?.project?.state==='needs-attention'?'Needs attention':wake.dispatcher?.connected?'Connected':'Waiting for receiver'}</Text>
   <Text dimColor>One local scheduler · recipients keep their own read receipts</Text>
   <Text weight="bold">Inbox wake-up · {wake.stale?'Needs refresh':wake.results.some(r=>r.state==='host-update-required')?'Waiting for Orca update':wake.results.every(r=>r.state==='settled-or-ineligible')?'No pending wake':wake.results.some(r=>['needs-attention','needs-reconciliation'].includes(r.state))?'Needs attention':'Checking inbox progress'}</Text>
   <Text dimColor>{wake.stale?'The last observation is old. Refresh before drawing conclusions.':wake.results.some(r=>r.state==='host-update-required')?'Automatic sends are blocked until Orca supports verified target delivery. Messages stay in the inbox.':'A wake-up is separate from reading a message or starting its assignment.'}</Text>
  </Box>}
  {s.caller?.recovery&&<Box borderStyle="round" borderColor="yellow" flexDirection="column"><Text weight="bold">Reconnect this conversation</Text><Text>Its saved member binding belongs to an earlier runtime. Choose the original member and a verified session below to reconnect. Team work stays unavailable until that connection is confirmed.</Text></Box>}
  {!s.caller&&<Text dimColor>Refresh to load your teams. Nothing is created by refreshing.</Text>}
  {s.page==='new'&&!pending?<Box flexDirection="column"><Text>A team draft is saved.</Text>{deps.onNewTeam&&button('workspace-resume-setup','Continue setup',deps.onNewTeam,true)}</Box>:<Box flexDirection="column">
   {s.caller&&!s.teams.length&&<Text dimColor>{controller?'No teams yet. Create your first shared team.':'No team binding for this conversation. Ask an approved controller to bind it.'}</Text>}
   {snapshot&&<Box flexDirection="column">
    <Text dimColor>{members.length} members · {bindings.length} connected · {new Set(work.map((item:any)=>item.task.task_id)).size} tasks · {work.length} attempts</Text>
    {s.about&&snapshot.team.function_text&&<Text>{snapshot.team.function_text}</Text>}
    <Box flexWrap="wrap" columnGap={1}>{button('workspace-roster-tab',s.page==='home'?'● Members':'Members',async()=>edit('page','home'))}{button('workspace-tasks-tab',s.page==='tasks'||s.page==='review'?'● Tasks':'Tasks',async()=>edit('page','tasks'))}{me&&button('workspace-meetings-tab',s.page==='meetings'?'● Meetings':'Meetings',async()=>edit('page','meetings'))}{me&&button('workspace-inbox-tab',s.page==='inbox'?'● Inbox':'Inbox',async()=>edit('page','inbox'))}</Box>
    {s.page==='edit-team'&&s.editor&&!pending&&await sharedTeamEditView(ui,{draft:s.editor,stale:s.editor.teamId!==s.teamId||s.editor.version!==snapshot.team.config_version||s.editor.controller!==s.caller?.controllerGeneration,onPatch:async(patch:any)=>{await update($,state,current=>current.busy||current.scope!==scope||current.editor?.teamId!==s.editor.teamId?current:{...current,editor:{...current.editor,...patch}})},onReview:()=>action($,async()=>{const current=await read($,state),draft=current.editor;if(!draft||draft.teamId!==current.teamId||draft.version!==current.snapshot?.team.config_version||draft.controller!==current.caller?.controllerGeneration)throw Error('Refresh and reopen Edit team before reviewing a changed configuration.');await set($,{editor:{...draft,command:teamEditCommand(draft),tab:'review'}})}),onCancel:async()=>{await update($,state,current=>current.busy||current.scope!==scope||current.editor?.teamId!==s.editor.teamId?current:{...current,editor:null,page:'home'})},onSave:()=>action($,async()=>{const current=await read($,state),draft=current.editor;if(!draft?.command||draft.teamId!==current.teamId||draft.version!==current.snapshot?.team.config_version||draft.controller!==current.caller?.controllerGeneration)throw Error('Team configuration or approval changed. Cancel and reopen Edit team.');await mutate($,deps,draft.command,'Team edit',undefined,true)})})}
    {s.page==='meetings'&&me&&!pending&&await sharedMeetingsView($,ui,{scope:`${scope}:${s.teamId}`,me,snapshot,onRead:async(command:any)=>{const response=await request($,deps,{teamId:s.teamId,...command});if(!response.ok)throw Error(failure(response));return valueOf(response)},onCommand:async(command:any)=>{let failed:any,confirmed=false;await action($,async()=>{try{const current=await read($,state);await mutate($,deps,{...authority(current),...command},'Meeting');if((await read($,state)).pending)throw Error('Meeting change is unconfirmed. Check its receipt before continuing.');confirmed=true;await edit('page','meetings')}catch(error){failed=error;throw error}});if(failed)throw failed;if(!confirmed)throw Error('Another workspace action is still running. Try again when it finishes.')}})}
    {s.page==='inbox'&&me&&!pending&&<Box flexDirection="column">{await sharedMailView($,ui,deps,members)}{await sharedQuestionsView($,ui,{scope,me,snapshot,onCommand:async(command:any)=>action($,async()=>{const current=await read($,state);await mutate($,deps,{...authority(current),...command},command.type==='askQuestion'?'Question':command.type==='answerQuestion'?'Answer':'Notice');await edit('page','inbox')})})}</Box>}
    {s.page==='home'&&members.length>0&&<Box flexDirection="column">
     {memberMissing&&<Text color="yellow">The selected member is no longer visible. Refresh or choose a member to continue.</Text>}
     <Select key="workspace-member-select" label="Member " value={chosenMember?.member_id} options={members.map((m:any)=>({value:m.member_id,label:workspaceLine(`${m.name}${me?.member_id===m.member_id?' · You':''} · ${bindings.some((b:any)=>b.member_id===m.member_id)?'Connected':'Not connected'}`)}))} onSelect={async(value:string)=>{if(!s.busy)await edit('memberChoice',value)}}/>
     {members.filter((m:any)=>m.member_id===chosenMember?.member_id).map((m:any)=>{
      const binding=bindings.find((b:any)=>b.member_id===m.member_id),boss=members.find((b:any)=>b.member_id===m.boss_member_id)
      const setup=snapshot.workerReadiness?.find((r:any)=>r.memberId===m.member_id),ready=!setup?.covered||(setup.state==='ready'&&!setup.setupPending)
      const setupLabel=setup?.setupPending?'Setup queued':({queued:'Queued',starting:'Starting',checking:'Checking tools',ready:'Ready',setup_required:'Setup needed',disconnected:'Disconnected'} as Record<string,string>)[setup?.state]||'Checking tools'
      return <Box key={m.member_id} flexDirection="column">
       <Text weight="bold">{m.name}{me?.member_id===m.member_id?' · You':''} · {m.role}</Text>
       <Text dimColor>{boss?`Reports to ${boss.name}`:'Team head'} · {binding?'Session linked':'Not connected'}</Text>
       {setup?.covered&&<Box borderStyle="round" borderColor={ready?'green':'yellow'} paddingX={1}><Text color={ready?'green':'yellow'}>{setupLabel}</Text></Box>}
       <Box flexWrap="wrap" columnGap={1}>
        {!!controller&&m.cli!=='codex'&&!binding&&!pending&&button(`workspace-launch-${m.member_id}`,(snapshot.launches??[]).some((l:any)=>l.member_id===m.member_id)?'Check launch':'Launch session',()=>action($,async()=>{
         const current=await read($,state),member=current.snapshot.members.find((x:any)=>x.member_id===m.member_id)
         const response=await sharedCall($,await proofNow(deps),{operationId:`launch-reserve-${uid()}`,command:{type:'reserveLaunch',teamId:current.teamId,memberId:member.member_id,launchId:uid(),expectedConfigVersion:current.snapshot.team.config_version,expectedMemberGeneration:member.generation,expectedControllerGeneration:controller}},{...deps,mode:'launchMember'})
         if(!response.ok)throw Error(failure(response))
         await load($,deps,current.teamId)
         await set($,{notice:response.result.queued?'Waiting for capacity. No session was closed.':response.result.unknown?'Launch result unknown. The reserved start will not be repeated.':response.result.launch?.status==='bound'?'Session connected.':'Session starting. Refresh to see its verified connection.',error:!!response.result.unknown})
         queueSharedDeliveries($,deps.proof,deps)
        }),true)}
        {(snapshot.launches??[]).filter((l:any)=>l.member_id===m.member_id&&!binding).map((l:any)=><Text key={`launch-status-${m.member_id}`} dimColor>{l.status==='queued'?'Queued · waiting for capacity':'Starting · awaiting verified session'}</Text>)}
        {!!controller&&!pending&&button(`workspace-bind-${m.member_id}`,binding?'Change session':'Connect session',()=>action($,async()=>{
         await set($,{memberChoice:m.member_id,bindingMember:m.member_id,sessions:[],sessionChoice:'0',page:'bind'})
         const response=await sharedCall($,await proofNow(deps),{},{...deps,mode:'listSessions'})
         if(!response.ok)throw Error(failure(response))
         const member=(await read($,state)).snapshot?.members.find((x:any)=>x.member_id===m.member_id)
         await set($,{sessions:(response.result?.sessions??[]).filter((candidate:any)=>(candidate.provider||'claude')===(member?.cli||'claude'))})
        }),!binding)}
        {!pending&&binding&&ready&&direct.some((d:any)=>d.member_id===m.member_id)&&button(`workspace-assign-${m.member_id}`,'Assign task',async()=>set($,{memberChoice:m.member_id,page:'assign',assignmentMember:m.member_id,instructions:'',expectedResult:''}),true)}
        {!pending&&setup?.covered&&!ready&&button(`workspace-check-tools-${m.member_id}`,'Check tools',()=>action($,async()=>load($,deps,s.teamId)))}
       </Box>
      </Box>
     })}
    </Box>}
    {s.page==='bind'&&!pending&&!members.some((m:any)=>m.member_id===s.bindingMember)&&<Box flexDirection="column"><Text color="yellow">The selected member is no longer visible.</Text>{button('workspace-bind-cancel','Back to Members',async()=>edit('page','home'))}</Box>}
    {s.page==='bind'&&!pending&&members.some((m:any)=>m.member_id===s.bindingMember)&&<Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
     <Text weight="bold">Bind {members.find((m:any)=>m.member_id===s.bindingMember)?.name}</Text>
     {members.find((m:any)=>m.member_id===s.bindingMember)?.cli==='codex'&&<Text color="yellow">Codex preview: configure and trust its team permission hook before connecting.</Text>}
     <Text dimColor>Choose a verified local Claude or Codex session, then Connect selected session. No session is launched or messaged.</Text>
     {!s.sessions.length&&<Text color="yellow">No eligible sessions found. The session needs an explicit native provider conversation association. Refresh the workspace and try again after it is available.</Text>}
     {s.sessions.length>0&&<Box flexDirection="column">
      <Select key="workspace-session-select" label="Session " value={s.sessionChoice||'0'} options={s.sessions.map((session:any,i:number)=>({value:String(i),label:workspaceLine(session.label||`Session ${i+1}`)}))} onSelect={async(value:string)=>set($,{sessionChoice:value})}/>
      {button('workspace-session-0','Connect selected session',()=>action($,async()=>{
       const current=await read($,state),index=Number(current.sessionChoice||'0'),session=current.sessions[index]
       if(!Number.isSafeInteger(index)||!session)fieldError('Refresh session choices before connecting.')
       const m=current.snapshot.members.find((m:any)=>m.member_id===current.bindingMember)
       if(!m)fieldError('The selected member is no longer visible. Refresh and choose a member.')
       const b=current.snapshot.bindings.find((b:any)=>b.member_id===m.member_id)
       await mutate($,deps,{type:'bindMember',teamId:current.teamId,memberId:m.member_id,expectedConfigVersion:current.snapshot.team.config_version,expectedMemberGeneration:m.generation,expectedBindingGeneration:b?.generation??0,expectedControllerGeneration:controller},'Session binding',session.reference)
      }),true)}
     </Box>}
     {button('workspace-bind-cancel','Back to Members',async()=>edit('page','home'))}
    </Box>}
    {s.page==='assign'&&!pending&&!members.some((m:any)=>m.member_id===s.assignmentMember)&&<Box flexDirection="column"><Text color="yellow">The selected member is no longer visible.</Text>{button('workspace-assignment-cancel','Back to Members',async()=>edit('page','home'))}</Box>}
    {s.page==='assign'&&!pending&&members.some((m:any)=>m.member_id===s.assignmentMember)&&<Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
     <Text weight="bold">Assign to {members.find((m:any)=>m.member_id===s.assignmentMember)?.name}</Text>
     {input('workspace-instructions','Task instructions',s.instructions,v=>edit('instructions',v))}
     {input('workspace-expected','Expected result / acceptance criteria',s.expectedResult,v=>edit('expectedResult',v))}
     <Text dimColor>Saves the assignment and queues its delivery. The worker reads the official role and brief at pickup.</Text>
     <Box flexWrap="wrap" columnGap={1}>{button('workspace-admit','Assign task',()=>action($,async()=>{
      const current=await read($,state);if(!workspaceLine(current.instructions).trim()||!workspaceLine(current.expectedResult).trim())fieldError('Enter task instructions and an expected result.')
      const m=current.snapshot.members.find((m:any)=>m.member_id===current.assignmentMember)
      if(!m)fieldError('The selected member is no longer visible. Refresh and choose a member.')
      const b=current.snapshot.bindings.find((b:any)=>b.member_id===m.member_id)
      if(!b)fieldError('Bind the worker before assigning a task.')
      await mutate($,deps,{type:'admitAssignment',...authority(current),runId:uid(),taskId:uid(),assignmentId:uid(),memberId:m.member_id,instructions:workspaceLine(current.instructions).trim(),expectedResult:workspaceLine(current.expectedResult).trim(),expectedTargetGeneration:m.generation,expectedTargetBindingGeneration:b.generation},'Task assignment')
      if(!(await read($,state)).pending)await edit('page','tasks')
     }),true)}{button('workspace-assignment-cancel','Cancel',async()=>edit('page','home'))}</Box>
    </Box>}
    {(s.page==='tasks'||s.page==='review')&&<Box flexDirection="column">
     <Text dimColor>Your assignments and work you admitted to current direct reports · newest 100</Text>
     {!work.length&&<Text dimColor>No visible tasks. Controller approval alone does not grant access to worker evidence.</Text>}
     {(taskMissing||s.page==='review'&&!!s.selectedAssignment&&!selected)&&<Text color="yellow">The selected task is no longer visible. Refresh or choose a task to continue.</Text>}
     {work.length>0&&<Box flexDirection="column">
      <Select key="workspace-task-select" label="Task " value={chosenTask?.assignment.assignment_id} options={taskOptions} onSelect={async(value:string)=>{if(!s.busy)await set($,{page:'tasks',taskChoice:value})}}/>
      {chosenTask&&(s.page!=='review'||!selected)&&<Box flexDirection="column"><Text>{String(chosenTask.brief.instructions).slice(0,180)}</Text>{button(`workspace-task-${chosenTask.assignment.assignment_id}`,'Open task',async()=>{
       const current=await read($,state),id=chosenTask.assignment.assignment_id
       await set($,{page:'review',taskChoice:id,selectedAssignment:id,...(current.selectedAssignment!==id?{reason:'',summary:'',evidence:'',verified:null,gateDraft:null,gateNote:'',gateChoice:''}:{})})
      })}</Box>}
     </Box>}
     {s.page==='review'&&selected&&<Box flexDirection="column">
      <Text weight="bold">{taskStatus(selected)}</Text>{button('workspace-task-back','Back to task list',async()=>edit('page','tasks'))}<Text>{selected.brief.instructions}</Text><Text weight="bold">Expected result</Text><Text>{selected.brief.expected_result}</Text>
      {activeGates.length>0&&<Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
       <Text weight="bold">Decisions · {activeGates.filter((g:any)=>g.status==='open').length} unanswered</Text>
       <Select key="workspace-gate-select" label="Decision " value={gate?.gate_id} options={activeGates.map((g:any)=>({value:g.gate_id,label:workspaceLine(`${g.status==='open'?'●':'✓'} ${g.question}`)}))} onSelect={async(value:string)=>set($,{gateChoice:value,gateNote:''})}/>
       {gate&&<Text>{gate.question}</Text>}
       {gate?.status==='resolved'?<Text color="green">{gateAnswer(gate)}</Text>:gate&&<Box flexDirection="column">
        {!humanDecision&&<Text dimColor>Waiting for the head to relay the user's decision. This task stays blocked.</Text>}
        {humanDecision&&!pending&&<Box flexDirection="column">
         {input('workspace-gate-note','Note · optional',s.gateNote,v=>edit('gateNote',v))}
         <Box flexWrap="wrap" columnGap={1}>{gateOptions(gate).map((choice,index)=>button(`workspace-gate-choice-${index}`,choice,()=>action($,async()=>{
          const current=await read($,state),item=current.snapshot.work.find((w:any)=>w.assignment.assignment_id===current.selectedAssignment),fresh=item.gates.find((g:any)=>g.gate_id===gate.gate_id)
          if(!fresh||fresh.status!=='open'||fresh.superseded_by_gate_id)fieldError('Refresh to read the current decision.')
          await mutate($,deps,{...authority(current),type:'resolveGate',gateId:fresh.gate_id,expectedGateGeneration:fresh.generation,choice,note:workspaceLine(current.gateNote)},'Decision')
         })))}</Box>
         {button('workspace-gate-replace','Offer different choices',async()=>edit('gateDraft',{replaceId:gate.gate_id,question:gate.question,options:['','']}))}
        </Box>}
       </Box>}
       {gates.some((g:any)=>g.superseded_by_gate_id)&&<Text dimColor>Earlier choices are preserved in the task history.</Text>}
      </Box>}
      {decidingHead&&!pending&&!selected.returned&&!selected.acceptance&&['open','blocked'].includes(selected.task.status)&&!s.gateDraft&&button('workspace-gate-new','Add decision gate',async()=>edit('gateDraft',{replaceId:'',question:'',options:['','']}))}
      {s.gateDraft&&decidingHead&&!pending&&<Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
       <Text weight="bold">{s.gateDraft.replaceId?'Replace choices':'New decision gate'}</Text>
       {input('workspace-gate-question','Question',s.gateDraft.question,v=>edit('gateDraft',{...s.gateDraft!,question:v}))}
       {s.gateDraft.options.map((option,index)=>input(`workspace-gate-option-${index}`,`Choice ${index+1}`,option,v=>edit('gateDraft',{...s.gateDraft!,options:s.gateDraft!.options.map((x,i)=>i===index?v:x)})))}
       {button('workspace-gate-add-option','Add choice',async()=>edit('gateDraft',{...s.gateDraft!,options:[...s.gateDraft!.options,'']}))}
       <Text dimColor>The task pauses until every decision is answered. Its deadlines keep running.</Text>
       <Box flexWrap="wrap" columnGap={1}>{button('workspace-gate-save','Save gate',()=>action($,async()=>{
        const current=await read($,state),draft=current.gateDraft;if(!draft)return
        const item=current.snapshot.work.find((w:any)=>w.assignment.assignment_id===current.selectedAssignment),options=draft.options.map(v=>workspaceLine(v).trim()),question=workspaceLine(draft.question).trim()
        if(!question||options.some(v=>!v)||new Set(options).size!==options.length)fieldError('Enter a question and distinct, nonempty choices.')
        const old=draft.replaceId?item.gates.find((g:any)=>g.gate_id===draft.replaceId):null
        if(draft.replaceId&&!old)fieldError('Refresh to find the original gate.')
        await mutate($,deps,{...authority(current),question,options,...(old?{type:'replaceGate',gateId:old.gate_id,newGateId:uid(),expectedGateGeneration:old.generation}:{type:'openGate',assignmentId:item.assignment.assignment_id,gateId:uid(),expectedAttemptGeneration:item.attempt.generation})},'Decision gate')
       }),true)}{button('workspace-gate-cancel','Cancel',async()=>edit('gateDraft',null))}</Box>
      </Box>}
      {selected.attempt.outcome&&<Box flexDirection="column"><Text weight="bold" color="yellow">Worker outcome · {selected.attempt.outcome}</Text><Text>{selected.attempt.summary}</Text><Text weight="bold">Evidence</Text><Text>{selected.attempt.evidence}</Text></Box>}
       {selected.assignment.pickup_expired_at_ms&&<Text color="yellow">Pickup window expired · returned to the head for reassignment.</Text>}
       {!pending&&(selected.returned||selected.assignment.pickup_expired_at_ms)&&(selected.returned?.returned_to_member_id??selected.assignment.returned_to_member_id)===me?.member_id&&!work.some((item:any)=>item.assignment.previous_assignment_id===selected.assignment.assignment_id)&&<Box flexDirection="column">
        {retryReports.length>0&&<Select key="workspace-retry-target" label="Reassign to " value={retryMember?.member_id} options={retryReports.map((m:any)=>({value:m.member_id,label:workspaceLine(m.name)}))} onSelect={async(value:string)=>edit('assignmentMember',value)}/>}
        {retryReports.length===0&&<Text dimColor>Connect a direct report before reassigning this task.</Text>}
        {retryReports.length>0&&button('workspace-retry-assignment','Reassign task',()=>action($,async()=>{
         const current=await read($,state),item=current.snapshot.work.find((w:any)=>w.assignment.assignment_id===current.selectedAssignment)
         const candidates=current.snapshot.members.filter((m:any)=>m.boss_member_id===current.caller.member.member_id&&m.membership_state==='active'&&current.snapshot.bindings.some((b:any)=>b.member_id===m.member_id))
         const target=candidates.find((m:any)=>m.member_id===current.assignmentMember)||candidates.find((m:any)=>m.member_id===item.assignment.member_id)||candidates[0],targetId=target?.member_id,binding=current.snapshot.bindings.find((b:any)=>b.member_id===targetId)
         if(!target||!binding)fieldError('Choose a connected direct report for this task.')
         await mutate($,deps,{...authority(current),type:'retryAssignment',assignmentId:item.assignment.assignment_id,newAssignmentId:uid(),memberId:targetId,expectedAttemptGeneration:item.attempt.generation,expectedTargetGeneration:target.generation,expectedTargetBindingGeneration:binding.generation},'Task reassignment')
        }),true)}
       </Box>}
      {selected.acceptance?<Box flexDirection="column"><Text weight="bold" color={selected.acceptance.decision==='accepted'?'green':'yellow'}>Head decision · {selected.acceptance.decision}</Text><Text>{selected.acceptance.reason}</Text></Box>:!pending&&<Box flexDirection="column">
       {me?.member_id===selected.assignment.member_id&&selected.task.status==='open'&&!selected.attempt.outcome&&!selected.returned&&!selected.assignment.pickup_expired_at_ms&&<Box flexDirection="column">
        {!selected.assignment.pickup_observed_at_ms?button('workspace-pickup','Pick up · read role and brief',()=>action($,async()=>{
         const current=await read($,state),item=current.snapshot.work.find((w:any)=>w.assignment.assignment_id===current.selectedAssignment)
         await mutate($,deps,{type:'verifyAssignment',...authority(current),assignmentId:item.assignment.assignment_id,expectedAttemptGeneration:item.attempt.generation},'Task pickup')
        }),true):<Box flexDirection="column">
         <Text weight="bold">Official role · read before working</Text><Text>{snapshot.roles.find((r:any)=>r.member_id===me.member_id)?.official_text||s.verified?.role?.official_text||'Refresh to read the official role.'}</Text>
         <Text dimColor>Read the role, instructions and expected result above before task work. Report only after checking the result.</Text>
         {input('workspace-summary','Outcome summary',s.summary,v=>edit('summary',v))}{input('workspace-evidence','Evidence',s.evidence,v=>edit('evidence',v))}
         <Box flexWrap="wrap" columnGap={1}>{['succeeded','failed'].map(outcome=>button(`workspace-report-${outcome}`,`Report ${outcome}`,()=>action($,async()=>{
          const current=await read($,state);if(!workspaceLine(current.summary).trim()||!workspaceLine(current.evidence).trim())fieldError('Enter an outcome summary and evidence.')
          const item=current.snapshot.work.find((w:any)=>w.assignment.assignment_id===current.selectedAssignment)
          await mutate($,deps,{type:'reportOutcome',...authority(current),assignmentId:item.assignment.assignment_id,expectedAttemptGeneration:item.attempt.generation,outcome,summary:workspaceLine(current.summary).trim(),evidence:workspaceLine(current.evidence).trim()},'Worker outcome')
          if(!(await read($,state)).pending)await edit('page','tasks')
         })))}</Box>
        </Box>}
       </Box>}
       {me&&selected.task.status==='open'&&selected.assignment.assigned_by_member_id===me.member_id&&direct.some((m:any)=>m.member_id===selected.assignment.member_id)&&selected.attempt.outcome&&<Box flexDirection="column">
        {input('workspace-reason','Review reason · required',s.reason,v=>edit('reason',v))}
        <Box flexWrap="wrap" columnGap={1}>{['accepted','rejected'].map(decision=>button(`workspace-${decision}`,decision==='accepted'?'Accept outcome':'Reject outcome',()=>action($,async()=>{
         const current=await read($,state);if(!workspaceLine(current.reason).trim())fieldError('Enter why you accept or reject this outcome.')
         const item=current.snapshot.work.find((w:any)=>w.assignment.assignment_id===current.selectedAssignment)
         await mutate($,deps,{type:'acceptTask',...authority(current),assignmentId:item.assignment.assignment_id,expectedAttemptGeneration:item.attempt.generation,decision,reason:workspaceLine(current.reason).trim()},'Head review')
         if(!(await read($,state)).pending)await edit('page','tasks')
        }),decision==='accepted'))}</Box>
       </Box>}
      </Box>}
     </Box>}
    </Box>}
   </Box>}
  </Box>}
 </Box>
}

export async function readSharedWorkspace($:any){return read($,state)}
export async function patchSharedDraft($:any,patch:Partial<Workspace>){await set($,patch)}
export async function editSharedMember($:any,id:string,patch:Partial<MemberDraft>){await update($,state,old=>({...old,members:old.members.map(m=>m.memberId===id?{...m,...patch}:m)}))}
export async function addSharedMember($:any){await update($,state,old=>({...old,members:[...old.members,{memberId:uid(),name:`Worker ${old.members.length}`,bossMemberId:old.members[0].memberId,role:'Implement and verify',officialText:'Read your role and brief before work. Report an explicit outcome and evidence to your direct head.'}]}))}
export async function removeSharedMember($:any,id:string){await update($,state,old=>({...old,members:old.members.filter(m=>m.memberId!==id).map(m=>m.bossMemberId===id?{...m,bossMemberId:old.members[0].memberId}:m)}))}
export async function beginSharedDraft($:any,fresh=false){
 const scope=workspaceScope(String(await $.session.root()),String(await $.session.id()))
 const old=await read($,state)
 if(old.pending)throw Error('Resolve the pending operation before starting a draft.')
 if(!fresh&&old.scope===scope&&old.page==='new'&&old.members.length)return
 await update($,state,()=>({...((old.scope===scope)?old:initial()),scope,page:'new',createdTeamId:'',members:freshMembers(),name:'',purpose:'',notice:'',error:false}))
}
export function sharedDraftSettings(current:Workspace){return {autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:numberField(current.capacity,'Capacity',0),launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.claude/scratch',pickupWindowMinutes:numberField(current.pickup,'Pickup window'),answerWindowMinutes:numberField(current.answer,'Answer window'),taskWindowMinutes:current.window.trim()?numberField(current.window,'Task window'):null,replayIntervalMs:numberField(current.replay,'Replay interval'),exemptMemberIds:[]}}
export function sharedDraftProblem(current:Workspace,step:number):{message:string;field:string}|null{
 if(step===0&&!workspaceLine(current.name).trim())return {message:'Give your team a name.',field:'workspace-team-name'}
 if(step===1){
  for(let i=0;i<current.members.length;i++){const m=current.members[i];if(!workspaceLine(m.name).trim()||!workspaceLine(m.role).trim()||!workspaceText(m.officialText).trim())return {message:'Every member needs a name, role and official instructions.',field:`workspace-member-name-${i}`}}
  if(new Set(current.members.map(m=>workspaceLine(m.name).trim().toLowerCase())).size!==current.members.length)return {message:'Member names must be unique.',field:'workspace-member-name-1'}
 }
 if(step===2){try{sharedDraftSettings(current)}catch(error){return {message:error instanceof Error?error.message:String(error),field:!/^\d+$/.test(current.capacity)||Number(current.capacity)<0?'workspace-capacity':!/^\d+$/.test(current.pickup)||Number(current.pickup)<1?'workspace-pickup':!/^\d+$/.test(current.answer)||Number(current.answer)<1?'workspace-answer':current.window.trim()&&(!/^\d+$/.test(current.window)||Number(current.window)<1)?'workspace-window':'workspace-replay'}}}
 return null
}
export async function submitSharedDraft($:any,deps:Dependencies){
 await action($,async()=>{
  const current=await read($,state)
  for(const step of [0,1,2]){const problem=sharedDraftProblem(current,step);if(problem)fieldError(problem.message)}
  await mutate($,deps,{type:'createFreshTeam',teamId:uid(),name:workspaceLine(current.name).trim(),functionText:workspaceText(current.purpose).trim(),members:current.members.map(m=>({...m,name:workspaceLine(m.name).trim(),role:workspaceLine(m.role).trim(),officialText:workspaceText(m.officialText).trim()})),settings:sharedDraftSettings(current),expectedControllerGeneration:deps.controllerGeneration},'Team creation')
 })
 return read($,state)
}
export async function reconcileSharedDraft($:any,deps:Dependencies,retry=false){
 await action($,async()=>{
  const current=await read($,state),p=current.pending;if(!p)return
  const response=await sharedCall($,await proofNow(deps),p.request,{...deps,mode:retry?'execute':'reconcile'})
  if(response.ok&&response.result?.status!=='unknown'){await committed($,deps,p,valueOf(response));return}
  await set($,{retry:response.ok&&response.result?.status==='unknown',notice:response.ok?'No committed receipt found yet. Check again or retry the same operation.':failure(response),error:!response.ok})
 })
 return read($,state)
}
export async function refreshSharedWorkspace($:any,deps:Dependencies){
 const old=await read($,state),scope=scopeOf(deps.proof)
 if(old.scope!==scope){if(old.pending)return;await update($,state,()=>({...initial(),scope}))}
 await action($,async()=>load($,deps))
}
