// Direct receiver for a provider process already owned by a reviewed runner.
// No discovery, launch, attach, resume, permission changes or Orca dependency.
// Provider message IDs are correlation, NOT assumed idempotency keys.
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,open,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {wakePointer,wakePrompt} from './orca-wake.mjs';

const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])])):value;
const same=(a,b)=>JSON.stringify(stable(a))===JSON.stringify(stable(b));
const hash=value=>createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
async function read(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function writeOnce(path,value){let file;try{file=await open(path,'wx',0o600);}catch(e){if(e.code==='EEXIST')return false;throw e;}try{await file.writeFile(JSON.stringify(value));await file.sync();return true;}finally{await file.close();}}
export function createOwnedProviderWake({transport,journalRoot,checkEligible,now=Date.now,progressWindowMs=30000}){
 if(!transport||typeof checkEligible!=='function'||typeof journalRoot!=='string')throw Error('An owned receiver, local journal and current eligibility check are required.');
 return async(delivery,scope)=>{
  const pointer=wakePointer(delivery),b=delivery.recipient;
  const result=(state,fields={})=>({state,pointer,recipientMemberId:b?.member_id,observedAt:now(),...fields});
  if(!b||b.machine_id!==scope.machineId||b.execution_host_id!=='local'||!['claude','codex'].includes(b.provider))return result('unsupported');
  const identity={projectRoot:scope.projectRoot,machineId:scope.machineId,provider:b.provider,conversationId:b.conversation_id,incarnationId:b.incarnation_id,terminalHandle:b.terminal_handle,contextId:b.context_id};
  const intent={projectRoot:scope.projectRoot,machineId:scope.machineId,memberId:b.member_id,pointer};
  const directory=join(journalRoot,'owned-v1',hash(intent));let saved;
  try{
   const eligible=await checkEligible(delivery);if(eligible?.eligible!==true)return result('settled-or-ineligible',{reason:eligible?.reason??'eligibility-unverified'});
   const snapshot=await transport.inspect();if(!same(snapshot.identity,identity))return result('needs-reconciliation',{reason:'owned-process-identity-changed'});
   await mkdir(directory,{recursive:true,mode:0o700});const path=join(directory,'intent.json'),receiptPath=join(directory,'receipt.json');
   saved=await read(path);
   if(saved){
    if(!same(saved.intent,intent)||!same(saved.identity,identity)||saved.text!==wakePrompt(pointer))return result('needs-reconciliation',{reason:'owned-intent-conflict',requestId:saved.requestId});
    const receipt=await read(receiptPath);
    if(!receipt||receipt.requestId!==saved.requestId)return result('needs-reconciliation',{reason:'owned-send-outcome-unknown',requestId:saved.requestId});
    return result(now()-receipt.acceptedAt>=progressWindowMs?'needs-attention':'awaiting-inbox-progress',{requestId:saved.requestId,nativeId:receipt.nativeId});
   }
   if(snapshot.state!=='idle'||snapshot.pendingReview)return result('waiting-for-idle');
   saved={intent,identity,requestId:randomUUID(),text:wakePrompt(pointer),createdAt:now()};
   if(!await writeOnce(path,saved))return result('needs-reconciliation',{reason:'owned-send-already-claimed'});
   // An exclusive durable claim precedes even a possible native write. A crash,
   // timeout or lost reply never makes this intent eligible for another send.
   const current=await checkEligible(delivery);if(current?.eligible!==true)return result('settled-or-ineligible',{reason:current?.reason??'eligibility-unverified'});
   const receipt=await transport.submit({identity,requestId:saved.requestId,text:saved.text});
   if(receipt?.requestId!==saved.requestId||typeof receipt.nativeId!=='string'||!receipt.nativeId||receipt.accepted!==true)return result('needs-reconciliation',{reason:'owned-send-receipt-unverified',requestId:saved.requestId});
   await writeOnce(receiptPath,{requestId:saved.requestId,nativeId:receipt.nativeId,acceptedAt:now()});
   return result('input-accepted',{requestId:saved.requestId,nativeId:receipt.nativeId});
  }catch{return result('needs-reconciliation',{reason:'owned-send-outcome-unverified',...(saved?{requestId:saved.requestId}:{})});}
 };
}

// rpc and alive belong to the exact runner-owned app-server connection. The
// adapter never uses a global daemon or a thread-name lookup to obtain them.
export function createOwnedCodexTransport({identity,rpc,alive,hasPendingReview=()=>false}){
 if(identity?.provider!=='codex'||typeof rpc!=='function'||typeof alive!=='function')throw Error('An owned Codex connection is required.');
 const fixed=structuredClone(identity);
 const inspect=async()=>{
  if(!alive())throw Error('Owned Codex process exited.');
  const result=await rpc('thread/read',{threadId:fixed.conversationId,includeTurns:false});
  if(!alive()||result.thread?.id!==fixed.conversationId||result.thread?.cwd!==fixed.projectRoot)throw Error('Owned Codex conversation changed.');
  return {identity:structuredClone(fixed),state:result.thread.status?.type==='idle'?'idle':'busy',pendingReview:hasPendingReview()};
 };
 return Object.freeze({inspect,async submit({identity:expected,requestId,text}){
  const current=await inspect();if(!same(expected,fixed)||current.state!=='idle'||current.pendingReview)throw Error('Owned Codex receiver is not idle and current.');
  // No await between the final process fence and the owned connection write.
  if(!alive())throw Error('Owned Codex process exited before submission.');
  const result=await rpc('turn/start',{threadId:fixed.conversationId,clientUserMessageId:requestId,input:[{type:'text',text}]});
  if(!alive()||typeof result.turn?.id!=='string')throw Error('Owned Codex receipt is unverified.');
  return {accepted:true,requestId,nativeId:result.turn.id};
 }});
}

// Streaming SDK integration: state comes from this query's native events;
// enqueue yields into its existing input iterable and resolves only on the
// matching SDKUserMessageReplay. No made-up Claude RPC or terminal keystrokes.
export function createOwnedClaudeTransport({identity,readState,enqueue,alive}){
 if(identity?.provider!=='claude'||typeof readState!=='function'||typeof enqueue!=='function'||typeof alive!=='function')throw Error('An owned Claude streaming query is required.');
 const fixed=structuredClone(identity);
 const inspect=async()=>{
  if(!alive())throw Error('Owned Claude process exited.');
  const state=await readState();
  if(!alive()||state?.sessionId!==fixed.conversationId||state?.projectRoot!==fixed.projectRoot)throw Error('Owned Claude conversation changed.');
  return {identity:structuredClone(fixed),state:state.idle===true?'idle':'busy',pendingReview:state.pendingReview===true};
 };
 return Object.freeze({inspect,async submit({identity:expected,requestId,text}){
  const state=await inspect();if(!same(expected,fixed)||state.state!=='idle'||state.pendingReview||!alive())throw Error('Owned Claude receiver is not idle and current.');
  const replay=await enqueue({type:'user',uuid:requestId,session_id:fixed.conversationId,message:{role:'user',content:text},parent_tool_use_id:null});
  if(!alive()||replay?.type!=='user'||replay.uuid!==requestId||replay.session_id!==fixed.conversationId||replay.isReplay!==true)throw Error('Owned Claude input receipt is unverified.');
  return {accepted:true,requestId,nativeId:replay.uuid};
 }});
}
