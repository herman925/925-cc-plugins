import {expect,test} from 'claude-code/testing'
import {projectWorkspaceEnabled,withProjectWorkspace,workspaceProjectKey,parseProjectWorkspaceModes} from './project-workspace'
import {world,sessionAs,ID1,mountBand} from './test-world'

test('a project choice survives option reload without changing other project defaults',()=>{
 const modes=withProjectWorkspace(['shared|c:/other'],'C:\\Project A\\',true)
 const reloaded=JSON.parse(JSON.stringify(modes))
 expect(projectWorkspaceEnabled(false,reloaded,'c:/PROJECT A/')).toBe(true)
 expect(projectWorkspaceEnabled(false,reloaded,'C:/Project B')).toBe(false)
 expect(projectWorkspaceEnabled(false,reloaded,'C:/other')).toBe(true)
 expect(projectWorkspaceEnabled(true,reloaded,'C:/Project B')).toBe(true)
 const off=withProjectWorkspace(reloaded,'C:/Project A',false)
 expect(projectWorkspaceEnabled(true,off,'C:/Project A')).toBe(false)
 expect(off.filter(x=>x.endsWith('|c:/project a')).length).toBe(1)
 expect(workspaceProjectKey('/projects/A')).not.toBe(workspaceProjectKey('/projects/a'))
})
test('a saved project choice gates the model API without turning on the global preview',{options:{orcaCommand:'orca',projectWorkspaceModes:'["shared|c:/proj"]'}} as any,async($:any,on:any)=>{
 const calls:any[]=[];world(on,[],[],e=>{if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined;calls.push(JSON.parse(e.init.stdin));return JSON.stringify({ok:true,result:{result:{member:null,teams:[]}}})});sessionAs(on,ID1)
 const result=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'saved-project',command:{type:'inspectCaller'}} as any)
 expect(result.deny).toBeUndefined();expect(calls.length).toBe(1);expect(calls[0].mode).toBe('execute')
})
test('another project saved choice leaves this project disabled',{options:{orcaCommand:'orca',projectWorkspaceModes:'["shared|c:/other"]'}} as any,async($:any,on:any)=>{
 const files=world(on);sessionAs(on,ID1)
 const result=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'other-project',command:{type:'inspectCaller'}} as any)
 expect(result.deny).toContain('disabled');expect(files.calls.some(a=>String(a[1]).endsWith('mod-bridge.mjs'))).toBe(false)
})

test('native text config round-trips project choices and rejects malformed values',()=>{
 expect(parseProjectWorkspaceModes(JSON.stringify(['shared|c:/proj','classic|c:/other']))).toEqual(['shared|c:/proj','classic|c:/other'])
 expect(()=>parseProjectWorkspaceModes('{bad')).toThrow()
 expect(()=>parseProjectWorkspaceModes('[1]')).toThrow()
})

test('malformed saved choices are visible and never overwritten by enabling',{options:{orcaCommand:'orca',sharedStorePreview:true,projectWorkspaceModes:'{invalid'}} as any,async($:any,on:any)=>{
 const sets:any[]=[];on('config.set',async(_$:any,e:any)=>{sets.push(e);return {value:e.value} as any})
 const files=world(on);sessionAs(on,ID1)
 const band=await mountBand($);await band.press({key:'band-settings'});await band.press({key:'settings-connection'})
 expect(JSON.stringify(await band.drawn())).toContain('Saved project workspace choices are invalid')
 await band.press({key:'shared-preview-on'})
 expect(sets.length).toBe(0)
 const result=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'malformed-settings',command:{type:'inspectCaller'}} as any)
 expect(result.deny).toContain('invalid')
 expect(files.calls.some(a=>String(a[1]).endsWith('mod-bridge.mjs'))).toBe(false)
})
