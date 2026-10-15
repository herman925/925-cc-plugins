import {randomUUID,createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
export const sameStopIdentity=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
export function stopStore({db,readPrivate,putPrivate,atomic}){
 const listStops=()=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'stop:%' ORDER BY rowid").all().map(row=>JSON.parse(row.json));
 const readStop=id=>readPrivate(`stop:${id}`);
 return {listStops,readStop,
 prepareStop(input,target){return atomic(()=>{
  if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId))throw Error('A stable stop request identity is required.');
  const fingerprint=createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex'),prior=readStop(input.requestId);
  if(prior){if(prior.fingerprint!==fingerprint)throw Error('Stop identity conflicts with another input.');return prior;}
  const duplicate=listStops().findLast(row=>sameStopIdentity(row.target,target));if(duplicate)return duplicate;
  const row={requestId:input.requestId,nativeRequestId:randomUUID(),fingerprint,target,state:'intent',version:1,createdAt:new Date().toISOString()};putPrivate(`stop:${row.requestId}`,row);return row;
 });},
 settleStop(id,version,patch){return atomic(()=>{const row=readStop(id);if(!row||row.version!==version)throw Error('Stop observation was superseded.');const next={...row,...patch,version:version+1};putPrivate(`stop:${id}`,next);return next;});},
 readStopProof({memberId,requestId,instanceGeneration,attemptId,binding}){const row=listStops().findLast(row=>row.state==='stopped'&&row.target.memberId===memberId&&(attemptId?row.target.attemptId===attemptId:row.target.operationRequestId===requestId&&row.target.instanceGeneration===instanceGeneration)&&(!binding||sameStopIdentity(row.target.binding,binding)));return row?{...row.proof,binding:row.target.binding,requestId:row.target.operationRequestId,instanceGeneration:row.target.instanceGeneration,attemptId:row.target.attemptId,stopRequestId:row.requestId}:null;},
 stopProjection:()=>listStops().map(({requestId,target,state,detail,submittedAt,confirmedAt})=>({requestId,teamId:target.teamId,memberId:target.memberId,workId:target.workId,attemptId:target.attemptId,state,detail,submittedAt,confirmedAt})),
 };
}
