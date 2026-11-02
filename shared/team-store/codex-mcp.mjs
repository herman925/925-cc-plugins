// Local stdio MCP adapter. No HTTP listener, API key, SQL, caller proof or
// controller approval is exposed as a tool. Native metadata is checked per call.
import {createCodexNativeIdentity} from './codex-native.mjs';
import {createTeamApi} from './api.mjs';
import {createInboxJournal} from './src/inbox-journal.mjs';
import {inspectGuardCaller} from './src/guard-reader.mjs';
import {codexGuard} from './src/codex-guard.mjs';
import {commandSchema} from './src/api-schema.mjs';
import {exact} from './src/api-domain.mjs';
import {hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
const object=properties=>({type:'object',properties,additionalProperties:false});
export const codexTools=[
 {name:'shared_team',description:'Shared Team Orchestrator API. inspectCaller discovers your binding and versions. Preserve operationId after an uncertain reply; use reconcile:true. Read official role and brief with verifyAssignment before working. reportOutcome never accepts a task: the admitting head reviews separately. Meetings: inspectMeeting, respondMeeting only for yourself after a safe checkpoint, contributeMeeting, proposeMeetingOutput. The top chair starts/advances/reviews/closes. Invitations and outputs grant no task, role or file permission.',inputSchema:{...object({operationId:{type:'string'},command:commandSchema,reconcile:{type:'boolean'}}),required:['operationId','command']}},
 {name:'shared_inbox_read',description:'Read your next durable message and recovery receipt. Confirm its exact readReceiptId with shared_inbox_seen. Meeting notifications require inspectMeeting before joining at your own safe checkpoint.',inputSchema:object({})},
 {name:'shared_inbox_seen',description:'Confirm that recovered inbox context reached this conversation. This accepts no task and grants no permissions.',inputSchema:{...object({readReceiptId:{type:'string'}}),required:['readReceiptId']}},
 {name:'team_guard',description:'Native PreToolUse hook callback. Evaluates current durable member switches. This tool cannot change permissions or approve controllers.',inputSchema:{...object({tool:{type:'string'},input:{}}),required:['tool','input']}},
];
export async function createCodexAdapter(options,dependencies={}) {
 const native=await (dependencies.createIdentity??createCodexNativeIdentity)(options);
 return Object.freeze({
  async call(name,args,metadata){
   const actor=await native.verifyCaller(metadata);
   if(name==='team_guard'){
    try{exact(args,['tool','input']);return codexGuard(await (dependencies.inspectGuard??inspectGuardCaller)({actor,...(options.postgres?{postgres:options.postgres}:{})}),args);}
    catch(error){if(error.code==='STORE_NOT_FOUND')return {};return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Current team authority could not be verified. Refresh the native binding before continuing.'}};}
   }
   const api=await (dependencies.createApi??createTeamApi)({projectRoot:actor.projectRoot,machineId:hostname(),writer:options.writer,postgres:options.postgres,authenticate:()=>native.verifyCaller(metadata)});
   let journal;
   try{
    if(name==='shared_team'){
     exact(args,['operationId','command','reconcile']);
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
// Bounded MCP stdio subset: initialization, ping and tools only. Serial execution
// prevents concurrent requests from sharing a mutable actor or store connection.
export async function serveCodexMcp(adapter,{input=process.stdin,output=process.stdout}={}) {
 input.setEncoding?.('utf8');
 let buffer='',initialized=false;
 const send=value=>output.write(JSON.stringify(value)+'\n');
 const failure=(id,code,message)=>send({jsonrpc:'2.0',id,error:{code,message}});
 for await(const chunk of input){
  buffer+=chunk;
  if(Buffer.byteLength(buffer)>1024*1024)throw Error('MCP frame exceeds 1 MiB.');
  let newline;
  while((newline=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,newline);buffer=buffer.slice(newline+1);if(!line.trim())continue;
   let request;try{request=JSON.parse(line);}catch{failure(null,-32700,'Invalid JSON.');continue;}
   if(request?.jsonrpc!=='2.0'||typeof request.method!=='string'){failure(request?.id??null,-32600,'Invalid JSON-RPC request.');continue;}
   if(!Object.hasOwn(request,'id'))continue;
   const {id,method,params={}}=request;
   try{
    let result;
    if(method==='initialize'){
     if(!['2024-11-05','2025-03-26','2025-06-18','2025-11-25'].includes(params.protocolVersion)){failure(id,-32602,'Unsupported MCP protocol version.');continue;}
     initialized=true;result={protocolVersion:params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'team-orchestrator-native-codex',version:'0.5.55'}};
    }else if(!initialized){failure(id,-32002,'Initialize the connection first.');continue;}
    else if(method==='ping')result={};
    else if(method==='tools/list')result={tools:codexTools};
    else if(method==='tools/call'){
     if(!codexTools.some(t=>t.name===params.name)){failure(id,-32602,'Unknown tool.');continue;}
     try{const value=await adapter.call(params.name,params.arguments??{},params._meta);result={content:[{type:'text',text:JSON.stringify(value)}]};}
     catch(error){
      // A hook callback must return a supported denial, not an MCP error that
      // Codex would ignore. Tool errors remain structured and never imply success.
      const value=params.name==='team_guard'?{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Native caller or team authority could not be verified.'}}:{ok:false,error:{code:error.code??'API_CODEX_REFUSED',message:error.code?error.message:'Native Codex team operation was refused.'}};
      result={content:[{type:'text',text:JSON.stringify(value)}],...(params.name==='team_guard'?{}:{isError:true})};
     }
    }else{failure(id,-32601,'Method not found.');continue;}
    send({jsonrpc:'2.0',id,result});
   }catch{failure(id,-32603,'Team MCP request could not be completed.');}
  }
 }
 if(buffer.trim())throw Error('Truncated MCP frame.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const scope={projectRoot:process.env.TEAM_PROJECT_ROOT,terminalHandle:process.env.TEAM_TERMINAL_HANDLE,contextId:process.env.TEAM_CONTEXT_ID};
  const adapter=await createCodexAdapter({scope,codexExecutable:process.env.TEAM_CODEX_EXECUTABLE,codexHome:process.env.TEAM_CODEX_HOME,orcaCommand:process.env.TEAM_ORCA_COMMAND,writer:{client:'team-orchestrator',version:'0.5.55'}});
  await serveCodexMcp(adapter);
 }catch{process.stderr.write('Native Codex team adapter refused startup or transport. Check fixed scope, native executable and Orca runtime.\n');process.exitCode=1;}
}
