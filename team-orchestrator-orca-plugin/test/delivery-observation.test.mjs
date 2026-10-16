import {test} from 'node:test';
import assert from 'node:assert/strict';
import {questionFixture} from './questions-fixture.mjs';
import {createWorkService} from '../src/local/teamwork.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';
import {createLifecycleService} from '../src/local/lifecycle.mjs';
async function delivery(t,kind='structured'){
 const f=await questionFixture(t,{kind});await createDispatchService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works}).check(f.work.id);
 const propose=(id,previousDeliveryId=null)=>{
  const protocol=f.store.readDispatchProtocol(f.work.id),spec=JSON.stringify({protocol:'team-delivery/v1',workId:f.work.id,token:protocol.token,generation:protocol.generation,supervisorMemberId:f.work.supervisorMemberId,previousDeliveryId,summary:'Read-only objective verified.',evidenceRefs:['report:readonly'],attemptIds:[]}),task={id,run_id:'run-head',spec,status:'ready'};
  f.db.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id,task.run_id,spec,task.status,null,kind==='terminal'?'term-head':null,kind==='terminal'?f.binding.paneKey:null,kind==='terminal'?'head-pty:head-instance':null,kind==='terminal'?1:null);
  f.receipt('create-'+id,'orchestration.taskCreate',{spec,run:'run-head',callerTerminalHandle:f.from},{task});
 };
 const lifecycle=createLifecycleService({store:f.store,rpc:f.rpc,userData:f.profile,consent:async()=>{},works:f.works});propose('delivery');await lifecycle.check(f.work.id);await f.works.check(f.work.id);
 const input={requestId:'accept-observed-delivery',workId:f.work.id,deliveryId:'delivery',expectedWorkVersion:f.store.readCurrentWork(f.work.id).version,decision:'accept'};
 return {...f,lifecycle,input,propose};
}
for(const kind of ['structured','terminal'])test(`${kind} repeated identical native observations refresh time without invalidating the exact displayed delivery`,async t=>{
 const f=await delivery(t,kind),before=f.store.readCurrentWork(f.work.id);
 for(let n=0;n<3;n++)await f.works.check(f.work.id);
 const refreshed=f.store.readCurrentWork(f.work.id);assert.equal(refreshed.version,before.version);assert.ok(refreshed.snapshot.observedAt>=before.snapshot.observedAt);assert.equal(refreshed.status,'awaiting_acceptance');
 await f.lifecycle.decide(f.input);assert.equal(f.store.readCurrentWork(f.work.id).status,'completed');
});
async function pausedDecision(f){
 let entered,release,armed=true;const entry=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const rpc=async(method,...args)=>{if(armed&&method==='status.get'){armed=false;entered();await gate;}return f.rpc(method,...args);};
 const works=createWorkService({store:f.store,rpc,userData:f.profile,consent:async()=>{}}),lifecycle=createLifecycleService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works});
 const result=lifecycle.decide(f.input);await entry;return {result,release};
}
test('background observation interleaved with acceptance preserves the exact decision fence when only freshness changes',async t=>{
 const f=await delivery(t),race=await pausedDecision(f);await f.works.check(f.work.id);race.release();await race.result;
 assert.equal(f.store.readCurrentWork(f.work.id).status,'completed');assert.equal(f.store.readWorkDecision(f.input.requestId).expectedWorkVersion,f.input.expectedWorkVersion);
});
for(const change of ['task-status','delivery-revision','delivery-rework','run-generation','run-owner'])test(`background ${change} during acceptance still rejects the stale decision without recording it`,async t=>{
 const f=await delivery(t),race=await pausedDecision(f);
 // Attach the rejection handler before the native verification gate is released.
 const refusal=assert.rejects(race.result,/changed|superseded|generation|owner|authority|unverified|unavailable/i);
 if(change==='task-status')f.db.prepare("UPDATE tasks SET status='pending' WHERE id='delivery'").run();
 if(change==='delivery-revision'){f.propose('new-delivery','delivery');await f.lifecycle.check(f.work.id);}
 if(change==='delivery-rework')await f.lifecycle.decide({...f.input,requestId:'real-rework',decision:'rework',feedback:'Verify the remaining requirement.'});
 if(change==='run-generation')f.db.prepare('UPDATE runs SET consumer_generation=2,coordinator_orca_session_id_generation=2').run();
 if(change==='run-owner')f.db.prepare("UPDATE runs SET coordinator_orca_session_id='other-head'").run();
 await f.works.check(f.work.id);race.release();await refusal;
 assert.ok(f.store.readCurrentWork(f.work.id).version>f.input.expectedWorkVersion);assert.equal(f.store.readWorkDecision(f.input.requestId),null);assert.notEqual(f.store.readCurrentWork(f.work.id).status,'completed');
});
