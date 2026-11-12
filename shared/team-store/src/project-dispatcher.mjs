// One scheduler per project and machine. Receivers retain provider credentials,
// native caller proof and API authority. This process never opens the team DB.
import {randomUUID} from 'node:crypto';

export function createProjectDispatcher({intervalMs=30000,now=Date.now,persist=async()=>{},recovered=null,isAlive=()=>true,isComplete=async()=>false}={}){
 const receivers=new Map(),groups=new Map(),coverage=new Map(),settled=new Map();
 let active=recovered,closed=false,chain=Promise.resolve(),lastFailure=null;
 const serial=action=>{const result=chain.then(action);chain=result.catch(()=>{});return result;};
 const save=async value=>{const prior=active;if(value)active=value;await persist(value);active=value;if(!value&&prior){settled.set(prior.passId,prior.receiverId);if(settled.size>64)settled.delete(settled.keys().next().value);}};
 const view=()=>({state:closed?'stopped':active?(now()-active.startedAt>=intervalMs*2?'needs-attention':'checking'):'waiting',receiverCount:receivers.size,intervalMs,active:active?{passId:active.passId,receiverId:active.receiverId,startedAt:active.startedAt}:null,lastFailure});
 return Object.freeze({
  register({id,pid,send,completedPassId}){return serial(async()=>{
   if(closed||typeof id!=='string'||!id||id.length>128||!Number.isSafeInteger(pid)||pid<1||typeof send!=='function')throw Error('Invalid dispatcher receiver.');
   if(receivers.has(id))throw Error('Receiver is already connected.');
   if(receivers.size>=64)throw Error('Project receiver limit reached.');
   if(active?.receiverId===id&&active.pid===pid&&completedPassId===active.passId)await save(null);
   receivers.set(id,{id,pid,send,group:`receiver:${id}`,priority:0,due:now()+intervalMs,connected:true});
   return view();
  });},
  disconnect(id){return serial(async()=>{receivers.delete(id);});},
  request(id){return serial(async()=>{const r=receivers.get(id);if(r){r.due=now();groups.set(r.group,now());if(r.team)coverage.set(r.team,now());}});},
  complete(id,passId,outcome={}){return serial(async()=>{
   if(settled.get(passId)===id)return view();
   if(active?.receiverId!==id||active.passId!==passId)throw Error('Dispatcher pass does not match the outstanding pass.');
   const r=receivers.get(id);
   if(r){
    r.team=typeof outcome.teamId==='string'&&outcome.teamId.length>0&&outcome.teamId.length<=256?outcome.teamId:null;
    r.head=outcome.head===true;
    // Only a head may prepare all senders' mail. Without a head, each sender
    // must get a turn; coalescing every worker into one team would starve mail.
    r.group=r.team?JSON.stringify([r.team,r.head?'head':id]):`receiver:${id}`;
    r.priority=outcome.failed===true?-1:outcome.head===true?1:0;
    r.due=outcome.suspended===true?Infinity:now()+intervalMs;
    groups.set(r.group,now()+intervalMs);
    if(r.team&&r.head&&outcome.failed!==true)coverage.set(r.team,now()+intervalMs);
   }
   await save(null);lastFailure=outcome.failed===true?'receiver-pass-failed':null;return view();
  });},
  tick(){return serial(async()=>{
   if(closed)return view();
   if(active){
    // A timeout is not proof a native effect stopped. Recover only after an
    // exact completion or after the owning process is known to have exited.
    if(await isComplete(active)){receivers.delete(active.receiverId);await save(null);}
    else if(!isAlive(active.pid)){await save(null);lastFailure='receiver-exited-during-pass';}
    else return view();
   }
   const candidates=new Map();
   for(const r of receivers.values())if(r.due<=now()&&(groups.get(r.group)??0)<=now()&&(!r.team||(coverage.get(r.team)??0)<=now())){
    const prior=candidates.get(r.group);if(!prior||r.priority>prior.priority||r.priority===prior.priority&&r.due<prior.due)candidates.set(r.group,r);
   }
   // Head preference is within a team. An active head cannot starve other teams.
   const preferredHeads=new Set([...candidates.values()].filter(r=>r.team&&r.head&&r.priority>0).map(r=>r.team));
   const due=[...candidates.values()].filter(r=>!r.team||r.head||!preferredHeads.has(r.team)).sort((a,b)=>(groups.get(a.group)??a.due)-(groups.get(b.group)??b.due)||a.due-b.due);
   const r=due[0];if(!r)return view();
   const pass={passId:randomUUID(),receiverId:r.id,pid:r.pid,startedAt:now()};
   await save(pass); // Durable before the receiver can perform any operation.
   try{r.send({type:'pass',passId:pass.passId});}catch{receivers.delete(r.id);lastFailure='receiver-disconnected-during-pass';}
   return view();
  });},
  status:view,
  async close(){await serial(async()=>{closed=true;receivers.clear();});},
 });
}
