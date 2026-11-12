import {expect,test} from 'claude-code/testing'
import {HUALONG,ID1,ID2,sessionAs,world} from './test-world'
import {sharedStoreProtection} from './shared-store'

function fixture(on:any,{member=false,probeFails=false,previewOnly=false,uncertain=false}={}){
 const files=world(on,[],[],e=>{
  if(e.argv.some((value:any)=>String(value).includes('team-orchestrator-membership-v1')))return JSON.stringify({membership:uncertain?'unknown':member?'member':'none'})
  if(probeFails&&e.argv[1]==='terminal'&&e.argv[2]==='show')return '{}'
  if(String(e.argv[1]).endsWith('mod-bridge.mjs'))return JSON.stringify({ok:true,result:{result:{member:member?{name:'Head',boss_member_id:null,allow_write:0,allow_agent:0}:null,hasReports:member}}})
 })
 sessionAs(on,ID1)
 if(!previewOnly)files.set('C:/proj/.team-orchestrator/team.sqlite','fixture database')
 for(const tool of ['Write','Agent','Bash'])on('tool.call',{tool} as any,async()=>({result:'executed'}) as any)
 return files
}
test('D1: a non-member with a shared store does not pay the native probe or inherit Write/Agent restrictions',async($,on)=>{
 const files=fixture(on,{probeFails:true});files.calls.length=0
 for(const input of [
  {tool:'Write',file_path:'C:/temp/outside-project.md',content:'control'},
  {tool:'Agent',subagent_type:'general-purpose',prompt:'control'},
 ])expect((await $.tool.call(input as any) as any).result).toBe('executed')
 expect(files.calls.filter(a=>a[1]==='terminal'&&a[2]==='show').length).toBe(0)
 expect(files.calls.some(a=>String(a[1]).endsWith('mod-bridge.mjs'))).toBe(false)
})
test('D1: preview presence without membership is not authority over ordinary work',{options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 const files=fixture(on,{probeFails:true,previewOnly:true});files.calls.length=0
 expect((await $.tool.call({tool:'Write',file_path:'C:/temp/control.md',content:'control'} as any) as any).result).toBe('executed')
 expect((await $.tool.call({tool:'Agent',subagent_type:'general-purpose',prompt:'control'} as any) as any).result).toBe('executed')
 expect(files.calls.filter(a=>a[1]==='terminal'&&a[2]==='show').length).toBe(0)
})
test('D1: plainly read-only literal and globbed folder listings are treated equally',async($,on)=>{
 const files=fixture(on,{probeFails:true});files.calls.length=0
 for(const command of ['ls docs/validation/','ls .team-orchestrator/','ls .team-o*/','ls .claude/team-orchestrator/','ls .team-orchestrator/ 2>/dev/null || true','ls .team-o*/ 2>/dev/null || true'])expect((await $.tool.call({tool:'Bash',command} as any) as any).result).toBe('executed')
 expect(files.calls.filter(a=>a[1]==='terminal'&&a[2]==='show').length).toBe(0)
})
test('D1: read-only failure handling does not admit redirection, mixed writes or private bridge execution',()=>{
 for(const command of ['ls .team-orchestrator/ > output.txt','ls .team-orchestrator/ || true; rm .team-orchestrator/team.sqlite','node store/mod-bridge.mjs || true'])expect(sharedStoreProtection('Bash','',command)).toBeDefined()
 expect(sharedStoreProtection('Bash','','ls .team-orchestrator/ 2>/dev/null || true')).toBeUndefined()
})

const compoundReads=[
 'cd "C:/proj" && ls .team-orchestrator',
 'cd "C:/proj" && ls .team-orchestrator/',
 'cd "C:/proj" && ls ./.team-orchestrator',
 'cd "C:/proj" && ls .team-orchestrator | head -3',
 'cd "C:/proj" && ls .team-orchestrator || true',
 'cd "C:/proj" && ls .team-orchestrator && echo done',
 'cd "C:/proj" && ls -la .team-orchestrator',
 'cd "C:/proj" && grep -c . .team-orchestrator/.gitignore',
 'cd "C:/proj" && ls -la .team-orchestrator/ 2>&1; echo "---and with slash---"; cat .team-orchestrator/.gitignore 2>&1',
 'cd "C:/proj" && ls -la .team-orchestrator 2>&1 | head -3',
 'cd "C:/proj" && ls .team-o*/',
 'cd "C:/proj" && grep -n "925-to/launch-profiles .team-orchestrator" README.md | head -3',
 'cd "C:/proj" && ls docs | head -2',
 'cd "C:/proj" && ls -la team-orchestrator',
 'cd "C:/proj" && node --version; echo "x"',
]

test('D1: CEO cd-prefixed reads, pipes and stderr merges do not acquire nonmember authority',async($,on)=>{
 const files=fixture(on,{probeFails:true});files.calls.length=0
 for(const command of compoundReads)expect((await $.tool.call({tool:'Bash',command} as any) as any).result).toBe('executed')
 expect(files.calls.filter(a=>a[1]==='terminal'&&a[2]==='show').length).toBe(0)
})

test('D1: known members may perform the same compound reads without opening writes',async($,on)=>{
 const files=fixture(on,{member:true,probeFails:true});files.calls.length=0
 for(const command of compoundReads.filter(c=>!c.includes('node --version')))expect((await $.tool.call({tool:'Bash',command} as any) as any).result).toBe('executed')
 expect(files.calls.filter(a=>a[1]==='terminal'&&a[2]==='show').length).toBe(0)
 for(const command of ['cd "C:/proj" && ls .team-orchestrator > .team-orchestrator/output.txt','cd "C:/proj" && ls .team-orchestrator; rm .team-orchestrator/team.sqlite','cd "C:/proj" && echo x > .team-orchestrator/team.sqlite'])expect((await $.tool.call({tool:'Bash',command} as any) as any).deny).toBeDefined()
})

test('D1: literal cat heredoc content is data while its output path remains protected',async($,on)=>{
 fixture(on,{probeFails:true})
 const body='A report mentioning .team-orchestrator and roster.json.\nrm .team-orchestrator/team.sqlite\n'
 const command="cat > /tmp/d1-report.txt <<'REPORT'\n"+body+'REPORT\n'
 expect((await $.tool.call({tool:'Bash',command} as any) as any).result).toBe('executed')
 for(const unsafe of [command.replace('/tmp/d1-report.txt','.team-orchestrator/report.txt'),command+'rm .team-orchestrator/team.sqlite',command.replace("<<'REPORT'",'<<REPORT'),command.replace('cat >','bash >')])expect(sharedStoreProtection('Bash','',unsafe)).toBeDefined()
})

test('D1: uncertain membership blocks effects with a guard-owned error',async($,on)=>{
 fixture(on,{uncertain:true})
 const result:any=await $.tool.call({tool:'Write',file_path:'C:/temp/control.md',content:'control'} as any)
 expect(result.deny).toContain('guard could not verify itself')
})
test('D1: shared members retain Agent/Write restrictions and raw team-state protection',async($,on)=>{
 fixture(on,{member:true})
 expect((await $.tool.call({tool:'Write',file_path:'C:/temp/control.md',content:'control'} as any) as any).deny).toContain('has reports')
 expect((await $.tool.call({tool:'Agent',subagent_type:'general-purpose',prompt:'control'} as any) as any).deny).toContain('no subagent permission')
 expect((await $.tool.call({tool:'Write',file_path:'C:/proj/.team-orchestrator/team.sqlite',content:'control'} as any) as any).deny).toContain('typed shared_team')
})
test('D1: a member probe failure is reported as the guard failing, not as a fault in the requested operation',async($,on)=>{
 fixture(on,{member:true,probeFails:true})
 const response:any=await $.tool.call({tool:'Write',file_path:'C:/temp/control.md',content:'control'} as any)
 expect(response.deny).toContain('guard could not verify itself')
 expect(response.deny).not.toContain('project scope for')
 expect(response.deny).not.toContain('C:/temp/control.md')
})
test('D1: a known classic member is not released when the native probe fails',async($,on)=>{
 const files=fixture(on,{probeFails:true,previewOnly:true})
 files.set('C:/proj/.claude/team-orchestrator/roster.json',JSON.stringify(HUALONG.map(m=>({...m,team:'Hualong',sessionId:m.name==='Hualong CEO'?ID1:ID2}))))
 const response:any=await $.tool.call({tool:'Agent',subagent_type:'general-purpose',prompt:'control'} as any)
 expect(response.deny).toBeDefined()
 expect(response.deny).toContain('guard could not verify itself')
})
test('D1: held classic members keep composer-only grants without opening team files',async($,on)=>{
 const files=fixture(on,{probeFails:true,previewOnly:true})
 files.set('C:/proj/.claude/team-orchestrator/roster.json',JSON.stringify(HUALONG.map(m=>({...m,team:'Hualong',sessionId:m.name==='Hualong CEO'?ID1:ID2}))))
 on('prompt.submit',async(_$:any,e:any)=>({text:e.text}) as any)
 await $.prompt.submit({text:'#allow-write',origin:{kind:'composer'},wait:false} as any)
 expect((await $.tool.call({tool:'Write',file_path:'C:/temp/control.md',content:'control'} as any) as any).result).toBe('executed')
 expect((await $.tool.call({tool:'Agent',subagent_type:'general-purpose',prompt:'control'} as any) as any).deny).toBeDefined()
 expect((await $.tool.call({tool:'Write',file_path:'C:/proj/.claude/team-orchestrator/roster.json',content:'control'} as any) as any).deny).toBeDefined()
 expect((await $.tool.call({tool:'Bash',command:'orca worktree create --name forbidden'} as any) as any).deny).toBeDefined()
})
