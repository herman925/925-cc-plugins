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
