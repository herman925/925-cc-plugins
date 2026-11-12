// Active-client observation only. Native caller proof and shared API generations
// are checked again on every pass; this component never reads or acknowledges mail.
import {randomUUID} from 'node:crypto';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from './runtime-release.mjs';
import {refusal} from './errors.mjs';
import {pumpCodexLaunches} from './codex-launch.mjs';
import {connectProjectReceiver} from './dispatcher-service.mjs';
const stamp=actor=>JSON.stringify(['projectRoot','machineId','provider','conversationId','executionHostId','contextId','terminalHandle','incarnationId'].map(key=>actor[key]));
export function createCodexObserver({native,writer=SHARED_WRITER,createApi=createTeamApi,postgres,timers,createReceiver=connectProjectReceiver}={}){
 // Injected clocks are an isolated deterministic test driver. Production uses
 // the project dispatcher, never a timer in each MCP observer.
 let scope=null,closed=false,inFlight=null,timer=null,receiver=null,passFence=null,team=null,head=false,state='waiting-for-caller',lastError=null,lastFailure=null,launches=[],wakeReceipts=[],wakeCheckedAt=null;
 const schedule=(delay=30000)=>{
  if(!timers||closed||!scope||timer!==null)return;
  timer=timers.setTimeout(async()=>{timer=null;try{await observer.pump();}catch{/* Failure is visible through status; stale native proof suspends. */}finally{schedule();}},delay);
  timer?.unref?.();
 };
 const run=async()=>{
  if(closed||!scope)return;
  const current=scope;
  const authenticate=async()=>{
   passFence?.();
   if(closed||scope!==current)throw refusal('API_OBSERVER_SCOPE_CHANGED','Observer scope changed.');
   const actor=await native.verifyCaller(current.metadata);
   if(closed||scope!==current||stamp(actor)!==current.stamp)throw refusal('API_OBSERVER_SCOPE_CHANGED','Observer native identity changed.');
   return actor;
  };
  const actor=await authenticate(),api=await createApi({projectRoot:actor.projectRoot,machineId:actor.machineId,writer,postgres,authenticate,verifyLaunchTarget:target=>native.verifyLaunchTarget(target,current.metadata)});
  const confirmed=async(kind,command)=>{
   let request=current.pending.get(kind),answer;
   if(request){answer=await api.reconcile(request);if(answer.status!=='unknown'){current.pending.delete(kind);return answer;}}
   else{request={operationId:`observer-${kind}-${randomUUID()}`,command};current.pending.set(kind,request);}
   try{answer=await api.execute(request);current.pending.delete(kind);return answer;}
   catch(error){if(error.code!=='STORE_COMMIT_UNKNOWN')current.pending.delete(kind);throw error;}
  };
  try{
   const info=(await api.execute({operationId:`observer-caller-${randomUUID()}`,command:{type:'inspectCaller'}})).result;
   team=info.member?.team_id??null;head=Boolean(info.member&&info.member.boss_member_id==null);
   if(native.launchWorkers)launches=await pumpCodexLaunches({api,native,actor,metadata:current.metadata,info,postgres});
   if(!info.member||!info.binding){state='waiting-for-member';lastError=null;lastFailure=null;return;}
   const authority={teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation};
   await confirmed('deadlines',{...authority,type:'observeDeadlines'});
   const prepared=await confirmed('deliveries',{...authority,type:'prepareDeliveries'});
   await authenticate();
   if(prepared.result.deliveries.length)current.wakes=prepared.result.deliveries;
   if(current.wakes.length){
    const receipts=await native.wake(current.wakes,current.metadata,{api,teamId:info.member.team_id});
    if(!closed&&scope===current){wakeReceipts=(receipts??[]).slice(0,20);wakeCheckedAt=Date.now();}
    if((receipts??[]).every(row=>row.state==='settled-or-ineligible'))current.wakes=[];
   }
   if(!closed&&scope===current){state='active';lastError=null;lastFailure=null;}
  }finally{await api.close();}
 };
 const observer=Object.freeze({
  activate(metadata,actor){if(!closed&&(!scope||scope.stamp!==stamp(actor))){
   const previous=receiver;receiver=null;if(previous)void previous.close().catch(()=>{});
   scope={metadata:structuredClone(metadata),stamp:stamp(actor),pending:new Map(),wakes:[]};state='scheduled';lastError=null;wakeReceipts=[];wakeCheckedAt=null;team=null;head=false;
   if(!timers){const current=scope;receiver=createReceiver({projectRoot:actor.projectRoot,machineId:actor.machineId,id:`codex-${process.pid}-${randomUUID()}`,onPass:async({assertCurrent})=>{
    if(scope!==current||closed)return {suspended:true};
    passFence=assertCurrent;
    try{await observer.pump();return {teamId:team,head,suspended:!scope||state==='waiting-for-member'};}
    catch{return {teamId:team,head,failed:true,suspended:!scope||state==='waiting-for-store'};}
    finally{passFence=null;}
   }});}
  }else if(receiver&&['waiting-for-member','waiting-for-store'].includes(state))receiver.request();schedule();},
  requestPass(){if(receiver){receiver.request();return;}if(timer!==null)timers?.clearTimeout(timer);timer=null;schedule(1);},
  pump(){
   if(closed)return Promise.resolve();
   if(!inFlight){const startedScope=scope;inFlight=run().catch(error=>{
    if(scope===startedScope){lastError=error.code??'OBSERVER_FAILED';state=['STORE_NOT_FOUND','STORE_EMPTY'].includes(lastError)?'waiting-for-store':'blocked';
     lastFailure={code:lastError,message:typeof error.code==='string'&&/^(API_|STORE_)[A-Z_]+$/.test(error.code)?String(error.message).slice(0,500):'Observation failed; no native authority was inferred.'};
     if(['API_NATIVE_UNVERIFIED','API_OBSERVER_SCOPE_CHANGED','API_STALE_BINDING'].includes(lastError)){state='suspended';scope=null;if(timer!==null)timers?.clearTimeout(timer);timer=null;}
    }
    throw error;
   }).finally(()=>{inFlight=null;});}
   return inFlight;
  },
  status(){return {state:closed?'stopped':state,intervalMs:30000,lastError,lastFailure,dispatcher:receiver?.status()??{state:timers?'test-clock':'waiting-for-caller'},launches,wakeReceipts,wakeCheckedAt,wakeObservationsStale:wakeCheckedAt!==null&&(Date.now()-wakeCheckedAt>90000||!scope||closed)};},
  async close(){closed=true;if(timer!==null)timers?.clearTimeout(timer);timer=null;await receiver?.close();await inFlight?.catch(()=>{});},
 });
 return observer;
}
