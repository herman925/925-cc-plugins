import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createOwnedClaudeManager} from '../src/owned-claude-manager.mjs';
import {writeReservedLaunchProfile} from '../src/codex-launch-profile.mjs';
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-owned-claude-'))),projectRoot=join(root,'project');await mkdir(projectRoot);
 const actor={projectRoot,machineId:'fixture-machine',provider:'codex',conversationId:randomUUID(),executionHostId:'local',contextId:'fixture-context',terminalHandle:'head',incarnationId:'head-process'},launchId=randomUUID();
 const launchProfile=await writeReservedLaunchProfile({root:join(root,'profiles'),actor,projectId:randomUUID(),launchId,memberId:'worker',workerAccess:{planId:'plan',policyId:'team-worker-v1'}});
 let opened=0,inputs=0,closed=0,native=false,living=true,failInput=false,busy=false,sessionId;const pending=[],answers=[];
 const driver={process:()=>({pid:1234,birth:'12345',executable:'fixture-claude'}),verifyProcess:async()=>{if(!living)throw Error('exited');},verifyNative:async()=>{assert.equal(native,true);return {projectRoot,sessionId};},state:async()=>({idle:!busy,pendingReview:pending.length>0,nativeVerified:native,sessionId,projectRoot}),pending:()=>structuredClone(pending),alive:()=>living,
  enqueue:async message=>{inputs++;if(failInput)throw Error('Native input outcome unknown');native=true;return {...message,isReplay:true};},respond:async value=>{answers.push(value);pending.splice(pending.findIndex(row=>row.id===value.requestId),1);},close:async()=>{closed++;living=false;}};
 const dependencies={observation:false,inspectProvider:async()=>({state:'available',sdkModule:'fixture-sdk',executable:'fixture-claude',digest:'fixture'}),openDriver:async options=>{opened++;sessionId=options.sessionId;return driver;}},options={directory:join(root,'private'),projectRoot,machineId:actor.machineId},manager=createOwnedClaudeManager(options,dependencies);t.after(()=>manager.close());
 return {manager,options,dependencies,input:{actor,launchId,launchProfile,workerToolPolicy:'team-worker-v1',model:'default',effort:'default'},pending,answers,driver,opened:()=>opened,inputs:()=>inputs,closed:()=>closed,setFail:v=>failInput=v,setBusy:v=>busy=v};
}
test('Claude preparation sends no model input or invented native identity; bootstrap is exact and not repeated',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input);assert.equal(prepared.identity,null);assert.equal(prepared.state,'prepared');assert.equal(f.inputs(),0);assert.equal(f.opened(),1);
 assert.equal((await f.manager.prepare(f.input)).reconciled,true);assert.equal(f.opened(),1);await assert.rejects(f.manager.prepare({...f.input,effort:'high'}));
 await assert.rejects(f.manager.start({launchId:f.input.launchId,target:{...prepared.target,incarnationId:'other'}}));assert.equal(f.inputs(),0);
 const started=await f.manager.start({launchId:f.input.launchId,target:prepared.target});assert.ok(started.bootstrap.nativeId);assert.equal(started.identity.provider,'claude');assert.deepEqual((await f.manager.start({launchId:f.input.launchId,target:prepared.target})).bootstrap,started.bootstrap);assert.equal(f.inputs(),1);
});
test('lost Claude bootstrap receipt and lost owner never create replacement input or process',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input);f.setFail(true);await assert.rejects(f.manager.start({launchId:f.input.launchId,target:prepared.target}));f.setFail(false);
 assert.equal((await f.manager.start({launchId:f.input.launchId,target:prepared.target})).reason,'bootstrap-outcome-unknown');assert.equal(f.inputs(),1);
 await f.manager.close();const next=createOwnedClaudeManager(f.options,f.dependencies);t.after(()=>next.close());assert.equal((await next.prepare(f.input)).reason,'recorded-owner-unavailable');assert.equal(f.opened(),1);
});
test('a pending human request blocks new wake input and only its exact reviewed response is submitted once',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input),started=await f.manager.start({launchId:f.input.launchId,target:prepared.target}),wake={launchId:f.input.launchId,identity:started.identity,requestId:'wake',pointer:{noticeId:'notice'}};
 f.setBusy(true);await assert.rejects(f.manager.sendWake(wake));f.setBusy(false);const request={id:'question',method:'claude/permission/request',params:{toolName:'AskUserQuestion',input:{questions:[]}}};f.pending.push(request);await assert.rejects(f.manager.sendWake(wake));assert.equal(f.inputs(),1);assert.equal(f.answers.length,0);
 await assert.rejects(f.manager.respond({launchId:f.input.launchId,requestId:request.id,operationId:'review',expected:{...request,params:{}},result:{behavior:'deny'}}));assert.equal(f.answers.length,0);
 const result={behavior:'deny',message:'Synthetic unit-test callback; not a human decision'},input={launchId:f.input.launchId,requestId:request.id,operationId:'review',expected:request,result};assert.equal((await f.manager.respond(input)).state,'answer-submitted');assert.equal((await f.manager.respond(input)).state,'answer-submitted');assert.equal(f.answers.length,1);
 const receipt=await f.manager.sendWake(wake);f.pending.push({...request,id:'next'});assert.deepEqual(await f.manager.sendWake(wake),receipt);assert.equal(f.inputs(),2);await assert.rejects(f.manager.sendWake({...wake,requestId:'new-wake'}));await assert.rejects(f.manager.sendWake({...wake,pointer:{noticeId:'other'}}));
});
test('uncertain Claude preparation retains the original process instead of closing or retrying it',async t=>{
 const f=await fixture(t);let killed=0;f.dependencies.openDriver=async()=>{const error=Error('Native initialization unverified');error.retainedClaude={child:{kill:()=>{killed++;}}};throw error;};
 await assert.rejects(f.manager.prepare(f.input));assert.equal(f.manager.active(),true);assert.equal(f.closed(),0);assert.equal((await f.manager.prepare(f.input)).reason,'recorded-owner-unavailable');assert.equal(killed,0);
});
