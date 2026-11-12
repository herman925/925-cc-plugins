// Native hook child only. Models cannot supply an authenticated caller, stored
// reservations or a target. Reconcile the exact already-committed operation;
// never reserve again, acknowledge, change permissions or restart a session.
import {createModNative} from './mod-native.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {createOrcaWake} from './src/orca-wake.mjs';
import {createTeamApi} from './api.mjs';
import {SHARED_WRITER} from './src/runtime-release.mjs';
import {exact} from './src/api-domain.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export async function wakeModDeliveries(input,dependencies={}){
 exact(input,['proof','request','orcaCommand']);
 if(input.request?.command?.type!=='prepareDeliveries')throw Error('Only a committed delivery reservation can be reconciled.');
 const native=await (dependencies.createNative??createModNative)({orcaCommand:input.orcaCommand});
 const actor=await native.verifyCaller(input.proof);
 const api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:SHARED_WRITER,authenticate:()=>native.verifyCaller(input.proof)});
 try{
  const receipt=await api.reconcile(input.request);
  if(receipt?.kind!=='api'||receipt.operationId!==input.request.operationId||!Array.isArray(receipt.result?.deliveries))return {state:'unconfirmed',results:[]};
  const snapshot=(await api.execute({operationId:`wake-inspect-${randomUUID()}`,command:{type:'inspectTeam',teamId:input.request.command.teamId}})).result;
  const host=await (dependencies.createHost??createOrcaHost)({orcaCommand:input.orcaCommand});
  const wake=(dependencies.createWake??createOrcaWake)({host});
  const results=[];
  for(const delivery of receipt.result.deliveries){
   const b=delivery.recipient;
   if(b?.provider!=='codex')continue;
   const current=snapshot.bindings.find(row=>row.member_id===b.member_id),member=snapshot.members.find(row=>row.member_id===b.member_id);
   if(member?.membership_state!=='active'||member.cli!=='codex'||!current||Object.keys(b).some(key=>current[key]!==b[key]))continue;
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
