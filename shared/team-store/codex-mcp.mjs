import {interviewForm} from './src/codex-interview.mjs';
import {serveMcp} from './src/mcp-stdio.mjs';
import {codexManagement,managementTypes} from './src/codex-management.mjs';
import {refusal} from './src/errors.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {inspectWindowsProcess} from './src/windows-native.mjs';
// Local stdio MCP adapter. No HTTP listener, API key, SQL, caller proof or
// controller approval is exposed as a tool. Native metadata is checked per call.
import {createCodexNativeIdentity} from './codex-native.mjs';
import {createIndependentCodexIdentity} from './src/codex-independent-native.mjs';
import {createTeamApi} from './api.mjs';
import {createInboxJournal} from './src/inbox-journal.mjs';
import {inspectGuardCaller} from './src/guard-reader.mjs';
import {codexGuard} from './src/codex-guard.mjs';
import {commandSchema,commandRequirements} from './src/api-schema.mjs';
import {exact} from './src/api-domain.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {SHARED_WRITER} from './src/runtime-release.mjs';
import {createCodexObserver} from './src/codex-observer.mjs';
import {codexLaunchPlan} from './src/codex-launch.mjs';
import {codexWorkerReview} from './src/codex-worker-review.mjs';
import {codexUpgrade} from './src/codex-upgrade.mjs';
import {readReservedLaunchProfile} from './src/codex-launch-profile.mjs';
import {createCodexWorkerRuntime} from './src/codex-worker-runtime.mjs';
import {WORKER_TOOL_POLICY} from './src/worker-policy.mjs';
import {reviewedTeamTools} from './src/managed-head.mjs';
import {SCHEMA_VERSION} from './contract.mjs';
// A person cannot read a proposal and press confirm this fast. Below this floor a
// reply is reported as a client answer, never as a human decision.
const HUMAN_REVIEW_FLOOR_MS=1000;
const staleBindingGuard=(error,event)=>codexGuard({member:null,hasReports:false,staleBinding:true,staleReason:String(error.message).slice(0,300)},event);
const editChanges={type:'array',minItems:1,maxItems:30,items:{oneOf:[
 {type:'object',additionalProperties:false,properties:{type:{const:'updateTeam'},name:{type:'string'},functionText:{type:'string'}},required:['type','name','functionText']},
 {type:'object',additionalProperties:false,properties:{type:{const:'saveSettings'},settings:commandSchema.properties.settings},required:['type','settings']},
 {type:'object',additionalProperties:false,properties:{type:{const:'addMember'},memberId:{type:'string'},name:{type:'string'},bossMemberId:{type:'string'},role:{type:'string'},officialText:{type:'string'},cli:{enum:['claude','codex']}},required:['type','memberId','name','bossMemberId','role','officialText','cli']},
 {type:'object',additionalProperties:false,properties:{type:{const:'updateMember'},memberId:{type:'string'},expectedMemberGeneration:{type:'integer',minimum:1},patch:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(['name','role','officialText','advisoryNotes','model','effort'].map(k=>[k,{type:'string'}])),allowWrite:{type:'boolean'},allowAgent:{type:'boolean'}}}},required:['type','memberId','expectedMemberGeneration','patch']}
]}};
const managedSchema={...commandSchema,...commandRequirements(managementTypes),properties:{...commandSchema.properties,type:{enum:managementTypes},changes:editChanges}};
const memberTypes=commandSchema.properties.type.enum.filter(t=>!managementTypes.includes(t));
const memberSchema={...commandSchema,...commandRequirements(memberTypes),properties:{...commandSchema.properties,type:{type:'string',enum:memberTypes}}};
const object=properties=>({type:'object',properties,additionalProperties:false});
export const codexTools=[
 {name:'shared_team_worker_review',description:'Inspect pending native questions/forms from one exact dispatcher-owned Claude or Codex worker. The approved top head relays worker requests; the creating approved controller may display its exact optional managed lead request. review opens the original question or one-time permission proposal; tool arguments cannot supply an answer. File approval requires the exact native diff, command approval the exact native command. Unsupported, missing or oversized proposals stay pending. Preserve operationId and reconcile uncertain replies. No remembered permission grant.',inputSchema:{...object({action:{enum:['inspect','review','reconcile']},launchId:{type:'string'},requestId:{anyOf:[{type:'string'},{type:'integer'}]},operationId:{type:'string'}}),required:['action','launchId']}},
 {name:'shared_team_upgrade',description:`Explicit native-reviewed shared workspace update to schema ${SCHEMA_VERSION} with a complete private backup. Matching clients are required. Preserves roster, approvals and history; grants no management, hook trust or launch approval. Preserve operationId and reconcile uncertain replies. Never upgrades on status or inspection.`,inputSchema:{...object({operationId:{type:'string'},reconcile:{type:'boolean'}}),required:['operationId']}},
 {name:'shared_team_launch',description:'Review these specific workers and their fixed team-tool access. New local workers start as capacity opens; connected workers require their current expectedBindingGeneration for setup adoption and are never launched again by this plan. Ordinary Orca teams use their native terminal route. Explicit optional managed teams use dispatcher-owned connections even from Orca; independent teams also use owned connections with native project execution settings. Use inspectConfiguration for current generations and launch IDs. Work waits for actual tool readiness. Preserve request/id and reconcile uncertain replies. No Hermes or unlisted worker access.',inputSchema:{...object({operationId:{type:'string'},reconcile:{type:'boolean'},command:{...object({type:{const:'approveLaunchPlan'},teamId:{type:'string'},planId:{type:'string'},workerToolPolicy:{const:WORKER_TOOL_POLICY},expectedConfigVersion:{type:'integer',minimum:1},expectedControllerGeneration:{type:'integer',minimum:1},selections:{type:'array',minItems:1,maxItems:30,items:{...object({memberId:{type:'string'},launchId:{type:'string'},expectedBindingGeneration:{type:'integer',minimum:0},expectedMemberGeneration:{type:'integer',minimum:1},expectedOfficialGeneration:{type:'integer',minimum:1},expectedNotesGeneration:{type:'integer',minimum:1}}),required:['memberId','launchId','expectedMemberGeneration','expectedOfficialGeneration','expectedNotesGeneration']}}}),required:['type','teamId','planId','workerToolPolicy','expectedConfigVersion','expectedControllerGeneration','selections']}}),required:['operationId','command']}},
 {name:'shared_team_interview',description:'Show a native interactive action menu or collect team/lead/member/edit preferences when a normal question tool is unavailable. Answers are draft data only; they never approve management, change a team or grant permissions.',inputSchema:{...object({step:{type:'string',enum:['action','team','lead','member','change']},bossNames:{type:'array',maxItems:30,items:{type:'string'},uniqueItems:true}}),required:['step']}},
 {name:'shared_team_manage',description:'Native reviewed team management. approveController, createFreshTeam, editTeam or bindMember. Every new effect requests a native confirmation form; ordinary tool arguments cannot approve it. createFreshTeam can request conversation management approval with the composition preview and can explicitly select managedLead for a new owned top member; launch remains separately reviewed. editTeam uses explicit changes: updateTeam, saveSettings, addMember, updateMember. Never removes, converts CLI, rebinds silently or transfers homes. Preserve operationId and exact request; reconcile:true only checks the receipt.',inputSchema:{...object({operationId:{type:'string'},command:managedSchema,target:{type:'object',additionalProperties:false,properties:Object.fromEntries(['projectRoot','conversationId','terminalHandle','contextId'].map(k=>[k,{type:'string'}])),required:['projectRoot','conversationId','terminalHandle','contextId']},reconcile:{type:'boolean'}}),required:['operationId','command']}},
 {name:'shared_team_sessions',description:'Discover currently verified existing Claude/Codex sessions eligible for explicit connection. Listing grants no approval or binding.',inputSchema:object({})},
 {name:'shared_team_status',description:'Check native identity, current controller/member state and supported onboarding actions. Reports missing setup explicitly; does not create a store or imply hook trust.',inputSchema:object({})},
 {name:'shared_team',description:'Shared Team Orchestrator API. inspectCaller discovers your binding and versions. Pure inspections return readOnly:true, save no receipt, and resample current authorized state on repeat/reconcile. For effects preserve operationId after an uncertain reply and use reconcile:true. Inputs and durable results are limited to 1 MiB; reference large artifacts in files. Read official role and brief with verifyAssignment before working. reportOutcome never accepts a task: the admitting head reviews separately. Meetings: inspectMeeting, respondMeeting only for yourself after a safe checkpoint, contributeMeeting, proposeMeetingOutput. The top chair starts/advances/reviews/closes. Invitations and outputs grant no task, role or file permission.',inputSchema:{...object({operationId:{type:'string'},command:memberSchema,reconcile:{type:'boolean'}}),required:['operationId','command']}},
 {name:'shared_inbox_read',description:'Read your next durable message and recovery receipt. Confirm its exact readReceiptId with shared_inbox_seen. Meeting notifications require inspectMeeting before joining at your own safe checkpoint.',inputSchema:object({})},
 {name:'shared_inbox_seen',description:'Confirm that recovered inbox context reached this conversation. This accepts no task and grants no permissions.',inputSchema:{...object({readReceiptId:{type:'string'}}),required:['readReceiptId']}},
 {name:'team_guard',description:'Native PreToolUse hook callback. Evaluates current durable member switches. This tool cannot change permissions or approve controllers.',inputSchema:{...object({tool:{type:'string'},input:{}}),required:['tool','input']}},
];
export async function createCodexAdapter(options={},dependencies={}) {
 options={...options,writer:options.writer??SHARED_WRITER};
 const allowedTools=options.workerAccess?new Set([...reviewedTeamTools(options.workerAccess),'team_guard']):null;
 if(options.hostMode!==undefined&&!['orca','independent'].includes(options.hostMode))throw refusal('API_INPUT_INVALID','Unknown native host mode.');
 const native=await (dependencies.createIdentity??(options.hostMode==='independent'?createIndependentCodexIdentity:createCodexNativeIdentity))(options);
 const workerRuntime=createCodexWorkerRuntime({options,native,createApi:dependencies.createApi??createTeamApi,timers:dependencies.workerTimers});
 const observation=options.observation===false?null:(dependencies.createObserver??createCodexObserver)({native,writer:options.writer,postgres:options.postgres,createApi:dependencies.createApi??createTeamApi});
 // Delivery evidence for this adapter's single MCP session. A client can
 // advertise elicitation and still answer the form itself without ever showing
 // it. Timing alone cannot attest delivery, and a rejected wait is not a reply.
 const deliveries={attempts:0,humanPaced:0,fastReplies:0,failedWaits:0,lastElapsedMs:null,lastOutcome:null};
 // humanPaced counts round trips slow enough that a person could have answered,
 // whether they accepted or declined. fastReplies counts the ones too fast for
 // that. A fast reply is a signal about the client, not proof about the person,
 // so the classification names the observation and claims nothing further.
 const reviewProbe=()=>({...deliveries,delivery:'unverified',classification:deliveries.attempts===0?'not-observed':deliveries.humanPaced>0?'human-paced-reply-delivery-unverified':deliveries.fastReplies>0?'replies-too-fast-for-a-person-delivery-unverified':'no-reply'});
 const recordReview=(elapsedMs,outcome)=>{deliveries.attempts++;deliveries.lastElapsedMs=elapsedMs;deliveries.lastOutcome=outcome;if(outcome==='failed'){deliveries.failedWaits++;return;}if(elapsedMs<HUMAN_REVIEW_FLOOR_MS)deliveries.fastReplies++;else deliveries.humanPaced++;};
 return Object.freeze({
  tools:allowedTools?codexTools.filter(tool=>allowedTools.has(tool.name)):codexTools,
  close:async()=>{try{await workerRuntime?.close();}finally{try{await observation?.close();}finally{await native.close?.();}}},
  async call(name,args,metadata,baseConnection){
   if(allowedTools&&!allowedTools.has(name))throw refusal('API_WORKER_ACCESS_REQUIRED','This owned member has no reviewed access to that tool. Workers use their head; a managed lead requires its separate reviewed tool bundle.');
   // Measure every review round trip in one place, so management, launch and
   // upgrade reviews cannot disagree about whether a form was really shown.
   const connection=baseConnection&&typeof baseConnection.elicit==='function'?{...baseConnection,elicit:async params=>{const started=Date.now();try{const reply=await baseConnection.elicit(params);recordReview(Date.now()-started,'response');return reply;}catch(error){recordReview(Date.now()-started,'failed');throw error;}}}:baseConnection;
   if(name==='team_guard'&&native.verifyGuardCaller&&!options.reservedLaunch&&!options.workerAccess){
    exact(args,['tool','input']);
    const guardActor=await native.verifyGuardCaller(metadata);let authority;
    try{authority=await (dependencies.inspectGuard??inspectGuardCaller)({actor:guardActor,postgres:options.postgres,allowLaunchProbe:true});}
    catch(error){
     if(['STORE_NOT_FOUND','STORE_EMPTY'].includes(error.code))authority={member:null};
     else if(error.code==='API_STALE_BINDING')return staleBindingGuard(error,args);
     else throw error;
    }
    // Absence at the configured project is a read-only membership fact. It
    // permits ordinary tools, never a team API effect or unverified bootstrap.
    if(!authority.member&&!authority.pendingLaunchId)return codexGuard({...authority,projectRoot:guardActor.projectRoot},args);
   }
   const actor=await native.verifyCaller(metadata);
   let stalePreflight;
   if(options.reservedLaunch){
    const fixed=options.reservedLaunch;
    if(actor.projectRoot!==fixed.projectRoot||actor.machineId!==fixed.machineId||actor.contextId!==fixed.contextId)throw refusal('API_LAUNCH_SCOPE','The reserved worker native home changed.');
    const attach=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata)});
    try{
     // A refused/missing target must be inspected again, not replay a cached
     // attached:false receipt forever. The database still allows only one bind.
     const result=await attach.launch({operationId:`reserved-attach-${crypto.randomUUID()}`,command:{type:'attachLaunch',projectId:fixed.projectId,launchId:fixed.launchId,memberId:fixed.memberId}});
     if(result.result.attached!==true)throw refusal('API_LAUNCH_ATTACH_REQUIRED','This reserved worker has no confirmed native attachment. Wait for the controller; ordinary unbound work is not allowed.');
     const info=(await attach.execute({operationId:`reserved-caller-${crypto.randomUUID()}`,command:{type:'inspectCaller'}})).result;
     if(info.projectId!==fixed.projectId||info.member?.member_id!==fixed.memberId)throw refusal('API_LAUNCH_SCOPE','This reserved worker is not bound to its expected project/member.');
    }finally{await attach.close();}
   }else if(native.launchWorkers){
    let probe;try{probe=await (dependencies.inspectGuard??inspectGuardCaller)({actor,postgres:options.postgres,allowLaunchProbe:true});}catch(error){
     if(error.code==='API_STALE_BINDING')stalePreflight=error;
     else if(!['STORE_NOT_FOUND','STORE_EMPTY'].includes(error.code))throw error;
    }
    if(probe?.pendingLaunchId){const attach=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata)});try{await attach.launch({operationId:`codex-attach-${actor.conversationId}-${actor.incarnationId}`,command:{type:'attachLaunch'}});}finally{await attach.close();}}
   }
   if(stalePreflight){
    // The launch probe runs before tool dispatch in real Orca sessions. Apply
    // the same restricted recovery policy here, including to direct MCP calls;
    // a stale binding never authorizes a launch or an unrelated effect.
    if(name==='team_guard'){exact(args,['tool','input']);return staleBindingGuard(stalePreflight,args);}
    const decision=staleBindingGuard(stalePreflight,{tool:name,input:args});
    if(decision.hookSpecificOutput?.permissionDecision==='deny')throw stalePreflight;
   }
   observation?.activate(metadata,actor);
   if(name==='shared_team_worker_review')return codexWorkerReview({args,actor,metadata,native,createApi:dependencies.createApi??createTeamApi,options,connection});
   if(name==='shared_team_upgrade')return codexUpgrade({args,actor,metadata,native,options,connection});
   if(name==='shared_team_launch'){if(!native.launchWorkers)throw refusal('API_LAUNCH_UNSUPPORTED','This native host cannot launch Codex workers.');const result=await codexLaunchPlan({args,actor,metadata,native,createApi:dependencies.createApi??createTeamApi,options,connection});if(result.status!=='unknown')observation?.requestPass?.();return result;}
   if(name==='shared_team_interview'){const form=interviewForm(args);if(!connection?.canElicit)throw refusal('API_REVIEW_UNAVAILABLE','A native interactive form is unavailable in this client.');const result=await connection.elicit(form);const current=await native.verifyCaller(metadata);if(JSON.stringify(current)!==JSON.stringify(actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed while the interview was open.');return {draftOnly:true,response:result};}
   if(name==='shared_team_manage'){const result=await codexManagement({args,actor,metadata,native,createApi:dependencies.createApi??createTeamApi,options,connection});if(result.status!=='unknown')observation?.requestPass?.();return result;}
   if(name==='shared_team_sessions'){exact(args,[]);return native.listTargets(metadata);}
   if(name==='team_guard'){
    try{exact(args,['tool','input']);return codexGuard({...await (dependencies.inspectGuard??inspectGuardCaller)({actor,...(options.postgres?{postgres:options.postgres}:{})}),projectRoot:actor.projectRoot},args);}
    catch(error){
     if(['STORE_NOT_FOUND','STORE_EMPTY'].includes(error.code))return codexGuard({member:null,hasReports:false,projectRoot:actor.projectRoot},args);
     // A stale native binding is a recoverable state, not a reason to disable
     // every tool. Hand the guard that fact so read-only inspection stays open
     // and the reviewed recovery call remains reachable. All effects and writes
     // stay denied; nothing here grants authority.
     if(error.code==='API_STALE_BINDING')return staleBindingGuard(error,args);
     return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Current team authority could not be verified. Refresh the native binding before continuing.'}};
    }
   }
   const api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata),...(workerRuntime?workerRuntime.apiOptions(metadata,actor):{})});
   let journal;
   try{
    await workerRuntime?.prepare(api,metadata,actor);
    if(name==='shared_team_status'){
     exact(args,[]);let info;
     try{info=(await api.execute({operationId:`status-${crypto.randomUUID()}`,command:{type:'inspectCaller'}})).result;}
     catch(e){
      if(e.code==='API_STALE_BINDING')info={...(await api.execute({operationId:`controller-status-${crypto.randomUUID()}`,command:{type:'inspectController'}})).result,bindingState:'stale-needs-explicit-reconnect',recovery:'shared_team_manage bindMember with a native review'};
      else if(e.code==='STORE_VERSION_UNSUPPORTED'&&[5,6,7,8,9,10].includes(e.details?.version)&&e.details?.supported===SCHEMA_VERSION)info={storeExists:true,upgradeRequired:true,storeVersion:e.details.version,controllerApprovalUnknown:true,member:null,teams:[]};
      else{if(!['STORE_NOT_FOUND','STORE_EMPTY'].includes(e.code))throw e;info={storeExists:false,controllerGeneration:null,member:null,teams:[]};}
     }
     // Capability is not proof of delivery. A client can advertise elicitation and
     // still answer the form itself; only a confirmed round trip is reported.
     const workerTools=workerRuntime?await workerRuntime.observe(api,'status'):null;
     const launchProviders=native.launchWorkers===true?(native.launchProviders??['codex']):[];
     const managedLead={creation:'explicit-new-team-native-review',route:'dispatcher-owned',launchProviders:(native.managedLaunchNative??native).launchProviders??[],controllerApprovalInherited:false,reviewViewer:'approving-controller-for-its-exact-managed-lead'};
     return {host:native.hostKind??'orca',provider:actor.provider,actor,info,...(workerTools?{workerTools}:{}),inboxWake:native.inboxWake??{state:'unverified'},observation:observation?.status()??{state:'disabled'},nativeReviewAvailable:connection?.canElicit===true,elicitationProbe:reviewProbe(),guardTrust:'not-attested',actions:{createTeam:'native-review',editTeam:'native-review',connectSession:'existing-verified',automaticCodexLaunch:launchProviders.includes('codex'),automaticClaudeLaunch:launchProviders.includes('claude'),launchProviders,managedLead,claudeComponent:(native.managedLaunchNative??native).claudeProvider??{state:'host-managed'},launchApproval:'specific-native-reviewed-plan',workspaceUpgrade:'native-review-with-backup',standalone:native.hostKind==='independent',...(native.hostKind==='independent'?{standaloneScope:'native management and reviewed owned workers; Claude requires its optional component; external conversations are not automatically adopted',workerNativeReview:'top-head-native-questions-and-one-time-permissions'}:{}),hermes:false}};
    }
    if(name==='shared_team'){
     exact(args,['operationId','command','reconcile']);
     if(managementTypes.includes(args.command?.type))throw refusal('API_MANAGEMENT_REVIEW_REQUIRED','Use shared_team_manage for a native reviewed management operation.');
     const result=await api[args.reconcile===true?'reconcile':'execute']({operationId:args.operationId,command:args.command});
     if(workerRuntime&&args.reconcile!==true&&args.command.type==='inspectTeam')await workerRuntime.observe(api,'api');
     if(result.status!=='unknown'&&!args.command.type.startsWith('inspect'))observation?.requestPass?.();
     return result;
    }
    if(!['shared_inbox_read','shared_inbox_seen'].includes(name))throw Error('Unknown team tool.');
    exact(args,name==='shared_inbox_seen'?['readReceiptId']:[]);
    if(workerRuntime&&name==='shared_inbox_read'){const setup=await workerRuntime.observe(api,'inbox');if(setup.state!=='ready')return setup;}
    if(workerRuntime&&name==='shared_inbox_seen'&&String(args.readReceiptId).startsWith('bootstrap-read-'))return await workerRuntime.observe(api,'seen',args.readReceiptId);
    journal=await (dependencies.createJournal??createInboxJournal)({api,actor,writer:options.writer,machineConfigRoot:options.machineConfigRoot});
    if(!journal)throw Error('This native conversation is not bound to a team member.');
    return await (name==='shared_inbox_read'?journal.poll():journal.attached(args.readReceiptId));
   }finally{await journal?.close();await api.close();}
  }
 });
}
export async function serveCodexMcp(adapter,options={}){try{return await serveMcp(adapter,adapter.tools??codexTools,options);}finally{await adapter.close?.();}}
export function refusedCodexAdapter(error){
 const safe=typeof error?.code==='string'&&/^(API_|STORE_)[A-Z_]+$/.test(error.code);
 const failure=refusal(safe?error.code:'API_NATIVE_UNVERIFIED',safe?String(error.message).slice(0,500):'Native Codex startup authority could not be verified. Reconnect after repairing its fixed configuration.');
 return Object.freeze({call:async()=>{throw failure;},close:async()=>{}});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let adapter;
 try{
  const hostMode=process.env.TEAM_HOST_MODE||'orca';
  if(!['orca','independent'].includes(hostMode))throw Error('Unknown native host mode.');
  const scope=hostMode==='independent'?{projectRoot:process.env.TEAM_PROJECT_ROOT,...(process.env.TEAM_CONTEXT_ID?{contextId:process.env.TEAM_CONTEXT_ID}:{})}:{projectRoot:process.env.TEAM_PROJECT_ROOT,terminalHandle:process.env.TEAM_TERMINAL_HANDLE||process.env.ORCA_TERMINAL_HANDLE,contextId:process.env.TEAM_CONTEXT_ID||process.env.ORCA_WORKTREE_ID};
  if(!scope.projectRoot){if(hostMode==='independent')throw Error('Independent setup requires its fixed project root.');if(!scope.terminalHandle||!scope.contextId)throw Error('A verified Orca terminal/context is required.');const host=await createOrcaHost();const terminal=(await host.rpc('terminal.show',{terminal:scope.terminalHandle})).terminal;if(terminal.worktreeId!==scope.contextId)throw Error('Orca scope changed.');scope.projectRoot=terminal.worktreePath;}
  const codexExecutable=process.env.TEAM_CODEX_EXECUTABLE||(await inspectWindowsProcess(process.ppid)).executable;
  const launch=process.env.TEAM_RESERVED_LAUNCH_PROFILE?await readReservedLaunchProfile(process.env.TEAM_RESERVED_LAUNCH_PROFILE,scope.projectRoot):{};
  adapter=await createCodexAdapter({hostMode,scope,codexExecutable,codexHome:process.env.TEAM_CODEX_HOME,orcaCommand:process.env.TEAM_ORCA_COMMAND,...launch});
 }catch(error){process.stderr.write('Native Codex team adapter is serving blocked diagnostics because startup authority was refused.\n');adapter=refusedCodexAdapter(error);}
 try{await serveCodexMcp(adapter);}catch{process.stderr.write('Native Codex team transport was refused.\n');process.exitCode=1;}
}
