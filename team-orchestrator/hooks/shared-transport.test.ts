import {expect,test} from 'claude-code/testing'
import {pumpSharedDeliveries,queueSharedDeliveries,sharedWakeContext,sharedWakeObservation} from './shared-transport'
const proof={ok:true as const,root:'C:/fixture',sessionId:'head',handle:'term-head',contextId:'fixture'}
const options={node:'node',orca:'orca'}
function fixture(results:any[]=[]){
 const calls:any[]=[],toasts:string[]=[]
 const $={plugin:{root:'C:/plugin'},ui:{toast:async value=>toasts.push(value)},process:{run:async(argv,init)=>{
  calls.push({argv,init})
  return {exitCode:0,stdout:JSON.stringify({ok:true,result:{dispatcher:{state:'connected'},results,checkedAt:Date.now()}})}
 }}}
 return {calls,toasts,$}
}
test('the UI opens a native dispatcher receiver instead of polling team tables',async()=>{
 const f=fixture();await pumpSharedDeliveries(f.$,proof,options);expect(f.calls.length).toBe(1);const call=f.calls[0];expect(call.argv[1]).toBe('C:/plugin/store/src/mod-dispatch-receiver.mjs');const input=JSON.parse(call.init.stdin);expect(input.proof.terminalHandle).toBe(proof.handle);expect(input.request).toBeUndefined();expect(input.pluginRoot).toBe('C:/plugin');expect(sharedWakeObservation(proof)?.dispatcher.state).toBe('connected')
})
test('native action timers coalesce and leave work to the receiver',async()=>{
 const f=fixture(),timers:any[]=[],$={...f.$,clock:{after:(ms,fn)=>timers.push({ms,fn})}};queueSharedDeliveries($,proof,options);queueSharedDeliveries($,proof,options);expect(timers.length).toBe(1);expect(f.calls.length).toBe(0);timers[0].fn();await Promise.resolve();await Promise.resolve();expect(f.calls.length).toBe(1)
})
test('unverified scopes never start a receiver',async()=>{const f=fixture();await pumpSharedDeliveries(f.$,{ok:false,reason:'unknown'},options);expect(f.calls.length).toBe(0)})
test('overlapping refreshes retain one receiver connection',async()=>{
 const f=fixture();let release:any;f.$.process.run=async()=>new Promise(resolve=>release=()=>resolve({exitCode:0,stdout:'{"ok":true,"result":{"results":[]}}'}));const one=pumpSharedDeliveries(f.$,proof,options);await pumpSharedDeliveries(f.$,proof,options);expect(typeof release).toBe('function');release();await one
})
test('blocked observations are scoped and do not invoke a session-send fallback',async()=>{
 const local={...proof,sessionId:'blocked'},f=fixture([{state:'host-update-required'}]);await pumpSharedDeliveries(f.$,local,options);expect(sharedWakeContext(local)).toContain('host-update-required');expect(sharedWakeContext({...local,sessionId:'other'})).toBeUndefined();expect(f.toasts.length).toBe(1);await pumpSharedDeliveries(f.$,local,options);expect(f.toasts.length).toBe(1)
})
test('an unknown child result remains visible and permits the next connection',async()=>{
 const local={...proof,sessionId:'unknown'},f=fixture();f.$.process.run=async()=>({exitCode:1,stdout:'bad'});await pumpSharedDeliveries(f.$,local,options);expect(sharedWakeObservation(local)?.lastError).toBe('API_RECEIVER_UNVERIFIED');expect(sharedWakeContext(local)).toContain('needs-reconciliation');await pumpSharedDeliveries(f.$,local,options)
})
