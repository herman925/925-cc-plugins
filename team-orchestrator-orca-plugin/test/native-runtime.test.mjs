import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';import { tmpdir } from 'node:os';
import { createNativeRpc } from '../src/local/native-runtime.mjs';
test('native user transport uses the verified profile socket and current consent without a supervisor caller',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-user-')),endpoint=join(profile,'runtime.sock'); const requests=[];
 const server=createServer(socket=>{let input='';socket.on('data',chunk=>{input+=chunk;if(!input.includes('\n'))return;const request=JSON.parse(input.trim());requests.push(request);socket.end(JSON.stringify({id:request.id,ok:true,result:{runtimeId:'runtime-one'},_meta:{runtimeId:'runtime-one'}})+'\n');});});
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});
 await writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId:'runtime-one',pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 let approved=true;const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{if(!approved)throw Error('Consent revoked');}});
 assert.equal((await rpc('status.get')).runtimeId,'runtime-one');assert.equal(requests[0].authToken,'private-token');
 assert.equal(requests[0].orchestrationCompatibilityEvidence,undefined);assert.equal(requests[0].from,undefined);
 approved=false;await assert.rejects(rpc('status.get'),/Consent revoked/);assert.equal(requests.length,1);
 await assert.rejects(rpc('orchestration.runCreate',{from:'forged'}),/allowed/);
});
for(const failure of ['wrong-runtime','wrong-id','truncated','oversized'])test(`native transport refuses ${failure} evidence instead of completing a work`,async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-fault-')),endpoint=join(profile,'runtime.sock');
 const server=createServer(socket=>{socket.once('data',chunk=>{const request=JSON.parse(chunk.toString().trim());
  if(failure==='truncated')return socket.end('{"id":');if(failure==='oversized')return socket.end('x'.repeat(4096));
  socket.end(JSON.stringify({id:failure==='wrong-id'?'other':request.id,ok:true,result:{},_meta:{runtimeId:failure==='wrong-runtime'?'another':'runtime-one'}})+'\n');
 });});await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});
 await writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId:'runtime-one',pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{},maxBytes:1024,timeoutMs:100});
 await assert.rejects(rpc('status.get'),/runtime|response|Native/);
});
test('native error text cannot disclose the runtime credential, socket or profile',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-private-')),endpoint=join(profile,'runtime.sock');
 const server=createServer(socket=>socket.once('data',chunk=>{const request=JSON.parse(chunk.toString().trim());socket.end(JSON.stringify({id:request.id,ok:false,error:{message:`private-token ${profile} ${endpoint}`},_meta:{runtimeId:'runtime-one'}})+'\n');}));
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});
 await writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId:'runtime-one',pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{}});
 await assert.rejects(rpc('status.get'),error=>!error.message.includes('private-token')&&!error.message.includes(profile)&&!error.message.includes(endpoint));
});
test('one observation pins the native epoch across calls and refuses a same-process rotation before input',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-epoch-')),endpoint=join(profile,'runtime.sock');let epoch='runtime-one';const requests=[];
 const metadata=()=>writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId:epoch,pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 const server=createServer(socket=>socket.once('data',async chunk=>{const request=JSON.parse(chunk.toString().trim());requests.push(request);socket.end(JSON.stringify({id:request.id,ok:true,result:{runtimeId:epoch},_meta:{runtimeId:epoch}})+'\n');}));
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});await metadata();
 const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{}});
 await assert.rejects(rpc.withRuntime('runtime-one',async()=>{await rpc('status.get');epoch='runtime-two';await metadata();await rpc('agentSession.send',{body:{}});}),/runtime.*changed|epoch/i);
 assert.deepEqual(requests.map(row=>row.method),['status.get']);
 assert.equal((await rpc.withRuntime('runtime-two',()=>rpc('status.get'))).runtimeId,'runtime-two');
});
test('a runtime rotation after native response bytes prevents accepting an old combined observation',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-response-epoch-')),endpoint=join(profile,'runtime.sock');
 const metadata=runtimeId=>writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId,pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 const server=createServer(socket=>socket.once('data',async chunk=>{const request=JSON.parse(chunk.toString().trim());await metadata('new-epoch');socket.end(JSON.stringify({id:request.id,ok:true,result:{runtimeId:'old-epoch'},_meta:{runtimeId:'old-epoch'}})+'\n');}));
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});await metadata('old-epoch');
 const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{}});await assert.rejects(rpc.withRuntime('old-epoch',()=>rpc('status.get')),/epoch changed/);
});
test('native stop uses the current orchestration contract with its saved idempotency identity and no caller override',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-contract-')),endpoint=join(profile,'runtime.sock'),requests=[];
 const server=createServer(socket=>socket.once('data',chunk=>{const request=JSON.parse(chunk.toString().trim());requests.push(request);const current=request.orchestrationContractVersion===1;socket.end(JSON.stringify({id:request.id,ok:current,...(current?{result:{state:'stop_unknown',dispatchId:'dispatch-one'}}:{error:{code:'orchestration_migration_required',message:'No effects were applied',data:{reason:'client_contract_missing',effectsApplied:false,requiredContractVersion:1}}}),_meta:{runtimeId:'runtime-one'}})+'\n');}));
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});
 await writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId:'runtime-one',pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{}}),params={dispatch:'dispatch-one'},envelope={orchestrationRequestId:'550e8400-e29b-41d4-a716-446655440000'};
 assert.equal((await rpc('orchestration.workerStop',params,envelope)).state,'stop_unknown');
 assert.equal(requests[0].orchestrationContractVersion,1);assert.equal(requests[0].orchestrationRequestId,envelope.orchestrationRequestId);assert.deepEqual(requests[0].params,params);
 assert.equal(requests[0].orchestrationCompatibilityEvidence,undefined);assert.equal(requests[0].from,undefined);
 await assert.rejects(rpc('orchestration.workerStop',params,{...envelope,orchestrationContractVersion:2}),/overrides/);
 assert.equal(requests.length,1);
});
test('sidebar naming reaches the authenticated native socket with only its exact terminal and title',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-naming-')),endpoint=join(profile,'runtime.sock'),requests=[];
 const server=createServer(socket=>socket.once('data',chunk=>{const request=JSON.parse(chunk.toString().trim());requests.push(request);socket.end(JSON.stringify({id:request.id,ok:true,result:{rename:{handle:request.params.terminal,tabId:'worker-tab',title:request.params.title}},_meta:{runtimeId:'runtime-one'}})+'\n');}));
 await new Promise(resolve=>server.listen(endpoint,resolve));t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});});
 await writeFile(join(profile,'orca-runtime.json'),JSON.stringify({runtimeId:'runtime-one',pid:process.pid,transports:[{kind:'unix',endpoint}],authToken:'private-token'}));
 let approved=true;const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{if(!approved)throw Error('Consent revoked');}});
 const result=await rpc.withRuntime('runtime-one',()=>rpc('terminal.rename',{terminal:'worker-handle',title:'proposal/Worker-1'}));
 assert.deepEqual(result.rename,{handle:'worker-handle',tabId:'worker-tab',title:'proposal/Worker-1'});
 assert.deepEqual(requests[0].params,{terminal:'worker-handle',title:'proposal/Worker-1'});assert.equal(requests[0].from,undefined);
 approved=false;await assert.rejects(rpc('terminal.rename',{terminal:'worker-handle',title:'Other'}),/Consent revoked/);assert.equal(requests.length,1);
});
