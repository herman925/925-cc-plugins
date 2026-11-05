// Active-client observation only. Native caller proof and shared API generations
// are checked again on every pass; this component never reads or acknowledges mail.
import {randomUUID} from 'node:crypto';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from './runtime-release.mjs';
import {refusal} from './errors.mjs';
const stamp=actor=>JSON.stringify(['projectRoot','machineId','provider','conversationId','executionHostId','contextId','terminalHandle','incarnationId'].map(key=>actor[key]));
export function createCodexObserver({native,writer=SHARED_WRITER,createApi=createTeamApi,postgres,timers={setTimeout,clearTimeout}}={}){
 let scope=null,closed=false,inFlight=null,timer=null,state='waiting-for-caller',lastError=null;
 const schedule=(delay=30000)=>{
  if(closed||!scope||timer!==null)return;
  timer=timers.setTimeout(async()=>{timer=null;try{await observer.pump();}catch{/* Failure is visible through status; stale native proof suspends. */}finally{schedule();}},delay);
  timer?.unref?.();
 };
 const run=async()=>{
  if(closed||!scope)return;
  const current=scope;
  const authenticate=async()=>{
   if(closed||scope!==current)throw refusal('API_OBSERVER_SCOPE_CHANGED','Observer scope changed.');
   const actor=await native.verifyCaller(current.metadata);
   if(closed||scope!==current||stamp(actor)!==current.stamp)throw refusal('API_OBSERVER_SCOPE_CHANGED','Observer native identity changed.');
   return actor;
  };
  const actor=await authenticate(),api=await createApi({projectRoot:actor.projectRoot,machineId:actor.machineId,writer,postgres,authenticate});
  const confirmed=async(kind,command)=>{
   let request=current.pending.get(kind),answer;
   if(request){answer=await api.reconcile(request);if(answer.status!=='unknown'){current.pending.delete(kind);return answer;}}
   else{request={operationId:`observer-${kind}-${randomUUID()}`,command};current.pending.set(kind,request);}
   try{answer=await api.execute(request);current.pending.delete(kind);return answer;}
   catch(error){if(error.code!=='STORE_COMMIT_UNKNOWN')current.pending.delete(kind);throw error;}
  };
  try{
   const info=(await api.execute({operationId:`observer-caller-${randomUUID()}`,command:{type:'inspectCaller'}})).result;
   if(!info.member||!info.binding){state='waiting-for-member';lastError=null;return;}
   const authority={teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation};
   await confirmed('deadlines',{...authority,type:'observeDeadlines'});
   const prepared=await confirmed('deliveries',{...authority,type:'prepareDeliveries'});
   await authenticate();
   if(prepared.result.deliveries.length)await native.wake(prepared.result.deliveries,current.metadata);
   if(!closed&&scope===current){state='active';lastError=null;}
  }finally{await api.close();}
 };
 const observer=Object.freeze({
  activate(metadata,actor){if(!closed&&(!scope||scope.stamp!==stamp(actor))){scope={metadata:structuredClone(metadata),stamp:stamp(actor),pending:new Map()};state='scheduled';lastError=null;}schedule();},
  requestPass(){if(timer!==null)timers.clearTimeout(timer);timer=null;schedule(1);},
  pump(){
   if(closed)return Promise.resolve();
   if(!inFlight){const startedScope=scope;inFlight=run().catch(error=>{
    if(scope===startedScope){lastError=error.code??'OBSERVER_FAILED';state=['STORE_NOT_FOUND','STORE_EMPTY'].includes(lastError)?'waiting-for-store':'blocked';
     if(['API_NATIVE_UNVERIFIED','API_OBSERVER_SCOPE_CHANGED','API_STALE_BINDING'].includes(lastError)){state='suspended';scope=null;if(timer!==null)timers.clearTimeout(timer);timer=null;}
    }
    throw error;
   }).finally(()=>{inFlight=null;});}
   return inFlight;
  },
  status(){return {state:closed?'stopped':state,intervalMs:30000,lastError};},
  async close(){closed=true;if(timer!==null)timers.clearTimeout(timer);timer=null;await inFlight?.catch(()=>{});},
 });
 return observer;
}
