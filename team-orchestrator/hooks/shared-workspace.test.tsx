import {expect,test} from 'claude-code/testing'
import {world,sessionAs,mountBand,ID1,ID2} from './test-world'

const options={options:{sharedStorePreview:true,orcaCommand:'orca'}} as any
function fixture(on:any,who='head'){
 const head={member_id:'head',team_id:'team',name:'Head',role:'Lead',boss_member_id:null,level:1,membership_state:'active',generation:1}
 const worker={member_id:'worker',team_id:'team',name:'Worker',role:'Implement',boss_member_id:'head',level:2,membership_state:'active',generation:1}
 const binding=(id:string)=>({member_id:id,conversation_id:id==='head'?ID1:ID2,generation:1})
 const model:any={team:{team_id:'team',name:'Demo',function_text:'Build',config_version:5},members:[head,worker],bindings:[binding('head'),binding('worker')],roles:[{member_id:'head',official_text:'Delegate and review.'},{member_id:'worker',official_text:'READ THIS ROLE BEFORE THE FIXTURE'}],work:[]}
 const configSets:any[]=[];let refuseConfig=false
 on('config.set',async(_$:any,e:any)=>{configSets.push(e);return refuseConfig?{deny:'settings read-only'}:{value:e.value}})
 const calls:any[]=[],receipts=new Map<string,any>(),control={unknown:false,discoveryFailure:false,reloadFailure:false,created:false}
 const item=()=>({assignment:{assignment_id:'assignment',member_id:'worker',assigned_by_member_id:'head',pickup_observed_at_ms:null},task:{task_id:'task',status:'open'},brief:{instructions:'Count the fixture words.',expected_result:'13 words with evidence'},attempt:{generation:1,outcome:null,summary:null,evidence:null},acceptance:null})
 const files=world(on,[],[],e=>{
  if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined
  const envelope=JSON.parse(e.init.stdin);calls.push(envelope)
  const ok=(value:any)=>JSON.stringify({ok:true,result:value})
  if(envelope.mode==='launchMember')return ok({launch:{status:'queued'},queued:true})
  if(envelope.mode==='inboxPoll')return ok({message:null})
  if(envelope.mode==='inboxAttached')return ok({confirmed:true})
  if(envelope.mode==='listSessions')return control.discoveryFailure?JSON.stringify({ok:false,error:{code:'API_NATIVE_UNVERIFIED',message:'No proof'}}):ok({sessions:[{label:'Verified worker',reference:{projectRoot:'C:/proj',conversationId:ID2,terminalHandle:'term_w',contextId:'r1::C:/proj'}}]})
  const {command,operationId}=envelope.request
  if(envelope.mode==='reconcile')return ok(receipts.get(operationId)??{status:'unknown',operationId})
  let result:any={}
  if(command.type==='inspectCaller'&&control.created&&control.reloadFailure)return JSON.stringify({ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'Read failed after commit'}})
  if(command.type==='inspectCaller')result={controllerGeneration:who==='worker'?null:1,member:who==='controller'?null:model.members.find((m:any)=>m.member_id===who),binding:who==='controller'?null:binding(who),teams:[model.team]}
  if(command.type==='inspectTeam')result=model
  if(command.type==='inspectMeeting')result=model.meetingDetail
  if(command.type==='inspectInbox')result={messages:[{message_id:'mail-1',delivery_id:'delivery-1',sender_member_id:'head',recipient_member_id:who,kind:'dispatch',body:'private body hidden until read'}]}
  if(command.type==='createFreshTeam'){
   control.created=true
   model.team={team_id:command.teamId,name:command.name,function_text:command.functionText,config_version:5}
   model.members=command.members.map((m:any,i:number)=>({member_id:m.memberId,team_id:command.teamId,name:m.name,role:m.role,boss_member_id:m.bossMemberId,level:i+1,membership_state:'active',generation:1}));model.bindings=[];model.work=[]
   result={teamId:command.teamId,configVersion:5}
  }
  if(command.type==='bindMember'){model.bindings=model.bindings.filter((b:any)=>b.member_id!==command.memberId);model.bindings.push({...binding(command.memberId),generation:command.expectedBindingGeneration+1});result={memberId:command.memberId,bindingGeneration:command.expectedBindingGeneration+1}}
  if(command.type==='admitAssignment'){const w=item();w.assignment.assignment_id=command.assignmentId;w.brief={instructions:command.instructions,expected_result:command.expectedResult};model.work.push(w);result={assignmentId:command.assignmentId,attemptGeneration:1}}
  if(command.type==='retryAssignment'){const previous=model.work.find((w:any)=>w.assignment.assignment_id===command.assignmentId),w:any=item();w.assignment={...w.assignment,assignment_id:command.newAssignmentId,member_id:command.memberId,previous_assignment_id:command.assignmentId};w.brief=previous.brief;model.work.push(w);result={assignmentId:command.newAssignmentId,attemptGeneration:1}}
  if(command.type==='verifyAssignment'){model.work[0].assignment.pickup_observed_at_ms=10;model.work[0].attempt.generation=2;result={attemptGeneration:2,brief:model.work[0].brief,role:model.roles[1]}}
  if(command.type==='reportOutcome'){Object.assign(model.work[0].attempt,{generation:3,outcome:command.outcome,summary:command.summary,evidence:command.evidence});result={attemptGeneration:3,acceptance:'pending'}}
  if(command.type==='acceptTask'){model.work[0].acceptance={decision:command.decision,reason:command.reason};model.work[0].task.status='succeeded';result={decision:command.decision}}
  const receipt={operationId,kind:'api',result};receipts.set(operationId,receipt)
  if(control.unknown&&command.type==='createFreshTeam'){control.unknown=false;return JSON.stringify({ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'Lost reply'}})}
  return ok(receipt)
 });sessionAs(on,ID1)
 return {model,calls,control,files,item,configSets,refuseConfig:()=>{refuseConfig=true}}
}
async function open($:any){const band=await mountBand($,80);await band.press({key:'main'});await band.press({key:'tab-shared'});await band.press({key:'workspace-refresh'});return band}
test('decision gates use native choices, preserve displayed authority and hide blocked work actions',options,async($:any,on:any)=>{
 const f=fixture(on),item:any=f.item();item.task.status='blocked';item.gates=[{gate_id:'g1',question:'Choose a route',status:'open',generation:3,options_json:'["Route A","Route B"]',superseded_by_gate_id:null}];f.model.work.push(item)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'});
 expect(JSON.stringify(await band.drawn())).toContain('Decision needed');expect(await band.find({key:'workspace-gate-select'})).toBeDefined()
 expect((await band.find({key:'workspace-gate-choice-0'})).props.label).toBe('Route A')
 expect(await band.find({key:'workspace-accepted'})).toBeUndefined()
 await band.input({key:'workspace-gate-note',text:'Approved for this task',kind:'change'});await band.press({key:'workspace-gate-choice-0'})
 const command=f.calls.find(c=>c.request?.command?.type==='resolveGate').request.command
 expect(command.gateId).toBe('g1');expect(command.expectedGateGeneration).toBe(3);expect(command.choice).toBe('Route A');expect(command.note).toBe('Approved for this task');expect(command.expectedConfigVersion).toBe(5)
})
test('gate creation and replacement stay drafts until saved and keep each offered option separate',options,async($:any,on:any)=>{
 const f=fixture(on),item:any=f.item();f.model.work.push(item)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'});await band.press({key:'workspace-gate-new'})
 await band.input({key:'workspace-gate-question',text:'Choose a route',kind:'change'});await band.input({key:'workspace-gate-option-0',text:'A',kind:'change'});await band.input({key:'workspace-gate-option-1',text:'B',kind:'change'});
 expect(f.calls.some(c=>c.request?.command?.type==='openGate')).toBe(false)
 await band.press({key:'workspace-gate-save'});const command=f.calls.find(c=>c.request?.command?.type==='openGate').request.command
 expect(command.options).toEqual(['A','B']);expect(command.question).toBe('Choose a route');expect(command.assignmentId).toBe('assignment');expect(command.expectedAttemptGeneration).toBe(1)
})
test('a worker sees the pending decision but cannot answer or report while blocked',options,async($:any,on:any)=>{
 const f=fixture(on,'worker'),item:any=f.item();item.task.status='blocked';item.gates=[{gate_id:'g1',question:'Choose a route',status:'open',generation:1,options_json:'["A","B"]'}];f.model.work.push(item)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'})
 expect(await band.find({key:'workspace-gate-choice-0'})).toBeUndefined();expect(await band.find({key:'workspace-gate-new'})).toBeUndefined();expect(await band.find({key:'workspace-pickup'})).toBeUndefined()
 expect(JSON.stringify(await band.drawn())).toContain('This task stays blocked.')
})
test('Inbox uses native controls; preview does not acknowledge or expose a protocol wall',options,async($:any,on:any)=>{
 const f=fixture(on,'worker'),prompts:any[]=[];on('prompt.submit',async(_$:any,e:any)=>{prompts.push(e);return {text:e.text}})
 const band=await open($);await band.press({key:'workspace-inbox-tab'});
 expect(f.calls.some(c=>c.request?.command?.type==='inspectInbox')).toBe(false)
 await band.press({key:'workspace-mail-refresh'});
 const drawn=JSON.stringify(await band.drawn());expect(drawn).toContain('Task assignment');expect(drawn).not.toContain('private body hidden until read')
 expect(f.calls.some(c=>c.request?.command?.type==='readInbox')).toBe(false)
 await band.press({key:'workspace-mail-read'});expect(prompts[0].text).toContain('shared_inbox_read')
 expect(prompts[0].text.length).toBeLessThan(400)
})
test('a returned expired assignment is labelled clearly and cannot be picked up from the panel',options,async($:any,on:any)=>{
 const f=fixture(on,'worker'),item:any=f.item();item.assignment.pickup_expired_at_ms=123;item.assignment.returned_to_member_id='head';f.model.work.push(item)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'})
 expect(JSON.stringify(await band.drawn())).toContain('Returned to head')
 expect(await band.find({key:'workspace-pickup'})).toBeUndefined()
 expect(f.calls.some(c=>c.request?.command?.type==='verifyAssignment')).toBe(false)
})
test('the head reassigns a returned task as a new attempt with fresh visible authority',options,async($:any,on:any)=>{
 const f=fixture(on,'head'),item:any=f.item();item.assignment.pickup_expired_at_ms=123;item.assignment.returned_to_member_id='head';item.attempt.generation=2;f.model.work.push(item)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'});
 expect((await band.find({key:'workspace-retry-target'})).props.value).toBe('worker')
 await band.press({key:'workspace-retry-assignment'})
 const command=f.calls.find(c=>c.request?.command?.type==='retryAssignment').request.command
 expect(command.assignmentId).toBe('assignment');expect(command.newAssignmentId).not.toBe('assignment');expect(command.memberId).toBe('worker')
 expect(command.expectedAttemptGeneration).toBe(2);expect(command.expectedTargetBindingGeneration).toBe(1)
 expect(f.model.work.length).toBe(2);expect(f.model.work[0].assignment.pickup_expired_at_ms).toBe(123)
 expect(await band.find({key:'workspace-retry-assignment'})).toBeUndefined()
})
test('a rejected attempt retains its review and offers a separate reassignment action',options,async($:any,on:any)=>{
 const f=fixture(on,'head'),item:any=f.item();item.attempt={generation:3,outcome:'succeeded',summary:'Original',evidence:'Old proof'};item.acceptance={decision:'rejected',reason:'Needs correction'};item.returned={reason:'rejected',returned_to_member_id:'head'};item.task.status='blocked';f.model.work.push(item)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'})
 expect(JSON.stringify(await band.drawn())).toContain('Needs correction');expect(await band.find({key:'workspace-retry-assignment'})).toBeDefined()
 expect(await band.find({key:'workspace-accepted'})).toBeUndefined();await band.press({key:'workspace-retry-assignment'})
 expect(item.acceptance.reason).toBe('Needs correction');expect(f.model.work.length).toBe(2)
 expect(f.calls.find(c=>c.request?.command?.type==='retryAssignment').request.command.expectedAttemptGeneration).toBe(3)
})

test('fresh team creation has editable roles, hierarchy and windows, with no side effect from opening or drafting',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($)
 await band.press({key:'workspace-new'})
 await band.input({key:'workspace-team-name',text:'My team',kind:'change'})
 await band.input({key:'workspace-team-purpose',text:'Verify a change',kind:'change'})
 await band.press({key:'setup-next'})
 await band.press({key:'workspace-member-add'})
 const options=(await band.find({key:'workspace-member-boss-2'})).props.options
 await band.select({key:'workspace-member-boss-2',value:options[1].value})
 await band.press({key:'setup-next'});await band.input({key:'workspace-pickup',text:'7',kind:'change'});await band.press({key:'setup-next'})
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 await band.press({key:'workspace-create'})
 const creates=f.calls.filter(c=>c.request?.command?.type==='createFreshTeam');expect(creates.length).toBe(1)
 const command=creates[0].request.command
 expect(command.name).toBe('My team');expect(command.members.length).toBe(3);expect(command.members[2].bossMemberId).toBe(command.members[1].memberId)
 expect(command.settings.pickupWindowMinutes).toBe(7);expect(command.expectedControllerGeneration).toBe(1)
 expect(f.calls.some(c=>c.request?.command?.type==='bindMember')).toBe(false)
 expect(JSON.stringify(await band.drawn())).toContain('Not connected')
})
test('binding uses native session choices and the displayed member/configuration/binding generations',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($);f.files.calls.length=0
 await band.drawn();await band.drawn();expect(f.files.calls.length).toBe(0)
 await band.press({key:'workspace-bind-worker'})
 expect(f.calls.some(c=>c.mode==='listSessions')).toBe(true)
 expect(f.calls.some(c=>c.request?.command?.type==='bindMember')).toBe(false)
 await band.press({key:'workspace-session-0'})
 const bind=f.calls.find(c=>c.request?.command?.type==='bindMember')
 expect(bind.request.target.conversationId).toBe(ID2);expect(bind.proof.conversationId).toBe(ID1)
 expect(bind.request.command.expectedBindingGeneration).toBe(1);expect(bind.request.command.expectedConfigVersion).toBe(5)
})
test('head assigns a task then reviews explicit worker evidence before separate acceptance',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($)
 await band.press({key:'workspace-assign-worker'})
 expect((await band.find({key:'workspace-instructions'})).props.label).toBe('Task instructions')
 expect((await band.find({key:'workspace-instructions'})).props.placeholder).toBe('Enter value')
 await band.input({key:'workspace-instructions',text:'Count the fixture words.',kind:'change'})
 await band.input({key:'workspace-expected',text:'13 words with evidence',kind:'change'})
 await band.press({key:'workspace-admit'})
 const admitted=f.calls.find(c=>c.request?.command?.type==='admitAssignment').request.command
 expect(admitted.memberId).toBe('worker');expect(admitted.expectedTargetBindingGeneration).toBe(1)
 await band.press({key:`workspace-task-${admitted.assignmentId}`});expect(await band.find({key:'workspace-accepted'})).toBeUndefined()
 Object.assign(f.model.work[0].attempt,{generation:3,outcome:'succeeded',summary:'13 words',evidence:'Checked fixture.txt'})
 await band.press({key:'workspace-refresh'});await band.press({key:'workspace-tasks-tab'});await band.press({key:`workspace-task-${admitted.assignmentId}`})
 expect(JSON.stringify(await band.drawn())).toContain('Checked fixture.txt')
 await band.press({key:'workspace-accepted'});expect(f.calls.some(c=>c.request?.command?.type==='acceptTask')).toBe(false)
 await band.input({key:'workspace-reason',text:'Independently checked all 13 words.',kind:'change'});await band.press({key:'workspace-accepted'})
 const review=f.calls.find(c=>c.request?.command?.type==='acceptTask').request.command
 expect(review.expectedAttemptGeneration).toBe(3);expect(review.decision).toBe('accepted')
 expect(review.expectedMemberGeneration).toBe(1)
})
test('worker pickup displays official role and brief; reporting never exposes head acceptance',options,async($:any,on:any)=>{
 const f=fixture(on,'worker');f.model.work.push(f.item());const band=await open($)
 expect(JSON.stringify(await band.drawn())).toContain('MEMBER')
 expect(await band.find({key:'workspace-new'})).toBeUndefined()
 expect(await band.find({key:'workspace-assign-head'})).toBeUndefined()
 await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'});await band.press({key:'workspace-pickup'})
 expect(JSON.stringify(await band.drawn())).toContain('READ THIS ROLE BEFORE THE FIXTURE')
 expect(JSON.stringify(await band.drawn())).toContain('13 words with evidence')
 await band.input({key:'workspace-summary',text:'13 words',kind:'change'});await band.input({key:'workspace-evidence',text:'Counted fixture.txt',kind:'change'});await band.press({key:'workspace-report-succeeded'})
 const report=f.calls.find(c=>c.request?.command?.type==='reportOutcome').request.command
 expect(report.expectedAttemptGeneration).toBe(2);expect(report.outcome).toBe('succeeded')
 await band.press({key:'workspace-task-assignment'})
 expect(await band.find({key:'workspace-accepted'})).toBeUndefined();expect(f.model.work[0].acceptance).toBe(null)
})
test('lost creation reply pauses changes and reconciles the exact original request without another create',options,async($:any,on:any)=>{
 const f=fixture(on,'controller');f.control.unknown=true;const band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Once only',kind:'change'});for(let i=0;i<3;i++)await band.press({key:'setup-next'});await band.press({key:'workspace-create'})
 expect(await band.find({key:'workspace-new'})).toBeUndefined();expect(await band.find({key:'workspace-create'})).toBeUndefined()
 expect(JSON.stringify(await band.drawn())).toContain('awaiting confirmation')
 await band.press({key:'workspace-reconcile'})
 const writes=f.calls.filter(c=>c.request?.command?.type==='createFreshTeam')
 expect(writes.length).toBe(2);expect(writes[0].mode).toBe('execute');expect(writes[1].mode).toBe('reconcile')
 expect(JSON.stringify(writes[0].request)).toBe(JSON.stringify(writes[1].request))
 expect(await band.find({key:'workspace-reconcile'})).toBeUndefined()
 expect(JSON.stringify(await band.drawn())).toContain('Once only')
})
test('invalid windows and unverifiable session discovery do not create writes or substitute caller proof',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Invalid',kind:'change'});await band.press({key:'setup-next'});await band.press({key:'setup-next'});await band.input({key:'workspace-pickup',text:'0',kind:'change'});await band.press({key:'setup-next'})
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 await band.press({key:'tab-shared'});f.control.discoveryFailure=true;await band.press({key:'workspace-bind-worker'})
 expect(await band.find({key:'workspace-session-0'})).toBeUndefined();expect(f.calls.some(c=>c.request?.command?.type==='bindMember')).toBe(false)
})
test('control-key text and multiline pastes keep the form usable and preserve readable role instructions',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Safe draft',kind:'change'});await band.press({key:'setup-next'})
 await band.press({key:'setup-member-select'})
 const members=(await band.findAll({type:'Button'})).filter((b:any)=>b.key?.startsWith('setup-member-option-'))
 await band.press({key:members[1].key})
 await band.input({key:'workspace-member-official-1',text:'Read role\u0001\u000b\u001b.\r\nVerify 你好\tand evidence.',kind:'change'})
 expect(await band.find({key:'setup-next'})).toBeDefined()
 expect((await band.find({key:'workspace-member-official-1'})).props.value).toBe('Read role.\nVerify 你好 and evidence.')
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 await band.press({key:'setup-next'});await band.press({key:'setup-next'});await band.press({key:'workspace-create'})
 const command=f.calls.find(c=>c.request?.command?.type==='createFreshTeam').request.command
 expect(command.members[1].officialText).toBe('Read role.\nVerify 你好 and evidence.')
})

test('Back and close retain member identities, hierarchy, multiline role and draft step',options,async($:any,on:any)=>{
 fixture(on,'controller');const band=await open($);await band.press({key:'workspace-new'})
 await band.input({key:'workspace-team-name',text:'Keep me',kind:'change'});await band.press({key:'setup-next'})
 await band.press({key:'setup-member-select'})
 const before=(await band.findAll({type:'Button'})).filter((b:any)=>b.key?.startsWith('setup-member-option-'))
 await band.press({key:before[1].key})
 await band.input({key:'workspace-member-official-1',text:'First line.\nSecond line.',kind:'change'})
 await band.press({key:'setup-back'});await band.press({key:'setup-next'});await band.press({key:'workspace-cancel'})
 await band.press({key:'band-team'})
 await band.press({key:'setup-member-select'})
 const after=(await band.findAll({type:'Button'})).filter((b:any)=>b.key?.startsWith('setup-member-option-'))
 expect(after.map((m:any)=>m.key)).toEqual(before.map((m:any)=>m.key))
 expect((await band.find({key:'workspace-member-official-1'})).props.value).toBe('First line.\nSecond line.')
 expect(await band.find({key:'workspace-team-name'})).toBeUndefined()
})
test('confirmed creation opens the workspace despite readback failure and never offers duplicate creation',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($);f.control.reloadFailure=true
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Committed once',kind:'change'})
 for(let i=0;i<3;i++)await band.press({key:'setup-next'})
 await band.press({key:'workspace-create'})
 expect(await band.find({key:'workspace-create'})).toBeUndefined()
 expect((await band.find({key:'tab-team'})).props.label).toBe('Team')
 expect(JSON.stringify(await band.drawn())).toContain('confirmed. Refresh the workspace')
 f.control.reloadFailure=false;await band.press({key:'workspace-refresh'})
 expect(JSON.stringify(await band.drawn())).toContain('Committed once')
 expect(f.calls.filter(c=>c.request?.command?.type==='createFreshTeam').length).toBe(1)
})

test('Create remembers this project even when the inherited global default is already On',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Remember upgrade',kind:'change'})
 for(let i=0;i<3;i++)await band.press({key:'setup-next'})
 expect(f.configSets.length).toBe(0)
 await band.press({key:'workspace-create'})
 expect(f.configSets.length).toBe(1);expect(f.configSets[0].key).toBe('team-orchestrator.projectWorkspaceModes')
 expect(f.configSets[0].value).toBe(JSON.stringify(['shared|c:/proj']))
 expect(f.calls.filter(c=>c.request?.command?.type==='createFreshTeam').length).toBe(1)
})
test('a failed project preference save prevents creation and retains the draft',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($);f.refuseConfig()
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Keep if save fails',kind:'change'})
 for(let i=0;i<3;i++)await band.press({key:'setup-next'})
 await band.press({key:'workspace-create'})
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 expect(JSON.stringify(await band.drawn())).toContain('settings read-only')
 expect(await band.find({key:'workspace-create'})).toBeDefined()
 await band.press({key:'setup-back'});await band.press({key:'setup-back'});await band.press({key:'setup-back'})
 expect((await band.find({key:'workspace-team-name'})).props.value).toBe('Keep if save fails')
})

test('compact member selector changes only presentation and keeps one named action target',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($);const count=f.calls.length
 expect(await band.find({key:'shared-preview-on'})).toBeUndefined()
 expect(await band.find({key:'workspace-bind-worker'})).toBeDefined()
 expect(await band.find({key:'workspace-bind-head'})).toBeUndefined()
 await band.select({key:'workspace-member-select',value:'head'})
 expect(f.calls.length).toBe(count)
 expect(await band.find({key:'workspace-bind-head'})).toBeDefined()
 expect(await band.find({key:'workspace-bind-worker'})).toBeUndefined()
 expect((await band.findAll({type:'Text'})).map((t:any)=>t.text).join('\n')).toContain('Head · You · Lead')
 await band.press({key:'shared-access'})
 expect(await band.find({key:'shared-preview-on'})).toBeDefined()
 expect(f.calls.length).toBe(count)
})
test('task selector distinguishes duplicate labels and selecting never records pickup',options,async($:any,on:any)=>{
 const f=fixture(on,'worker'),first=f.item(),second=f.item()
 first.assignment.assignment_id='first-same';second.assignment.assignment_id='next-same'
 second.brief.expected_result='SECOND expected result in full'
 f.model.work.push(first,second);const band=await open($);const count=f.calls.length
 const picker=(await band.find({key:'workspace-task-select'})).props
 expect(picker.options[0].value).toBe('first-same');expect(picker.options[1].value).toBe('next-same')
 expect(picker.options[0].label).not.toBe(picker.options[1].label)
 await band.select({key:'workspace-task-select',value:'next-same'})
 expect(f.calls.length).toBe(count)
 expect(await band.find({key:'workspace-task-first-same'})).toBeUndefined()
 await band.press({key:'workspace-task-next-same'})
 expect(f.calls.length).toBe(count)
 expect(JSON.stringify(await band.drawn())).toContain('SECOND expected result in full')
 expect(f.calls.some(c=>c.request?.command?.type==='verifyAssignment')).toBe(false)
})
test('returning to an open task preserves unsent review text and full worker evidence',options,async($:any,on:any)=>{
 const f=fixture(on),item=f.item();Object.assign(item.attempt,{generation:3,outcome:'succeeded',summary:'Ready',evidence:'FULL EVIDENCE '+ 'line '.repeat(80)})
 f.model.work.push(item);const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'})
 await band.input({key:'workspace-reason',text:'Unsent review draft',kind:'change'})
 await band.press({key:'workspace-task-back'});await band.press({key:'workspace-task-assignment'})
 expect((await band.find({key:'workspace-reason'})).props.value).toBe('Unsent review draft')
 expect(JSON.stringify(await band.drawn())).toContain(item.attempt.evidence)
 expect(f.calls.some(c=>c.request?.command?.type==='acceptTask')).toBe(false)
})
test('refresh does not silently retarget a removed selected member or task',options,async($:any,on:any)=>{
 const f=fixture(on),item=f.item();f.model.work.push(item);const band=await open($)
 await band.select({key:'workspace-member-select',value:'worker'})
 f.model.members=f.model.members.filter((m:any)=>m.member_id!=='worker');f.model.bindings=f.model.bindings.filter((b:any)=>b.member_id!=='worker')
 await band.press({key:'workspace-refresh'})
 expect(JSON.stringify(await band.drawn())).toContain('selected member is no longer visible')
 expect(await band.find({key:'workspace-bind-head'})).toBeUndefined()
 await band.select({key:'workspace-member-select',value:'head'})
 expect(await band.find({key:'workspace-bind-head'})).toBeDefined()
 await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-assignment'})
 f.model.work=[];await band.press({key:'workspace-refresh'})
 expect(JSON.stringify(await band.drawn())).toContain('selected task is no longer visible')
 expect(await band.find({key:'workspace-pickup'})).toBeUndefined()
 expect(await band.find({key:'workspace-accepted'})).toBeUndefined()
 expect(f.calls.some(c=>['bindMember','verifyAssignment','acceptTask'].includes(c.request?.command?.type))).toBe(false)
})

test('long team purpose stays behind explicit team info while subject navigation stays visible',options,async($:any,on:any)=>{
 const f=fixture(on);f.model.team.function_text='LONG PURPOSE '+ 'purpose '.repeat(100)
 const band=await open($),count=f.calls.length
 expect(await band.find({key:'workspace-member-select'})).toBeDefined()
 expect(JSON.stringify(await band.drawn())).not.toContain(f.model.team.function_text)
 await band.press({key:'workspace-about'})
 expect(JSON.stringify(await band.drawn())).toContain(f.model.team.function_text)
 expect(f.calls.length).toBe(count)
})


test('new assignment selects its own preview and cannot inherit another tasks unsent review',options,async($:any,on:any)=>{
 const f=fixture(on),old=f.item();Object.assign(old.attempt,{outcome:'succeeded',summary:'Old result',evidence:'Old evidence'});f.model.work.push(old)
 const band=await open($);await band.press({key:'workspace-tasks-tab'});await band.select({key:'workspace-task-select',value:'assignment'});await band.press({key:'workspace-task-assignment'})
 await band.input({key:'workspace-reason',text:'Unsent review for old task',kind:'change'})
 await band.press({key:'workspace-roster-tab'});await band.press({key:'workspace-assign-worker'})
 await band.input({key:'workspace-instructions',text:'A separate new assignment',kind:'change'});await band.input({key:'workspace-expected',text:'A separate result',kind:'change'});await band.press({key:'workspace-admit'})
 const admitted=f.calls.find(c=>c.request?.command?.type==='admitAssignment').request.command
 expect((await band.find({key:'workspace-task-select'})).props.value).toBe(admitted.assignmentId)
 expect(await band.find({key:`workspace-task-${admitted.assignmentId}`})).toBeDefined()
 const next=f.model.work.find((w:any)=>w.assignment.assignment_id===admitted.assignmentId);Object.assign(next.attempt,{outcome:'succeeded',summary:'New result',evidence:'New evidence'})
 await band.press({key:'workspace-refresh'});await band.press({key:'workspace-tasks-tab'});await band.press({key:`workspace-task-${admitted.assignmentId}`})
 expect((await band.find({key:'workspace-reason'})).props.value).toBe('')
 expect(f.calls.some(c=>c.request?.command?.type==='acceptTask')).toBe(false)
})


test('an approved controller must finish or cancel an active interview before Create is available',options,async($:any,on:any)=>{
 const f=fixture(on,'controller');on('prompt.submit',async(_$:any,e:any)=>({text:e.text}));on('tool.register',async(_$:any,e:any)=>({value:{tool:`mcp__team-orchestrator__${e.name}`}}))
 const band=await open($);await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Review guard',kind:'change'})
 await band.press({key:'setup-interview'});for(let i=0;i<3;i++)await band.press({key:'setup-next'})
 expect(await band.find({key:'setup-interview-cancel'})).toBeDefined();expect(await band.find({key:'workspace-create'})).toBeUndefined()
 await band.press({key:'setup-interview-cancel'});expect(await band.find({key:'workspace-create'})).toBeDefined()
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
})


test('shared member launch is a native action with generation checks and visible capacity queue',options,async($:any,on:any)=>{
 const f=fixture(on);f.model.bindings=f.model.bindings.filter((b:any)=>b.member_id==='head');
 const band=await open($);await band.press({key:'workspace-launch-worker'});
 const call=f.calls.find(c=>c.mode==='launchMember');expect(call.request.command.type).toBe('reserveLaunch');expect(call.request.command.memberId).toBe('worker');expect(call.request.command.expectedMemberGeneration).toBe(1);expect(call.request.command.expectedControllerGeneration).toBe(1);
 expect(JSON.stringify(await band.drawn())).toContain('Waiting for capacity');
});
test('inbox question form sends a typed question without acknowledging or changing a task',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($);await band.press({key:'workspace-inbox-tab'});await band.press({key:'question-new'});
 await band.input({key:'question-text',text:'Which approach should I use?',kind:'change'});await band.press({key:'question-send'});
 const q=f.calls.find(c=>c.request?.command?.type==='askQuestion').request.command;expect(q.recipientMemberId).toBe('worker');expect(q.assignmentId).toBe(null);expect(q.question).toBe('Which approach should I use?');expect(q.expectedConfigVersion).toBe(5);
 expect(f.calls.some(c=>c.request?.command?.type==='readInbox')).toBe(false);
});


test('meeting invitations require a reviewed draft and an explicit start rule in the native panel',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($)
 await band.press({key:'workspace-meetings-tab'});await band.press({key:'meeting-new'})
 await band.input({key:'meeting-title',text:'Weekly review',kind:'change'})
 await band.press({key:'meeting-invite-worker'})
 await band.select({key:'meeting-policy',value:'joined'})
 await band.input({key:'meeting-topic',text:'Review evidence',kind:'change'});await band.press({key:'meeting-topic-add'})
 expect(f.calls.some(c=>c.request?.command?.type==='createMeeting')).toBe(false)
 await band.press({key:'meeting-review-invitations'})
 expect(f.calls.some(c=>c.request?.command?.type==='createMeeting')).toBe(false)
 await band.press({key:'meeting-send-invitations'})
 const command=f.calls.find(c=>c.request?.command?.type==='createMeeting').request.command
 expect(command.startPolicy).toBe('joined');expect(command.participantIds).toEqual(['head','worker']);expect(command.topics[0].requiredMemberIds).toEqual(['head','worker'])
 expect(command.lineLimit).toBe(25);expect(command.roundLimit).toBe(2)
})

test('meeting workspace uses native Agenda Discussion Outputs tabs and browsing never joins another member',options,async($:any,on:any)=>{
 const f=fixture(on),meeting={meeting_id:'meeting',title:'Durable review',status:'active',chair_member_id:'head',generation:4,current_topic:0,extended:0};f.model.meetings=[meeting]
 f.model.meetingDetail={meeting,participants:[{member_id:'head',state:'joined'},{member_id:'worker',state:'invited'}],topics:[{topic_index:0,title:'Evidence',state:'pending'}],required:[{topic_index:0,member_id:'worker'}],contributions:[],outputs:[{output_id:'out',kind:'action',state:'proposed',owner_member_id:'worker',body:'Follow up'}]}
 const band=await open($);await band.press({key:'workspace-meetings-tab'});await band.select({key:'meeting-select',value:'meeting'})
 for(const tab of ['agenda','discussion','outputs']){await band.press({key:`meeting-tab-${tab}`});expect(await band.find({key:`meeting-tab-${tab}`})).toBeDefined()}
 expect(f.calls.some(c=>c.request?.command?.type==='respondMeeting')).toBe(false)
 expect(JSON.stringify(await band.drawn())).toContain('Follow up')
})
