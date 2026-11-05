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
 return Object.freeze({
  async call(name,args,metadata,connection){
   const actor=await native.verifyCaller(metadata);
   if(name==='shared_team_interview'){const form=interviewForm(args);if(!connection?.canElicit)throw refusal('API_REVIEW_UNAVAILABLE','A native interactive form is unavailable in this client.');const result=await connection.elicit(form);const current=await native.verifyCaller(metadata);if(JSON.stringify(current)!==JSON.stringify(actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed while the interview was open.');return {draftOnly:true,response:result};}
   if(name==='shared_team_manage')return codexManagement({args,actor,metadata,native,createApi:dependencies.createApi??createTeamApi,options,connection});
   if(name==='shared_team_sessions'){exact(args,[]);return native.listTargets(metadata);}
   if(name==='team_guard'){
    try{exact(args,['tool','input']);return codexGuard(await (dependencies.inspectGuard??inspectGuardCaller)({actor,...(options.postgres?{postgres:options.postgres}:{})}),args);}
    catch(error){if(error.code==='STORE_NOT_FOUND')return {};return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Current team authority could not be verified. Refresh the native binding before continuing.'}};}
   }
   const api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata)});
   let journal;
   try{
    if(name==='shared_team_status'){exact(args,[]);let info;try{info=(await api.execute({operationId:`status-${crypto.randomUUID()}`,command:{type:'inspectCaller'}})).result;}catch(e){if(e.code==='API_STALE_BINDING'){info={...(await api.execute({operationId:`controller-status-${crypto.randomUUID()}`,command:{type:'inspectController'}})).result,bindingState:'stale-needs-explicit-reconnect'};}else{if(!['STORE_NOT_FOUND','STORE_EMPTY'].includes(e.code))throw e;info={storeExists:false,controllerGeneration:null,member:null,teams:[]};}}return {host:'orca',provider:'codex',actor,info,nativeReviewAvailable:connection?.canElicit===true,guardTrust:'not-attested',actions:{createTeam:'native-review',editTeam:'native-review',connectSession:'existing-verified',automaticCodexLaunch:false,standalone:false,hermes:false}};}
    if(name==='shared_team'){
     exact(args,['operationId','command','reconcile']);
     if(managementTypes.includes(args.command?.type))throw refusal('API_MANAGEMENT_REVIEW_REQUIRED','Use shared_team_manage for a native reviewed management operation.');
     const result=await api[args.reconcile===true?'reconcile':'execute']({operationId:args.operationId,command:args.command});
     if(native.wake&&result.status!=='unknown'&&!args.command.type.startsWith('inspect')){
      try{
       const info=(await api.execute({operationId:`codex-caller-${crypto.randomUUID()}`,command:{type:'inspectCaller'}})).result;
       if(info.member&&info.binding){const reservations=await api.execute({operationId:`codex-wake-${crypto.randomUUID()}`,command:{type:'prepareDeliveries',teamId:info.member.team_id,expectedConfigVersion:info.configVersion,expectedMemberGeneration:info.member.generation,expectedBindingGeneration:info.binding.generation}});await native.wake(reservations.result.deliveries,metadata);}
      }catch{/* The effect receipt is confirmed; attention delivery may be retried. */}
     }
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
export async function serveCodexMcp(adapter,options={}){return serveMcp(adapter,codexTools,options);}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const scope={projectRoot:process.env.TEAM_PROJECT_ROOT,terminalHandle:process.env.TEAM_TERMINAL_HANDLE||process.env.ORCA_TERMINAL_HANDLE,contextId:process.env.TEAM_CONTEXT_ID||process.env.ORCA_WORKTREE_ID};
  if(!scope.projectRoot){if(!scope.terminalHandle||!scope.contextId)throw Error('A verified Orca terminal/context is required.');const host=await createOrcaHost();const terminal=(await host.rpc('terminal.show',{terminal:scope.terminalHandle})).terminal;if(terminal.worktreeId!==scope.contextId)throw Error('Orca scope changed.');scope.projectRoot=terminal.worktreePath;}
  const codexExecutable=process.env.TEAM_CODEX_EXECUTABLE||(await inspectWindowsProcess(process.ppid)).executable;
  const adapter=await createCodexAdapter({scope,codexExecutable,codexHome:process.env.TEAM_CODEX_HOME,orcaCommand:process.env.TEAM_ORCA_COMMAND});
  await serveCodexMcp(adapter);
 }catch{process.stderr.write('Native Codex team adapter refused startup or transport. Check fixed scope, native executable and Orca runtime.\n');process.exitCode=1;}
}
