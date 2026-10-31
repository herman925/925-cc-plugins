import {expect,test} from 'claude-code/testing'
import {projectWorkspaceEnabled,withProjectWorkspace,workspaceProjectKey} from './project-workspace'
import {world,sessionAs,ID1} from './test-world'

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
test('a saved project choice gates the model API without turning on the global preview',{options:{orcaCommand:'orca',projectWorkspaceModes:['shared|c:/proj']}} as any,async($:any,on:any)=>{
 const calls:any[]=[];world(on,[],[],e=>{if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined;calls.push(JSON.parse(e.init.stdin));return JSON.stringify({ok:true,result:{result:{member:null,teams:[]}}})});sessionAs(on,ID1)
 const result=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'saved-project',command:{type:'inspectCaller'}} as any)
 expect(result.deny).toBeUndefined();expect(calls.length).toBe(1);expect(calls[0].mode).toBe('execute')
})
test('another project saved choice leaves this project disabled',{options:{orcaCommand:'orca',projectWorkspaceModes:['shared|c:/other']}} as any,async($:any,on:any)=>{
 const files=world(on);sessionAs(on,ID1)
 const result=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'other-project',command:{type:'inspectCaller'}} as any)
 expect(result.deny).toContain('disabled');expect(files.calls.some(a=>String(a[1]).endsWith('mod-bridge.mjs'))).toBe(false)
})
