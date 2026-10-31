import {expect,test} from 'claude-code/testing'
import {world,sessionAs,mountBand,ID1,ID2} from './test-world'

const options={options:{sharedStorePreview:true,orcaCommand:'orca'}} as any
function fixture(on:any,who='head'){
 const head={member_id:'head',team_id:'team',name:'Head',role:'Lead',boss_member_id:null,level:1,membership_state:'active',generation:1}
 const worker={member_id:'worker',team_id:'team',name:'Worker',role:'Implement',boss_member_id:'head',level:2,membership_state:'active',generation:1}
 const binding=(id:string)=>({member_id:id,conversation_id:id==='head'?ID1:ID2,generation:1})
 const model:any={team:{team_id:'team',name:'Demo',function_text:'Build',config_version:5},members:[head,worker],bindings:[binding('head'),binding('worker')],roles:[{member_id:'head',official_text:'Delegate and review.'},{member_id:'worker',official_text:'READ THIS ROLE BEFORE THE FIXTURE'}],work:[]}
 const calls:any[]=[],receipts=new Map<string,any>(),control={unknown:false,discoveryFailure:false}
 const item=()=>({assignment:{assignment_id:'assignment',member_id:'worker',assigned_by_member_id:'head',pickup_observed_at_ms:null},task:{task_id:'task',status:'open'},brief:{instructions:'Count the fixture words.',expected_result:'13 words with evidence'},attempt:{generation:1,outcome:null,summary:null,evidence:null},acceptance:null})
 const files=world(on,[],[],e=>{
  if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined
  const envelope=JSON.parse(e.init.stdin);calls.push(envelope)
  const ok=(value:any)=>JSON.stringify({ok:true,result:value})
  if(envelope.mode==='listSessions')return control.discoveryFailure?JSON.stringify({ok:false,error:{code:'API_NATIVE_UNVERIFIED',message:'No proof'}}):ok({sessions:[{label:'Verified worker',reference:{projectRoot:'C:/proj',conversationId:ID2,terminalHandle:'term_w',contextId:'r1::C:/proj'}}]})
  const {command,operationId}=envelope.request
  if(envelope.mode==='reconcile')return ok(receipts.get(operationId)??{status:'unknown',operationId})
  let result:any={}
  if(command.type==='inspectCaller')result={controllerGeneration:who==='worker'?null:1,member:who==='controller'?null:model.members.find((m:any)=>m.member_id===who),binding:who==='controller'?null:binding(who),teams:[model.team]}
  if(command.type==='inspectTeam')result=model
  if(command.type==='createFreshTeam'){
   model.team={team_id:command.teamId,name:command.name,function_text:command.functionText,config_version:5}
   model.members=command.members.map((m:any,i:number)=>({member_id:m.memberId,team_id:command.teamId,name:m.name,role:m.role,boss_member_id:m.bossMemberId,level:i+1,membership_state:'active',generation:1}));model.bindings=[];model.work=[]
   result={teamId:command.teamId,configVersion:5}
  }
  if(command.type==='bindMember'){model.bindings=model.bindings.filter((b:any)=>b.member_id!==command.memberId);model.bindings.push({...binding(command.memberId),generation:command.expectedBindingGeneration+1});result={memberId:command.memberId,bindingGeneration:command.expectedBindingGeneration+1}}
  if(command.type==='admitAssignment'){const w=item();w.assignment.assignment_id=command.assignmentId;w.brief={instructions:command.instructions,expected_result:command.expectedResult};model.work.push(w);result={assignmentId:command.assignmentId,attemptGeneration:1}}
  if(command.type==='verifyAssignment'){model.work[0].assignment.pickup_observed_at_ms=10;model.work[0].attempt.generation=2;result={attemptGeneration:2,brief:model.work[0].brief,role:model.roles[1]}}
  if(command.type==='reportOutcome'){Object.assign(model.work[0].attempt,{generation:3,outcome:command.outcome,summary:command.summary,evidence:command.evidence});result={attemptGeneration:3,acceptance:'pending'}}
  if(command.type==='acceptTask'){model.work[0].acceptance={decision:command.decision,reason:command.reason};model.work[0].task.status='succeeded';result={decision:command.decision}}
  const receipt={operationId,kind:'api',result};receipts.set(operationId,receipt)
  if(control.unknown&&command.type==='createFreshTeam'){control.unknown=false;return JSON.stringify({ok:false,error:{code:'API_BRIDGE_UNKNOWN',message:'Lost reply'}})}
  return ok(receipt)
 });sessionAs(on,ID1)
 return {model,calls,control,files,item}
}
async function open($:any){const band=await mountBand($,80);await band.press({key:'main'});await band.press({key:'tab-shared'});await band.press({key:'workspace-refresh'});return band}

test('fresh team creation has editable roles, hierarchy and windows, with no side effect from opening or drafting',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($)
 await band.press({key:'workspace-new'})
 await band.input({key:'workspace-team-name',text:'My team',kind:'change'})
 await band.input({key:'workspace-team-purpose',text:'Verify a change',kind:'change'})
 await band.input({key:'workspace-pickup',text:'7',kind:'change'})
 await band.press({key:'workspace-member-add'});await band.press({key:'workspace-member-boss-2-1'})
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 await band.press({key:'workspace-create'})
 const creates=f.calls.filter(c=>c.request?.command?.type==='createFreshTeam');expect(creates.length).toBe(1)
 const command=creates[0].request.command
 expect(command.name).toBe('My team');expect(command.members.length).toBe(3);expect(command.members[2].bossMemberId).toBe(command.members[1].memberId)
 expect(command.settings.pickupWindowMinutes).toBe(7);expect(command.expectedControllerGeneration).toBe(1)
 expect(f.calls.some(c=>c.request?.command?.type==='bindMember')).toBe(false)
 expect(JSON.stringify(await band.drawn())).toContain('Unbound')
})
test('binding uses native session choices and the displayed member/configuration/binding generations',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($);f.files.calls.length=0
 await band.drawn();await band.drawn();expect(f.files.calls.length).toBe(0)
 await band.press({key:'workspace-bind-1'})
 expect(f.calls.some(c=>c.mode==='listSessions')).toBe(true)
 expect(f.calls.some(c=>c.request?.command?.type==='bindMember')).toBe(false)
 await band.press({key:'workspace-session-0'})
 const bind=f.calls.find(c=>c.request?.command?.type==='bindMember')
 expect(bind.request.target.conversationId).toBe(ID2);expect(bind.proof.conversationId).toBe(ID1)
 expect(bind.request.command.expectedBindingGeneration).toBe(1);expect(bind.request.command.expectedConfigVersion).toBe(5)
})
test('head assigns a task then reviews explicit worker evidence before separate acceptance',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($)
 await band.press({key:'workspace-assign-1'})
 await band.input({key:'workspace-instructions',text:'Count the fixture words.',kind:'change'})
 await band.input({key:'workspace-expected',text:'13 words with evidence',kind:'change'})
 await band.press({key:'workspace-admit'})
 const admitted=f.calls.find(c=>c.request?.command?.type==='admitAssignment').request.command
 expect(admitted.memberId).toBe('worker');expect(admitted.expectedTargetBindingGeneration).toBe(1)
 await band.press({key:'workspace-task-0'});expect(await band.find({key:'workspace-accepted'})).toBeUndefined()
 Object.assign(f.model.work[0].attempt,{generation:3,outcome:'succeeded',summary:'13 words',evidence:'Checked fixture.txt'})
 await band.press({key:'workspace-refresh'});await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-0'})
 expect(JSON.stringify(await band.drawn())).toContain('Checked fixture.txt')
 await band.press({key:'workspace-accepted'});expect(f.calls.some(c=>c.request?.command?.type==='acceptTask')).toBe(false)
 await band.input({key:'workspace-reason',text:'Independently checked all 13 words.',kind:'change'});await band.press({key:'workspace-accepted'})
 const review=f.calls.find(c=>c.request?.command?.type==='acceptTask').request.command
 expect(review.expectedAttemptGeneration).toBe(3);expect(review.decision).toBe('accepted')
 expect(review.expectedMemberGeneration).toBe(1)
})
test('worker pickup displays official role and brief; reporting never exposes head acceptance',options,async($:any,on:any)=>{
 const f=fixture(on,'worker');f.model.work.push(f.item());const band=await open($)
 expect(JSON.stringify(await band.drawn())).toContain('Member access verified')
 expect(await band.find({key:'workspace-new'})).toBeUndefined()
 expect(await band.find({key:'workspace-assign-0'})).toBeUndefined()
 await band.press({key:'workspace-tasks-tab'});await band.press({key:'workspace-task-0'});await band.press({key:'workspace-pickup'})
 expect(JSON.stringify(await band.drawn())).toContain('READ THIS ROLE BEFORE THE FIXTURE')
 expect(JSON.stringify(await band.drawn())).toContain('13 words with evidence')
 await band.input({key:'workspace-summary',text:'13 words',kind:'change'});await band.input({key:'workspace-evidence',text:'Counted fixture.txt',kind:'change'});await band.press({key:'workspace-report-succeeded'})
 const report=f.calls.find(c=>c.request?.command?.type==='reportOutcome').request.command
 expect(report.expectedAttemptGeneration).toBe(2);expect(report.outcome).toBe('succeeded')
 await band.press({key:'workspace-task-0'})
 expect(await band.find({key:'workspace-accepted'})).toBeUndefined();expect(f.model.work[0].acceptance).toBe(null)
})
test('lost creation reply pauses changes and reconciles the exact original request without another create',options,async($:any,on:any)=>{
 const f=fixture(on,'controller');f.control.unknown=true;const band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Once only',kind:'change'});await band.press({key:'workspace-create'})
 expect(await band.find({key:'workspace-new'})).toBeUndefined();expect(await band.find({key:'workspace-create'})).toBeUndefined()
 expect(JSON.stringify(await band.drawn())).toContain('awaiting receipt')
 await band.press({key:'workspace-reconcile'})
 const writes=f.calls.filter(c=>c.request?.command?.type==='createFreshTeam')
 expect(writes.length).toBe(2);expect(writes[0].mode).toBe('execute');expect(writes[1].mode).toBe('reconcile')
 expect(JSON.stringify(writes[0].request)).toBe(JSON.stringify(writes[1].request))
 expect(await band.find({key:'workspace-reconcile'})).toBeUndefined()
 expect(JSON.stringify(await band.drawn())).toContain('Once only')
})
test('invalid windows and unverifiable session discovery do not create writes or substitute caller proof',options,async($:any,on:any)=>{
 const f=fixture(on),band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Invalid',kind:'change'});await band.input({key:'workspace-pickup',text:'0',kind:'change'});await band.press({key:'workspace-create'})
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 await band.press({key:'workspace-cancel'});f.control.discoveryFailure=true;await band.press({key:'workspace-bind-1'})
 expect(await band.find({key:'workspace-session-0'})).toBeUndefined();expect(f.calls.some(c=>c.request?.command?.type==='bindMember')).toBe(false)
})
test('control-key text and multiline pastes keep the form usable and preserve readable role instructions',options,async($:any,on:any)=>{
 const f=fixture(on,'controller'),band=await open($)
 await band.press({key:'workspace-new'});await band.input({key:'workspace-team-name',text:'Safe draft',kind:'change'})
 await band.input({key:'workspace-member-official-1',text:'Read role\u0001\u000b\u001b.\r\nVerify 你好\tand evidence.',kind:'change'})
 expect(await band.find({key:'workspace-create'})).toBeDefined()
 expect(JSON.stringify(await band.drawn())).toContain('Read role. Verify 你好 and evidence.')
 expect(f.calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
 await band.press({key:'workspace-create'})
 const command=f.calls.find(c=>c.request?.command?.type==='createFreshTeam').request.command
 expect(command.members[1].officialText).toBe('Read role. Verify 你好 and evidence.')
})
