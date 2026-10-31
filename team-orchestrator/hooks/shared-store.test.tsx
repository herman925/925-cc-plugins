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
  const request=JSON.parse(e.init.stdin);calls.push(request);return JSON.stringify({ok:true,result:{result:{controllerGeneration:request.mode==='approveController'?1:null}}})
 })
 sessionAs(on,ID1)
 const band=await mountBand($);await band.press({key:'main'});await band.press({key:'tab-shared'})
 expect(calls.filter(c=>c.mode==='approveController').length).toBe(0)
 expect([...files.keys()].filter(k=>k.includes('controller-actions/')).length).toBe(0)
 expect(await band.find({key:'shared-approve-controller'})).toBeDefined()
 await band.press({key:'shared-approve-controller'})
 const approvals=calls.filter(c=>c.mode==='approveController')
 expect(approvals.length).toBe(1)
 const sent=approvals[0]
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
 const files=world(on,[],[],e=>String(e.argv[1]).endsWith('mod-bridge.mjs')?JSON.stringify({ok:false,error:{code:'STORE_NOT_FOUND'}}):undefined);sessionAs(on,ID1)
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

test('the band opens clickable preview options while off, without a slash command or approval',async($,on)=>{
 const sets:any[]=[],calls:any[]=[]
 on('config.set',async(_$:any,e:any)=>{sets.push(e);if(e.key==='team-orchestrator.sharedStorePreview'&&typeof e.value!=='boolean')return {deny:'toggle requires boolean'} as any;return {value:e.value} as any})
 const files=world(on,[],[],e=>{if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined;calls.push(JSON.parse(e.init.stdin));return JSON.stringify({ok:true,result:{result:{controllerGeneration:null,member:null}}})})
 sessionAs(on,ID1)
 const band=await mountBand($)
 await band.press({key:'band-settings'})
 expect(await band.find({key:'shared-preview-on'})).toBeDefined()
 await band.press({key:'shared-preview-on'})
 expect(sets.some(e=>e.key==='team-orchestrator.sharedStorePreview'&&e.value===true)).toBe(true)
 expect(calls.length).toBe(0)
 expect([...files.keys()].some(k=>k.includes('controller-actions'))).toBe(false)
 const activated:any=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'inspect-after-on',command:{type:'inspectCaller'}} as any)
 expect(activated.deny).toBeUndefined()
 expect(calls.length).toBe(1)
 await band.press({key:'shared-preview-off'})
 const denied:any=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'inspect-after-off',command:{type:'inspectCaller'}} as any)
 expect(denied.deny).toContain('disabled');expect(calls.length).toBe(1)
})

test('a refused option save leaves the preview off and reports a useful failure',async($,on)=>{
 world(on);on('config.set',async()=>({deny:'settings read-only'}) as any)
 const band=await mountBand($);await band.press({key:'band-settings'});await band.press({key:'shared-preview-on'})
 expect(JSON.stringify(await band.drawn())).toContain('could not be saved')
 const result:any=await $.tool.call({tool:'mcp__team-orchestrator__shared_team',operationId:'disabled',command:{type:'inspectCaller'}} as any)
 expect(result.deny).toContain('disabled')
})

test('Node executable is edited with a field and saved once, without running the draft',async($,on)=>{
 const sets:any[]=[];on('config.set',async(_$:any,e:any)=>(sets.push(e),{value:e.value}) as any)
 const files=world(on);const band=await mountBand($);await band.press({key:'band-settings'})
 await band.input({key:'shared-node-input',text:'C:/Program Files/nodejs/node.exe',kind:'change'})
 expect(sets.length).toBe(0)
 await band.press({key:'shared-node-save'})
 expect(sets.filter(e=>e.key==='team-orchestrator.sharedStoreNode').length).toBe(1)
 expect(sets[0].value).toBe('C:/Program Files/nodejs/node.exe')
 expect(files.calls.some(a=>a[0]==='C:/Program Files/nodejs/node.exe')).toBe(false)
})

test('the Orca connection field validates before saving even when the host skips own config hooks',async($,on)=>{
 const sets:any[]=[];on('config.set',async(_$:any,e:any)=>(sets.push(e),{value:e.value}) as any)
 world(on);const band=await mountBand($);await band.press({key:'band-settings'})
 await band.input({key:'shared-orca-input',text:'missing-orca',kind:'change'});await band.press({key:'shared-orca-save'})
 expect(sets.some(e=>e.key==='team-orchestrator.orcaCommand')).toBe(false)
 expect(JSON.stringify(await band.drawn())).toContain('could not be saved')
})

test('an already-approved workspace shows a status card and keeps receipt JSON behind Details', {options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 world(on,[],[],e=>String(e.argv[1]).endsWith('mod-bridge.mjs')?JSON.stringify({ok:true,result:{operationId:'private-receipt-id',result:{controllerGeneration:1}}}):undefined);sessionAs(on,ID1)
 const band=await mountBand($,80);await band.press({key:'main'});await band.press({key:'tab-shared'})
 expect(JSON.stringify(await band.drawn())).toContain('APPROVED')
 expect(JSON.stringify(await band.drawn())).not.toContain('private-receipt-id')
 expect(await band.find({key:'shared-approve-controller'})).toBeUndefined()
 await band.press({key:'shared-details'})
 expect(JSON.stringify(await band.drawn())).toContain('private-receipt-id')
})

test('an uncertain approval requires a readback before another approval action', {options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 let approvals=0
 world(on,[],[],e=>{if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined;const request=JSON.parse(e.init.stdin);if(request.mode==='approveController'){approvals++;return JSON.stringify({ok:false,error:{code:'API_BRIDGE_UNKNOWN'}})}return JSON.stringify({ok:true,result:{result:{controllerGeneration:approvals?1:null}}})});sessionAs(on,ID1)
 const band=await mountBand($);await band.press({key:'main'});await band.press({key:'tab-shared'});await band.press({key:'shared-approve-controller'})
 expect(await band.find({key:'shared-approve-controller'})).toBeUndefined()
 expect(JSON.stringify(await band.drawn())).toContain('Check access before retrying')
 await band.press({key:'shared-refresh'})
 expect(JSON.stringify(await band.drawn())).toContain('APPROVED');expect(approvals).toBe(1)
})

test('switching the preview off cannot bypass existing shared member or raw-store guards',async($,on)=>{
 const files=world(on,[],[],e=>String(e.argv[1]).endsWith('mod-bridge.mjs')?JSON.stringify({ok:true,result:{result:{member:{name:'Head',boss_member_id:null,allow_write:0,allow_agent:0},hasReports:true}}}):undefined)
 sessionAs(on,ID1);files.set('C:/proj/.team-orchestrator/team.sqlite','fixture')
 const denied:any=await $.tool.call({tool:'Write',file_path:'C:/proj/code.ts',content:'x'} as any)
 expect(denied.deny).toContain('has reports')
 const raw:any=await $.tool.call({tool:'Write',file_path:'C:/proj/.team-orchestrator/team.sqlite',content:'x'} as any)
 expect(raw.deny).toContain('typed shared_team')
})
