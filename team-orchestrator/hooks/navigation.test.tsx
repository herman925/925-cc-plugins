import {expect,test} from 'claude-code/testing'
import {world,sessionAs,mountBand,ID1} from './test-world'

test('each active top tab closes its panel; another tab switches panels',async($,on)=>{
 world(on)
 const band=await mountBand($)
 for(const key of ['tab-roster','tab-new','tab-settings','tab-shared']){
  await band.press({key:'main'})
  if(key!=='tab-roster')await band.press({key})
  expect(await band.find({key})).toBeDefined()
  await band.press({key})
  expect(await band.find({key:'close'})).toBeUndefined()
  expect(await band.find({key:'band-settings'})).toBeDefined()
 }
 await band.press({key:'band-settings'})
 await band.press({key:'tab-roster'})
 expect(await band.find({key:'settings'})).toBeUndefined()
 expect(await band.find({key:'preset-Squad'})).toBeDefined()
 expect(await band.find({key:'close'})).toBeDefined()
})

test('Settings shortcut is visible only while the panel is closed',async($,on)=>{
 world(on)
 const band=await mountBand($)
 expect(await band.find({key:'band-settings'})).toBeDefined()
 expect(await band.find({key:'tab-settings'})).toBeUndefined()
 await band.press({key:'band-settings'})
 expect(await band.find({key:'band-settings'})).toBeUndefined()
 expect(await band.find({key:'tab-settings'})).toBeDefined()
 expect(await band.find({key:'settings'})).toBeUndefined()
 await band.press({key:'tab-settings'})
 expect(await band.find({key:'band-settings'})).toBeDefined()
 expect(await band.find({key:'tab-settings'})).toBeUndefined()
})

test('shared setup hides all legacy creation paths and only reveals shared creation after explicit approval',{options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 let approved=false
 const calls:any[]=[]
 world(on,[],[],e=>{
  if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined
  const request=JSON.parse(e.init.stdin);calls.push(request)
  if(request.mode==='approveController')approved=true
  return approved?JSON.stringify({ok:true,result:{result:{controllerGeneration:1,member:null,teams:[]}}}):JSON.stringify({ok:false,error:{code:'STORE_NOT_FOUND',message:'Team store does not exist. Explicit creation is required.'}})
 });sessionAs(on,ID1)
 const band=await mountBand($,60);await band.press({key:'main'})
 for(const key of ['tab-new','preset-Squad','interview-empty','go'])expect(await band.find({key})).toBeUndefined()
 await band.press({key:'empty-open-shared'})
 expect(await band.find({key:'shared-approve-controller'})).toBeDefined()
 expect(await band.find({key:'workspace-new'})).toBeUndefined()
 expect(await band.find({key:'workspace-refresh'})).toBeUndefined()
 await band.press({key:'shared-details'})
 expect(JSON.stringify(await band.drawn())).toContain('No shared store yet. Approve controller')
 expect(JSON.stringify(await band.drawn())).not.toContain('STORE_NOT_FOUND')
 await band.press({key:'shared-approve-controller'})
 expect(await band.find({key:'workspace-new'})).toBeDefined()
 expect(await band.find({key:'tab-new'})).toBeUndefined()
 const shown=JSON.stringify(await band.drawn())
 expect(shown.indexOf('Team workspace')<shown.indexOf('Connection details')).toBe(true)
 expect(calls.some(c=>c.request?.command?.type==='createFreshTeam')).toBe(false)
})

test('closing the active Shared store tab performs no native verification',{options:{sharedStorePreview:true,orcaCommand:'orca'}} as any,async($:any,on:any)=>{
 const files=world(on,[],[],e=>String(e.argv[1]).endsWith('mod-bridge.mjs')?JSON.stringify({ok:true,result:{result:{controllerGeneration:1,member:null}}}):undefined)
 sessionAs(on,ID1)
 const band=await mountBand($);await band.press({key:'main'});await band.press({key:'tab-shared'})
 expect(await band.find({key:'workspace-new'})).toBeDefined()
 files.calls.length=0
 await band.press({key:'tab-shared'})
 expect(await band.find({key:'workspace-new'})).toBeUndefined()
 expect(await band.find({key:'tab-shared'})).toBeUndefined()
 expect(files.calls.length).toBe(0)
})

test('an active dock tab closes the native pane and the band shortcut can reopen it',async($,on)=>{
 world(on)
 let placed=false
 const opens:string[]=[],closes:string[]=[]
 on('ui.open',async(_$:any,e:any)=>{opens.push(e.id);placed=true;return {value:{isPlaced:true}} as any})
 on('ui.close',async(_$:any,e:any)=>{closes.push(e.id);placed=false;return {value:undefined} as any})
 on('ui.panes',async()=>({value:placed?[{id:'team-dock',isPlaced:true}]:[]}) as any)
 const band=await mountBand($);await band.press({key:'band-settings'});await band.press({key:'layout-dock'})
 const pane=await $.ui.mount({plugin:'team-orchestrator',surface:'terminal',component:'Pane',requestId:'team-dock',props:{title:'Team Orchestrator',isFocused:true,bodyColumns:80,placement:'side'} as any})
 await pane.press({key:'tab-settings'})
 expect(closes.includes('team-dock')).toBe(true)
 expect(await pane.find({key:'tab-settings'})).toBeUndefined()
 expect(await band.find({key:'band-settings'})).toBeDefined()
 await band.press({key:'band-settings'})
 expect(opens.filter(id=>id==='team-dock').length).toBe(2)
 expect(await pane.find({key:'tab-settings'})).toBeDefined()
 expect(await band.find({key:'band-settings'})).toBeUndefined()
})
