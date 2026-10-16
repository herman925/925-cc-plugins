import assert from 'node:assert/strict';
import { createServer, createConnection } from 'node:net';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { createNativeRpc } from '../src/local/native-runtime.mjs';

// Actual pinned migration fence, durable mutation executor and SQLite receipt store.
// Only the final stop effect is inert; this does not prove native process ownership.
export async function verifyStopContract(host) {
 const profile=await mkdtemp(join(tmpdir(),'stop-contract-')),endpoint=join(profile,'rpc.sock');
 const db=new DatabaseSync(':memory:');db.exec(host.createCoreTablesSql());host.migrateMutationReceiptCapacity(db);
 const native={db};for(const name of ['getOrCreateLocalMutationCallerFingerprint','beginMutationReceipt','completeMutationReceipt','discardPendingMutationReceipt','getMutationReceipt'])native[name]=host[name];
 const runtime={getOrchestrationDb:()=>native,getRuntimeId:()=> 'contract-runtime'};
 let executor=new host.OrchestrationMutationExecutor(runtime),effects=0,dropReceipt=false;const requests=[];
 const server=createServer(socket=>socket.once('data',async bytes=>{
  const request=JSON.parse(bytes.toString().trim());requests.push(request);
  const meta={runtimeId:'contract-runtime'};let response=host.orchestrationMigrationFence(request,meta);
  if(!response){
   try{const params=host.WorkerDispatchParams.parse(request.params);const result=await executor.run(request,params,()=>{effects++;return {dispatchId:params.dispatch,state:'stopped',close:{ptyKilled:true}};});response={id:request.id,ok:true,result,_meta:meta};}
   catch(error){response={id:request.id,ok:false,error:{code:error.code,message:error.message},_meta:meta};}
  }
  if(dropReceipt){if(response.ok!==true)console.error('Unexpected pinned stop response before loss:',response);dropReceipt=false;socket.destroy();}else socket.end(JSON.stringify(response)+'\n');
 }));
 try{
  await new Promise(resolve=>server.listen(endpoint,resolve));
  await writeFile(join(profile,'orca-runtime.json'),JSON.stringify({pid:process.pid,runtimeId:'contract-runtime',authToken:'isolated',transport:{kind:'unix',endpoint}}));
  const rpc=createNativeRpc({userData:profile,parentPid:process.pid,consent:async()=>{}});
  const requestId='550e8400-e29b-41d4-a716-446655440000',params={dispatch:'exact-owned-dispatch'};
  const raw=request=>new Promise((resolve,reject)=>{const socket=createConnection(endpoint),chunks=[];socket.on('connect',()=>socket.write(JSON.stringify(request)+'\n'));socket.on('data',chunk=>chunks.push(chunk));socket.on('end',()=>resolve(JSON.parse(Buffer.concat(chunks).toString())));socket.on('error',reject);});
  for(const version of [undefined,2]){
   const refused=await raw({id:'old-request',method:'orchestration.workerStop',params,orchestrationRequestId:requestId,...(version===undefined?{}:{orchestrationContractVersion:version})});
   assert.equal(refused.error.code,'orchestration_migration_required');assert.equal(refused.error.data.effectsApplied,false);assert.equal(effects,0);
  }
  assert.equal(db.prepare('SELECT count(*) AS n FROM mutation_receipts').get().n,0);
  dropReceipt=true;await assert.rejects(rpc('orchestration.workerStop',params,{orchestrationRequestId:requestId}),/unconfirmed/);assert.equal(effects,1);
  executor=new host.OrchestrationMutationExecutor(runtime); // plugin/native executor restart does not erase the durable receipt.
  assert.equal((await rpc('orchestration.workerStop',params,{orchestrationRequestId:requestId})).state,'stopped');assert.equal(effects,1);
  await assert.rejects(rpc('orchestration.workerStop',{dispatch:'different-dispatch'},{orchestrationRequestId:requestId}),error=>error.code==='request_mismatch');assert.equal(effects,1);
  const pendingId='550e8400-e29b-41d4-a716-446655440001';
  native.beginMutationReceipt({callerFingerprint:native.getOrCreateLocalMutationCallerFingerprint(),requestId:pendingId,method:'orchestration.workerStop',payloadHash:host.hashCanonical({method:'orchestration.workerStop',params})});
  await assert.rejects(rpc('orchestration.workerStop',params,{orchestrationRequestId:pendingId}),error=>error.code==='operation_unknown');assert.equal(effects,1);
  assert.equal(requests.at(-1).orchestrationContractVersion,1);assert.deepEqual(requests.at(-1).params,params);assert.equal(requests.at(-1).orchestrationCompatibilityEvidence,undefined);
  console.log('PASS: pinned stop migration fence and durable SQLite receipt replay over real socket: missing/unsupported contract, lost receipt, restart, same-ID completed/pending/mismatch; inert final effect.');
 }finally{await new Promise(resolve=>server.close(resolve));db.close();await rm(profile,{recursive:true,force:true});}
}
