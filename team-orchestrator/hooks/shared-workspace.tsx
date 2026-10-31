import {atom,read,update} from 'claude-code'
import {sharedCall} from './shared-bridge'
import type {SharedProof} from './shared-bridge'

type MemberDraft={memberId:string;name:string;bossMemberId:string|null;role:string;officialText:string}
type Pending={request:any;label:string}
export type Workspace={scope:string;busy:boolean;notice:string;error:boolean;caller:any;teams:any[];teamId:string;snapshot:any;page:string;members:MemberDraft[];name:string;purpose:string;pickup:string;answer:string;window:string;replay:string;capacity:string;sessions:any[];bindingMember:string;assignmentMember:string;instructions:string;expectedResult:string;selectedAssignment:string;reason:string;summary:string;evidence:string;verified:any;pending:Pending|null;retry:boolean}
type Dependencies={enabled:boolean;node:string;orca:string;proof:Extract<SharedProof,{ok:true}>;controllerGeneration:number|null;revalidate:()=>Promise<SharedProof>}
const uid=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('')
const initial=():Workspace=>({scope:'',busy:false,notice:'',error:false,caller:null,teams:[],teamId:'',snapshot:null,page:'home',members:[],name:'',purpose:'',pickup:'2',answer:'3',window:'',replay:'1000',capacity:'8',sessions:[],bindingMember:'',assignmentMember:'',instructions:'',expectedResult:'',selectedAssignment:'',reason:'',summary:'',evidence:'',verified:null,pending:null,retry:false})
const state=atom({plugin:'team-orchestrator',key:'sharedWorkspace'} as const,initial())
const valueOf=(response:any)=>response?.result?.result
const scopeOf=(proof:Extract<SharedProof,{ok:true}>)=>JSON.stringify([proof.root,proof.sessionId])
const referenceOf=(p:Extract<SharedProof,{ok:true}>)=>({projectRoot:p.root,conversationId:p.sessionId,terminalHandle:p.handle,contextId:p.contextId})
const uncertain=(response:any)=>['API_BRIDGE_UNKNOWN','STORE_COMMIT_UNKNOWN','STORE_ROLLBACK_UNKNOWN'].includes(String(response?.error?.code))
const failure=(r:any)=>`${r?.error?.message||'The operation was refused.'}${r?.error?.code?` (${r.error.code})`:''}`
// Native Input values are single-line text. Control keys or pasted line breaks
// must not poison a saved draft and cause the host to reject the entire panel.
export function workspaceLine(value:string){return String(value).replace(/[\r\n\t]+/g,' ').replace(/[\u0000-\u001f\u007f-\u009f]/g,'')}
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
 const caller=await request($,deps,{type:'inspectCaller'})
 if(!caller.ok)throw Error(failure(caller))
 const info=valueOf(caller),old=await read($,state),teams=Array.isArray(info?.teams)?info.teams:[]
 const teamId=[preferred,old.teamId,info?.member?.team_id,teams[0]?.team_id].find(id=>id&&teams.some((t:any)=>t.team_id===id))||''
 // Drop old authority immediately, including when the subsequent read fails.
 await set($,{caller:info,teams,teamId,snapshot:null,sessions:[],verified:null})
 if(teamId){const team=await request($,deps,{type:'inspectTeam',teamId});if(!team.ok)throw Error(failure(team));await set($,{snapshot:valueOf(team)})}
}
async function action($:any,work:()=>Promise<void>){
 if(!await lock($))return
 try{await work()}catch(error){await set($,{notice:error instanceof Error?error.message:String(error),error:true})}
 finally{await set($,{busy:false})}
}
async function committed($:any,deps:Dependencies,pending:Pending,result:any){
 const command=pending.request.command
 const patch:Partial<Workspace>={pending:null,retry:false,page:'home',notice:`${pending.label} confirmed.`,error:false}
 if(command.type==='createFreshTeam')patch.teamId=command.teamId
 if(command.type==='admitAssignment')patch.selectedAssignment=command.assignmentId
 if(command.type==='verifyAssignment'){patch.selectedAssignment=command.assignmentId;patch.verified=result;patch.page='review'}
 if(command.type==='reportOutcome'||command.type==='acceptTask')patch.selectedAssignment=command.assignmentId
 await set($,patch)
 try{await load($,deps,command.teamId)}catch(error){await set($,{notice:`${pending.label} confirmed. Refresh the workspace to read the latest state.`,error:false});return}
 if(command.type==='verifyAssignment')await set($,{verified:result,page:'review'})
}
async function mutate($:any,deps:Dependencies,command:any,label:string,target?:any){
 const old=await read($,state)
 if(old.pending)throw Error('Check the pending operation receipt before making another change.')
 const proof=await proofNow(deps)
 const pending={request:{operationId:`workspace-${uid()}`,command,...(target?{target}:{})},label}
 await set($,{pending,retry:false})
 const response=await sharedCall($,proof,pending.request,deps)
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
 return [{memberId:head,name:'Head',bossMemberId:null,role:'Lead and review',officialText:'Lead this team, delegate work to direct reports and review their evidence before accepting outcomes. Use the available interactive question tool for user decisions (Claude AskUserQuestion, Codex request_user_input or request_user_input_async, Hermes clarify, or an exposed native/MCP equivalent). Wait for the actual answer before ending that decision.'},{memberId:uid(),name:'Worker',bossMemberId:head,role:'Implement and verify',officialText:'Read your official role and admitted task brief before working. Report an explicit outcome with evidence to your direct head. Your head decides acceptance.'}]
}

export async function sharedWorkspaceView($:any,ui:any,deps:Dependencies){
 const {Box,Text,Button,Input}=ui
 let s=await read($,state)
 const scope=scopeOf(deps.proof)
 if(s.scope!==scope){
  if(s.pending)return <Box borderStyle="round" borderColor="yellow" paddingX={1}><Text>A change from another conversation is still unconfirmed. Return to that conversation and check its receipt.</Text></Box>
  s={...initial(),scope}
 }
 function input(key:string,label:string,value:string,onInput:(v:string)=>any,placeholder=''){return <Box flexDirection="column"><Text dimColor>{label}</Text><Input key={key} value={workspaceLine(value)} placeholder={placeholder} onInput={(text:string)=>onInput(workspaceLine(text))} onSubmit={()=>{}}/></Box>}
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
 const pending=s.pending
 const resume=(retry=false)=>action($,async()=>{
  const current=await read($,state),p=current.pending;if(!p)return
  const response=await sharedCall($,await proofNow(deps),p.request,{...deps,mode:retry?'execute':'reconcile'})
  if(response.ok&&response.result?.status!=='unknown'){await committed($,deps,p,valueOf(response));return}
  await set($,{retry:response.ok&&response.result?.status==='unknown',notice:response.ok?'No committed receipt found yet. Check again or retry the same operation.':failure(response),error:!response.ok})
 })
 return <Box flexDirection="column">
  <Box flexWrap="wrap" columnGap={1}>
   <Text weight="bold" color="cyan">Team workspace</Text>
   {button('workspace-refresh',s.busy?'Working…':'↻ Refresh',refresh)}
   {!!controller&&!pending&&button('workspace-new','＋ Create team',async()=>{await set($,{page:'new',members:freshMembers(),name:'',purpose:'',notice:''})},true)}
  </Box>
  {pending&&<Box borderStyle="round" borderColor="yellow" paddingX={1} flexDirection="column">
   <Text weight="bold" color="yellow">● {pending.label}: awaiting receipt</Text>
   <Text>Other changes are paused until this operation is confirmed.</Text>
   <Box flexWrap="wrap" columnGap={1}>{button('workspace-reconcile','Check receipt',()=>resume())}{s.retry&&button('workspace-retry','Retry same operation',()=>resume(true))}</Box>
  </Box>}
  {s.notice&&<Text color={s.error?'yellow':'green'}>{s.notice}</Text>}
  {!s.caller&&<Text dimColor>Refresh to load your teams. Nothing is created by refreshing.</Text>}
  {s.page==='new'&&!pending?<Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
   <Text weight="bold">New shared team</Text>
   <Text dimColor>Creates a fresh roster. Session binding is a separate step.</Text>
   {input('workspace-team-name','Team name',s.name,v=>edit('name',v))}
   {input('workspace-team-purpose','Purpose',s.purpose,v=>edit('purpose',v))}
   {s.members.map((m,i)=><Box key={m.memberId} borderStyle="single" borderColor="gray" paddingX={1} flexDirection="column">
    <Text weight="bold">{i===0?'◆ Head':`└ Member ${i+1}`}</Text>
    {input(`workspace-member-name-${i}`,'Name',m.name,v=>set($,{members:s.members.map((row,j)=>j===i?{...row,name:v}:row)}))}
    {input(`workspace-member-role-${i}`,'Role',m.role,v=>set($,{members:s.members.map((row,j)=>j===i?{...row,role:v}:row)}))}
    {input(`workspace-member-official-${i}`,'Official instructions',m.officialText,v=>set($,{members:s.members.map((row,j)=>j===i?{...row,officialText:v}:row)}))}
    {i>0&&<Box flexWrap="wrap" columnGap={1}><Text dimColor>Reports to</Text>{s.members.slice(0,i).map((boss,j)=>button(`workspace-member-boss-${i}-${j}`,`${m.bossMemberId===boss.memberId?'●':'○'} ${boss.name}`,async()=>set($,{members:s.members.map((row,k)=>k===i?{...row,bossMemberId:boss.memberId}:row)})))}</Box>}
    {i>0&&button(`workspace-member-remove-${i}`,'Remove',async()=>set($,{members:s.members.filter(row=>row.memberId!==m.memberId).map(row=>row.bossMemberId===m.memberId?{...row,bossMemberId:s.members[0].memberId}:row)}))}
   </Box>)}
   {s.members.length<30&&button('workspace-member-add','＋ Add member',async()=>set($,{members:[...s.members,{memberId:uid(),name:`Worker ${s.members.length}`,bossMemberId:s.members[0].memberId,role:'Implement and verify',officialText:'Read your role and brief before work. Report an explicit outcome and evidence to your direct head.'}]}))}
   <Text weight="bold">Windows and capacity</Text>
   {input('workspace-pickup','Pickup window · minutes',s.pickup,v=>edit('pickup',v))}
   {input('workspace-answer','Answer window · minutes',s.answer,v=>edit('answer',v))}
   {input('workspace-window','Task window · minutes, empty = off',s.window,v=>edit('window',v))}
   {input('workspace-replay','Replay interval · milliseconds',s.replay,v=>edit('replay',v))}
   {input('workspace-capacity','Capacity · 0 = unlimited',s.capacity,v=>edit('capacity',v))}
   <Text dimColor>Automatic close off · demand launch · no scratch allocation. This preview does not launch sessions or run a scheduler.</Text>
   <Box flexWrap="wrap" columnGap={1}>
    {button('workspace-create','Create team',()=>action($,async()=>{
     const current=await read($,state)
     if(!workspaceLine(current.name).trim()||current.members.some(m=>!workspaceLine(m.name).trim()||!workspaceLine(m.role).trim()||!workspaceLine(m.officialText).trim()))fieldError('Give the team and every member a name, role and official instructions.')
     if(new Set(current.members.map(m=>workspaceLine(m.name).trim().toLowerCase())).size!==current.members.length)fieldError('Member names must be unique.')
     const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:numberField(current.capacity,'Capacity',0),launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.claude/scratch',pickupWindowMinutes:numberField(current.pickup,'Pickup window'),answerWindowMinutes:numberField(current.answer,'Answer window'),taskWindowMinutes:current.window.trim()?numberField(current.window,'Task window'):null,replayIntervalMs:numberField(current.replay,'Replay interval'),exemptMemberIds:[]}
     await mutate($,deps,{type:'createFreshTeam',teamId:uid(),name:workspaceLine(current.name).trim(),functionText:workspaceLine(current.purpose).trim(),members:current.members.map(m=>({...m,name:workspaceLine(m.name).trim(),role:workspaceLine(m.role).trim(),officialText:workspaceLine(m.officialText).trim()})),settings,expectedControllerGeneration:controller},'Team creation')
    }),true)}
    {button('workspace-cancel','Cancel',async()=>edit('page','home'))}
   </Box>
  </Box>:<Box flexDirection="column">
   {s.teams.length>0&&<Box flexWrap="wrap" columnGap={1}>{s.teams.map((team:any,i:number)=>button(`workspace-team-${i}`,`${s.teamId===team.team_id?'●':'○'} ${team.name}`,()=>action($,async()=>{await set($,{page:'home',selectedAssignment:'',reason:''});await load($,deps,team.team_id)})))}</Box>}
   {s.caller&&!s.teams.length&&<Text dimColor>{controller?'No teams yet. Create your first shared team.':'No team binding for this conversation. Ask an approved controller to bind it.'}</Text>}
   {snapshot&&<Box flexDirection="column">
    <Text weight="bold">{snapshot.team.name} · {members.length} members · {work.length} recent visible tasks</Text>
    <Text dimColor>{snapshot.team.function_text}</Text>
    <Box flexWrap="wrap" columnGap={1}>{button('workspace-roster-tab',s.page==='home'?'● Roster':'Roster',async()=>edit('page','home'))}{button('workspace-tasks-tab',s.page==='tasks'||s.page==='review'?'● Tasks':'Tasks',async()=>edit('page','tasks'))}</Box>
    {s.page==='home'&&<Box flexDirection="column">{members.map((m:any,i:number)=>{
     const binding=bindings.find((b:any)=>b.member_id===m.member_id),boss=members.find((b:any)=>b.member_id===m.boss_member_id)
     return <Box key={m.member_id} borderStyle="single" borderColor={binding?'green':'gray'} paddingX={1} flexDirection="column">
      <Box flexWrap="wrap" columnGap={1}><Text weight="bold">{m.boss_member_id?'└':'◆'} {m.name}{me?.member_id===m.member_id?' · You':''}</Text><Text color={binding?'green':'yellow'}>{binding?'● Bound':'○ Unbound'}</Text></Box>
      <Text>{m.role}{boss?` · Reports to ${boss.name}`:''}</Text>
      <Box flexWrap="wrap" columnGap={1}>
       {!!controller&&!pending&&button(`workspace-bind-${i}`,binding?'Change session':'Bind session',()=>action($,async()=>{
        await set($,{bindingMember:m.member_id,sessions:[],page:'bind'})
        const response=await sharedCall($,await proofNow(deps),{},{...deps,mode:'listSessions'})
        if(!response.ok)throw Error(failure(response))
        await set($,{sessions:response.result?.sessions??[]})
       }))}
       {!pending&&binding&&direct.some((d:any)=>d.member_id===m.member_id)&&button(`workspace-assign-${i}`,'Assign task',async()=>set($,{page:'assign',assignmentMember:m.member_id,instructions:'',expectedResult:''}),true)}
      </Box>
     </Box>
    })}</Box>}
    {s.page==='bind'&&!pending&&<Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
     <Text weight="bold">Bind {members.find((m:any)=>m.member_id===s.bindingMember)?.name}</Text>
     <Text dimColor>Verified local Claude sessions in this project. Selecting one binds it; no session is launched or messaged.</Text>
     {!s.sessions.length&&<Text color="yellow">No eligible sessions found. The session needs an explicit native Claude conversation association. Refresh the workspace and try again after it is available.</Text>}
     {s.sessions.map((session:any,i:number)=><Box key={i} flexDirection="column"><Text dimColor>{session.reference.conversationId.slice(0,8)} · {session.reference.terminalHandle}</Text>{button(`workspace-session-${i}`,session.label||`Session ${i+1}`,()=>action($,async()=>{
      const current=await read($,state),m=current.snapshot.members.find((m:any)=>m.member_id===current.bindingMember),b=current.snapshot.bindings.find((b:any)=>b.member_id===m.member_id)
      await mutate($,deps,{type:'bindMember',teamId:current.teamId,memberId:m.member_id,expectedConfigVersion:current.snapshot.team.config_version,expectedMemberGeneration:m.generation,expectedBindingGeneration:b?.generation??0,expectedControllerGeneration:controller},'Session binding',session.reference)
     }))}</Box>)}
     {button('workspace-bind-cancel','Back to roster',async()=>edit('page','home'))}
    </Box>}
    {s.page==='assign'&&!pending&&<Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
     <Text weight="bold">Assign to {members.find((m:any)=>m.member_id===s.assignmentMember)?.name}</Text>
     {input('workspace-instructions','Task instructions',s.instructions,v=>edit('instructions',v))}
     {input('workspace-expected','Expected result / acceptance criteria',s.expectedResult,v=>edit('expectedResult',v))}
     <Text dimColor>Records the assignment. The worker must pick it up through the Tasks panel or shared_team tool; automatic delivery is not implemented.</Text>
     <Box flexWrap="wrap" columnGap={1}>{button('workspace-admit','Assign task',()=>action($,async()=>{
      const current=await read($,state);if(!workspaceLine(current.instructions).trim()||!workspaceLine(current.expectedResult).trim())fieldError('Enter task instructions and an expected result.')
      const m=current.snapshot.members.find((m:any)=>m.member_id===current.assignmentMember),b=current.snapshot.bindings.find((b:any)=>b.member_id===m?.member_id)
      if(!b)fieldError('Bind the worker before assigning a task.')
      await mutate($,deps,{type:'admitAssignment',...authority(current),runId:uid(),taskId:uid(),assignmentId:uid(),memberId:m.member_id,instructions:workspaceLine(current.instructions).trim(),expectedResult:workspaceLine(current.expectedResult).trim(),expectedTargetGeneration:m.generation,expectedTargetBindingGeneration:b.generation},'Task assignment')
      if(!(await read($,state)).pending)await edit('page','tasks')
     }),true)}{button('workspace-assignment-cancel','Cancel',async()=>edit('page','home'))}</Box>
    </Box>}
    {(s.page==='tasks'||s.page==='review')&&<Box flexDirection="column">
     <Text dimColor>Your assignments and work you admitted to current direct reports · newest 100</Text>
     {!work.length&&<Text dimColor>No visible tasks. Controller approval alone does not grant access to worker evidence.</Text>}
     {work.map((item:any,i:number)=>{
      const a=item.assignment,m=members.find((m:any)=>m.member_id===a.member_id),status=item.acceptance?item.task.status:item.attempt.outcome?'Needs review':a.pickup_observed_at_ms?'In progress':'Awaiting pickup'
      return <Box key={a.assignment_id} borderStyle="single" borderColor={item.acceptance?'gray':item.attempt.outcome?'yellow':'cyan'} paddingX={1} flexDirection="column">
       <Box flexWrap="wrap" columnGap={1}><Text weight="bold">{m?.name||'Member'}</Text><Text color={item.attempt.outcome&&!item.acceptance?'yellow':'cyan'}>● {status}</Text></Box>
       <Text>{String(item.brief.instructions).slice(0,180)}</Text>
       {button(`workspace-task-${i}`,'Open task',async()=>set($,{page:'review',selectedAssignment:a.assignment_id,reason:'',summary:'',evidence:'',verified:null}))}
      </Box>
     })}
     {s.page==='review'&&selected&&<Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
      <Text weight="bold">Task detail</Text><Text>{selected.brief.instructions}</Text><Text weight="bold">Expected result</Text><Text>{selected.brief.expected_result}</Text>
      {selected.attempt.outcome&&<Box flexDirection="column"><Text weight="bold" color="yellow">Worker outcome · {selected.attempt.outcome}</Text><Text>{selected.attempt.summary}</Text><Text weight="bold">Evidence</Text><Text>{selected.attempt.evidence}</Text></Box>}
      {selected.acceptance?<Box flexDirection="column"><Text weight="bold" color="green">Head decision · {selected.acceptance.decision}</Text><Text>{selected.acceptance.reason}</Text></Box>:!pending&&<Box flexDirection="column">
       {me?.member_id===selected.assignment.member_id&&!selected.attempt.outcome&&<Box flexDirection="column">
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
       {me&&selected.assignment.assigned_by_member_id===me.member_id&&direct.some((m:any)=>m.member_id===selected.assignment.member_id)&&selected.attempt.outcome&&<Box flexDirection="column">
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
