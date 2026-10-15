import {createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const publicWake=row=>{if(!row)return null;const {oldBinding,nativeAction,fingerprint,...value}=row;return {...value,oldRequestId:oldBinding.requestId,oldInstanceGeneration:oldBinding.instanceGeneration??1};};
export function wakeStore({db,readPrivate,putPrivate,atomic,readOperation}){
 const readWake=id=>readPrivate(`wake:${id}`);
 return {
  readWake,
  listWakes:()=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().map(r=>JSON.parse(r.json)),
  prepareWake(input,operation,proof,nativeAction){return atomic(()=>{
   const prior=readWake(input.requestId),fingerprint=digest(input);if(prior){if(prior.fingerprint!==fingerprint)throw Error('Recovery request conflicts with saved input.');return {row:prior,fresh:false};}
   const current=readOperation(operation.requestId),pointer=readPrivate(`binding:${operation.memberId}`);
   if(current?.version!==operation.version||pointer?.requestId!==operation.requestId||(pointer.instanceGeneration??1)!==(operation.instanceGeneration??1))throw Error('Member binding changed during recovery.');
   if(readPrivate(`wake-member:${operation.memberId}`))throw Error('This member already has an unresolved recovery. Check its saved result.');
   const row={...input,fingerprint,oldBinding:operation,proof,nativeAction,state:nativeAction?'reserved':'needs_decision',version:1,createdAt:new Date().toISOString()};
   putPrivate(`wake:${input.requestId}`,row);putPrivate(`wake-member:${operation.memberId}`,{requestId:input.requestId});return {row,fresh:true};
  });},
  claimWake(id){return atomic(()=>{const row=readWake(id);if(row?.state!=='reserved')return false;row.state='submitted';row.version++;putPrivate(`wake:${id}`,row);return true;});},
  updateWake(id,version,patch){return atomic(()=>{const row=readWake(id);if(!row||row.version!==version)throw Error('Recovery changed; reload saved evidence.');if(Object.keys(patch).some(k=>!['state','detail','receipt','newInstance','handoff','decision','nativeAction','notification'].includes(k)))throw Error('Immutable recovery identity cannot change.');Object.assign(row,patch,{version:version+1});putPrivate(`wake:${id}`,row);return row;});}
 };
}
