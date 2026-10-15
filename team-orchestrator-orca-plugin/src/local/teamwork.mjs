import {createKeyedSerializer} from './keyed-serializer.mjs';
import {readNativeParentEvidence} from './native-hierarchy.mjs';
import { withNativeRuntime } from './native-runtime.mjs';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {publicWork} from '../work.mjs';
import {readNativeRunEvidence} from './native-run.mjs';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value??null):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
export const sendFingerprint=(sessionId,body,delivery)=>createHash('sha256').update(canonical({method:'agentSession.send',sessionId,fields:{body,...(delivery?{delivery}:{})}})).digest('hex');
export function objectiveInstructions(work,team){
 if(work.parent)return `TEAM_MANAGER_RUN\n${JSON.stringify({teamWorkId:work.teamWorkId,runBindingId:work.id,parent:work.parent,objective:work.nativeObjective,instruction:'You are the actual assigned manager of the original parent Dispatch. Keep that umbrella Dispatch active while delegating and reviewing. Using your own inherited native identity create exactly one Run with this exact objective; do not fabricate --from. Never pass a parent Run Task as native --parent in this Run. Wait for the versioned child admission protocol. Native depth is inherited from your active parent Dispatch across Runs; if nested_worker_depth_exceeded, report that refusal and ask the highest supervisor to request Settings → Orchestration → Nested worker depth at least 2 (or the required deeper level). Never change the setting or launch a standalone replacement to bypass it. Accept only direct reports. When every descendant is accepted and questions resolved, send your own native worker_done for the ORIGINAL parent Dispatch/Task and original parent Run using the installed guide; do not stamp the child Run onto the upward report. Only the highest supervisor asks/delivers to the user. Relay questions through your real parent manager, preserving their original native question IDs. Do not self-create provider-native subagents; only approved roster members via admitted native Orca dispatch. This is a cooperative instruction and admission policy, not global provider tool interception.'})}`;

 const head=team.members.find(row=>row.id===work.supervisorMemberId);
 return `Team Orchestrator work protocol v1. TeamWork ${work.id}; team ${work.teamId}; supervisor member ${work.supervisorMemberId}; configuration ${work.configVersion}; role ${work.roleVersion}.\nYour saved role: ${head.brief}\nWork habits: ${head.habits}\nCollaboration: ${head.collaboration}\nProject: ${work.scope.workspaceId}; execution host: ${work.scope.executionHostId}.\nApproved prior-work handoff: ${work.handoff?JSON.stringify(work.handoff):'None'}.\nTotal objective: ${work.objective}\nUse your own inherited Orca session identity and the matching installed Orca CLI. Read its skills get orchestration --full guide. Create your own native Run exactly once with this exact objective string: ${JSON.stringify(work.nativeObjective)}. If that exact Run already exists for this work, inspect it and continue it; do not create another. Never override --from with another session or fabricate caller/consumer credentials. Return the Run ID as a lookup hint; the plugin verifies native owner evidence. Report exact CLI/runtime/authentication prerequisites when unavailable. Do not dispatch roster workers yet; wait for the plugin's versioned admission protocol. Session creation, input acceptance and delivery of the total result are distinct. The user must accept the completed total objective.`;
}
export function createWorkService({store,rpc,userData,consent}){
 const serialize=createKeyedSerializer();
 const serial=(id,fn)=>serialize(id,()=>withNativeRuntime(rpc,store.readCurrentWork(id)?.binding.runtimeId,fn));
 const save=(work,patch)=>store.updateWork(work.id,work.version,patch);
 async function verifyHost(work,expected=work.binding.hostGeneration){
  if(!work.scope.executionHostId.startsWith('ssh:'))return null;
  const state=(await rpc('ssh.getState',{targetId:decodeURIComponent(work.scope.executionHostId.slice(4))}))?.state;
  if(state?.status!=='connected'||!Number.isSafeInteger(state.connectionGeneration)||(expected!=null&&state.connectionGeneration!==expected))throw Error('Saved SSH host disconnected or changed generation; existing intent remains reserved.');
  return state.connectionGeneration;
 }
 async function verify(work,forSend=false,{allowSettledParent=false,retirementRequestId}={}){
  if(work.status==='completed')throw Error('Completed TeamWork is sealed.');
  await consent();
  const binding=work.parent&&!work.recoveryRequestId?work.binding:store.readOperation(work.binding.requestId);let parentAssignee;
  const pendingIdle=store.listWakes().find(r=>r.mode==='idle-replacement'&&r.memberId===work.supervisorMemberId&&['approved','replacing'].includes(r.state));
  if(pendingIdle&&(forSend||retirementRequestId!==pendingIdle.requestId))throw Error('Saved supervisor binding changed: idle replacement is reserved; normal input and admission are paused.');
  if(work.parent){
   const parentWork=(store.readCurrentWork??store.readWork)(work.parent.workId),attempt=store.listDispatches(work.parent.workId).find(a=>a.id===work.parent.attemptId);
   if(!parentWork||!attempt||attempt.dispatchId!==work.parent.dispatchId||store.listDispatches(parentWork.id).filter(a=>a.taskKey===attempt.taskKey).at(-1)?.id!==attempt.id)throw Error('Parent manager attempt changed.');
   await verify(parentWork,false,{allowSettledParent,retirementRequestId});
   const proof=await readNativeParentEvidence(userData,{parentWork,attempt,active:!allowSettledParent});if(proof.state!=='verified')throw Error(proof.detail);parentAssignee=proof.assignee;
  }
  const retirement=retirementRequestId&&store.readWake(retirementRequestId),reserved=retirement?.mode==='idle-replacement'&&retirement.state==='replacing'&&retirement.oldBinding.requestId===binding?.requestId&&store.readMemberOperation(retirement.memberId)?.requestId===retirement.newInstance?.requestId;
  // Only the private read-only pre-launch check may inspect the retired owner. Normal input
  // and admission still require the current active recipient and cannot use this exception.
  if(reserved){if(forSend)throw Error('Retired supervisor cannot receive input.');store.assertReplacementIdle(retirement.memberId);}
  if(!binding||((!work.parent||work.recoveryRequestId)&&!store.isActiveOperation(binding)&&!reserved)||binding.status!=='created'||['memberId','teamId','kind','handle','sessionId','runtimeId'].some(key=>binding[key]!==work.binding[key])||binding.scope?.workspaceKey!==work.scope.workspaceKey)throw Error('Saved supervisor binding changed; no objective can be redirected.');
  const status=await rpc('status.get');
  if(status?.runtimeId!==binding.runtimeId||!status.capabilities?.includes('orchestration.contract.v1'))throw Error('The bound Orca runtime or orchestration contract is unavailable. Open its Orchestration setup and read the matching installed CLI guide.');
  const selected=(await rpc('worktree.show',{worktree:work.scope.workspaceId.startsWith('folder:')?work.scope.workspaceId:`id:${work.scope.workspaceId}`}))?.worktree;
  if(selected?.id!==work.scope.workspaceId||(selected.hostId??selected.identity?.executionHostId)!==work.scope.executionHostId)throw Error('The saved project or execution host is no longer verified.');
  const hostGeneration=await verifyHost(work);
  if(binding.kind==='structured'){
   if(!status.capabilities.includes('agent-session.structured.v1'))throw Error('This runtime cannot accept structured user messages.');
   const address=(await rpc('orchestration.sessionAddress',{sessionId:binding.sessionId}))?.orcaSessionId;
   const location=address&&(await rpc('orchestration.partyLocation',{address}))?.location;
   if(!address?.startsWith('orca_session_id:')||location?.kind!=='chat'||location.sessionId!==binding.sessionId||location.worktreeId!==work.scope.workspaceId)throw Error('The prepared supervisor session lineage or project changed.');
   const history=await rpc('agentSession.history',{sessionId:binding.sessionId,direction:'tail',limit:40});
   if(history?.ok!==true||history.page?.sessionId!==binding.sessionId||!Number.isSafeInteger(history.page.fence)||history.page.fence<1)throw Error('A verified native session fence is unavailable. Open the supervisor session and resolve its native error.');
   const instance={kind:'structured',sessionId:address.slice('orca_session_id:'.length),liveSessionId:binding.sessionId,fence:history.page.fence};
   if(parentAssignee&&parentAssignee.sessionId!==instance.sessionId)throw Error('Recovered manager is not the actual original parent Dispatch assignee; a genuine parent assignment is required.');
   if(work.instance&&['sessionId','liveSessionId','fence'].some(key=>work.instance[key]!==instance[key]))throw Error('Supervisor execution fence changed; the existing work remains reserved.');
   await verifyHost(work,hostGeneration);
   return {instance,history:history.page,status,hostGeneration};
  }
  const shown=(await rpc('terminal.show',{terminal:binding.handle}))?.terminal;
  if(shown?.handle!==binding.handle||shown.worktreeId!==work.scope.workspaceId||shown.executionHostId!==work.scope.executionHostId||!shown.connected||!shown.writable||!shown.incarnationId||shown.agentIdentity!==binding.nativeRequest.agent||`${shown.tabId}:${shown.leafId}`!==binding.paneKey)throw Error('The prepared terminal agent, host or execution instance is unverified. Open its native session and resolve login or permission issues.');
  if (forSend) {
   const activity=(await rpc('terminal.agentStatus',{terminal:binding.handle}))?.agentStatus;
   if(activity?.handle!==binding.handle||activity.isRunningAgent!==true||activity.status==='permission')throw Error('The supervisor is not ready for user input or is waiting for permission. Resolve its native session first.');
  }
  const instance={kind:'terminal',handle:binding.handle,paneKey:binding.paneKey,incarnationId:shown.incarnationId};
  if(parentAssignee&&(parentAssignee.handle!==instance.handle||parentAssignee.paneKey!==instance.paneKey||parentAssignee.incarnationId!==instance.incarnationId))throw Error('Recovered manager does not match the actual parent Dispatch execution instance.');
  if(work.instance&&work.instance.incarnationId!==instance.incarnationId)throw Error('Supervisor terminal incarnation changed; the existing work remains reserved.');
  if(!status.capabilities.includes('terminal.prompt-delivery.v1'))throw Error('This host does not support durable terminal prompt delivery. Update the owning Orca host before submitting.');
  await verifyHost(work,hostGeneration);
  return {instance,status,hostGeneration};
 }
 async function observe(work,verified){
  if(work.status==='completed'||work.run.state==='fenced')return work;
  verified??=await verify(work);
  let input=work.input.state==='sending'?{...work.input,state:'unknown',detail:'The original submission has no settled receipt. Checking never sends it again.'}:work.input,processing=work.processing;
  if(verified.history&&work.nativeSend){
   const submission=verified.history.submissions?.find(row=>row.clientMessageId===work.nativeSend.params.envelope.clientOperationId);
   if(submission){
    if(submission.dispatchState==='accepted')input={...input,state:'accepted',source:'native-host-journal',dispatchState:'accepted',providerItemId:submission.providerItemId??null,messageId:submission.clientMessageId,detail:'Native provider accepted this exact user message; processing is separate.'};
    if(submission.dispatchState==='rejected')input={...input,state:'rejected',source:'native-host-journal',dispatchState:'rejected',detail:'Native provider rejected the saved objective. Inspect the supervisor session.'};
    // Pinned agentJournalSubmissionKey uses the orca:<encoded clientMessageId> key.
    const userItemId=`orca:${encodeURIComponent(submission.clientMessageId)}`;
    const turn=verified.history.latestTurn?.turn;
    if(submission.dispatchState==='accepted'&&turn?.userItemId===userItemId&&['running','completed','interrupted'].includes(turn.state))processing={state:'observed',detail:'A native turn is linked to this exact objective message; total-work acceptance is separate.',turnId:turn.turnId};
   }
  }
  let run=await readNativeRunEvidence(userData,{objective:work.nativeObjective,owner:verified.instance,runId:work.run.id});
  if(work.run.consumerGeneration&&run.state==='verified'&&run.consumerGeneration!==work.run.consumerGeneration)return save(work,{run:{...work.run,state:'fenced',detail:'Native Run consumer generation changed. Earlier work authority is not reused.'},status:'needs_attention'});
  if (run.state !== 'verified' && work.run.id) run = { ...work.run, state: 'unverified', detail: run.detail };
  let snapshot = work.snapshot ? { ...work.snapshot, stale: true } : undefined;
  if(run.state==='verified'){
   const current=(await rpc('orchestration.runShow',{id:run.id}))?.run;
   if(current?.id!==run.id||current.consumer_generation!==run.consumerGeneration||current.objective!==work.nativeObjective)throw Error('Native Run changed while observing its snapshot.');
   const result=await rpc('orchestration.taskList',{run:run.id,brief:true});
   if(!Array.isArray(result?.tasks)||result.tasks.some(task=>task.run_id!==run.id))throw Error('Native Task snapshot does not match the confirmed Run.');
   const finalOwner = await readNativeRunEvidence(userData,{objective:work.nativeObjective,owner:verified.instance,runId:run.id});
   if(finalOwner.state!=='verified'||finalOwner.consumerGeneration!==run.consumerGeneration)throw Error('Native Run ownership changed during snapshot read; prior generation remains fenced.');
   snapshot={stale:false,observedAt:new Date().toISOString(),tasks:result.tasks.map(task=>({id:task.id,status:task.status,title:task.task_title??task.display_name??'Task',...(task.dispatch_id?{dispatchId:task.dispatch_id}:{})}))};
  }
  await verifyHost(work,verified.hostGeneration);
  return save(work,{input,processing,run,...(snapshot?{snapshot}:{}),instance:verified.instance,status:work.status==='awaiting_acceptance'?'awaiting_acceptance':run.state==='verified'?'active':input.state==='not_sent'||input.state==='rejected'?'needs_attention':'awaiting_run',error:undefined});
 }
 async function deliver(work){
  if(work.input.state!=='not_sent'||work.nativeSend)return work;
  let attempted=false;
  try{
   const verified=await verify(work,true),team=store.readTeamVersion(work.teamId,work.configVersion),body={kind:'message',role:'user',blocks:[{type:'text',text:objectiveInstructions(work,team)}]};
   let nativeSend;
   if(work.binding.kind==='structured'){
    const sessionId=work.binding.sessionId;
    nativeSend={method:'agentSession.send',params:{envelope:{sessionId,clientOperationId:`${Date.now()}-${randomBytes(16).toString('hex')}`,expectedRuntimeFence:verified.instance.fence,payloadFingerprint:sendFingerprint(sessionId,body)},body},envelope:{}};
   }else nativeSend={method:'terminal.send',params:{terminal:work.binding.handle,text:body.blocks[0].text,enter:true,agentPrompt:true,waitSubmitMs:1000,client:{id:'team-orchestrator',type:'desktop'}},envelope:{orchestrationRequestId:randomUUID()}};
   await consent();work=save(work,{nativeSend,instance:verified.instance,input:{state:'sending'},status:'awaiting_input'});attempted=true;
   await verifyHost(work,verified.hostGeneration);
   const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);
   let input,processing={state:'unknown'};
   if(work.binding.kind==='structured'){
    if(receipt?.ok!==true)throw Error(`Native supervisor input refused: ${receipt?.refusal?.message??receipt?.refusal?.code??'unverified result'}`);
    const value=receipt.value;
    if(value?.clientMessageId!==nativeSend.params.envelope.clientOperationId||!Number.isSafeInteger(receipt.fence))throw Error('Native objective message identity is unverified.');
    if (value.queued) {
     if (!['waiting','dispatched','returned','withdrawn'].includes(value.queued.state) || typeof value.queued.messageId !== 'string') throw Error('Native queued objective receipt is unverified.');
     input={state:'queued',source:'native-queue',messageId:value.clientMessageId,queued:{messageId:value.queued.messageId,state:value.queued.state,position:value.queued.position},detail:'Native host queued this user input; queueing is not provider processing.'};
    } else {
     const submission=value.submission;
     if(submission?.clientMessageId!==value.clientMessageId||!['pending','accepted','rejected','unknown'].includes(submission.dispatchState)) throw Error('Native objective dispatch evidence is unverified.');
     input={state:submission.dispatchState==='unknown'?'unknown':submission.dispatchState==='rejected'?'rejected':'accepted',source:'native-host-journal',dispatchState:submission.dispatchState,messageId:value.clientMessageId,providerItemId:submission.providerItemId??null,fence:receipt.fence,...(submission.handedOverAt?{handedOverAt:submission.handedOverAt}:{}),detail:`Native journal dispatch: ${submission.dispatchState}. Host acceptance and provider processing are separate.`};
    }
   }else{
    const send=receipt?.send;
    if(send?.handle!==work.binding.handle||send.accepted!==true||send.prompt?.requestId!==nativeSend.envelope.orchestrationRequestId||send.prompt.processIncarnation!==verified.instance.incarnationId)throw Error('Terminal objective receipt or execution instance is unconfirmed. Do not resend.');
    input={state:'accepted',messageId:send.prompt.requestId,detail:'Native terminal accepted the objective input.'};
    if(send.prompt.stages?.includes('turn_started')&&send.prompt.observation==='supported')processing={state:'observed',detail:'Native host observed the prompt start; total-work completion is separate.'};
   }
   work=save(work,{input,processing,status:'awaiting_run'});
   return await observe(work,verified);
  }catch(error){return save(work,{input:attempted&&work.input.state==='sending'?{...work.input,state:'unknown',detail:'Input may have been delivered. Checking work never resends it.'}:work.input,status:'needs_attention',error:String(error.message).slice(0,1500)});}
 }
 return {
  async startManager(id){return serial(id,async()=>{const work=store.readCurrentWork(id);if(!work?.parent)throw Error('Manager Run binding required.');return publicWork(await deliver(work));});},
  async verifyHost(id,expected){const work=store.readCurrentWork(id);if(!work)throw Error('Saved work not found.');return verifyHost(work,expected);},
  async verifyWork(id,forSend=false,options){const work=store.readCurrentWork(id);if(!work)throw Error('Saved work not found.');return withNativeRuntime(rpc,work.binding.runtimeId,()=>verify(work,forSend,options));},
  async submit(input){const prepared=store.prepareWork(input);return serial(prepared.work.id,async()=>publicWork(prepared.fresh?await deliver(store.readCurrentWork(prepared.work.id)):store.readCurrentWork(prepared.work.id)));},
  async check(id){return serial(id,async()=>{let work=store.readCurrentWork(id);if(!work)throw Error('Saved TeamWork was not found.');try{return publicWork(await observe(work));}catch(error){return publicWork(save(work,{status:'needs_attention',run:{...work.run,state:work.run.state==='fenced'?'fenced':'unverified',detail:'Current native Run authority is unverified; its saved generation is retained.'},...(work.snapshot?{snapshot:{...work.snapshot,stale:true}}:{}),error:String(error.message).slice(0,1500)}));}});},
  async retry(id){return serial(id,async()=>{const work=store.readCurrentWork(id);if(!work||work.recoveryRequestId||work.input.state!=='not_sent'||work.nativeSend)throw Error('This objective may have been submitted. Check its evidence instead of sending again.');return publicWork(await deliver(work));});},
  async reconcile(){for(const work of store.listCurrentWorks())if(work.status!=='completed'&&(work.recoveryRequestId||work.input.state!=='not_sent')&&work.run.state!=='fenced')await this.check(work.id);}
 };
}
