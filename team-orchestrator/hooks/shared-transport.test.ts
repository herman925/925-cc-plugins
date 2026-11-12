import {expect,test} from 'claude-code/testing'
import {pumpSharedDeliveries,queueSharedDeliveries} from './shared-transport'

const proof={ok:true as const,root:'C:/fixture',sessionId:'head-conversation',handle:'term-head',contextId:'fixture'}
const options={node:'node',orca:'orca'}
function fixture(response:any={}) {
 const commands:any[]=[],sent:any[]=[]
 const $={plugin:{root:'C:/plugin'},process:{run:async(_argv:any,init:any)=>{
  const request=JSON.parse(init.stdin).request;commands.push(request.command)
  const value=request.command.type==='inspectCaller'?{ok:true,result:{result:{member:{member_id:'head',team_id:'team',generation:3},binding:{generation:2},configVersion:7}}}:request.command.type==='observeDeadlines'?{ok:true,result:{result:{returned:[]}}}:response
  return {exitCode:value.ok?0:1,stdout:JSON.stringify(value)}
 }},session:{send:async(value:any)=>{sent.push(value);return {isDelivered:true}}}}
 return {$,commands,sent}
}

test('native actions schedule transport separately and coalesce pending timers',async()=>{
 const f=fixture(),timers:any[]=[];const $={...f.$,clock:{after:(ms:number,fn:any)=>{timers.push({ms,fn})}}}
 queueSharedDeliveries($,proof,options);queueSharedDeliveries($,proof,options)
 expect(timers.length).toBe(1);expect(f.commands.length).toBe(0)
 timers[0].fn();await Promise.resolve();await Promise.resolve();expect(f.commands[0].type).toBe('inspectCaller')
})
test('unverified caller never starts transport I/O',async()=>{
 const f=fixture();await pumpSharedDeliveries(f.$,{ok:false,reason:'unknown'},options)
 expect(f.commands.length).toBe(0);expect(f.sent.length).toBe(0)
})
test('the Mod launch pump leaves reviewed Codex reservations to the native Codex adapter',async()=>{
 const started:string[]=[];const $={plugin:{root:'C:/plugin'},process:{run:async(_argv:any,init:any)=>{
  const e=JSON.parse(init.stdin),c=e.request.command;
  if(e.mode==='launchMember')started.push(c.memberId);
  const value=c.type==='inspectCaller'?{controllerGeneration:1,teams:[{team_id:'team'}]}:c.type==='inspectTeam'?{team:{config_version:7},members:[{member_id:'codex-worker',cli:'codex',generation:1},{member_id:'claude-worker',cli:'claude',generation:1}],launches:[{launch_id:'codex',member_id:'codex-worker',status:'queued'},{launch_id:'claude',member_id:'claude-worker',status:'queued'}]}:{};
  return {exitCode:0,stdout:JSON.stringify({ok:true,result:{result:value}})};
 }}};await pumpSharedDeliveries($,proof,options);expect(started).toEqual(['claude-worker']);
})
test('queued bindings without fresh private native verification are never transport targets',async()=>{
 const f=fixture({ok:true,result:{result:{deliveries:[{recipient:{conversation_id:'impostor'}}]}}})
 await pumpSharedDeliveries(f.$,proof,options)
 expect(f.commands.map(c=>c.type)).toEqual(['inspectCaller','observeDeadlines','prepareDeliveries']);expect(f.sent.length).toBe(0)
})
test('Codex wakes use the private native child with the original reservation, never shell input or orchestration mail',async()=>{
 const commands:any[]=[],processes:any[]=[],requestIds:string[]=[]
 const delivery={deliveryId:'d',messageId:'m',threadId:'thread',recipient:{provider:'codex'}}
 const $={plugin:{root:'C:/plugin'},process:{run:async(argv:any,init:any)=>{
  processes.push(argv);const e=JSON.parse(init.stdin)
  if(argv[1].endsWith('/mod-wake.mjs')){requestIds.push(e.request.operationId);expect(e.proof.handle).toBeUndefined();expect(e.proof.terminalHandle).toBe(proof.handle);return {exitCode:0,stdout:'{"ok":true}'}}
  commands.push(e.request)
  const type=e.request.command.type
  const result=type==='inspectCaller'?{member:{member_id:'head',team_id:'team',generation:1},binding:{generation:1},configVersion:7}:type==='prepareDeliveries'?{deliveries:[delivery]}:{}
  return {exitCode:0,stdout:JSON.stringify({ok:true,result:{result},transportTargets:type==='prepareDeliveries'?[{provider:'codex',terminalHandle:'worker'}]:[]})}
 }},session:{send:async()=>{throw Error('Codex must not use the Claude session API')}}}
 await pumpSharedDeliveries($,proof,options)
 expect(requestIds).toEqual([commands[2].operationId]);expect(processes.length).toBe(4)
 expect(processes.every(argv=>argv[0]==='node')).toBe(true)
 expect(commands.map(e=>e.command.type)).toEqual(['inspectCaller','observeDeadlines','prepareDeliveries'])
})
test('wake sends a durable pointer and never acknowledges a message or assumes pickup',async()=>{
 const target={deliveryId:'delivery-1',messageId:'message-1',threadId:'thread-1',replay:true,conversationId:'worker-conversation'}
 const f=fixture({ok:true,result:{result:{deliveries:[]}},transportTargets:[target]})
 await pumpSharedDeliveries(f.$,proof,options)
 expect(f.sent.length).toBe(1);expect(f.sent[0].to.sessionId).toBe('worker-conversation')
 expect(f.sent[0].text).toContain('not acknowledgement');expect(f.sent[0].text).toContain('"deliveryId":"delivery-1"')
 expect(f.sent[0].text).toContain('shared_inbox_read');expect(f.sent[0].text).toContain('shared_inbox_seen')
 expect(f.commands.some(c=>/read|ack|verifyAssignment/i.test(c.type))).toBe(false)
 expect(f.commands[2].expectedBindingGeneration).toBe(2)
})
test('unknown reservation outcome sends nothing; a failed wake leaves the pump usable',async()=>{
 const unknown=fixture({ok:false,error:{code:'STORE_COMMIT_UNKNOWN'}})
 await pumpSharedDeliveries(unknown.$,proof,options);expect(unknown.sent.length).toBe(0)
 const f=fixture({ok:true,transportTargets:[{conversationId:'worker',deliveryId:'delivery',messageId:'message',threadId:'thread',replay:false}]})
 f.$.session.send=async()=>{throw Error('offline')}
 await pumpSharedDeliveries(f.$,proof,options);await pumpSharedDeliveries(f.$,proof,options)
 expect(f.commands.length).toBe(6)
})
