import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planTeam,DEFAULT_FORM} from '../src/team.mjs';
import {requiredDispatchDepth,ensureDispatchDepth,nativeDispatchDepth} from '../src/local/dispatch-depth.mjs';
const local=requiredDepth=>({requiredDepth,scope:{executionHostId:'local'}});

test('the saved hierarchy requires one generation for a sole supervisor and two for 11/21 members',()=>{
 for(const [leads,workers,total,depth] of [[1,3,4,1],[2,4,11,2],[4,4,21,2]]){
  const team=planTeam({...DEFAULT_FORM,levels:leads>1?3:2,leadCount:leads,workersPerLead:workers});
  assert.equal(team.members.length,total);assert.equal(requiredDispatchDepth(team.members),depth);
 }
 assert.throws(()=>requiredDispatchDepth([{id:'a',boss:'a'}]),/hierarchy/);
 assert.throws(()=>requiredDispatchDepth([{id:'root',boss:null},{id:'a',boss:'missing'}]),/unavailable/);
});
test('flat rosters leave native settings untouched; host defaults match Orca',async()=>{
 const result=await ensureDispatchDepth(local(1),{});assert.equal(result.status,'not-needed');
 for(const value of [undefined,null,0,-1,1.5,'2'])assert.equal(nativeDispatchDepth({nestedWorkerMaxDepth:value}),1);
 assert.throws(()=>nativeDispatchDepth(Promise.resolve({})),/format/);
});
test('raise only the missing second generation, then verify; never restore or lower a higher limit',async()=>{
 for(const initial of [1,2,4]){
  let value=initial;const writes=[];
  const result=await ensureDispatchDepth(local(2),{authority:async()=>{},getSettings:()=>({nestedWorkerMaxDepth:value,unrelated:true}),setSettings:args=>{writes.push(args);value=args.nestedWorkerMaxDepth;}});
  assert.equal(value,Math.max(initial,2));assert.equal(result.observedDepth,value);assert.equal(result.adjusted,initial===1);
  assert.deepEqual(writes,initial===1?[{nestedWorkerMaxDepth:2}]:[]);
 }
});
test('the last synchronous native read honors a concurrently raised setting',async()=>{
 let value=1;
 const result=await ensureDispatchDepth(local(2),{authority:async()=>{value=5;},getSettings:()=>({nestedWorkerMaxDepth:value}),setSettings:()=>{throw Error('Must not lower 5');}});
 assert.equal(result.observedDepth,5);assert.equal(result.adjusted,false);
});
test('denied, missing, asynchronous or unconfirmed native settings stop before launches',async()=>{
 await assert.rejects(ensureDispatchDepth(local(2),{authority:async()=>{throw Error('revoked');}}),/revoked/);
 await assert.rejects(ensureDispatchDepth(local(2),{authority:async()=>{}}),/cannot configure/);
 await assert.rejects(ensureDispatchDepth(local(2),{authority:async()=>{},getSettings:()=>Promise.resolve({}),setSettings:()=>{throw Error('Must not write');}}),/format/);
 await assert.rejects(ensureDispatchDepth(local(2),{authority:async()=>{},getSettings:()=>({nestedWorkerMaxDepth:1}),setSettings:()=>{}}),/did not confirm/);
});
test('remote scopes and deeper legacy rosters do not rewrite local or higher limits',async()=>{
 assert.equal((await ensureDispatchDepth({requiredDepth:2,scope:{executionHostId:'ssh:remote'}},{})).status,'remote-not-verified');
 await assert.rejects(ensureDispatchDepth(local(3),{authority:async()=>{},getSettings:()=>({nestedWorkerMaxDepth:1}),setSettings:()=>{throw Error('Must not raise above 2');}}),/above 2/);
 assert.equal((await ensureDispatchDepth(local(3),{authority:async()=>{},getSettings:()=>({nestedWorkerMaxDepth:4}),setSettings:()=>{throw Error('Must not lower 4');}})).observedDepth,4);
});
