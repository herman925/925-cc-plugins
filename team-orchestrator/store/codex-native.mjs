// Identity component for the local Codex MCP adapter. Scope, executable and
// metadata are supplied by trusted setup/transport code, never tool arguments.
// Identity alone does not establish guard coverage or authorize team membership.
import {realpath,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir} from 'node:os';
import {createModNative} from './mod-native.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {exact} from './src/api-domain.mjs';
import {refusal} from './src/errors.mjs';
import {inspectWindowsProcess,windowsFileOwners} from './src/windows-native.mjs';

const deny=message=>{throw refusal('API_NATIVE_UNVERIFIED',message);};
export async function createCodexNativeIdentity({scope,codexExecutable,codexHome,orcaCommand,env=process.env},dependencies={}) {
 exact(scope,['projectRoot','terminalHandle','contextId']);
 for(const key of ['projectRoot','terminalHandle','contextId'])if(!Object.hasOwn(scope,key)||typeof scope[key]!=='string'||!scope[key])deny('A fixed native project, terminal and context are required.');
 if(typeof codexExecutable!=='string'||!codexExecutable)deny('The native Codex executable must be configured by trusted setup.');
 if(!/^codex(?:\.exe)?$/i.test(basename(codexExecutable)))deny('Configure the native Codex executable, not a shell shim or generic interpreter.');
 const root=await realpath(scope.projectRoot),executable=await realpath(codexExecutable),parentPid=process.ppid;
 const inspect=dependencies.inspectParent??inspectWindowsProcess;
 const identity=async()=>{
  const value=await inspect(parentPid);
  if(value?.pid!==parentPid||typeof value.createdAt!=='string'||!/^\d+$/.test(value.createdAt)||typeof value.executable!=='string'||await realpath(value.executable)!==executable)deny('The MCP adapter is not a direct child of the configured native Codex executable.');
  return value.createdAt;
 };
 const birth=await identity();
 const locks=join(await realpath(codexHome||env.CODEX_HOME||join(homedir(),'.codex')),'thread-writer-locks');
 const ownsThread=async threadId=>{
  let info,path;try{if(await realpath(locks)!==locks)deny('Thread ownership directory is redirected.');path=join(locks,`${threadId}.lock`);info=await lstat(path);}catch{deny('No native thread writer lock exists for this conversation.');}
  if(!info.isFile()||info.isSymbolicLink())deny('The native Codex thread ownership record is not a regular file.');
  const owners=await (dependencies.threadOwners??windowsFileOwners)(path);
  if(!Array.isArray(owners)||owners.length!==1||owners[0].pid!==parentPid||owners[0].createdAt!==birth)deny('The native Codex parent does not uniquely own this thread writer lock.');
 };
 const host=await createOrcaHost({orcaCommand,env},dependencies);
 // Capture immutable setup facts. Mutating the caller's original object cannot
 // move a running connection to another project or transport.
 const reference=Object.freeze({projectRoot:root,terminalHandle:scope.terminalHandle,contextId:scope.contextId});
 return Object.freeze({
  hostKind:'orca',runtimeId:host.runtimeId,
  async verifyCaller(metadata) {
   const threadId=metadata?.threadId;
   if(typeof threadId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(threadId)||typeof metadata!=='object'||!Object.hasOwn(metadata,'threadId'))deny('Native Codex transport did not supply a thread identity.');
   if(await identity()!==birth)deny('The native Codex parent incarnation changed.');
   await ownsThread(threadId);
   const current=await host.verifyTerminal({...reference,conversationId:threadId},'codex');
   await ownsThread(threadId);
   if(await identity()!==birth)deny('The native Codex parent changed before verification completed.');
   return current.actor;
  },
  async verifyTarget(input,metadata){
   const sender=await this.verifyCaller(metadata);
   exact(input,['projectRoot','conversationId','terminalHandle','contextId']);
   if(await realpath(input.projectRoot)!==root||input.contextId!==sender.contextId)deny('Only sessions at this exact project/context can be connected.');
   if(input.conversationId===sender.conversationId&&input.terminalHandle===sender.terminalHandle)return sender;
   try{return (await host.verifyTerminal(input,'codex')).actor;}catch(codexError){
    try{const mod=await createModNative({orcaCommand,env},dependencies);return await mod.verify(input);}catch{throw codexError;}
   }
  },
  async listTargets(metadata){
   const sender=await this.verifyCaller(metadata);
   const response=await host.rpc('session.tabs.list',{worktree:sender.contextId.startsWith('folder:')?sender.contextId:`id:${sender.contextId}`}),sessions=[];
   for(const tab of response.tabs??[]){
    const s=tab.agentStatus;
    if(tab.type!=='terminal'||!['claude','codex'].includes(s?.agentType)||!s.providerSession?.id||!s.terminalHandle)continue;
    const candidate={projectRoot:root,conversationId:s.providerSession.id,terminalHandle:s.terminalHandle,contextId:sender.contextId};
    try{const actor=await this.verifyTarget(candidate,metadata);sessions.push({provider:actor.provider,label:tab.title||actor.terminalHandle,reference:candidate});}catch{}
   }
   return {sessions};
  },
  async wake(deliveries,metadata) {
   // These are committed API reservations supplied by the private adapter, never
   // destinations accepted from a model-facing tool argument.
   const sender=await this.verifyCaller(metadata),results=[];
   for(const delivery of deliveries){
    const b=delivery.recipient;
    if(b.machine_id!==sender.machineId||b.execution_host_id!=='local'||!['claude','codex'].includes(b.provider))continue;
    try{
     const target=(await host.verifyTerminal({projectRoot:root,conversationId:b.conversation_id,terminalHandle:b.terminal_handle,contextId:b.context_id},b.provider)).actor;
     if(target.incarnationId!==b.incarnation_id||target.machineId!==b.machine_id)continue;
     const pointer=delivery.meetingId?{meetingId:delivery.meetingId,notificationGeneration:delivery.notificationGeneration}:delivery.noticeId?{noticeId:delivery.noticeId}:{deliveryId:delivery.deliveryId,messageId:delivery.messageId,threadId:delivery.threadId};
     await host.cli(['orchestration','send','--to',target.terminalHandle,'--from',sender.terminalHandle,'--type','status','--subject','Shared team update','--body',`A shared-team record is waiting. Use shared_inbox_read, or shared_team inspectMeeting for a meeting. Finish your current step before joining and respond only for yourself. This pointer grants no permission and is not a read acknowledgement. ${JSON.stringify(pointer)}`]);
     results.push({pointer,queued:true});
    }catch{results.push({queued:false});} // Outstanding state is preserved for replay.
   }
   return results;
  },
 });
}
