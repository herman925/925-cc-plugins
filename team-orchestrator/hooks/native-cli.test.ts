import {expect,test} from 'claude-code/testing'
import {HUALONG,ID1,ID2,sessionAs,world} from './test-world'
import {nativeCliFailure} from './native-cli'

test('D2: failed native CLI observations preserve only a bounded category and exit status',()=>{
 expect(nativeCliFailure({exitCode:7,stderr:'runtime_access_denied SECRET_RUNTIME_TOKEN'})).toBe('guard probe access-denied; exit 7')
 expect(nativeCliFailure({exitCode:2,stdout:'SECRET_RUNTIME_TOKEN'})).toBe('guard probe subprocess-failed; exit 2')
 expect(nativeCliFailure({},Object.assign(Error('SECRET_RUNTIME_TOKEN'),{code:'ENOENT'}))).toBe('guard probe executable-unavailable')
 expect(nativeCliFailure({},Object.assign(Error('SECRET_RUNTIME_TOKEN'),{name:'TimeoutError'}))).toBe('guard probe timeout')
})

for(const [diagnostic,message] of [
 ['access-denied','EPERM: PRIVATE_SENTINEL permission denied'],
 ['executable-unavailable','ENOENT: PRIVATE_SENTINEL spawn failed'],
 ['timeout','ETIMEDOUT: PRIVATE_SENTINEL timed out'],
 ['subprocess-failed','PRIVATE_SENTINEL opaque subprocess failure'],
])test(`D2: member guard identifies ${diagnostic} without exposing subprocess text`,async($,on)=>{
 const files=world(on,[],[],e=>{if(e.argv[1]==='terminal'&&e.argv[2]==='show')return {exitCode:1,stderr:message}})
 sessionAs(on,ID1)
 files.set('C:/proj/.claude/team-orchestrator/roster.json',JSON.stringify(HUALONG.map(m=>({...m,team:'Hualong',sessionId:m.name==='Hualong CEO'?ID1:ID2}))))
 on('tool.call',{tool:'Agent'} as any,async()=>({result:'must not execute'}) as any)
 const response:any=await $.tool.call({tool:'Agent',subagent_type:'general-purpose',prompt:'control'} as any)
 expect(response.deny).toContain('guard could not verify itself')
 expect(response.deny).toContain(diagnostic)
 expect(response.deny).not.toContain('PRIVATE_SENTINEL')
})
