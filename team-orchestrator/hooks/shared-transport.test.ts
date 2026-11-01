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
test('queued bindings without fresh private native verification are never transport targets',async()=>{
 const f=fixture({ok:true,result:{result:{deliveries:[{recipient:{conversation_id:'impostor'}}]}}})
 await pumpSharedDeliveries(f.$,proof,options)
 expect(f.commands.map(c=>c.type)).toEqual(['inspectCaller','observeDeadlines','prepareDeliveries']);expect(f.sent.length).toBe(0)
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
