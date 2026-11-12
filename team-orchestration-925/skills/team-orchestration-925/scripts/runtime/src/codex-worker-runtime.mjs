// Private adapter lifecycle. No model request supplies a runtime proof, epoch,
// approval or ready flag. Tool steps are observed only after their real call.
import {randomUUID,createHash} from 'node:crypto';
import {refusal} from './errors.mjs';
import {requireWorkerToolPolicy} from './worker-policy.mjs';
const stamp=actor=>JSON.stringify(['projectRoot','machineId','provider','conversationId','executionHostId','contextId','terminalHandle','incarnationId'].map(k=>actor[k]));
export function createCodexWorkerRuntime({options,native,createApi,timers={setTimeout,clearTimeout}}){
 if(!options.workerAccess)return null;
 if(!options.reservedLaunch)throw refusal('API_WORKER_PROOF_REQUIRED','Reviewed worker access requires its fixed reserved launch.');
 requireWorkerToolPolicy(options.workerAccess.policyId);
 const epoch=randomUUID();let current=null,timer=null,closed=false,inFlight=null;
 const proofFor=actor=>({launchId:options.reservedLaunch.launchId,planId:options.workerAccess.planId,policyId:options.workerAccess.policyId,runtimeEpoch:epoch,nativeExecutionKey:createHash('sha256').update(JSON.stringify([stamp(actor),process.ppid])).digest('hex')});
 const failure=()=>refusal('API_WORKER_RUNTIME_STALE','The verified worker runtime changed; readiness must be checked again.');
 const apiOptions=(metadata,actor,cachedClose=false)=>({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,
  authenticate:async()=>{if(cachedClose)return actor;const fresh=await native.verifyCaller(metadata);if(stamp(fresh)!==stamp(actor))throw failure();return fresh;},
  verifyWorkerRuntime:async()=>proofFor(actor)});
 const step=(api,type,extra={})=>api.workerRuntime({operationId:`worker-runtime-${randomUUID()}`,type,...extra});
 const schedule=()=>{if(closed||!current||timer!==null)return;timer=timers.setTimeout(async()=>{timer=null;try{await runtime.heartbeat();}catch{/* Admission observes expiry; no readiness is invented on a failed native check. */}finally{schedule();}},30000);timer?.unref?.();};
 const runtime={
  apiOptions,
  async prepare(api,metadata,actor){
   if(closed)throw failure();
   if(current&&current.stamp===stamp(actor))return;
   await step(api,'beginWorkerRuntime');current={metadata,actor,stamp:stamp(actor)};schedule();
  },
  async observe(api,observed,receiptId){return (await step(api,'observeWorkerRuntime',{step:observed,...(receiptId?{receiptId}:{})})).result;},
  async heartbeat(){
   if(closed||!current)return;if(inFlight)return inFlight;
   const active=current;
   inFlight=(async()=>{const api=await createApi(apiOptions(active.metadata,active.actor));try{if(closed||current!==active)return;await runtime.observe(api,'heartbeat');}finally{await api.close();}})().finally(()=>{inFlight=null;});
   return inFlight;
  },
  async close(){
   if(closed)return;closed=true;if(timer!==null)timers.clearTimeout(timer);timer=null;await inFlight?.catch(()=>{});
   if(!current)return;const active=current;
   // Down-only disconnect uses the last verified actor after transport EOF.
   // The database still fences exact binding/epoch, so a predecessor cannot
   // disconnect a successor. It cannot begin or refresh readiness here.
   const api=await createApi(apiOptions(active.metadata,active.actor,true));
   try{await step(api,'closeWorkerRuntime');}catch{/* Changed binding/authority cannot affect its successor. */}finally{await api.close();}
  }
 };
 return Object.freeze(runtime);
}
