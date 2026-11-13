import {expect,test} from 'claude-code/testing'
import {world,sessionAs,ID1,ID2,ID3} from './test-world'
import {sharedIdentityText,sharedTeamIdentityContext} from './shared-identity'
import {judge,NO_GRANTS} from './guard'

const options={options:{sharedStorePreview:true,orcaCommand:'orca'}} as any
test('a Claude head receives current Codex worker identities on each prompt, including peer wakes',options,async($:any,on:any)=>{
 const head={member_id:'head',team_id:'research',name:'Research Head',cli:'claude',model:'default',membership_state:'active'}
 const first={member_id:'research-1',team_id:'research',name:'Research Worker 1',cli:'codex',model:'default',membership_state:'active'}
 const second={member_id:'research-2',team_id:'research',name:'Research Worker 2',cli:'codex',model:'default',membership_state:'active'}
 const snapshot={team:{team_id:'research',name:'Research',config_version:7},members:[head,first,second],bindings:[{member_id:'head',provider:'claude',conversation_id:ID1,generation:1},{member_id:first.member_id,provider:'codex',conversation_id:ID2,generation:1},{member_id:second.member_id,provider:'codex',conversation_id:ID3,generation:1}]}
 const calls:any[]=[],prompts:any[]=[]
 world(on,[],[],e=>{
  if(!String(e.argv[1]).endsWith('mod-bridge.mjs'))return undefined
  const envelope=JSON.parse(e.init.stdin);calls.push(envelope)
  if(envelope.mode==='inboxPoll')return JSON.stringify({ok:true,result:{message:null}})
  const command=envelope.request?.command
  const result=command?.type==='inspectCaller'?{member:head,binding:snapshot.bindings[0],controllerGeneration:1,teams:[snapshot.team]}:command?.type==='inspectTeam'?snapshot:{}
  return JSON.stringify({ok:true,result:{result}})
 });sessionAs(on,ID1)
 on('prompt.submit',async(_$:any,e:any)=>{prompts.push(e);return {text:e.text,context:e.context}})
 await $.prompt.submit({text:'What CLI do the Research specialists use?',origin:{kind:'composer'},wait:false} as any)
 const initial=JSON.stringify(prompts[0].context)
 expect(initial).toContain('Shared-team identity snapshot')
 expect(initial).toContain('Research Worker 1');expect(initial).toContain('Research Worker 2')
 expect(initial).toContain('configuredCli');expect(initial).toContain('codex')
 expect(initial).toContain('not proof of liveness, readiness or task pickup')
 expect(prompts[0].text).toBe('What CLI do the Research specialists use?')
 snapshot.bindings[1]!.generation=2
 first.name='Renamed Research Worker'
 await $.prompt.submit({text:'Shared inbox wake',origin:{kind:'peer'},wait:false} as any)
 const updated=JSON.stringify(prompts[1].context)
 expect(updated).toContain('Renamed Research Worker');expect(updated).toContain('bindingGeneration')
 expect(updated).not.toContain('Research Worker 1')
 expect(calls.filter(c=>c.request?.command?.type==='inspectTeam')).toHaveLength(2)
 expect(calls.filter(c=>c.request?.command?.type==='inspectTeam').every(c=>c.request.command.projection==='identity')).toBe(true)
 expect(calls.every(c=>c.mode==='inboxPoll'||['inspectCaller','inspectTeam'].includes(c.request?.command?.type))).toBe(true)
})

test('identity projection never defaults unknown CLI to Claude or treats a saved binding as runtime readiness',()=>{
 const snapshot:any={team:{team_id:'t',name:'Team',config_version:2},members:[{member_id:'w',name:'Claude research',role:'Research',model:'opus',membership_state:'active'}],bindings:[{member_id:'w',provider:'codex',generation:1}]}
 const text=sharedIdentityText(snapshot,{member:null})
 expect(text).toContain('"configuredCli":"unknown"');expect(text).toContain('"recordedSessionProvider":"codex"')
 expect(text).toContain('"state":"controller-only"');expect(text).toContain('not proof of liveness, readiness or task pickup')
 snapshot.members[0]!.cli='claude' as any
 expect(sharedIdentityText(snapshot,{member:null})).toContain('"bindingState":"provider-conflict"')
})

test('head context distinguishes an expired assignment from the leaf-write rule and agrees with the Mod guard',()=>{
 const members=[{member_id:'h',name:'Head',boss_member_id:null,generation:1,cli:'claude',membership_state:'active',allow_write:0,allow_agent:0},{member_id:'w',name:'Worker',boss_member_id:'h',generation:1,cli:'codex',membership_state:'active',allow_write:0,allow_agent:0}]
 const snapshot={team:{team_id:'t',config_version:7},members,bindings:[],work:[{assignment:{assignment_id:'expired',member_id:'w',pickup_observed_at_ms:null},task:{status:'open'},returned:{reason:'pickup_expired'}}]}
 const text=sharedIdentityText(snapshot,{member:members[0]}),data=JSON.parse(text.split('\n').at(-1)!)
 expect(data.members[0].guardPolicy.managerWriteRule).toBe('requires-write-grant')
 expect(data.members[1].guardPolicy.managerWriteRule).toBe('not-blocked-by-manager-rule')
 expect(data.members[1].guardPolicy.standingWritesEnabled).toBe(false)
 expect(data.assignmentReceipts[0].returnedReason).toBe('pickup_expired')
 expect(text).toContain('Name the actual guard verdict or receipt');expect(text).toContain('A fresh assignment changes no permissions')
 const list:any=members.map(m=>({name:m.name,boss:members.find(parent=>parent.member_id===m.boss_member_id)?.name??'',allowWrite:false,allowAgent:false}))
 for(let i=0;i<list.length;i++){
  const verdict=judge({me:list[i],list,tool:'Write',path:'C:/project/AGENTS.md',grants:NO_GRANTS,claudeDirs:[]})
  expect(verdict?.kind==='deny').toBe(data.members[i].guardPolicy.managerWriteRule==='requires-write-grant')
 }
})

test('unverified or ordinary callers disclose no roster; failed/cross-team reads cannot supply stale identity',async()=>{
 const calls:any[]=[];let member=false,cross=false
 const $={plugin:{root:'C:/plugin'},process:{run:async(_argv:any,init:any)=>{
  const envelope=JSON.parse(init.stdin);calls.push(envelope)
  const result=envelope.request.command.type==='inspectCaller'?{member:member?{member_id:'head',team_id:'t'}:null}:cross?{team:{team_id:'wrong'},members:[],bindings:[]}:null
  return {exitCode:0,stdout:JSON.stringify({ok:true,result:{result}})}
 }}}
 const proof={ok:true as const,root:'C:/proj',sessionId:ID1,handle:'head',contextId:'ctx'},options={node:'node',orca:'orca'}
 expect(await sharedTeamIdentityContext($,{ok:false,reason:'unverified'},options)).toBeUndefined();expect(calls.length).toBe(0)
 expect(await sharedTeamIdentityContext($,proof,options)).toBeUndefined();expect(calls.length).toBe(1)
 member=true
 expect(await sharedTeamIdentityContext($,proof,options)).toContain('unavailable')
 cross=true
 expect(await sharedTeamIdentityContext($,proof,options)).toContain('unavailable')
 expect(calls.every(c=>['inspectCaller','inspectTeam'].includes(c.request.command.type))).toBe(true)
})
