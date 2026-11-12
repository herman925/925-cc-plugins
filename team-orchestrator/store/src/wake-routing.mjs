// One logical wake owns one backend choice. Availability is NOT permission;
// each backend must still prove the native target and existing shared authority.
import {createHash} from 'node:crypto';
import {mkdir,open,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {wakePointer} from './orca-wake.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const unavailableReasons=new Set(['missing-target-fence','owned-input-unavailable','transport-not-supported']);
const routeIds=new Set(['orca-terminal','orca-managed','provider-direct','provider-managed']);
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function reserve(path,value){let file;try{file=await open(path,'wx',0o600);}catch(e){if(e.code==='EEXIST')return read(path);throw e;}try{await file.writeFile(JSON.stringify(value));await file.sync();return value;}finally{await file.close();}}
async function predatesRouting(root,intent,key){
 for(const [prefix,file] of [['v2','request-0.json'],['owned-v1','intent.json']])if(await read(join(root,prefix,key,file)))return true;
 let entries;try{entries=await readdir(root);}catch(e){if(e.code==='ENOENT')return false;throw e;}
 if(entries.length>2000)throw Error('Legacy receipt scan requires reconciliation.');
 for(const name of entries)if(/^[a-f0-9]{64}$/.test(name)){
  const row=await read(join(root,name,'request.json'));
  if(row?.identity?.projectRoot===intent.projectRoot&&row.identity.binding?.member_id===intent.memberId&&same(row.identity.pointer,intent.pointer))return true;
 }
 return false;
}
export function createWakeRouter({primary,fallback,journalRoot,checkEligible,now=Date.now}){
 for(const route of [primary,...(fallback?[fallback]:[])])if(!routeIds.has(route?.id)||typeof route.availability!=='function'||typeof route.wake!=='function')throw Error('A private verified wake backend is required.');
 if(primary.id===fallback?.id||typeof checkEligible!=='function'||typeof journalRoot!=='string')throw Error('Distinct routes, current eligibility and a local journal are required.');
 const routes=new Map([primary,...(fallback?[fallback]:[])].map(route=>[route.id,route]));
 return async(delivery,scope)=>{
  const pointer=wakePointer(delivery),memberId=delivery.recipient?.member_id;
  const result=(state,extra={})=>({state,pointer,recipientMemberId:memberId,observedAt:now(),...extra});
  const intent={projectRoot:scope.projectRoot,machineId:scope.machineId,memberId,pointer},key=hash(intent),directory=join(journalRoot,'routes-v1'),path=join(directory,`${key}.json`);
  let saved;
  try{
   const eligible=await checkEligible(delivery);if(eligible?.eligible!==true)return result('settled-or-ineligible',{reason:eligible?.reason??'eligibility-unverified'});
   saved=await read(path);
   if(!saved){
    const available=await primary.availability(delivery,scope);let route;
    if(available?.state==='available')route=primary;
    else if(available?.state==='unavailable'&&unavailableReasons.has(available.reason)){
     if(await predatesRouting(journalRoot,intent,key))return result('needs-reconciliation',{reason:'pre-routing-wake-receipt',primaryRoute:primary.id});
     if(!fallback)return result('fallback-setup-required',{reason:'no-reviewed-managed-backend',primaryRoute:primary.id});
     const alternate=await fallback.availability(delivery,scope);
     if(alternate?.state!=='available')return result(alternate?.state==='blocked'?'needs-attention':alternate?.state==='unknown'?'needs-reconciliation':'fallback-setup-required',{reason:alternate?.reason??'managed-target-unverified',primaryRoute:primary.id,fallbackRoute:fallback.id});
     route=fallback;
    }else return result(available?.state==='unknown'?'needs-reconciliation':'needs-attention',{reason:available?.reason??'primary-availability-unverified',primaryRoute:primary.id});
    await mkdir(directory,{recursive:true,mode:0o700});
    saved=await reserve(path,{version:1,intent,selectedRoute:route.id,primaryRoute:primary.id,fallbackRoute:fallback?.id??null,selectedAt:now()});
   }
   if(saved?.version!==1||!same(saved.intent,intent)||saved.primaryRoute!==primary.id||saved.selectedRoute!==primary.id&&saved.selectedRoute!==fallback?.id)return result('needs-reconciliation',{reason:'wake-route-contract-changed',selectedRoute:saved?.selectedRoute});
   const selected=routes.get(saved.selectedRoute);if(!selected)return result('needs-reconciliation',{reason:'selected-wake-backend-unavailable',selectedRoute:saved.selectedRoute});
   // Once selected, call THAT backend to reconcile its original receipt. A
   // newly healthy primary, timeout, lost reply or refusal never reroutes it.
   const current=await checkEligible(delivery);if(current?.eligible!==true)return result('settled-or-ineligible',{reason:current?.reason??'eligibility-unverified',selectedRoute:selected.id});
   const receipt=await selected.wake(delivery,scope);
   if(!receipt||typeof receipt.state!=='string')return result('needs-reconciliation',{reason:'wake-backend-receipt-unverified',selectedRoute:selected.id});
   return {...receipt,selectedRoute:selected.id,usingFallback:selected.id!==primary.id};
  }catch{return result('needs-reconciliation',{reason:'wake-route-outcome-unverified',...(saved?{selectedRoute:saved.selectedRoute}:{})});}
 };
}
