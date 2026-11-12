import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const textHash=value=>createHash('sha256').update(value,'utf8').digest('hex');
export const FENCED_WAKE_CAPABILITY='terminal.fenced-prompt-delivery.v1';
export const nativeWakeBinding=b=>({terminalHandle:b.terminal_handle,worktreeId:b.context_id,executionHostId:b.execution_host_id,provider:b.provider,conversationId:b.conversation_id,incarnationId:b.incarnation_id});
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function claim(path,value){
 let file;try{file=await open(path,'wx',0o600);}catch(error){if(error.code==='EEXIST')return read(path);throw error;}
 try{await file.writeFile(JSON.stringify(value));await file.sync();return value;}finally{await file.close();}
}
export function createWakeJournal({host,journalRoot,prompt,pointerFor,checkEligible,now=Date.now,progressWindowMs=30000}){
 return async(delivery,scope)=>{
  const pointer=pointerFor(delivery),b=delivery.recipient,observedAt=now();
  const result=(state,fields={})=>({state,pointer,recipientMemberId:b?.member_id,observedAt,...fields});
  if(!['claude','codex'].includes(b?.provider)||b.machine_id!==scope.machineId||b.execution_host_id!=='local')return result('unsupported');
  if(typeof checkEligible!=='function')return result('needs-reconciliation',{reason:'eligibility-check-unavailable'});
  const expectedBinding=nativeWakeBinding(b),text=prompt(pointer),bodyDigest=textHash(text);
  // Binding generation is authority freshness, NOT native effect identity.
  // Even a changed native target consults the same original request first.
  const intent={projectRoot:scope.projectRoot,machineId:scope.machineId,memberId:b.member_id,pointer};
  const directory=join(journalRoot,'v2',hash(intent));
  let saved;
  const eligible=async()=>{
   const value=await checkEligible(delivery);
   if(value?.eligible!==true)return result('settled-or-ineligible',{reason:value?.reason??'eligibility-unverified'});
   return null;
  };
  const verify=async()=>{
   const target=await host.verifyTerminal({projectRoot:scope.projectRoot,conversationId:b.conversation_id,terminalHandle:b.terminal_handle,contextId:b.context_id},b.provider);
   if(target.actor.incarnationId!==b.incarnation_id||target.actor.machineId!==scope.machineId)throw Error('Native target changed.');
  };
  try{
   const stopped=await eligible();if(stopped)return stopped;
   if(!host.capabilities.includes(FENCED_WAKE_CAPABILITY)||!host.capabilities.includes('terminal.prompt-delivery.v1')||!host.promptJournalId)return result('host-update-required',{recoveryAction:'Update the owning Orca host to the fenced prompt/receipt contract, then reconnect the client. No input was sent.'});
   await verify();await mkdir(directory,{recursive:true,mode:0o700});
   // Do not silently reset pre-fence journals on an update. Their acceptance
   // history cannot be reconstructed from a new binding or host capability.
   const legacy=await readdir(journalRoot);if(legacy.length>2000)return result('needs-reconciliation',{reason:'legacy-journal-scan-limit'});
   for(const name of legacy)if(/^[a-f0-9]{64}$/.test(name)){
    const old=await read(join(journalRoot,name,'request.json'));
    if(old?.identity?.projectRoot===scope.projectRoot&&same(old.identity.pointer,pointer)&&old.identity.binding?.member_id===b.member_id)return result('needs-reconciliation',{reason:'legacy-wake-request',requestId:old.requestId});
   }
   for(let attempt=0;attempt<2;attempt++){
    const path=join(directory,`request-${attempt}.json`);
    saved=await read(path);
    if(!saved){
     const activity=(await host.rpc('terminal.agentStatus',{terminal:b.terminal_handle}))?.agentStatus;
     if(activity?.handle!==b.terminal_handle||activity.isRunningAgent!==true||activity.status!=='idle')return result('waiting-for-idle');
     saved=await claim(path,{version:2,intent,requestId:randomUUID(),expectedBinding,terminalHandle:b.terminal_handle,text,bodyDigest,journalId:host.promptJournalId,createdAt:now()});
    }
    if(saved?.version!==2||!same(saved.intent,intent)||saved.bodyDigest!==textHash(saved.text)||saved.journalId!==host.promptJournalId)return result('needs-reconciliation',{reason:'journal-continuity-unverified',requestId:saved?.requestId});
    // Always use the saved body. A release may change the fixed prompt wording;
    // an already accepted request must never acquire a different payload.
    const lookup=await host.lookupWake(saved);
    if(lookup?.journalId!==saved.journalId||lookup.requestId!==saved.requestId)return result('needs-reconciliation',{reason:'native-receipt-unverified',requestId:saved.requestId});
    if(!same(lookup.expectedBinding,saved.expectedBinding)||lookup.bodyDigest!==saved.bodyDigest)return result('needs-reconciliation',{reason:'native-receipt-conflict',requestId:saved.requestId});
    if(lookup.state==='unknown'||lookup.authoritative!==true)return result('needs-reconciliation',{reason:'native-outcome-unknown',requestId:saved.requestId});
    if(!same(saved.expectedBinding,expectedBinding)){
     if(lookup.targetState==='retired'&&['accepted','refused','absent'].includes(lookup.state)&&lookup.authoritative===true)continue;
     return result('needs-reconciliation',{reason:'previous-native-target-unsettled',requestId:saved.requestId});
    }
    const observed=await read(join(directory,`receipt-${attempt}-started.json`));
    const send=lookup.send;
    if(lookup.state==='accepted'&&(send?.accepted!==true||send.handle!==saved.terminalHandle||send.prompt?.requestId!==saved.requestId||send.prompt.processIncarnation!==saved.expectedBinding.incarnationId||send.prompt.observation!=='supported'||!Array.isArray(send.prompt.stages)))return result('needs-reconciliation',{reason:'native-accepted-receipt-unverified',requestId:saved.requestId});
    if(observed||send?.prompt?.stages?.includes('turn_started')){
     const started=observed??await claim(join(directory,`receipt-${attempt}-started.json`),{requestId:saved.requestId,startedAt:now()});
     const status=now()-started.startedAt>=progressWindowMs?'needs-attention':'awaiting-inbox-progress';
     return result(status,{requestId:saved.requestId,startedAt:started.startedAt,progressDeadline:started.startedAt+progressWindowMs,recoveryAction:'Inspect this member and the exact inbox/assignment receipt. The wake started but inbox progress is unconfirmed; do not reissue the assignment or change permissions to hide it.'});
    }
    if(lookup.state==='refused')return result('needs-attention',{reason:'native-prompt-refused',requestId:saved.requestId,recoveryAction:'Resolve the native refusal or permission/trust prompt yourself, then inspect the saved request; no automatic replacement input.'});
    if(!['absent','accepted'].includes(lookup.state))return result('needs-reconciliation',{reason:'native-state-unrecognized',requestId:saved.requestId});
    await verify();const changed=await eligible();if(changed)return changed;
    const response=await host.submitWake(saved),actual=response?.send,receipt=actual?.prompt;
    if(actual?.handle!==saved.terminalHandle||actual.accepted!==true||receipt?.requestId!==saved.requestId||receipt.processIncarnation!==b.incarnation_id||receipt.observation!=='supported'||!Array.isArray(receipt.stages))return result('needs-reconciliation',{reason:'send-receipt-unverified',requestId:saved.requestId});
    if(receipt.stages?.includes('turn_started'))await claim(join(directory,`receipt-${attempt}-started.json`),{requestId:saved.requestId,startedAt:now()});
    return result(receipt.stages?.includes('turn_started')?'turn-started':'input-accepted',{requestId:saved.requestId});
   }
   return result('needs-attention',{reason:'native-replacement-limit',recoveryAction:'Review the delivery after two retired native targets; no additional wake is created.'});
  }catch{return result('needs-reconciliation',{reason:'wake-outcome-unverified',...(saved?.requestId?{requestId:saved.requestId}:{}),recoveryAction:'Preserve this request. A later pump checks the native durable receipt before considering any submission.'});}
 };
}
