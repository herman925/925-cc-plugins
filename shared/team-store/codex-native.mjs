// Identity component for the local Codex MCP adapter. Scope, executable and
// metadata are supplied by trusted setup/transport code, never tool arguments.
// Identity alone does not establish guard coverage or authorize team membership.
import {realpath,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir,hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createModNative} from './mod-native.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {exact,normalizeActor} from './src/api-domain.mjs';
import {refusal} from './src/errors.mjs';
import {inspectWindowsProcess,windowsFileOwners} from './src/windows-native.mjs';
import {FENCED_WAKE_CAPABILITY} from './src/orca-wake.mjs';
import {createHostAdaptiveWake} from './src/host-adaptive-wake.mjs';
import {currentWakeEligibility} from './src/wake-eligibility.mjs';

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
 const home=await realpath(codexHome||env.CODEX_HOME||join(homedir(),'.codex')),locks=join(home,'thread-writer-locks');
 const ownsThread=async threadId=>{
  let info,path;try{if(await realpath(locks)!==locks)deny('Thread ownership directory is redirected.');path=join(locks,`${threadId}.lock`);info=await lstat(path);}catch{deny('No native thread writer lock exists for this conversation.');}
  if(!info.isFile()||info.isSymbolicLink())deny('The native Codex thread ownership record is not a regular file.');
  const owners=await (dependencies.threadOwners??windowsFileOwners)(path);
  if(!Array.isArray(owners)||owners.length!==1||owners[0].pid!==parentPid||owners[0].createdAt!==birth)deny('The native Codex parent does not uniquely own this thread writer lock.');
 };
 let host;try{host=await createOrcaHost({orcaCommand,env},dependencies);}catch{host=null;}
 // Capture immutable setup facts. Mutating the caller's original object cannot
 // move a running connection to another project or transport.
 const reference=Object.freeze({projectRoot:root,terminalHandle:scope.terminalHandle,contextId:scope.contextId});
 const createdTargets=new WeakSet(),startedTargets=new WeakSet();
 const verifyCreated=async target=>{
  if(!createdTargets.has(target))deny('Only this adapter\'s native terminal creation receipt can start a worker.');
  const terminal=(await host.rpc('terminal.show',{terminal:target.terminalHandle})).terminal;
  if(terminal?.handle!==target.terminalHandle||!terminal.connected||terminal.executionHostId!=='local'||terminal.worktreeId!==target.contextId||terminal.incarnationId!==target.incarnationId||await realpath(terminal.worktreePath)!==target.projectRoot)deny('The created terminal home or incarnation changed before startup.');
  const context=target.contextId.startsWith('folder:')?target.contextId:`id:${target.contextId}`;
  const tabs=await host.rpc('session.tabs.list',{worktree:context});
  if((tabs.tabs??[]).some(tab=>(tab.agentStatus?.terminalHandle===target.terminalHandle||tab.terminalHandle===target.terminalHandle)&&tab.agentStatus?.agentType))deny('The created terminal already contains an agent; no startup input was sent.');
  return target;
 };
 const native={
  inboxWake:Object.freeze({state:!host?'host-unavailable':host.capabilities.includes(FENCED_WAKE_CAPABILITY)&&host.capabilities.includes('terminal.prompt-delivery.v1')&&host.promptJournalId?'available':'host-update-required',primaryRoute:'orca-terminal',managedFallback:{state:dependencies.createManagedWakeBackend?'target-check-required':'not-enrolled',launchesWorkers:false},providers:['claude','codex'],requiredCapability:FENCED_WAKE_CAPABILITY,note:'Startup state describes the primary terminal route. Managed fallback needs current verified enrollment. Route selection, native acceptance, inbox acknowledgement and assignment pickup are separate.'}),
  hostKind:'orca',runtimeId:host?.runtimeId??null,codexExecutable:executable,codexHome:home,launchWorkers:true,launchProfileRoot:join(home,'925-to','launch-profiles'),
  async createLaunchTerminal({title},metadata){
   const actor=await this.verifyCaller(metadata),context=actor.contextId.startsWith('folder:')?actor.contextId:`id:${actor.contextId}`;
   const before=await host.cli(['terminal','list','--worktree',context]);
   if(before.truncated||!Array.isArray(before.terminals)||before.terminals.some(t=>typeof t.handle!=='string'))deny('The complete native terminal inventory is required before creation.');
   const receipt=await host.cli(['terminal','create','--worktree',context,'--title',title,'--shell','powershell.exe']);
   const handle=receipt.terminal?.handle;
   if(!handle||before.terminals.some(t=>t.handle===handle))deny('The host did not return a fresh terminal creation receipt.');
   const terminal=(await host.rpc('terminal.show',{terminal:handle})).terminal;
   if(!terminal?.incarnationId)deny('The created terminal has no native incarnation.');
   const target=Object.freeze({projectRoot:actor.projectRoot,machineId:actor.machineId,executionHostId:'local',contextId:actor.contextId,terminalHandle:handle,incarnationId:terminal.incarnationId});
   createdTargets.add(target);return verifyCreated(target);
  },
  async verifyLaunchTarget(target,metadata){await this.verifyCaller(metadata);return ownedTargets.has(target)?this.managedLaunchNative.verifyLaunchTarget(target,metadata):verifyCreated(target);},
  async startLaunchTerminal(target,command,metadata){
   await this.verifyCaller(metadata);await verifyCreated(target);
   if(startedTargets.has(target))deny('This native launch input was already attempted; an uncertain start must not be resent.');
   startedTargets.add(target);
   return host.cli(['terminal','send','--terminal',target.terminalHandle,'--text',command,'--enter']);
  },
  async verifyCaller(metadata) {
   if(!host)deny('Orca host proof is unavailable. Reconnect after restoring the normal Orca connection. No team operation is authorized.');
   const threadId=metadata?.threadId;
   if(typeof threadId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(threadId)||typeof metadata!=='object'||!Object.hasOwn(metadata,'threadId'))deny('Native Codex transport did not supply a thread identity.');
   if(await identity()!==birth)deny('The native Codex parent incarnation changed.');
   await ownsThread(threadId);
   const current=await host.verifyTerminal({...reference,conversationId:threadId},'codex');
   await ownsThread(threadId);
   if(await identity()!==birth)deny('The native Codex parent changed before verification completed.');
   return current.actor;
  },
  async verifyGuardCaller(metadata){
   try{return await this.verifyCaller(metadata);}catch{
    // This projection is only for the guard's read-only membership lookup.
    // It can establish absence, never a native binding or team API authority.
    const threadId=metadata?.threadId;
    if(!metadata||!Object.hasOwn(metadata,'threadId')||typeof threadId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(threadId))deny('Native thread metadata is required for guard membership discovery.');
    if(await identity()!==birth)deny('The native Codex parent changed.');await ownsThread(threadId);
    if(await identity()!==birth)deny('The native Codex parent changed during guard discovery.');
    return normalizeActor({projectRoot:root,machineId:hostname(),provider:'codex',conversationId:threadId,executionHostId:'local',contextId:reference.contextId,terminalHandle:reference.terminalHandle,incarnationId:`guard-only-codex-process:${parentPid}:${birth}`});
   }
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
  async wake(deliveries,metadata,{api,teamId}={}) {
   // These are committed API reservations supplied by the private adapter, never
   // destinations accepted from a model-facing tool argument.
   const sender=await this.verifyCaller(metadata),results=[];
   if(!api||!teamId)return deliveries.map(()=>({state:'needs-reconciliation',reason:'eligibility-context-unavailable',observedAt:Date.now()}));
   const managedBackend=await dependencies.createManagedWakeBackend?.({host,actor:sender,api,teamId,metadata});
   const wake=createHostAdaptiveWake({host,managedBackend,checkEligible:delivery=>currentWakeEligibility(api,teamId,delivery),...(dependencies.wakeJournalRoot?{journalRoot:dependencies.wakeJournalRoot}:{})});
   for(const delivery of deliveries){
    const b=delivery.recipient;
    if(b.machine_id!==sender.machineId||b.execution_host_id!=='local'||!['claude','codex'].includes(b.provider))continue;
    try{
     results.push(await wake(delivery,{projectRoot:root,machineId:sender.machineId}));
    }catch{results.push({state:'needs-reconciliation',reason:'native-wake-unverified',observedAt:Date.now()});}
   }
   return results;
  },
 };
 const ownedTargets=new WeakSet(),request=async(type,input={},launch=false)=>{const send=dependencies.requestOwned??(await import('./src/dispatcher-service.mjs')).projectOwnedRequest;return send({projectRoot:root,machineId:hostname(),operation:{type,input},launch});};
 const {createOwnedHeadNative}=await import('./src/owned-head-native.mjs'),{inspectClaudeProvider}=await import('./src/claude-provider.mjs');let claudeProvider;
 try{claudeProvider=await (dependencies.inspectClaudeProvider??inspectClaudeProvider)();}catch{claudeProvider={state:'blocked'};}
 const managed=createOwnedHeadNative({verifyCaller:metadata=>native.verifyCaller(metadata),request,codexRuntime:{codexExecutable:executable,codexHome:home,node:process.execPath,adapter:fileURLToPath(new URL('./codex-mcp.mjs',import.meta.url))},claudeProvider,wake:async()=>[]});
 native.managedLaunchNative=Object.freeze({...managed,createLaunchTarget:async(input,metadata)=>{const target=await managed.createLaunchTarget(input,metadata);ownedTargets.add(target);return target;}});
 native.ownedWorkerRequest=async(type,input,metadata)=>{await native.verifyCaller(metadata);return request(type,input,false);};
 return Object.freeze(native);
}
