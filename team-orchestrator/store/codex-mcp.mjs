import {interviewForm} from './src/codex-interview.mjs';
import {serveMcp} from './src/mcp-stdio.mjs';
import {codexManagement,managementTypes} from './src/codex-management.mjs';
import {refusal} from './src/errors.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {inspectWindowsProcess} from './src/windows-native.mjs';
// Local stdio MCP adapter. No HTTP listener, API key, SQL, caller proof or
// controller approval is exposed as a tool. Native metadata is checked per call.
import {createCodexNativeIdentity} from './codex-native.mjs';
import {createTeamApi} from './api.mjs';
import {createInboxJournal} from './src/inbox-journal.mjs';
import {inspectGuardCaller} from './src/guard-reader.mjs';
import {codexGuard} from './src/codex-guard.mjs';
import {commandSchema} from './src/api-schema.mjs';
import {exact} from './src/api-domain.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {SHARED_WRITER} from './src/runtime-release.mjs';
import {createCodexObserver} from './src/codex-observer.mjs';
import {codexLaunchPlan} from './src/codex-launch.mjs';
import {codexUpgrade} from './src/codex-upgrade.mjs';
import {readReservedLaunchProfile} from './src/codex-launch-profile.mjs';
// A person cannot read a proposal and press confirm this fast. Below this floor a
// reply is reported as a client answer, never as a human decision.
const HUMAN_REVIEW_FLOOR_MS=1000;
const editChanges={type:'array',minItems:1,maxItems:30,items:{oneOf:[
 {type:'object',additionalProperties:false,properties:{type:{const:'updateTeam'},name:{type:'string'},functionText:{type:'string'}},required:['type','name','functionText']},
 {type:'object',additionalProperties:false,properties:{type:{const:'saveSettings'},settings:commandSchema.properties.settings},required:['type','settings']},
 {type:'object',additionalProperties:false,properties:{type:{const:'addMember'},memberId:{type:'string'},name:{type:'string'},bossMemberId:{type:'string'},role:{type:'string'},officialText:{type:'string'},cli:{enum:['claude','codex']}},required:['type','memberId','name','bossMemberId','role','officialText','cli']},
 {type:'object',additionalProperties:false,properties:{type:{const:'updateMember'},memberId:{type:'string'},expectedMemberGeneration:{type:'integer',minimum:1},patch:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(['name','role','officialText','advisoryNotes','model','effort'].map(k=>[k,{type:'string'}])),allowWrite:{type:'boolean'},allowAgent:{type:'boolean'}}}},required:['type','memberId','expectedMemberGeneration','patch']}
]}};
const managedSchema={...commandSchema,properties:{...commandSchema.properties,type:{enum:managementTypes},changes:editChanges}};
const memberSchema={...commandSchema,properties:{...commandSchema.properties,type:{type:'string',enum:commandSchema.properties.type.enum.filter(t=>!managementTypes.includes(t))}}};
const object=properties=>({type:'object',properties,additionalProperties:false});
export const codexTools=[
 {name:'shared_team_upgrade',description:'Explicit native-reviewed shared workspace update to schema 9 with a complete private backup. Preserves roster, approvals and history; does not grant management, hook trust or launch approval. Other clients need Mod 0.5.58 / Codex 0.1.8. Preserve operationId and reconcile an uncertain reply. Never upgrades on ordinary status or inspection.',inputSchema:{...object({operationId:{type:'string'},reconcile:{type:'boolean'}}),required:['operationId']}},
 {name:'shared_team_launch',description:'Review one specific Codex worker launch plan through a native confirmation form. Only listed unbound local workers may start automatically as capacity opens. Existing sessions are never closed or replaced. Use inspectConfiguration for current worker and role generations and any existing queued launch IDs. Keep the exact request/id and reconcile uncertain replies. This does not approve new workers, role changes, standalone hosts or Hermes.',inputSchema:{...object({operationId:{type:'string'},reconcile:{type:'boolean'},command:{...object({type:{const:'approveLaunchPlan'},teamId:{type:'string'},planId:{type:'string'},expectedConfigVersion:{type:'integer',minimum:1},expectedControllerGeneration:{type:'integer',minimum:1},selections:{type:'array',minItems:1,maxItems:30,items:{...object({memberId:{type:'string'},launchId:{type:'string'},expectedMemberGeneration:{type:'integer',minimum:1},expectedOfficialGeneration:{type:'integer',minimum:1},expectedNotesGeneration:{type:'integer',minimum:1}}),required:['memberId','launchId','expectedMemberGeneration','expectedOfficialGeneration','expectedNotesGeneration']}}}),required:['type','teamId','planId','expectedConfigVersion','expectedControllerGeneration','selections']}}),required:['operationId','command']}},
 {name:'shared_team_interview',description:'Show a native interactive action menu or collect team/member/edit preferences when a normal question tool is unavailable. Answers are draft data only; they never approve management, change a team or grant permissions.',inputSchema:{...object({step:{type:'string',enum:['action','team','member','change']},bossNames:{type:'array',maxItems:30,items:{type:'string'},uniqueItems:true}}),required:['step']}},
 {name:'shared_team_manage',description:'Native reviewed team management. approveController, createFreshTeam, editTeam or bindMember. Every new effect requests a native confirmation form; ordinary tool arguments cannot approve it. createFreshTeam can request conversation management approval together with the composition preview. editTeam uses explicit changes: updateTeam, saveSettings, addMember, updateMember. Never removes, converts CLI, rebinds silently or transfers homes. Preserve operationId and exact request; reconcile:true only checks the receipt.',inputSchema:{...object({operationId:{type:'string'},command:managedSchema,target:{type:'object',additionalProperties:false,properties:Object.fromEntries(['projectRoot','conversationId','terminalHandle','contextId'].map(k=>[k,{type:'string'}])),required:['projectRoot','conversationId','terminalHandle','contextId']},reconcile:{type:'boolean'}}),required:['operationId','command']}},
 {name:'shared_team_sessions',description:'Discover currently verified existing Claude/Codex sessions eligible for explicit connection. Listing grants no approval or binding.',inputSchema:object({})},
 {name:'shared_team_status',description:'Check native identity, current controller/member state and supported onboarding actions. Reports missing setup explicitly; does not create a store or imply hook trust.',inputSchema:object({})},
 {name:'shared_team',description:'Shared Team Orchestrator API. inspectCaller discovers your binding and versions. Preserve operationId after an uncertain reply; use reconcile:true. Read official role and brief with verifyAssignment before working. reportOutcome never accepts a task: the admitting head reviews separately. Meetings: inspectMeeting, respondMeeting only for yourself after a safe checkpoint, contributeMeeting, proposeMeetingOutput. The top chair starts/advances/reviews/closes. Invitations and outputs grant no task, role or file permission.',inputSchema:{...object({operationId:{type:'string'},command:memberSchema,reconcile:{type:'boolean'}}),required:['operationId','command']}},
 {name:'shared_inbox_read',description:'Read your next durable message and recovery receipt. Confirm its exact readReceiptId with shared_inbox_seen. Meeting notifications require inspectMeeting before joining at your own safe checkpoint.',inputSchema:object({})},
 {name:'shared_inbox_seen',description:'Confirm that recovered inbox context reached this conversation. This accepts no task and grants no permissions.',inputSchema:{...object({readReceiptId:{type:'string'}}),required:['readReceiptId']}},
 {name:'team_guard',description:'Native PreToolUse hook callback. Evaluates current durable member switches. This tool cannot change permissions or approve controllers.',inputSchema:{...object({tool:{type:'string'},input:{}}),required:['tool','input']}},
];
export async function createCodexAdapter(options={},dependencies={}) {
 options={...options,writer:options.writer??SHARED_WRITER};
 const native=await (dependencies.createIdentity??createCodexNativeIdentity)(options);
 const observation=options.observation===false?null:(dependencies.createObserver??createCodexObserver)({native,writer:options.writer,postgres:options.postgres,createApi:dependencies.createApi??createTeamApi});
 // Delivery evidence for this adapter's single MCP session. A client can
 // advertise elicitation and still answer the form itself without ever showing
 // it. The only trustworthy signal is a reply that took human-scale time.
 const deliveries={attempts:0,humanPaced:0,fastReplies:0,lastElapsedMs:null};
 // humanPaced counts round trips slow enough that a person could have answered,
 // whether they accepted or declined. fastReplies counts the ones too fast for
 // that. A fast reply is a signal about the client, not proof about the person,
 // so the classification names the observation and claims nothing further.
 const reviewProbe=()=>({...deliveries,classification:deliveries.attempts===0?'not-observed':deliveries.humanPaced>0?'form-delivered':deliveries.fastReplies>0?'replies-too-fast-for-a-person-delivery-unverified':'no-reply'});
 const recordReview=elapsedMs=>{deliveries.attempts++;deliveries.lastElapsedMs=elapsedMs;if(elapsedMs<HUMAN_REVIEW_FLOOR_MS)deliveries.fastReplies++;else deliveries.humanPaced++;};
 return Object.freeze({
  close:async()=>observation?.close(),
  async call(name,args,metadata,baseConnection){
   // Measure every review round trip in one place, so management, launch and
   // upgrade reviews cannot disagree about whether a form was really shown.
   const connection=baseConnection&&typeof baseConnection.elicit==='function'?{...baseConnection,elicit:async params=>{const started=Date.now();try{const reply=await baseConnection.elicit(params);recordReview(Date.now()-started);return reply;}catch(error){recordReview(Date.now()-started);throw error;}}}:baseConnection;
   const actor=await native.verifyCaller(metadata);
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
    let probe;try{probe=await (dependencies.inspectGuard??inspectGuardCaller)({actor,postgres:options.postgres,allowLaunchProbe:true});}catch(error){if(!['STORE_NOT_FOUND','STORE_EMPTY'].includes(error.code))throw error;}
    if(probe?.pendingLaunchId){const attach=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata)});try{await attach.launch({operationId:`codex-attach-${actor.conversationId}-${actor.incarnationId}`,command:{type:'attachLaunch'}});}finally{await attach.close();}}
   }
   observation?.activate(metadata,actor);
   if(name==='shared_team_upgrade')return codexUpgrade({args,actor,metadata,native,options,connection});
   if(name==='shared_team_launch'){if(!native.launchWorkers)throw refusal('API_LAUNCH_UNSUPPORTED','This native host cannot launch Codex workers.');const result=await codexLaunchPlan({args,actor,metadata,native,createApi:dependencies.createApi??createTeamApi,options,connection});if(result.status!=='unknown')observation?.requestPass?.();return result;}
   if(name==='shared_team_interview'){const form=interviewForm(args);if(!connection?.canElicit)throw refusal('API_REVIEW_UNAVAILABLE','A native interactive form is unavailable in this client.');const result=await connection.elicit(form);const current=await native.verifyCaller(metadata);if(JSON.stringify(current)!==JSON.stringify(actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed while the interview was open.');return {draftOnly:true,response:result};}
   if(name==='shared_team_manage'){const result=await codexManagement({args,actor,metadata,native,createApi:dependencies.createApi??createTeamApi,options,connection});if(result.status!=='unknown')observation?.requestPass?.();return result;}
   if(name==='shared_team_sessions'){exact(args,[]);return native.listTargets(metadata);}
   if(name==='team_guard'){
    try{exact(args,['tool','input']);return codexGuard(await (dependencies.inspectGuard??inspectGuardCaller)({actor,...(options.postgres?{postgres:options.postgres}:{})}),args);}
    catch(error){
     if(error.code==='STORE_NOT_FOUND')return {};
     // A stale native binding is a recoverable state, not a reason to disable
     // every tool. Hand the guard that fact so read-only inspection stays open
     // and the reviewed recovery call remains reachable. All effects and writes
     // stay denied; nothing here grants authority.
     if(error.code==='API_STALE_BINDING')return codexGuard({member:null,hasReports:false,staleBinding:true,staleReason:String(error.message).slice(0,300)},args);
     return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Current team authority could not be verified. Refresh the native binding before continuing.'}};
    }
   }
   const api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata)});
   let journal;
   try{
    if(name==='shared_team_status'){
     exact(args,[]);let info;
     try{info=(await api.execute({operationId:`status-${crypto.randomUUID()}`,command:{type:'inspectCaller'}})).result;}
     catch(e){
      if(e.code==='API_STALE_BINDING')info={...(await api.execute({operationId:`controller-status-${crypto.randomUUID()}`,command:{type:'inspectController'}})).result,bindingState:'stale-needs-explicit-reconnect',recovery:'shared_team_manage bindMember with a native review'};
      else if(e.code==='STORE_VERSION_UNSUPPORTED'&&[5,6,7,8].includes(e.details?.version)&&e.details?.supported===9)info={storeExists:true,upgradeRequired:true,storeVersion:e.details.version,controllerApprovalUnknown:true,member:null,teams:[]};
      else{if(!['STORE_NOT_FOUND','STORE_EMPTY'].includes(e.code))throw e;info={storeExists:false,controllerGeneration:null,member:null,teams:[]};}
     }
     // Capability is not proof of delivery. A client can advertise elicitation and
     // still answer the form itself; only a confirmed round trip is reported.
     return {host:'orca',provider:'codex',actor,info,observation:observation?.status()??{state:'disabled'},nativeReviewAvailable:connection?.canElicit===true,elicitationProbe:reviewProbe(),guardTrust:'not-attested',actions:{createTeam:'native-review',editTeam:'native-review',connectSession:'existing-verified',automaticCodexLaunch:native.launchWorkers===true,launchApproval:'specific-native-reviewed-plan',workspaceUpgrade:'native-review-with-backup',standalone:false,hermes:false}};
    }
    if(name==='shared_team'){
     exact(args,['operationId','command','reconcile']);
     if(managementTypes.includes(args.command?.type))throw refusal('API_MANAGEMENT_REVIEW_REQUIRED','Use shared_team_manage for a native reviewed management operation.');
     const result=await api[args.reconcile===true?'reconcile':'execute']({operationId:args.operationId,command:args.command});
     if(result.status!=='unknown'&&!args.command.type.startsWith('inspect'))observation?.requestPass?.();
     return result;
    }
    if(!['shared_inbox_read','shared_inbox_seen'].includes(name))throw Error('Unknown team tool.');
    exact(args,name==='shared_inbox_seen'?['readReceiptId']:[]);
    journal=await (dependencies.createJournal??createInboxJournal)({api,actor,writer:options.writer,machineConfigRoot:options.machineConfigRoot});
    if(!journal)throw Error('This native conversation is not bound to a team member.');
    return await (name==='shared_inbox_read'?journal.poll():journal.attached(args.readReceiptId));
   }finally{await journal?.close();await api.close();}
  }
 });
}
export async function serveCodexMcp(adapter,options={}){try{return await serveMcp(adapter,codexTools,options);}finally{await adapter.close?.();}}
export function refusedCodexAdapter(error){
 const safe=typeof error?.code==='string'&&/^(API_|STORE_)[A-Z_]+$/.test(error.code);
 const failure=refusal(safe?error.code:'API_NATIVE_UNVERIFIED',safe?String(error.message).slice(0,500):'Native Codex startup authority could not be verified. Reconnect after repairing its fixed configuration.');
 return Object.freeze({call:async()=>{throw failure;},close:async()=>{}});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let adapter;
 try{
  const scope={projectRoot:process.env.TEAM_PROJECT_ROOT,terminalHandle:process.env.TEAM_TERMINAL_HANDLE||process.env.ORCA_TERMINAL_HANDLE,contextId:process.env.TEAM_CONTEXT_ID||process.env.ORCA_WORKTREE_ID};
  if(!scope.projectRoot){if(!scope.terminalHandle||!scope.contextId)throw Error('A verified Orca terminal/context is required.');const host=await createOrcaHost();const terminal=(await host.rpc('terminal.show',{terminal:scope.terminalHandle})).terminal;if(terminal.worktreeId!==scope.contextId)throw Error('Orca scope changed.');scope.projectRoot=terminal.worktreePath;}
  const codexExecutable=process.env.TEAM_CODEX_EXECUTABLE||(await inspectWindowsProcess(process.ppid)).executable;
  const launch=process.env.TEAM_RESERVED_LAUNCH_PROFILE?await readReservedLaunchProfile(process.env.TEAM_RESERVED_LAUNCH_PROFILE,scope.projectRoot):{};
  adapter=await createCodexAdapter({scope,codexExecutable,codexHome:process.env.TEAM_CODEX_HOME,orcaCommand:process.env.TEAM_ORCA_COMMAND,...launch});
 }catch(error){process.stderr.write('Native Codex team adapter is serving blocked diagnostics because startup authority was refused.\n');adapter=refusedCodexAdapter(error);}
 try{await serveCodexMcp(adapter);}catch{process.stderr.write('Native Codex team transport was refused.\n');process.exitCode=1;}
}
