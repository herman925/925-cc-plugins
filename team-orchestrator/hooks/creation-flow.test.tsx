import {expect,test} from 'claude-code/testing'
import {world,mountBand,ID1,ID2} from './test-world'
import {TEAM_TEMPLATES,templateMembers} from './team-templates'
import {interviewDraft} from './creation-draft'

async function open($:any,on:any,sid=()=>ID1){const files=world(on);on('session.id',async()=>({value:sid()}));const band=await mountBand($,66);await band.press({key:'main'});return {files,band}}
const proposal=(id:string)=>({tool:'mcp__team-orchestrator__team_draft',interviewId:id,name:'Interviewed team',purpose:'Verify the proposal',members:[{name:'Lead',role:'Review',boss:null,officialText:'Delegate and review.'},{name:'Worker',role:'Verify',boss:'Lead',officialText:'Read the brief.\nReturn evidence.'}]})
const token=(prompt:string)=>prompt.match(/with interviewId ([a-f0-9]+)/)![1]

test('all three original templates are discoverable, previewed and applied only to an editable draft',async($,on)=>{
 const {files,band}=await open($,on)
 await band.input({key:'workspace-team-purpose',text:'Keep this purpose',kind:'change'})
 for(const [index,t] of TEAM_TEMPLATES.entries()){
  await band.press({key:`setup-template-${t.label}`})
  expect((await band.find({key:'workspace-team-name'})).props.value).toBe(index===0?'':TEAM_TEMPLATES[index-1].form.team)
  await band.press({key:'setup-template-apply'})
  expect((await band.find({key:'workspace-team-name'})).props.value).toBe(t.form.team)
  expect((await band.find({key:'workspace-team-purpose'})).props.value).toBe('Keep this purpose')
  await band.press({key:'setup-next'});expect((await band.find({key:'workspace-member-official-0'})).props.value).toContain('AskUserQuestion');await band.press({key:'setup-member-select'})
  const rows=(await band.findAll({type:'Button'})).filter(b=>b.key?.startsWith('setup-member-option-'))
  expect(rows.length).toBe([4,11,21][index])
  const plan=templateMembers(t,'Purpose'),names=new Set<string>()
  for(const m of plan){expect(m.boss===null||names.has(m.boss)).toBe(true);names.add(m.name)}
  if(index===2)expect(rows.some(b=>b.text.includes('Security Team-Head'))).toBe(true)
  await band.press({key:'setup-back'})
 }
 expect(files.calls.some(a=>String(a[1]).endsWith('mod-bridge.mjs'))).toBe(false)
 expect([...files.keys()].some(k=>k.includes('controller-actions'))).toBe(false)
 expect(await band.find({key:'workspace-create'})).toBeUndefined()
})

test('member picker toggles closed, selecting the same member closes, and close/reopen keeps edits',async($,on)=>{
 const {band}=await open($,on);await band.input({key:'workspace-team-name',text:'Kept',kind:'change'});await band.press({key:'setup-next'})
 expect((await band.find({key:'setup-member-select'})).text).toBe('Edit member: Head ▾')
 await band.press({key:'setup-member-select'})
 const rows=(await band.findAll({type:'Button'})).filter(b=>b.key?.startsWith('setup-member-option-'))
 expect(rows.length).toBe(2)
 await band.press({key:'setup-member-select'});expect(await band.find({key:rows[0].key})).toBeUndefined()
 await band.press({key:'setup-member-select'});await band.press({key:rows[0].key});expect(await band.find({key:rows[0].key})).toBeUndefined()
 await band.press({key:'setup-member-select'});await band.press({key:rows[1].key})
 await band.input({key:'workspace-member-role-1',text:'Kept role',kind:'change'});await band.press({key:'setup-member-select'})
 await band.press({key:'close'});await band.press({key:'band-team'})
 expect(await band.find({key:rows[1].key})).toBeUndefined()
 expect((await band.find({key:'workspace-member-role-1'})).props.value).toBe('Kept role')
 expect(JSON.stringify(await band.drawn())).not.toContain('Head · Head')
})

test('Interview me submits interactive guidance once and proposal opens Review without creation or permission',async($,on)=>{
 const prompts:string[]=[];on('prompt.submit',async(_$,e)=>{prompts.push(e.text);return {text:e.text}})
 const {files,band}=await open($,on)
 await band.press({key:'setup-interview'})
 expect(prompts.length).toBe(1);expect(await band.find({key:'setup-interview'})).toBeUndefined()
 for(const text of ['AskUserQuestion','request_user_input_async','clarify','Keep the turn open','Do not call team_launch'])expect(prompts[0]).toContain(text)
 const response:any=await $.tool.call(proposal(token(prompts[0])) as any)
 expect(JSON.stringify(response)).toContain('draft_only')
 expect(JSON.stringify(await band.drawn())).toContain('Interviewed team')
 expect(await band.find({key:'setup-review-members'})).toBeDefined()
 expect(await band.find({key:'workspace-create'})).toBeUndefined()
 expect(await band.find({key:'setup-interview-cancel'})).toBeUndefined()
 expect(files.calls.some(a=>String(a[1]).endsWith('mod-bridge.mjs'))).toBe(false)
 expect([...files.keys()].some(k=>k.includes('controller-actions'))).toBe(false)
 const replay:any=await $.tool.call(proposal(token(prompts[0])) as any);expect(JSON.stringify(replay)).toContain('DRAFT_REFUSED')
 await band.press({key:'setup-review-members'});await band.press({key:'setup-member-select'})
 const rows=(await band.findAll({type:'Button'})).filter(b=>b.key?.startsWith('setup-member-option-'));await band.press({key:rows[1].key})
 expect((await band.find({key:'workspace-member-official-1'})).props.value).toBe('Read the brief.\nReturn evidence.')
})

test('stale, cancelled and wrong-conversation interview proposals preserve the current draft',async($,on)=>{
 const prompts:string[]=[];let sid:string=ID1;on('prompt.submit',async(_$,e)=>{prompts.push(e.text);return {text:e.text}})
 const {band}=await open($,on,()=>sid)
 await band.press({key:'setup-interview'});await band.input({key:'workspace-team-name',text:'Manual edit',kind:'change'})
 const stale:any=await $.tool.call(proposal(token(prompts[0])) as any);expect(JSON.stringify(stale)).toContain('draft changed')
 expect((await band.find({key:'workspace-team-name'})).props.value).toBe('Manual edit')
 await band.press({key:'setup-interview-cancel'});const cancelled:any=await $.tool.call(proposal(token(prompts[0])) as any);expect(JSON.stringify(cancelled)).toContain('DRAFT_REFUSED')
 await band.press({key:'setup-interview'});sid=ID2
 const moved:any=await $.tool.call(proposal(token(prompts[1])) as any);expect(JSON.stringify(moved)).toContain('DRAFT_REFUSED')
 sid=ID1;expect((await band.find({key:'workspace-team-name'})).props.value).toBe('Manual edit')
})

test('refused interview prompt can be retried and invalid hierarchy cannot replace the draft',async($,on)=>{
 on('prompt.submit',async()=>({drop:'test refusal'}));const {band}=await open($,on)
 await band.press({key:'setup-interview'});expect(await band.find({key:'setup-interview'})).toBeDefined();expect(JSON.stringify(await band.drawn())).toContain('test refusal')
 expect(()=>interviewDraft({...proposal('id'),members:[{name:'Worker',role:'Work',boss:'Missing',officialText:'Verify.'}]})).toThrow()
 expect(()=>interviewDraft({...proposal('id'),pickup:0})).toThrow()
})
