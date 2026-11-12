import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrcaWake,wakePrompt} from '../src/orca-wake.mjs';
import {wakeModDeliveries} from '../mod-wake.mjs';

async function fixture(t){
 const journalRoot=await mkdtemp(join(tmpdir(),'team-wake-'));t.after(()=>rm(journalRoot,{recursive:true,force:true}));
 const recipient={member_id:'worker',machine_id:'machine',execution_host_id:'local',provider:'codex',conversation_id:'thread',context_id:'ctx',terminal_handle:'terminal',incarnation_id:'inc',generation:1};
 const delivery={deliveryId:'delivery',messageId:'message',threadId:'task-thread',recipient},sent=[];
 let activity='idle',mode='started',effect=0,checks=0,valid=true;
 const requests=new Map();
 const host={runtimeId:'epoch',capabilities:['terminal.prompt-delivery.v1'],verifyTerminal:async()=>{checks++;if(!valid)throw Error('stale');return {actor:{incarnationId:'inc',machineId:'machine'}};},rpc:async(method,params)=>{assert.equal(method,'terminal.agentStatus');assert.deepEqual(params,{terminal:'terminal'});return {agentStatus:{handle:'terminal',isRunningAgent:true,status:activity}};},submitWake:async request=>{
  sent.push(request);if(!requests.has(request.requestId)){effect++;requests.set(request.requestId,request.text);}else assert.equal(requests.get(request.requestId),request.text);
  if(mode==='lost'){mode='started';throw Error('lost receipt after accepted input');}
  return {send:{handle:'terminal',accepted:true,prompt:{requestId:mode==='wrong'?'other':request.requestId,processIncarnation:'inc',observation:'supported',stages:mode==='queued'?['input_accepted']:['input_accepted','turn_started']}}};
 }};
 const wake=()=>createOrcaWake({host,journalRoot});
 return {host,wake,delivery,sent,journalRoot,scope:{projectRoot:'project',machineId:'machine'},setActivity:v=>activity=v,setMode:v=>mode=v,setValid:v=>valid=v,effects:()=>effect,checks:()=>checks};
}
test('a completed native wake survives pump/process recreation without another submission',async t=>{
 const f=await fixture(t),result=await f.wake()(f.delivery,f.scope);assert.equal(result.state,'turn-started');assert.equal(f.effects(),1);
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');assert.equal(f.sent.length,1);
 assert.match(f.sent[0].text,/shared_inbox_read/);assert.match(f.sent[0].text,/neither acknowledgement nor task pickup/);assert.equal(f.checks(),3);
});
test('lost reply reuses the exact persisted native request ID and produces one host effect',async t=>{
 const f=await fixture(t);f.setMode('lost');assert.equal((await f.wake()(f.delivery,f.scope)).state,'unknown');
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');assert.equal(f.sent.length,2);assert.equal(f.effects(),1);assert.deepEqual(f.sent[0],f.sent[1]);
});
test('accepted input is distinct from turn start; replay observes rather than submits a new prompt',async t=>{
 const f=await fixture(t);f.setMode('queued');assert.equal((await f.wake()(f.delivery,f.scope)).state,'input-accepted');
 f.setActivity('working');f.setMode('started');assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');assert.equal(f.effects(),1);
});
test('concurrent local senders share a single durable request and host effect',async t=>{
 const f=await fixture(t);await Promise.all(Array.from({length:8},()=>f.wake()(f.delivery,f.scope)));
 assert.equal(f.effects(),1);assert.equal(new Set(f.sent.map(s=>s.requestId)).size,1);
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');
});
test('busy, permission, unknown and unsupported hosts send nothing, then idle can wake',async t=>{
 const f=await fixture(t);
 for(const state of ['working','permission','unknown',undefined]){f.setActivity(state);assert.equal((await f.wake()(f.delivery,f.scope)).state,'waiting-for-idle');}
 f.setActivity('idle');f.host.capabilities=[];assert.equal((await f.wake()(f.delivery,f.scope)).state,'unsupported');assert.equal(f.effects(),0);
 f.host.capabilities=['terminal.prompt-delivery.v1'];assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');
});
test('stale/native/provider/remote evidence cannot produce a prompt',async t=>{
 const f=await fixture(t);f.setValid(false);assert.equal((await f.wake()(f.delivery,f.scope)).state,'unknown');
 for(const change of [{provider:'claude'},{machine_id:'elsewhere'},{execution_host_id:'remote'}])assert.equal((await f.wake()({...f.delivery,recipient:{...f.delivery.recipient,...change}},f.scope)).state,'unsupported');
 assert.equal(f.effects(),0);
});
test('a runtime change or damaged request cannot turn uncertainty into a fresh send',async t=>{
 const f=await fixture(t);f.setMode('lost');await f.wake()(f.delivery,f.scope);f.host.runtimeId='new-epoch';
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'unknown');assert.equal(f.effects(),1);assert.equal(f.sent.length,1);
 const [directory]=await readdir(f.journalRoot);await writeFile(join(f.journalRoot,directory,'request.json'),'partial');
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'unknown');assert.equal(f.sent.length,1);
});
test('receipt mismatch is never claimed as started and does not replace the saved request',async t=>{
 const f=await fixture(t);f.setMode('wrong');const first=await f.wake()(f.delivery,f.scope);assert.equal(first.state,'unknown');
 f.setMode('started');await f.wake()(f.delivery,f.scope);assert.equal(f.effects(),1);assert.equal(f.sent[0].requestId,f.sent[1].requestId);
});
test('meeting generations and deadline notices have distinct bounded inbox pointers',async t=>{
 const f=await fixture(t);
 for(const pointer of [{noticeId:'notice'},{meetingId:'meeting',notificationGeneration:1},{meetingId:'meeting',notificationGeneration:2}])assert.equal((await f.wake()({...pointer,recipient:f.delivery.recipient},f.scope)).state,'turn-started');
 assert.equal(f.effects(),3);assert.ok(f.sent.every(s=>s.text===wakePrompt(JSON.parse(s.text.slice(s.text.indexOf('{'))))));
});
test('Mod native child reconciles only committed receipts and rechecks shared binding before waking',async()=>{
 const recipient={member_id:'w',provider:'codex',generation:1},delivery={noticeId:'n',recipient};
 const request={operationId:'original',command:{type:'prepareDeliveries',teamId:'t'}},proof={conversationId:'head'},calls=[];
 let committed=true,current=true,closed=0;
 const dependencies={createNative:async()=>({verifyCaller:async supplied=>{assert.equal(supplied,proof);return {projectRoot:'root',machineId:'machine'};}}),createApi:async()=>({reconcile:async original=>{assert.equal(original,request);return committed?{kind:'api',operationId:'original',result:{deliveries:[delivery]}}:{status:'unknown'};},execute:async input=>{calls.push(input.command.type);return {result:{members:[{member_id:'w',membership_state:'active',cli:'codex'}],bindings:[{...recipient,generation:current?1:2}]}};},close:async()=>closed++}),createHost:async()=>({}),createWake:()=>async(...args)=>{calls.push(args);return {state:'turn-started'};}};
 const input={proof,request,orcaCommand:'orca'};
 assert.equal((await wakeModDeliveries(input,dependencies)).results.length,1);
 current=false;assert.equal((await wakeModDeliveries(input,dependencies)).results.length,0);
 committed=false;assert.equal((await wakeModDeliveries(input,dependencies)).state,'unconfirmed');assert.equal(closed,3);
 assert.equal(calls.filter(Array.isArray).length,1);assert.ok(calls.filter(v=>!Array.isArray(v)).every(v=>v==='inspectTeam'));
 await assert.rejects(wakeModDeliveries({...input,request:{command:{type:'readInbox'}}},dependencies));
});
