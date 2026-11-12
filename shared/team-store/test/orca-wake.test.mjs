import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOrcaWake,wakePrompt,FENCED_WAKE_CAPABILITY} from '../src/orca-wake.mjs';
import {wakeModDeliveries} from '../mod-wake.mjs';

async function fixture(t){
 const journalRoot=await mkdtemp(join(tmpdir(),'team-wake-'));t.after(()=>rm(journalRoot,{recursive:true,force:true}));
 const recipient={member_id:'worker',machine_id:'machine',execution_host_id:'local',provider:'codex',conversation_id:'thread',context_id:'ctx',terminal_handle:'terminal',incarnation_id:'inc',generation:1};
 const delivery={deliveryId:'delivery',messageId:'message',threadId:'task-thread',recipient},sent=[];
 let activity='idle',mode='started',effect=0,checks=0,valid=true,eligible=true,time=1000;
 const requests=new Map();
 const host={runtimeId:'epoch',promptJournalId:'journal',capabilities:['terminal.prompt-delivery.v1',FENCED_WAKE_CAPABILITY],verifyTerminal:async()=>{checks++;if(!valid)throw Error('stale');return {actor:{incarnationId:'inc',machineId:'machine'}};},rpc:async(method,params)=>{assert.equal(method,'terminal.agentStatus');assert.deepEqual(params,{terminal:'terminal'});return {agentStatus:{handle:'terminal',isRunningAgent:true,status:activity}};},lookupWake:async request=>{
  const recorded=requests.get(request.requestId);
  return {journalId:host.promptJournalId,requestId:request.requestId,authoritative:true,state:recorded?'accepted':'absent',targetState:'active',expectedBinding:request.expectedBinding,bodyDigest:request.bodyDigest,...(recorded?{send:{handle:'terminal',accepted:true,prompt:{requestId:request.requestId,processIncarnation:request.expectedBinding.incarnationId,observation:'supported',stages:mode==='queued'?['input_accepted']:['input_accepted','turn_started']}}}:{})};
 },submitWake:async request=>{
  sent.push(request);if(!requests.has(request.requestId)){effect++;requests.set(request.requestId,request);}else assert.deepEqual(requests.get(request.requestId),request);
  if(mode==='lost'){mode='started';throw Error('lost receipt after accepted input');}
  return {send:{handle:'terminal',accepted:true,prompt:{requestId:mode==='wrong'?'other':request.requestId,processIncarnation:request.expectedBinding.incarnationId,observation:'supported',stages:mode==='queued'?['input_accepted']:['input_accepted','turn_started']}}};
 }};
 const wake=()=>createOrcaWake({host,journalRoot,now:()=>time,checkEligible:async()=>({eligible,reason:eligible?'current':'already-read'})});
 return {host,wake,delivery,sent,journalRoot,scope:{projectRoot:'project',machineId:'machine'},setActivity:v=>activity=v,setMode:v=>mode=v,setValid:v=>valid=v,setEligible:v=>eligible=v,setTime:v=>time=v,effects:()=>effect,checks:()=>checks};
}
test('a completed native wake survives pump/process recreation without another submission',async t=>{
 const f=await fixture(t),result=await f.wake()(f.delivery,f.scope);assert.equal(result.state,'turn-started');assert.equal(f.effects(),1);
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.sent.length,1);
 assert.match(f.sent[0].text,/shared_inbox_read/);assert.match(f.sent[0].text,/neither acknowledgement nor task pickup/);assert.equal(f.checks(),3);
});
test('lost reply reuses the exact persisted native request ID and produces one host effect',async t=>{
 const f=await fixture(t);f.setMode('lost');assert.equal((await f.wake()(f.delivery,f.scope)).state,'needs-reconciliation');
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.sent.length,1);assert.equal(f.effects(),1);
});
test('accepted input is distinct from turn start; replay observes rather than submits a new prompt',async t=>{
 const f=await fixture(t);f.setMode('queued');assert.equal((await f.wake()(f.delivery,f.scope)).state,'input-accepted');
 f.setActivity('working');f.setMode('started');assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.effects(),1);
});
test('concurrent local senders share a single durable request and host effect',async t=>{
 const f=await fixture(t);await Promise.all(Array.from({length:8},()=>f.wake()(f.delivery,f.scope)));
 assert.equal(f.effects(),1);assert.equal(new Set(f.sent.map(s=>s.requestId)).size,1);
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');
});
test('busy, permission, unknown and unsupported hosts send nothing, then idle can wake',async t=>{
 const f=await fixture(t);
 for(const state of ['working','permission','unknown',undefined]){f.setActivity(state);assert.equal((await f.wake()(f.delivery,f.scope)).state,'waiting-for-idle');}
 f.setActivity('idle');f.host.capabilities=['terminal.prompt-delivery.v1'];assert.equal((await f.wake()(f.delivery,f.scope)).state,'host-update-required');assert.equal(f.effects(),0);
 f.host.capabilities=['terminal.prompt-delivery.v1',FENCED_WAKE_CAPABILITY];assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');
});
test('stale/native/provider/remote evidence cannot produce a prompt',async t=>{
 const f=await fixture(t);f.setValid(false);assert.equal((await f.wake()(f.delivery,f.scope)).state,'needs-reconciliation');
 for(const change of [{provider:'hermes'},{machine_id:'elsewhere'},{execution_host_id:'remote'}])assert.equal((await f.wake()({...f.delivery,recipient:{...f.delivery.recipient,...change}},f.scope)).state,'unsupported');
 assert.equal(f.effects(),0);
});
test('a runtime change reconciles the original durable journal; damaged state creates no fresh send',async t=>{
 const f=await fixture(t);f.setMode('lost');await f.wake()(f.delivery,f.scope);f.host.runtimeId='new-epoch';
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.effects(),1);assert.equal(f.sent.length,1);
 const [directory]=await readdir(join(f.journalRoot,'v2'));await writeFile(join(f.journalRoot,'v2',directory,'request-0.json'),'partial');
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'needs-reconciliation');assert.equal(f.sent.length,1);
});
test('receipt mismatch is never claimed as started and does not replace the saved request',async t=>{
 const f=await fixture(t);f.setMode('wrong');const first=await f.wake()(f.delivery,f.scope);assert.equal(first.state,'needs-reconciliation');
 f.setMode('started');await f.wake()(f.delivery,f.scope);assert.equal(f.effects(),1);assert.equal(f.sent.length,1);
});
test('meeting generations and deadline notices have distinct bounded inbox pointers',async t=>{
 const f=await fixture(t);
 for(const pointer of [{noticeId:'notice'},{meetingId:'meeting',notificationGeneration:1},{meetingId:'meeting',notificationGeneration:2}])assert.equal((await f.wake()({...pointer,recipient:f.delivery.recipient},f.scope)).state,'turn-started');
 assert.equal(f.effects(),3);assert.ok(f.sent.every(s=>s.text===wakePrompt(JSON.parse(s.text.slice(s.text.indexOf('{'))))));
});
test('a same-process rebind after a lost reply reconciles the original ID instead of sending again',async t=>{
 const f=await fixture(t);f.setMode('lost');await f.wake()(f.delivery,f.scope);
 const rebound={...f.delivery,recipient:{...f.delivery.recipient,generation:2}};
 assert.equal((await f.wake()(rebound,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.effects(),1);assert.equal(f.sent.length,1);
});
test('confirmed start without inbox progress becomes actionable; read mail settles it without another wake',async t=>{
 const f=await fixture(t);await f.wake()(f.delivery,f.scope);f.setTime(32000);
 const stalled=await f.wake()(f.delivery,f.scope);assert.equal(stalled.state,'needs-attention');assert.equal(stalled.startedAt,1000);assert.match(stalled.recoveryAction,/inbox/);
 f.setEligible(false);assert.equal((await f.wake()(f.delivery,f.scope)).state,'settled-or-ineligible');assert.equal(f.effects(),1);
});
test('current eligibility is checked again just before input and blocks a newly stale pointer',async t=>{
 const f=await fixture(t);let checks=0;
 const wake=createOrcaWake({host:f.host,journalRoot:f.journalRoot,checkEligible:async()=>({eligible:++checks===1,reason:'expired'})});
 assert.equal((await wake(f.delivery,f.scope)).state,'settled-or-ineligible');assert.equal(f.effects(),0);assert.equal(checks,2);
});
test('both supported recipient providers use the same native fenced wake',async t=>{
 const f=await fixture(t);
 for(const provider of ['claude','codex']){
  const d={...f.delivery,deliveryId:`d-${provider}`,recipient:{...f.delivery.recipient,provider}};
  assert.equal((await f.wake()(d,f.scope)).state,'turn-started');
  assert.equal(f.sent.at(-1).expectedBinding.provider,provider);
 }
 assert.equal(f.effects(),2);
});
test('a changed native process waits for authoritative retirement; replacement attempts are bounded',async t=>{
 const f=await fixture(t);await f.wake()(f.delivery,f.scope);
 const next={...f.delivery,recipient:{...f.delivery.recipient,conversation_id:'replacement',incarnation_id:'inc2',generation:2}};
 f.host.verifyTerminal=async()=>({actor:{incarnationId:'inc2',machineId:'machine'}});
 assert.equal((await f.wake()(next,f.scope)).state,'needs-reconciliation');assert.equal(f.effects(),1);
 const lookup=f.host.lookupWake;f.host.lookupWake=async saved=>({...await lookup(saved),targetState:saved.expectedBinding.incarnationId==='inc2'?'active':'retired'});
 assert.equal((await f.wake()(next,f.scope)).state,'turn-started');assert.equal(f.effects(),2);
 f.host.verifyTerminal=async()=>({actor:{incarnationId:'inc3',machineId:'machine'}});
 f.host.lookupWake=async saved=>({...await lookup(saved),targetState:'retired'});
 assert.equal((await f.wake()({...next,recipient:{...next.recipient,incarnation_id:'inc3',conversation_id:'third'}},f.scope)).reason,'native-replacement-limit');assert.equal(f.effects(),2);
});
test('loss of journal continuity and unverified native absence never authorize a new input',async t=>{
 const f=await fixture(t);f.setMode('lost');await f.wake()(f.delivery,f.scope);f.host.promptJournalId='different-journal';
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'needs-reconciliation');assert.equal(f.effects(),1);
 const other=await fixture(t),lookup=other.host.lookupWake;other.host.lookupWake=async saved=>({...await lookup(saved),authoritative:false});
 assert.equal((await other.wake()(other.delivery,other.scope)).state,'needs-reconciliation');assert.equal(other.effects(),0);
});
test('legacy pre-fence requests are surfaced for reconciliation rather than silently reset',async t=>{
 const f=await fixture(t),legacy=join(f.journalRoot,'a'.repeat(64));await mkdir(legacy);
 await writeFile(join(legacy,'request.json'),JSON.stringify({requestId:'old',identity:{projectRoot:'project',pointer:{deliveryId:'delivery',messageId:'message',threadId:'task-thread'},binding:{member_id:'worker'}}}));
 const result=await f.wake()(f.delivery,f.scope);assert.equal(result.reason,'legacy-wake-request');assert.equal(result.requestId,'old');assert.equal(f.effects(),0);
});
test('a wrong native accepted receipt is not progress and cannot trigger a replacement send',async t=>{
 const f=await fixture(t);f.setMode('lost');await f.wake()(f.delivery,f.scope);const lookup=f.host.lookupWake;
 f.host.lookupWake=async saved=>{const value=await lookup(saved);value.send.prompt.processIncarnation='wrong';return value;};
 const result=await f.wake()(f.delivery,f.scope);assert.equal(result.state,'needs-reconciliation');assert.equal(f.effects(),1);
});
test('a non-authoritative started receipt is not accepted as progress',async t=>{
 const f=await fixture(t);f.setMode('lost');await f.wake()(f.delivery,f.scope);const lookup=f.host.lookupWake;
 f.host.lookupWake=async saved=>({...await lookup(saved),authoritative:false});
 assert.equal((await f.wake()(f.delivery,f.scope)).reason,'native-outcome-unknown');assert.equal(f.effects(),1);
});
test('manual inbox progress clears stale host-update status even before Orca is upgraded',async t=>{
 const f=await fixture(t);f.host.capabilities=['terminal.prompt-delivery.v1'];
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'host-update-required');
 f.setEligible(false);assert.equal((await f.wake()(f.delivery,f.scope)).state,'settled-or-ineligible');assert.equal(f.effects(),0);
});
test('native binding property order does not create a false stale/conflict result',async t=>{
 const f=await fixture(t),lookup=f.host.lookupWake;
 f.host.lookupWake=async saved=>{const result=await lookup(saved);result.expectedBinding=Object.fromEntries(Object.entries(result.expectedBinding).reverse());return result;};
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'turn-started');
 assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.effects(),1);
});
test('Mod native child reconciles only committed receipts and rechecks shared binding before waking',async()=>{
 const recipient={member_id:'w',provider:'codex',generation:1},delivery={noticeId:'n',recipient};
 const request={operationId:'original',command:{type:'prepareDeliveries',teamId:'t'}},proof={conversationId:'head'},calls=[];
 let committed=true,current=true,closed=0;
 const dependencies={createNative:async()=>({verifyCaller:async supplied=>{assert.equal(supplied,proof);return {projectRoot:'root',machineId:'machine'};}}),createApi:async()=>({reconcile:async original=>{assert.equal(original,request);return committed?{kind:'api',operationId:'original',result:{deliveries:[delivery]}}:{status:'unknown'};},inspectWake:async input=>{calls.push(input.command.type);return {result:{eligible:true,binding:{...recipient,generation:current?1:2}}};},close:async()=>closed++}),createHost:async()=>({}),createWake:()=>async(...args)=>{calls.push(args);return {state:'turn-started'};}};
 const input={proof,request,orcaCommand:'orca'};
 assert.equal((await wakeModDeliveries(input,dependencies)).results.length,1);
 current=false;assert.equal((await wakeModDeliveries(input,dependencies)).results[0].state,'settled-or-ineligible');
 committed=false;assert.equal((await wakeModDeliveries(input,dependencies)).state,'unconfirmed');assert.equal(closed,3);
 assert.equal(calls.filter(Array.isArray).length,1);assert.ok(calls.filter(v=>!Array.isArray(v)).every(v=>v==='inspectWake'));
 await assert.rejects(wakeModDeliveries({...input,request:{command:{type:'readInbox'}}},dependencies));
});
