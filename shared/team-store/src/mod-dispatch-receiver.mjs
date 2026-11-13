// A direct native hook child. No polling loop and no controller identity in the
// daemon: every scheduled pass re-proves this child's actual Claude parent.
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createModNative} from '../mod-native.mjs';
import {createTeamApi} from '../api.mjs';
import {createOrcaHost} from './orca-host.mjs';
import {createHostAdaptiveWake} from './host-adaptive-wake.mjs';
import {currentWakeEligibility} from './wake-eligibility.mjs';
import {connectProjectReceiver} from './dispatcher-service.mjs';
import {SHARED_WRITER} from './runtime-release.mjs';
import {launchMember} from './mod-launch.mjs';
import {exact} from './api-domain.mjs';

export async function createModDispatchReceiver(input,dependencies={}){
 exact(input,['proof','orcaCommand','pluginRoot']);
 const native=await (dependencies.createNative??createModNative)({orcaCommand:input.orcaCommand});
 const actor=await native.verifyCaller(input.proof),stamp=JSON.stringify(actor),pending=new Map();
 let closed=false,wakes=[],results=[],checkedAt=null,lastError=null;
 const confirmed=async(api,kind,command)=>{
  let request=pending.get(kind);
  if(request){const prior=await api.reconcile(request);if(prior.status!=='unknown'){pending.delete(kind);return prior;}}
  else{request={operationId:`dispatcher-${kind}-${randomUUID()}`,command};pending.set(kind,request);}
  try{const result=await api.execute(request);pending.delete(kind);return result;}
  catch(e){if(e.code!=='STORE_COMMIT_UNKNOWN')pending.delete(kind);throw e;}
 };
 const receiver=(dependencies.connectReceiver??connectProjectReceiver)({projectRoot:actor.projectRoot,machineId:actor.machineId,id:`claude-${process.pid}-${randomUUID()}`,onPass:async({assertCurrent})=>{
  let teamId=null,head=false;
  const authenticate=async()=>{assertCurrent();if(closed)throw Error('Receiver closed.');const current=await native.verifyCaller(input.proof);if(JSON.stringify(current)!==stamp)throw Error('Native receiver identity changed.');return current;};
  let api;
  try{
   await authenticate();api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:SHARED_WRITER,authenticate});
   const info=(await api.execute({operationId:`dispatcher-caller-${randomUUID()}`,command:{type:'inspectCaller'}})).result;
   teamId=info.member?.team_id??null;head=Boolean(info.member&&info.member.boss_member_id==null);
   if(info.controllerGeneration)for(const team of info.teams??[]){
    const data=(await api.execute({operationId:`dispatcher-launches-${randomUUID()}`,command:{type:'inspectConfiguration',teamId:team.team_id}})).result;
    for(const launch of data.launches??[]){
     const member=data.members.find(m=>m.member_id===launch.member_id);
     if(launch.status!=='queued'||!member||member.cli==='codex'||launch.conversation_id===null)continue;
     await authenticate();
     await (dependencies.launchMember??launchMember)({api,native,actor,pluginRoot:input.pluginRoot,configuration:{orca:input.orcaCommand},request:{operationId:`dispatcher-launch-${randomUUID()}`,command:{type:'reserveLaunch',teamId:team.team_id,memberId:member.member_id,launchId:launch.launch_id,expectedConfigVersion:data.team.config_version,expectedMemberGeneration:member.generation,expectedControllerGeneration:info.controllerGeneration}}});
    }
   }
   if(!info.member||!info.binding){lastError=null;return {suspended:true};}
   const authority={teamId,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation};
   const activity=(await api.execute({operationId:`dispatcher-activity-${randomUUID()}`,command:{type:'inspectDispatch',teamId}})).result;
   if(activity.deadlinesDue||pending.has('deadlines'))await confirmed(api,'deadlines',{...authority,type:'observeDeadlines'});
   const prepared=activity.deliveriesDue||activity.deadlinesDue||pending.has('deliveries')?await confirmed(api,'deliveries',{...authority,type:'prepareDeliveries'}):{result:{deliveries:[]}};
   if(prepared.result.deliveries.length)wakes=prepared.result.deliveries;
   if(wakes.length){
    const host=await (dependencies.createHost??createOrcaHost)({orcaCommand:input.orcaCommand});
    const managedBackend=await dependencies.createManagedWakeBackend?.({host,actor,api,teamId});
    const wake=(dependencies.createWake??createHostAdaptiveWake)({host,managedBackend,checkEligible:async delivery=>{await authenticate();return currentWakeEligibility(api,teamId,delivery);}});
    results=[];for(const delivery of wakes){await authenticate();results.push(await wake(delivery,{projectRoot:actor.projectRoot,machineId:actor.machineId}));}
    checkedAt=Date.now();if(results.every(r=>r.state==='settled-or-ineligible'))wakes=[];
   }
   lastError=null;return {teamId,head};
  }catch(e){lastError=/^(API_|STORE_)[A-Z_]+$/.test(e.code??'')?e.code:'API_RECEIVER_UNVERIFIED';return {teamId,head,failed:true,suspended:['API_NATIVE_UNVERIFIED','API_STALE_BINDING','API_RECEIVER_UNVERIFIED'].includes(lastError)};}
  finally{await api?.close();}
 }});
 receiver.request();
 return {status:()=>({dispatcher:receiver.status(),results,checkedAt,lastError}),request:()=>receiver.request(),async close(){closed=true;await receiver.close();}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  let source='';for await(const chunk of process.stdin){source+=chunk;if(source.length>16384)throw Error('Receiver request too large.');}
  const receiver=await createModDispatchReceiver(JSON.parse(source));
  // Bounded hook child, renewed by the existing UI refresh. The sole periodic
  // DB scheduler is the project daemon; this child only receives IPC passes.
  await new Promise(resolve=>setTimeout(resolve,55000));
  const result=receiver.status();await receiver.close();process.stdout.write(JSON.stringify({ok:true,result}));
 }catch{process.stdout.write(JSON.stringify({ok:false,error:{code:'API_RECEIVER_UNVERIFIED'}}));process.exitCode=1;}
}
