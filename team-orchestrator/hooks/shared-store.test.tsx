import {expect,test} from 'claude-code/testing'
import {sharedStoreProtection} from './shared-store'
import {world,sessionAs,mountBand,ID1} from './test-world'
declare const setTimeout:(fn:()=>void,ms:number)=>unknown

test('the shared store blocks raw state and private approval access even for a controller',()=>{
 for(const tool of ['Write','Edit','NotebookEdit'])expect(sharedStoreProtection(tool,'C:/proj/.team-orchestrator/team.sqlite','')).toBeDefined()
 expect(sharedStoreProtection('Read','C:/home/.claude/team-orchestrator/controller-actions/secret.json','')).toBeDefined()
 expect(sharedStoreProtection('Bash','','node store/mod-bridge.mjs')).toBeDefined()
 expect(sharedStoreProtection('Bash','','sqlite3 .team-orchestrator/team.sqlite "UPDATE members SET allow_write=1"')).toBeDefined()
 expect(sharedStoreProtection('Read','C:/proj/README.md','')).toBeUndefined()
})

test('the disabled preview cannot invoke its private bridge',async($,on)=>{
 const calls:any[]=[];world(on,[],[],e=>{if(String(e.argv[1]).endsWith('mod-bridge.mjs'))calls.push(e)})
 const r:any=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'op',command:{type:'inspectCaller'}} as any)
 expect(r.deny).toContain('disabled');expect(calls.length).toBe(0)
})

test('a specific approval panel click mints scoped evidence; opening the panel does not approve', {options:{sharedStorePreview:true,orcaCommand:'orca'}} as any, async($:any,on:any)=>{
 const calls:any[]=[]
 const files=world(on,[],[],e=>{
  if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined
  calls.push(JSON.parse(e.init.stdin));return JSON.stringify({ok:true,result:{result:{controllerGeneration:1}}})
 })
 sessionAs(on,ID1)
 const band=await mountBand($);await band.press({key:'main'});await band.press({key:'tab-shared'})
 expect(calls.length).toBe(0)
 expect(await band.find({key:'shared-approve-controller'})).toBeDefined()
 await band.press({key:'shared-approve-controller'})
 for(let i=0;i<30&&calls.length===0;i++)await new Promise<void>(resolve=>setTimeout(resolve,5))
 expect(calls.length).toBe(1)
 const sent=calls[0]
 expect(sent.mode).toBe('approveController');expect(sent.proof.conversationId).toBe(ID1);expect(sent.proof.projectRoot).toBe('C:/proj')
 expect(sent.uiApprovalId.length).toBe(32)
 const ticket=JSON.parse(files.get(`C:/home/.claude/team-orchestrator/controller-actions/${sent.uiApprovalId}.json`)!)
 expect(ticket.action).toBe('approveController');expect(ticket.conversationId).toBe(ID1);expect(ticket.id).toBe(sent.uiApprovalId)
})

test('model arguments cannot choose the private approval mode or replace native caller facts', {options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 const calls:any[]=[]
 world(on,[],[],e=>{if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined;calls.push(JSON.parse(e.init.stdin));return JSON.stringify({ok:true,result:{result:{member:null}}})})
 sessionAs(on,ID1)
 await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'op',command:{type:'inspectCaller'},proof:{conversationId:'forged'},mode:'approveController',uiApprovalId:'forged'} as any)
 expect(calls.length).toBe(1);expect(calls[0].mode).toBe('execute');expect(calls[0].uiApprovalId).toBeUndefined();expect(calls[0].proof.conversationId).toBe(ID1)
})

test('redrawing the shared approval view performs no native subprocess verification', {options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 const files=world(on);sessionAs(on,ID1)
 const band=await mountBand($);await band.press({key:'main'});await band.press({key:'tab-shared'})
 expect(await band.find({key:'shared-approve-controller'})).toBeDefined()
 files.calls.length=0
 await band.drawn();await band.drawn();await band.drawn()
 expect(files.calls.length).toBe(0)
})

test('shared managers retain the existing write and Agent restrictions and composer-only grants', {options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 on('prompt.submit',async(_$:any,e:any)=>({text:e.text}) as any)
 on('tool.call',{tool:'Write'} as any,async()=>({result:'wrote'}) as any)
 const files=world(on,[],[],e=>{if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined;return JSON.stringify({ok:true,result:{result:{member:{name:'Head',boss_member_id:null,allow_write:0,allow_agent:0},hasReports:true}}})})
 sessionAs(on,ID1);files.set('C:/proj/.team-orchestrator/team.sqlite','fixture')
 const write:any=await $.tool.call({tool:'Write',file_path:'C:/proj/code.ts',content:'x'} as any)
 expect(write.deny).toContain('has reports')
 const agent:any=await $.tool.call({tool:'Agent',subagent_type:'general-purpose',prompt:'x'} as any)
 expect(agent.deny).toContain('no subagent permission')
 await $.prompt.submit({text:'#allow-write',origin:{kind:'composer'},wait:false} as any)
 const allowed:any=await $.tool.call({tool:'Write',file_path:'C:/proj/code.ts',content:'x'} as any)
 expect(allowed.result).toBe('wrote')
 const raw:any=await $.tool.call({tool:'Write',file_path:'C:/proj/.team-orchestrator/team.sqlite',content:'x'} as any)
 expect(raw.deny).toContain('typed shared_team')
})
