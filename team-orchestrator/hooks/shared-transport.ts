import type {SharedProof} from './shared-bridge'
// UI refresh maintains a bounded native receiver, without polling the DB.
let pumping=false
let queued=false
let wakeObservation:{scope:string;checkedAt:number;results:any[];dispatcher?:any;lastError?:string}|undefined
const scopeKey=(proof:SharedProof)=>proof.ok?JSON.stringify([proof.root,proof.sessionId,proof.handle,proof.contextId]):''
export function sharedWakeObservation(proof:SharedProof){
 if(!proof.ok||wakeObservation?.scope!==scopeKey(proof))return undefined
 return {checkedAt:wakeObservation.checkedAt,stale:Date.now()-wakeObservation.checkedAt>90000,results:wakeObservation.results,dispatcher:wakeObservation.dispatcher,lastError:wakeObservation.lastError}
}
export function sharedWakeContext(proof:SharedProof){
 const observed=sharedWakeObservation(proof)
 return observed?'Machine-local single project dispatcher observations. Check timestamps and stale before reporting current delivery. The dispatcher schedules independently authenticated receivers; it holds no controller approval. host-update-required sends no input; fallback-setup-required means no verified managed route is enrolled, not permission to create one. needs-reconciliation preserves the original request and selected route. A turn start is not inbox progress or task pickup. Inspect actual inbox/assignment receipts; never repair this by inventing assignments, changing permissions or answering another session’s approval.\n'+JSON.stringify(observed):undefined
}
export function queueSharedDeliveries($:any,proof:SharedProof,options:{node:string;orca:string}){
 if(!proof.ok||queued)return
 queued=true
 $.clock.after(1,()=>{queued=false;void pumpSharedDeliveries($,proof,options).catch(()=>undefined)})
}
export async function pumpSharedDeliveries($:any,proof:SharedProof,options:{node:string;orca:string}){
 if(!proof.ok||pumping)return
 pumping=true
 try{
  const result=await $.process.run([options.node,`${$.plugin.root}/store/src/mod-dispatch-receiver.mjs`],{stdin:JSON.stringify({proof:{projectRoot:proof.root,conversationId:proof.sessionId,terminalHandle:proof.handle,contextId:proof.contextId},orcaCommand:options.orca,pluginRoot:$.plugin.root}),timeoutMs:65000}).catch(()=>undefined)
  let value:any
  try{value=JSON.parse(String(result?.stdout));if(result?.exitCode!==0||value.ok!==true||!Array.isArray(value.result?.results))throw Error()}catch{value={result:{results:[{state:'needs-reconciliation',reason:'dispatcher-receiver-unverified',observedAt:Date.now()}],lastError:'API_RECEIVER_UNVERIFIED'}}}
  const previous=wakeObservation,observed=value.result
  wakeObservation={scope:scopeKey(proof),checkedAt:observed.checkedAt??Date.now(),results:observed.results.slice(0,20),dispatcher:observed.dispatcher,lastError:observed.lastError}
  const blocked=wakeObservation.results.find(r=>['host-update-required','fallback-setup-required','needs-reconciliation','needs-attention'].includes(r.state))
  if(blocked&&(previous?.scope!==scopeKey(proof)||JSON.stringify(previous?.results.map(r=>r.state))!==JSON.stringify(wakeObservation.results.map(r=>r.state))))try{await $.ui.toast(`Inbox wake-up: ${blocked.state}. Inspect Team workspace; no permission or assignment was changed.`)}catch{}
 }finally{pumping=false}
}
