import { withNativeRuntime } from './native-runtime.mjs';
import { readNativeDispatchEvidence } from './native-dispatch.mjs';
import { userMessage,accepted } from './dispatch.mjs';
import { notifyQuestionEvent } from './questions.mjs';
export function createLifecycleService({store,rpc,userData,consent,works,notify}){
 const queues=new Map();
 const serial=(id,fn)=>{const p=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(()=>withNativeRuntime(rpc,store.readCurrentWork(id)?.binding.runtimeId,fn));queues.set(id,p);p.finally(()=>{if(queues.get(id)===p)queues.delete(id);}).catch(()=>{});return p;};
 async function evidence(id){
  const work=store.readCurrentWork(id);if(!work||work.status==='completed')return null;
  const verified=await works.verifyWork(id,true),protocol=store.readDispatchProtocol(id);
  if(!protocol||protocol.generation!==work.run.consumerGeneration)throw Error('Supervisor delivery protocol is unavailable.');
  const native=await readNativeDispatchEvidence(userData,{work,protocol,team:store.effectiveTeamForWork(work.id),owner:verified.instance,admitted:store.listDispatches(id)});
  if(native.state!=='verified')throw Error(native.detail);
  return {work,verified,native};
 }
 async function check(id){
  const row=await evidence(id);if(!row)return;
  if(store.readCurrentWork(id).version!==row.work.version)throw Error('Work changed during delivery observation.');
  for(const proposal of row.native.deliveries??[]){let d;try{d=store.recordDelivery(id,proposal);}catch{continue;}
   if(d?.status==='pending')await notifyQuestionEvent(store,notify,{workId:id,id:`delivery-${d.id}`,kind:'goal-delivery',title:'Total objective ready for your review',body:d.summary.slice(0,1000)});
  }
 }
 return {
  check:id=>serial(id,()=>check(id)),
  decide:input=>serial(input.workId,async()=>{
   await consent();const prior=store.readWorkDecision(input.requestId);
   if(prior)return store.decideWork(input);
   const row=await evidence(input.workId);if(!row||!row.native.deliveries.some(d=>d.id===input.deliveryId))throw Error('Current native Head delivery is unavailable.');
   if(input.decision==='accept'&&row.native.intents.some(i=>!store.listDispatches(input.workId).some(a=>a.nativeTaskId===i.nativeTaskId)))throw Error('Native task awaits application admission.');
   if(input.decision==='accept'&&row.native.unmanaged?.length)throw Error('Unregistered native work requires confirmation before closure.');
   if(input.decision==='accept'&&store.listDispatches(input.workId).some(a=>a.status==='accepted'&&!row.native.observations.some(o=>o.id===a.id&&o.state==='verified'&&o.completion?.evidenceId===a.evidenceId)))throw Error('Accepted task execution evidence changed; closure awaits confirmation.');
   if(input.decision==='accept'&&row.native.rejected.length)throw Error('Native task evidence needs confirmation before closure.');
   await works.verifyHost(input.workId,row.verified.hostGeneration);
   const event=store.decideWork(input);
   if(input.decision==='rework'){
    const nativeSend=userMessage(row.work,row.verified.instance,'TEAM_GOAL_REWORK\n'+JSON.stringify({workId:input.workId,deliveryId:input.deliveryId,decisionId:input.requestId,feedback:input.feedback,instruction:'Continue this same total objective. Submit a new genuine team-delivery/v1 Task referencing previousDeliveryId after corrections; the old proposal cannot be accepted.'}),row.verified.status);
    store.updateWorkDecision(input.requestId,{nativeSend,input:{state:'sending'}});
    try{await consent();await works.verifyHost(input.workId,row.verified.hostGeneration);const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);if(!accepted(receipt,nativeSend,row.verified.instance))throw Error('Unconfirmed input');store.updateWorkDecision(input.requestId,{input:{state:receipt.value?.queued?'queued':'accepted'}});}
    catch(error){store.updateWorkDecision(input.requestId,{input:{state:'unknown',detail:String(error.message).slice(0,1200)}});}
   }
   return event;
  }),
  async reconcile(){for(const w of store.listCurrentWorks())if(w.status!=='completed'&&w.run.state==='verified')try{await this.check(w.id);}catch{}}
 };
}
