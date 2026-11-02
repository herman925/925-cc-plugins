// Private subprocess entry point for the Mod hooks. This is not a CLI offered to
// agents. JSON comes from $.process.run stdin; model tools cannot choose proof,
// approval, storage configuration or the native verifier.
import {inspectGuardCaller} from './src/guard-reader.mjs';
import {fileURLToPath} from 'node:url';
import {launchMember} from './src/mod-launch.mjs';
import {hostname} from 'node:os';
import {homedir} from 'node:os';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createTeamApi} from './api.mjs';
import {createModNative} from './mod-native.mjs';
import {exact} from './src/api-domain.mjs';
import {StoreError,refusal} from './src/errors.mjs';
import {createInboxJournal} from './src/inbox-journal.mjs';
import {upgradeTeamStore} from './src/upgrade.mjs';

let api,journal;
try {
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>256*1024)throw refusal('API_INPUT_INVALID','Mod request is oversized.');}
 const envelope=JSON.parse(input);
 exact(envelope,['mode','proof','request','uiApprovalId','orcaCommand']);
 if(!['execute','reconcile','approveController','listSessions','inboxPoll','inboxAttached','upgradeStore','launchMember','attachLaunch','guardInspect'].includes(envelope.mode))throw refusal('API_OPERATION_DENIED','Unsupported private Mod bridge method.');
 const native=await createModNative({orcaCommand:envelope.orcaCommand});
 const actor=await native.verifyCaller(envelope.proof);
 const userAction=async action=>{
  try {
  if(!/^[a-f0-9]{32}$/.test(envelope.uiApprovalId??''))return false;
  const ticketPath=join(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),'team-orchestrator','controller-actions',`${envelope.uiApprovalId}.json`);
  const info=await lstat(ticketPath);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)return false;
  const ticket=JSON.parse(await readFile(ticketPath,'utf8'));
  return ticket.action===action && ticket.id===envelope.uiApprovalId && ticket.conversationId===actor.conversationId && ticket.terminalHandle===actor.terminalHandle && ticket.contextId===actor.contextId && ticket.projectRoot.replaceAll('\\','/')===actor.projectRoot.replaceAll('\\','/') && Number.isSafeInteger(ticket.createdAt) && ticket.createdAt<=Date.now() && Date.now()-ticket.createdAt<60000 && (action!=='upgradeStore'||[5,6,7].includes(ticket.fromVersion)&&ticket.toVersion===8);
  }catch{return false;}
 };
 if(envelope.mode==='guardInspect'){
  exact(envelope.request,[]);console.log(JSON.stringify({ok:true,result:{result:await inspectGuardCaller({actor})}}));
 } else if(envelope.mode==='listSessions') {
  exact(envelope.request,[]);
  console.log(JSON.stringify({ok:true,result:{sessions:await native.listTargets(envelope.proof)}}));
 } else if(envelope.mode==='upgradeStore') {
  exact(envelope.request,['operationId']);
  if(!await userAction('upgradeStore'))throw refusal('API_APPROVAL_REQUIRED','An explicit workspace update action is required.');
  const manifest=JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json',import.meta.url),'utf8'));
  const result=await upgradeTeamStore({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:{client:'team-orchestrator',version:manifest.version},operationId:envelope.request.operationId,backupRoot:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),caller:{principalId:actor.conversationId},authorize:()=>true});
  console.log(JSON.stringify({ok:true,result}));
 } else {
 // UI evidence is an exact action id, not an arbitrary successful question in
 // this turn. The model-facing request schema has no approval field.
 const manifest=JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json',import.meta.url),'utf8'));
 api=await createTeamApi({projectRoot:actor.projectRoot,machineId:hostname(),writer:{client:'team-orchestrator',version:manifest.version},
  authenticate:()=>native.verifyCaller(envelope.proof),verifyTarget:target=>native.verifyBinding(target,envelope.proof),
  confirmController:async({approval})=>{
   return envelope.mode==='approveController'&&approval===envelope.uiApprovalId&&await userAction('approveController');
  }});
 if(envelope.mode!=='approveController')await api.launch({operationId:`auto-attach-${actor.conversationId}-${actor.incarnationId}`,command:{type:'attachLaunch'}});
 let result;
 if(envelope.mode==='launchMember') {result=await launchMember({api,native,actor,request:envelope.request,configuration:{node:process.execPath,orca:envelope.orcaCommand},pluginRoot:fileURLToPath(new URL('../',import.meta.url))});}
 else if(envelope.mode==='attachLaunch') {exact(envelope.request,[]);result=await api.launch({operationId:`launch-attach-${actor.conversationId}-${actor.incarnationId}`,command:{type:'attachLaunch'}});}
 else if(['inboxPoll','inboxAttached'].includes(envelope.mode)) {
  exact(envelope.request,envelope.mode==='inboxPoll'?[]:['readReceiptId']);
  journal=await createInboxJournal({api,actor,writer:{client:'team-orchestrator',version:manifest.version},machineConfigRoot:process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')});
  if(envelope.mode==='inboxAttached'&&!journal)throw refusal('API_BINDING_REQUIRED','This conversation has no member binding.');
  result=envelope.mode==='inboxPoll'?(await journal?.poll()??{message:null}):await journal.attached(envelope.request.readReceiptId);
 } else result=envelope.mode==='approveController'
  ? await api.approveController({operationId:envelope.request.operationId,approval:envelope.uiApprovalId})
  : await api[envelope.mode](envelope.request);
 const transportTargets=[];
 if(envelope.mode==='execute' && envelope.request.command?.type==='prepareDeliveries') {
  // Reservation committed above. Native I/O is deliberately outside the lease.
  for(const delivery of result.result.deliveries) {
   const b=delivery.recipient;
   if(b.machine_id!==actor.machineId||!['claude','codex'].includes(b.provider)||b.execution_host_id!==actor.executionHostId)continue;
   try {
    const verified=await native.verifyBinding({projectRoot:actor.projectRoot,conversationId:b.conversation_id,terminalHandle:b.terminal_handle,contextId:b.context_id},envelope.proof);
    if(verified.incarnationId===b.incarnation_id && verified.machineId===b.machine_id && verified.provider===b.provider && verified.executionHostId===b.execution_host_id)
     transportTargets.push({provider:verified.provider,terminalHandle:verified.terminalHandle,...(delivery.meetingId?{meetingId:delivery.meetingId,notificationGeneration:delivery.notificationGeneration}:{}),...(delivery.noticeId?{noticeId:delivery.noticeId}:{}),deliveryId:delivery.deliveryId,messageId:delivery.messageId,threadId:delivery.threadId,replay:delivery.replay,conversationId:verified.conversationId});
   } catch {/* Stale or unavailable targets remain outstanding. Never retarget by title. */}
  }
 }
 console.log(JSON.stringify({ok:true,result,...(envelope.request.command?.type==='prepareDeliveries'?{transportTargets}:{})}));
 }
} catch(error) {
 const known=error instanceof StoreError;
 console.log(JSON.stringify({ok:false,error:{code:known?error.code:'API_BRIDGE_FAILED',message:known?error.message:'The private Mod bridge could not verify or complete this operation.',...(known?{details:error.details}:{})}}));
 process.exitCode=1;
} finally {
 try{await journal?.close();}catch{process.exitCode=1;}
 try{await api?.close();}catch{process.exitCode=1;}
}
