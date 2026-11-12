import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createManagedWakeBackend} from '../src/managed-wake.mjs';
import {createHostAdaptiveWake} from '../src/host-adaptive-wake.mjs';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'team-managed-wake-')),identity={projectRoot:root,machineId:'machine',provider:'codex',conversationId:'conversation',incarnationId:'execution',terminalHandle:'terminal',contextId:'context'},delivery={deliveryId:'delivery',messageId:'message',threadId:'thread',recipient:{member_id:'worker',machine_id:'machine',execution_host_id:'local',provider:'codex',conversation_id:'conversation',incarnation_id:'execution',terminal_handle:'terminal',context_id:'context'}},scope={projectRoot:root,machineId:'machine'};
 let effects=0,state='idle',review=false,eligible=true;
 const transport={inspect:async()=>({identity,state,pendingReview:review}),submit:async({requestId})=>{effects++;return {accepted:true,requestId,nativeId:'native-message'};}};
 const options={transport,journalRoot:root,checkEligible:async()=>({eligible})};
 return {root,identity,delivery,scope,options,host:{capabilities:[]},effects:()=>effects,setState:value=>state=value,setReview:value=>review=value,setEligible:value=>eligible=value};
}
for(const id of ['orca-managed','provider-managed'])test(`${id}: an enrolled transport has one native effect across router/backend recreation`,async()=>{
 const f=await fixture();
 const wake=()=>createHostAdaptiveWake({host:f.host,journalRoot:f.root,checkEligible:f.options.checkEligible,managedBackend:createManagedWakeBackend({...f.options,id})});
 const first=await wake()(f.delivery,f.scope);assert.equal(first.state,'input-accepted');assert.equal(first.selectedRoute,id);assert.equal(first.usingFallback,true);assert.equal((await wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.effects(),1);
});
test('unsupported Orca host without verified managed enrollment sends nothing',async()=>{
 const f=await fixture();assert.equal((await createHostAdaptiveWake({host:f.host,journalRoot:f.root,checkEligible:f.options.checkEligible})(f.delivery,f.scope)).state,'fallback-setup-required');assert.equal(f.effects(),0);
});
test('managed identity, busy and human review blockers never trigger native input',async()=>{
 const f=await fixture(),backend=createManagedWakeBackend({...f.options,id:'provider-managed'});f.setState('busy');assert.equal((await backend.availability(f.delivery,f.scope)).reason,'managed-execution-not-idle');f.setState('idle');f.setReview(true);assert.equal((await backend.availability(f.delivery,f.scope)).reason,'managed-execution-awaiting-human');f.setReview(false);f.identity.incarnationId='replacement';assert.equal((await backend.availability(f.delivery,f.scope)).reason,'managed-execution-identity-changed');assert.equal(f.effects(),0);
});
test('current eligibility still settles an intent before managed delivery',async()=>{
 const f=await fixture(),wake=createHostAdaptiveWake({host:f.host,journalRoot:f.root,checkEligible:f.options.checkEligible,managedBackend:createManagedWakeBackend({...f.options,id:'orca-managed'})});f.setEligible(false);assert.equal((await wake(f.delivery,f.scope)).state,'settled-or-ineligible');assert.equal(f.effects(),0);
});
test('a generic orchestration send function is not accepted as an owned execution transport',()=>{
 assert.throws(()=>createManagedWakeBackend({id:'orca-managed',transport:{send(){}},journalRoot:'private',checkEligible:async()=>({eligible:true})}),/enrolled owned execution/);
});
