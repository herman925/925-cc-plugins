// Native hook child only. Models cannot supply an authenticated caller, stored
// reservations or a target. Reconcile the exact already-committed operation;
// never reserve again, acknowledge, change permissions or restart a session.
import {createModNative} from './mod-native.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {createHostAdaptiveWake} from './src/host-adaptive-wake.mjs';
import {createTeamApi} from './api.mjs';
import {SHARED_WRITER} from './src/runtime-release.mjs';
import {exact} from './src/api-domain.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {currentWakeEligibility} from './src/wake-eligibility.mjs';

export async function wakeModDeliveries(input,dependencies={}){
 exact(input,['proof','request','orcaCommand']);
 if(input.request?.command?.type!=='prepareDeliveries')throw Error('Only a committed delivery reservation can be reconciled.');
 const native=await (dependencies.createNative??createModNative)({orcaCommand:input.orcaCommand});
 const actor=await native.verifyCaller(input.proof);
 const api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:SHARED_WRITER,authenticate:()=>native.verifyCaller(input.proof)});
 try{
  const receipt=await api.reconcile(input.request);
  if(receipt?.kind!=='api'||receipt.operationId!==input.request.operationId||!Array.isArray(receipt.result?.deliveries))return {state:'unconfirmed',results:[]};
  const host=await (dependencies.createHost??createOrcaHost)({orcaCommand:input.orcaCommand});
  const checkEligible=delivery=>currentWakeEligibility(api,input.request.command.teamId,delivery);
  const managedBackend=await dependencies.createManagedWakeBackend?.({host,actor,api,teamId:input.request.command.teamId});
  const wake=(dependencies.createWake??createHostAdaptiveWake)({host,managedBackend,checkEligible});
  const results=[];
  for(const delivery of receipt.result.deliveries){
   const b=delivery.recipient;
   if(!['claude','codex'].includes(b?.provider))continue;
   const eligible=await checkEligible(delivery);
   if(!eligible.eligible){results.push({state:'settled-or-ineligible',pointer:delivery.deliveryId??delivery.noticeId??delivery.meetingId,recipientMemberId:b.member_id,reason:eligible.reason,observedAt:Date.now()});continue;}
   results.push(await wake(delivery,{projectRoot:actor.projectRoot,machineId:actor.machineId}));
  }
  return {state:'checked',results};
 }finally{await api.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  let source='';for await(const chunk of process.stdin){source+=chunk;if(source.length>65536)throw Error('Oversized wake request.');}
  const result=await wakeModDeliveries(JSON.parse(source));process.stdout.write(JSON.stringify({ok:true,result}));
 }catch{process.stdout.write(JSON.stringify({ok:false,error:{code:'API_WAKE_UNVERIFIED',message:'Native wake was not confirmed. The original delivery remains outstanding.'}}));process.exitCode=1;}
}
