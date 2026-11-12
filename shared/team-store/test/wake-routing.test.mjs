import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {createWakeRouter} from '../src/wake-routing.mjs';
async function fixture(){
 const root=await mkdtemp(join(tmpdir(),'team-route-')),calls=[],scope={projectRoot:'project',machineId:'machine'},delivery={deliveryId:'delivery',messageId:'message',threadId:'thread',recipient:{member_id:'worker'}};
 let primaryState={state:'available'},fallbackState={state:'available'},eligible=true,checks=0;
 const primary={id:'orca-terminal',availability:async()=>primaryState,wake:async()=>{calls.push('primary');return {state:'input-accepted',requestId:'original-primary'};}};
 const fallback={id:'orca-managed',availability:async()=>fallbackState,wake:async()=>{calls.push('fallback');return {state:'input-accepted',requestId:'original-fallback'};}};
 const options={primary,fallback,journalRoot:root,checkEligible:async()=>{checks++;return {eligible};}};
 return {root,calls,scope,delivery,primary,fallback,options,router:()=>createWakeRouter(options),setPrimary:value=>primaryState=value,setFallback:value=>fallbackState=value,setEligible:value=>eligible=value,checks:()=>checks};
}
test('healthy original transport remains preferred and selection is durable before the effect',async()=>{
 const f=await fixture();f.primary.wake=async()=>{const files=await readdir(join(f.root,'routes-v1'));const record=JSON.parse(await readFile(join(f.root,'routes-v1',files[0]),'utf8'));assert.equal(record.selectedRoute,'orca-terminal');return {state:'input-accepted'};};
 const result=await f.router()(f.delivery,f.scope);assert.equal(result.selectedRoute,'orca-terminal');assert.equal(result.usingFallback,false);assert.ok(f.checks()>=2);
});
test('positively unavailable primary selects the reviewed managed fallback',async()=>{
 const f=await fixture();f.setPrimary({state:'unavailable',reason:'missing-target-fence'});const result=await f.router()(f.delivery,f.scope);assert.equal(result.selectedRoute,'orca-managed');assert.deepEqual(f.calls,['fallback']);
});
test('uncertain primary outcome never moves to a fallback after recreation or capability loss',async()=>{
 const f=await fixture();f.primary.wake=async()=>{f.calls.push('primary');throw Error('Native reply lost.');};assert.equal((await f.router()(f.delivery,f.scope)).state,'needs-reconciliation');f.setPrimary({state:'unavailable',reason:'missing-target-fence'});await f.router()(f.delivery,f.scope);assert.deepEqual(f.calls,['primary','primary']);
});
test('an old fallback intent stays on its backend when primary becomes available; new mail prefers primary',async()=>{
 const f=await fixture();f.setPrimary({state:'unavailable',reason:'missing-target-fence'});await f.router()(f.delivery,f.scope);f.setPrimary({state:'available'});await f.router()(f.delivery,f.scope);await f.router()({...f.delivery,deliveryId:'next'},f.scope);assert.deepEqual(f.calls,['fallback','fallback','primary']);
});
for(const reason of ['human-declined','permission-required','trust-required','busy','identity-stale'])test(`${reason} cannot be mislabeled as transport failure to enable fallback`,async()=>{
 const f=await fixture();f.setPrimary({state:'unavailable',reason});assert.equal((await f.router()(f.delivery,f.scope)).state,'needs-attention');assert.deepEqual(f.calls,[]);
});
test('unknown availability and an unenrolled fallback are explicit and send nothing',async()=>{
 const f=await fixture();f.setPrimary({state:'unknown'});assert.equal((await f.router()(f.delivery,f.scope)).state,'needs-reconciliation');f.setPrimary({state:'unavailable',reason:'missing-target-fence'});f.setFallback({state:'unavailable',reason:'managed-target-not-enrolled'});assert.equal((await f.router()(f.delivery,f.scope)).state,'fallback-setup-required');assert.deepEqual(f.calls,[]);
});
test('a pre-router primary receipt blocks fallback even if primary capability is now absent',async()=>{
 const f=await fixture();f.setPrimary({state:'unavailable',reason:'missing-target-fence'});
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
 const intent={...f.scope,memberId:'worker',pointer:{deliveryId:'delivery',messageId:'message',threadId:'thread'}},key=createHash('sha256').update(JSON.stringify(canonical(intent))).digest('hex');
 const path=join(f.root,'v2',key);await mkdir(path,{recursive:true});await writeFile(join(path,'request-0.json'),'{}');assert.equal((await f.router()(f.delivery,f.scope)).reason,'pre-routing-wake-receipt');assert.deepEqual(f.calls,[]);
});
test('concurrent different availability observations still select only one backend',async()=>{
 const f=await fixture();let count=0;f.primary.availability=async()=>++count===1?{state:'available'}:{state:'unavailable',reason:'missing-target-fence'};
 await Promise.all([f.router()(f.delivery,f.scope),f.router()(f.delivery,f.scope)]);assert.ok(f.calls.length>=1);assert.equal(new Set(f.calls).size,1,'backend journals deduplicate native submissions within the selected route');
});
test('settled mail and changed route contracts cannot create a new backend effect',async()=>{
 const f=await fixture();f.setPrimary({state:'unavailable',reason:'missing-target-fence'});await f.router()(f.delivery,f.scope);f.setEligible(false);assert.equal((await f.router()(f.delivery,f.scope)).state,'settled-or-ineligible');f.setEligible(true);const changed=createWakeRouter({...f.options,fallback:{...f.fallback,id:'provider-managed'}});assert.equal((await changed(f.delivery,f.scope)).reason,'wake-route-contract-changed');assert.deepEqual(f.calls,['fallback']);
});
