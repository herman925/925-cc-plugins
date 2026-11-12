import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOwnedProviderWake,createOwnedCodexTransport,createOwnedClaudeTransport} from '../src/owned-provider-wake.mjs';
async function fixture(provider='codex'){
 const root=await mkdtemp(join(tmpdir(),'team-owned-wake-')),identity={projectRoot:root,machineId:'machine',provider,conversationId:'conversation',incarnationId:'owned-process',terminalHandle:'owned-terminal',contextId:'owned-context'};
 const delivery={deliveryId:'delivery',messageId:'message',threadId:'thread',recipient:{member_id:'worker',machine_id:'machine',execution_host_id:'local',provider,conversation_id:identity.conversationId,incarnation_id:identity.incarnationId,terminal_handle:identity.terminalHandle,context_id:identity.contextId}};
 let effects=0,eligible=true,time=1,mode='normal',pendingReview=false,state='idle';
 const transport={inspect:async()=>({identity,state,pendingReview}),submit:async({requestId})=>{effects++;if(mode==='lost')throw Error('Reply lost after input.');return {requestId,nativeId:'turn',accepted:true};}};
 const options={transport,journalRoot:join(root,'journal'),checkEligible:async()=>({eligible}),now:()=>time};
 return {root,identity,delivery,options,scope:{projectRoot:root,machineId:'machine'},wake:()=>createOwnedProviderWake(options),effects:()=>effects,setEligible:value=>eligible=value,setTime:value=>time=value,setMode:value=>mode=value,setReview:value=>pendingReview=value,setState:value=>state=value};
}
for(const provider of ['claude','codex'])test(`${provider}: a direct owned receiver sends once, preserves unread ownership and refuses blind retry`,async()=>{
 const f=await fixture(provider);assert.equal((await f.wake()(f.delivery,f.scope)).state,'input-accepted');assert.equal((await f.wake()(f.delivery,f.scope)).state,'awaiting-inbox-progress');assert.equal(f.effects(),1);
 f.setTime(30002);assert.equal((await f.wake()(f.delivery,f.scope)).state,'needs-attention');f.setEligible(false);assert.equal((await f.wake()(f.delivery,f.scope)).state,'settled-or-ineligible');assert.equal(f.effects(),1);
});
test('concurrent independent receivers cannot submit the same pointer twice',async()=>{const f=await fixture();await Promise.all([f.wake()(f.delivery,f.scope),f.wake()(f.delivery,f.scope)]);assert.equal(f.effects(),1);});
test('a lost native reply stays uncertain across runner recreation',async()=>{const f=await fixture();f.setMode('lost');assert.equal((await f.wake()(f.delivery,f.scope)).state,'needs-reconciliation');f.setMode('normal');assert.equal((await f.wake()(f.delivery,f.scope)).reason,'owned-send-outcome-unknown');assert.equal(f.effects(),1);});
test('busy, review-blocked and replaced receivers are never prompted',async()=>{
 const f=await fixture();f.setState('busy');assert.equal((await f.wake()(f.delivery,f.scope)).state,'waiting-for-idle');f.setState('idle');f.setReview(true);assert.equal((await f.wake()(f.delivery,f.scope)).state,'waiting-for-idle');f.setReview(false);f.identity.incarnationId='replacement';assert.equal((await f.wake()(f.delivery,f.scope)).reason,'owned-process-identity-changed');assert.equal(f.effects(),0);
});
test('Codex adapter writes only to its exact idle owned connection and never modifies policy',async()=>{
 const f=await fixture(),calls=[];let live=true,pending=false;
 const transport=createOwnedCodexTransport({identity:f.identity,alive:()=>live,hasPendingReview:()=>pending,rpc:async(method,params)=>{calls.push({method,params});return method==='thread/read'?{thread:{id:f.identity.conversationId,cwd:f.root,status:{type:'idle'}}}:{turn:{id:'native-turn'}};}});
 const wake=createOwnedProviderWake({...f.options,transport});assert.equal((await wake(f.delivery,f.scope)).state,'input-accepted');
 const send=calls.find(row=>row.method==='turn/start');assert.deepEqual(Object.keys(send.params).sort(),['clientUserMessageId','input','threadId']);assert.equal(send.params.threadId,f.identity.conversationId);assert.match(send.params.input[0].text,/shared_inbox_read/);
 pending=true;await assert.rejects(transport.submit({identity:f.identity,requestId:'new',text:'input'}));pending=false;live=false;await assert.rejects(transport.inspect());
});
test('Claude streaming adapter requires the matching native replay and leaves reviews pending',async()=>{
 const f=await fixture('claude'),messages=[];let review=false;
 const transport=createOwnedClaudeTransport({identity:f.identity,alive:()=>true,readState:async()=>({sessionId:f.identity.conversationId,projectRoot:f.root,idle:true,pendingReview:review}),enqueue:async message=>{messages.push(message);return {...message,isReplay:true};}});
 assert.equal((await createOwnedProviderWake({...f.options,transport})(f.delivery,f.scope)).state,'input-accepted');assert.equal(messages.length,1);assert.equal(messages[0].session_id,f.identity.conversationId);assert.match(messages[0].message.content,/shared_inbox_read/);
 review=true;await assert.rejects(transport.submit({identity:f.identity,requestId:'another',text:'check'}));assert.equal(messages.length,1);
});
