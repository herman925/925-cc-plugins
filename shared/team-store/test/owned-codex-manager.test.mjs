import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath,readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createOwnedCodexManager} from '../src/owned-codex-manager.mjs';
import {writeReservedLaunchProfile} from '../src/codex-launch-profile.mjs';
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-owned-manager-'))),projectRoot=join(root,'project'),home=join(root,'home'),directory=join(root,'private'),executable=join(root,'codex.exe'),adapter=join(root,'adapter.mjs');await mkdir(projectRoot);await mkdir(home);await writeFile(executable,'native executable mocked');await writeFile(adapter,'fixture');
 const actor={projectRoot,machineId:'fixture-machine',provider:'codex',conversationId:randomUUID(),executionHostId:'local',contextId:'project:fixture',terminalHandle:'head-terminal',incarnationId:'head-incarnation'},launchId=randomUUID();
 const launchProfile=await writeReservedLaunchProfile({root:join(root,'profiles'),actor,projectId:randomUUID(),launchId,memberId:'worker',workerAccess:{planId:'specific-plan',policyId:'team-worker-v1'}});
 const calls=[],answered=[],requests=[];let spawned=0,living=true,turns=0,busy=false,failTurn=false,killed=0;const threadId=randomUUID();
 const dependencies={spawn:()=>{spawned++;return {pid:1234,stderr:{resume(){}},stdin:{end(){}},kill(){killed++;living=false;}};},inspectProcess:async()=>({pid:1234,createdAt:'12345',executable}),verifyOwner:async input=>{assert.equal(input.threadId,threadId);assert.equal(input.expectedPid,1234);assert.equal(input.expectedBirth,'12345');if(!living)throw Error('exited');},connect:()=>({alive:()=>living,notify(){},disconnect(){living=false;},pendingRequests:()=>structuredClone(requests),respond:(id,result)=>{answered.push({id,result});requests.splice(requests.findIndex(r=>r.id===id),1);},call:async(method,params)=>{calls.push({method,params});if(method==='initialize')return {};if(method==='thread/start')return {cwd:projectRoot,thread:{id:threadId,cwd:projectRoot},approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:{type:'readOnly'}};if(method==='thread/read')return {thread:{id:threadId,cwd:projectRoot,status:{type:busy?'active':'idle'}}};if(method==='turn/start'){turns++;if(failTurn)throw Error('lost native reply');return {turn:{id:'turn-'+turns}};}throw Error('Unexpected native operation.');}})};
 const options={directory,projectRoot,machineId:actor.machineId},manager=createOwnedCodexManager(options,dependencies);t.after(()=>manager.close());
 const input={actor,launchId,launchProfile,codexExecutable:executable,codexHome:home,model:'default',effort:'default',adapter:fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url)),node:process.execPath,workerToolPolicy:'team-worker-v1'};
 return {manager,options,dependencies,input,calls,requests,answered,directory,spawned:()=>spawned,killed:()=>killed,turns:()=>turns,setBusy:value=>busy=value,setFail:value=>failTurn=value};
}
test('an uncertain preparation retains its process and pending review instead of automatically closing or replacing it',async t=>{
 const f=await fixture(t);f.dependencies.verifyOwner=async()=>{throw Error('Ownership reply lost after process creation.');};f.requests.push({id:'review',method:'mcpServer/elicitation/request',params:{}});
 await assert.rejects(f.manager.prepare(f.input));assert.equal(f.killed(),0);assert.equal(f.manager.active(),true);const inspected=await f.manager.inspect({launchId:f.input.launchId});assert.equal(inspected.reason,'native-preparation-unverified');assert.equal(inspected.pendingRequests.length,1);assert.equal(f.answered.length,0);
 assert.equal((await f.manager.prepare(f.input)).state,'needs-reconciliation');assert.equal(f.spawned(),1);assert.equal(f.killed(),0);
});
test('owned preparation records native creation before input, and identical reconciliation never starts another process',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input);assert.equal(prepared.state,'prepared');assert.equal(f.turns(),0);assert.equal(f.spawned(),1);assert.equal(prepared.identity.conversationId,prepared.target.terminalHandle.slice('codex-thread:'.length));
 const files=await readdir(f.directory);assert.equal(files.length,1);const attempt=JSON.parse(await readFile(join(f.directory,files[0],'attempt.json'),'utf8'));assert.equal(attempt.manifest.launchId,f.input.launchId);
 const again=await f.manager.prepare(f.input);assert.equal(again.reconciled,true);assert.equal(f.spawned(),1);await assert.rejects(f.manager.prepare({...f.input,model:'changed-model'}));
 const started=await f.manager.start({launchId:f.input.launchId,target:prepared.target});assert.equal(started.bootstrap.turnId,'turn-1');await f.manager.start({launchId:f.input.launchId,target:prepared.target});assert.equal(f.turns(),1);
});
test('a recorded launch survives owner loss as uncertainty instead of creating a replacement',async t=>{
 const f=await fixture(t);await f.manager.prepare(f.input);await f.manager.close();const restarted=createOwnedCodexManager(f.options,f.dependencies);t.after(()=>restarted.close());
 const result=await restarted.prepare(f.input);assert.equal(result.state,'needs-reconciliation');assert.equal(result.reason,'recorded-owner-unavailable');assert.equal(f.spawned(),1);
});
test('an uncertain bootstrap is never replayed, and another target cannot start it',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input);await assert.rejects(f.manager.start({launchId:f.input.launchId,target:{...prepared.target,incarnationId:'other'}}));assert.equal(f.turns(),0);
 f.setFail(true);await assert.rejects(f.manager.start({launchId:f.input.launchId,target:prepared.target}));f.setFail(false);assert.equal((await f.manager.start({launchId:f.input.launchId,target:prepared.target})).state,'needs-reconciliation');assert.equal(f.turns(),1);
});
test('busy and human review states send nothing; exact wake request retries return the native receipt',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input),request={launchId:f.input.launchId,identity:prepared.identity,requestId:randomUUID(),pointer:{deliveryId:'delivery',messageId:'message',threadId:'thread'}};
 f.setBusy(true);await assert.rejects(f.manager.sendWake(request));f.setBusy(false);f.requests.push({id:7,method:'mcpServer/elicitation/request',params:{threadId:prepared.identity.conversationId}});await assert.rejects(f.manager.sendWake(request));assert.equal(f.turns(),0);assert.equal(f.answered.length,0);
 f.requests.length=0;const receipt=await f.manager.sendWake(request);assert.equal(receipt.accepted,true);assert.deepEqual(await f.manager.sendWake(request),receipt);assert.equal(f.turns(),1);await assert.rejects(f.manager.sendWake({...request,pointer:{noticeId:'different'}}));
 const text=f.calls.find(row=>row.method==='turn/start').params.input[0].text;assert.ok(text.includes('neither acknowledgement nor task pickup'));assert.ok(!text.includes('fixture work'));
});
test('pending native human requests remain unanswered until an exact private bridge response',async t=>{
 const f=await fixture(t),prepared=await f.manager.prepare(f.input),request={id:'native-question',method:'mcpServer/elicitation/request',params:{threadId:prepared.identity.conversationId,message:'Review this worker action'}};f.requests.push(request);
 assert.deepEqual(await f.manager.pending({launchId:f.input.launchId}),[request]);assert.equal(f.answered.length,0);await assert.rejects(f.manager.respond({launchId:f.input.launchId,operationId:'response',requestId:request.id,expected:{...request,params:{}},result:{action:'accept'}}));
 assert.deepEqual(await f.manager.respond({launchId:f.input.launchId,operationId:'response',requestId:request.id,expected:request,result:{action:'decline'}}),{state:'answer-submitted',requestId:request.id,operationId:'response'});assert.equal(f.answered[0].result.action,'decline');await assert.rejects(f.manager.respond({launchId:f.input.launchId,operationId:'other',requestId:request.id,expected:request,result:{action:'accept'}}));
});
