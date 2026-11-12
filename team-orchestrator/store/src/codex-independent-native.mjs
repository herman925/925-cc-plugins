import {realpath,lstat} from 'node:fs/promises';
import {basename,join,isAbsolute} from 'node:path';
import {homedir,hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {inspectWindowsProcess,windowsFileOwners} from './windows-native.mjs';
import {createCodexThreadInspector} from './codex-inspector.mjs';
import {normalizeActor,exact} from './api-domain.mjs';
import {refusal} from './errors.mjs';
import {createOwnedProviderWake} from './owned-provider-wake.mjs';
import {createWakeRouter} from './wake-routing.mjs';
import {currentWakeEligibility} from './wake-eligibility.mjs';
import {wakePointer,wakePrompt} from './orca-wake.mjs';
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const deny=message=>{throw refusal('API_NATIVE_UNVERIFIED',message);};
export const independentContext=root=>'project:'+createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex');
export async function verifyCodexThreadOwner({threadId,codexExecutable,codexHome,expectedPid,expectedBirth},dependencies={}){
 if(typeof threadId!=='string'||!uuid.test(threadId))deny('Native Codex supplied no valid thread identity.');
 const home=await realpath(codexHome),locks=join(home,'thread-writer-locks'),path=join(locks,`${threadId}.lock`);
 let info;try{if(await realpath(locks)!==locks)deny('The native ownership directory is redirected.');info=await lstat(path);}catch{deny('No verified native thread ownership record is available.');}
 if(!info.isFile()||info.isSymbolicLink())deny('Native thread ownership must be a regular file.');
 const owners=await (dependencies.threadOwners??windowsFileOwners)(path);
 if(!Array.isArray(owners)||owners.length!==1||!Number.isSafeInteger(owners[0].pid)||typeof owners[0].createdAt!=='string')deny('The native thread does not have exactly one verified writer.');
 const owner=owners[0],processInfo=await (dependencies.inspectProcess??inspectWindowsProcess)(owner.pid);
 if(processInfo?.pid!==owner.pid||processInfo.createdAt!==owner.createdAt||await realpath(processInfo.executable)!==await realpath(codexExecutable)||expectedPid!==undefined&&owner.pid!==expectedPid||expectedBirth!==undefined&&owner.createdAt!==expectedBirth)deny('The native Codex process or thread owner changed.');
 return owner;
}
export async function createIndependentCodexIdentity({scope,codexExecutable,codexHome,env=process.env},dependencies={}){
 exact(scope,['projectRoot','contextId','terminalHandle']);
 if(!isAbsolute(scope?.projectRoot??'')||!/^codex(?:\.exe)?$/i.test(basename(codexExecutable??'')))deny('Standalone setup requires the native Codex executable and fixed project.');
 if(scope.terminalHandle)deny('An independent conversation cannot claim an Orca terminal or another execution.');
 const root=await realpath(scope.projectRoot),home=await realpath(codexHome||env.CODEX_HOME||join(homedir(),'.codex')),executable=await realpath(codexExecutable),parentPid=process.ppid;
 const processInfo=await (dependencies.inspectProcess??inspectWindowsProcess)(parentPid);
 if(processInfo?.pid!==parentPid||typeof processInfo.createdAt!=='string'||!/^\d+$/.test(processInfo.createdAt)||await realpath(processInfo.executable)!==executable)deny('The team adapter is not a direct child of native Codex.');
 const birth=processInfo.createdAt,contextId=scope.contextId||independentContext(root);
 const inspector=(dependencies.createInspector??createCodexThreadInspector)({codexExecutable:executable,codexHome:home,projectRoot:root,env});
 let closed=false;
 const own=async metadata=>{
  if(closed||!metadata||!Object.hasOwn(metadata,'threadId')||typeof metadata.threadId!=='string'||!uuid.test(metadata.threadId))deny('Native Codex transport must supply its own thread identity.');
  const owner=await verifyCodexThreadOwner({threadId:metadata.threadId,codexExecutable:executable,codexHome:home,expectedPid:parentPid,expectedBirth:birth},dependencies);
  return normalizeActor({projectRoot:root,machineId:hostname(),provider:'codex',conversationId:metadata.threadId,executionHostId:'local',contextId,terminalHandle:`codex-thread:${metadata.threadId}`,incarnationId:`codex-process:${owner.pid}:${owner.createdAt}`});
 };
 const verify=async metadata=>{
  const actor=await own(metadata),native=await inspector.inspect(actor.conversationId);
  if(native.threadId!==actor.conversationId||await realpath(native.projectRoot)!==root)deny('The native Codex conversation belongs to another project.');
  await own(metadata);return actor;
 };
 const request=async(type,input={},launch=true)=>{const send=dependencies.requestOwned??(await import('./dispatcher-service.mjs')).projectOwnedRequest;return send({projectRoot:root,machineId:hostname(),operation:{type,input},launch,...(dependencies.dispatcherRoot?{root:dependencies.dispatcherRoot}:{})});};
 const inventory=()=>request('list',{},false);
 const targets=new WeakMap();
 const ownedTarget=async target=>{const launchId=targets.get(target);if(!launchId)deny('Only this adapter’s exact owned-worker preparation receipt can be used.');const current=await request('inspect',{launchId},false);if(JSON.stringify(current.target)!==JSON.stringify(target))deny('The managed native target changed.');return current;};
 return Object.freeze({hostKind:'independent',codexExecutable:executable,codexHome:home,launchWorkers:true,launchProfileRoot:join(home,'925-to','launch-profiles'),
  inboxWake:{state:'target-check-required',primaryRoute:'provider-direct',managedFallback:{state:'not-enrolled',launchesWorkers:false},providers:['codex'],note:'Automatic input is available only for exact workers owned by the project dispatcher. Existing external conversations require a supported host transport or manual inbox checks.'},
  verifyCaller:verify,
  // Only guard membership discovery can use this weaker, still OS-attested
  // identity. An ordinary nonmember must not lose shell access when an optional
  // read-only scope inspector is unavailable. API effects always use verify.
  verifyGuardCaller:own,
  async createLaunchTarget({member,launchId,launchProfile,workerToolPolicy},metadata){
   const actor=await verify(metadata),prepared=await request('prepare',{actor,launchId,launchProfile,workerToolPolicy,codexExecutable:executable,codexHome:home,model:member.model,effort:member.effort,node:process.execPath,adapter:fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url))});
   if(prepared.state!=='prepared'||!prepared.target)deny('Managed worker preparation is uncertain. Inspect the original launch; no replacement was created.');
   const target=Object.freeze(prepared.target);targets.set(target,launchId);return target;
  },
  async verifyLaunchTarget(target,metadata){await verify(metadata);await ownedTarget(target);return target;},
  async startLaunchTarget(target,metadata){await verify(metadata);await ownedTarget(target);const result=await request('start',{launchId:targets.get(target),target},false);if(!result.bootstrap?.turnId)deny('Worker bootstrap is pending or uncertain. Do not retry with another target.');return result;},
  async ownedWorkerRequest(type,input,metadata){await verify(metadata);return request(type,input,false);},
  async verifyTarget(input,metadata){
   const actor=await verify(metadata);exact(input,['projectRoot','conversationId','terminalHandle','contextId']);
   if(await realpath(input.projectRoot)!==root||input.contextId!==contextId||input.terminalHandle!==`codex-thread:${input.conversationId}`)deny('Only this project’s verified native Codex conversations can be connected.');
   if(input.conversationId===actor.conversationId)return actor;
   const target=(await inventory()).find(row=>row.identity?.conversationId===input.conversationId&&row.identity?.contextId===contextId&&row.identity?.terminalHandle===input.terminalHandle);
   if(!target)deny('This peer is not a current project-dispatcher-owned native conversation.');return normalizeActor(target.identity);
  },
  async listTargets(metadata){const actor=await verify(metadata);let owned=[],ownedDiscovery='verified';try{owned=(await inventory()).filter(row=>row.identity?.projectRoot===root&&row.identity?.contextId===contextId&&row.identity?.conversationId!==actor.conversationId);}catch{ownedDiscovery='unavailable';}return {ownedDiscovery,sessions:[{provider:'codex',label:'This verified native Codex conversation',reference:{projectRoot:root,conversationId:actor.conversationId,terminalHandle:actor.terminalHandle,contextId:actor.contextId}},...owned.map(row=>({provider:'codex',label:'Owned Codex worker '+row.launchId,reference:{projectRoot:root,conversationId:row.identity.conversationId,terminalHandle:row.identity.terminalHandle,contextId}}))]};},
  async wake(deliveries,metadata,{api,teamId}={}){
   const actor=await verify(metadata);if(!api||!teamId)return deliveries.map(()=>({state:'needs-reconciliation',reason:'eligibility-context-unavailable',observedAt:Date.now()}));
   const journalRoot=dependencies.wakeJournalRoot??join(homedir(),'.team-orchestrator','wake-receipts'),receipts=[];
   for(const delivery of deliveries){
    let sessions;try{sessions=await inventory();}catch{receipts.push({state:'needs-reconciliation',reason:'owned-inventory-unverified',observedAt:Date.now()});continue;}
    const pointer=wakePointer(delivery),binding=delivery.recipient,session=sessions.find(row=>row.identity?.conversationId===binding.conversation_id),checkEligible=()=>currentWakeEligibility(api,teamId,delivery);
    const transport={inspect:async()=>{if(!session)throw Error('Owned target unavailable.');const row=await request('inspect',{launchId:session.launchId},false);return {identity:Object.fromEntries(['projectRoot','machineId','provider','conversationId','incarnationId','terminalHandle','contextId'].map(key=>[key,row.identity[key]])),state:row.nativeState,pendingReview:row.pendingReview};},submit:async({identity,requestId,text})=>{if(text!==wakePrompt(pointer))deny('Only the canonical inbox-check pointer can be submitted.');return request('sendWake',{launchId:session.launchId,identity,requestId,pointer},false);}};
    const primary={id:'provider-direct',availability:async()=>session?{state:'available'}:{state:'unavailable',reason:'owned-input-unavailable'},wake:createOwnedProviderWake({transport,journalRoot,checkEligible})};
    receipts.push(await createWakeRouter({primary,journalRoot,checkEligible})(delivery,{projectRoot:root,machineId:actor.machineId}));
   }
   return receipts;
  },
  async close(){if(closed)return;closed=true;await inspector.close();},
 });
}
