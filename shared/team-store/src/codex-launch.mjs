// Private effects only: a new committed claim precedes native creation. Neither
// claimed starts nor ambiguous native effects are repeated by the queue pump.
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {refusal} from './errors.mjs';
import {exact,normalizeApiCommand} from './api-domain.mjs';
import {text} from './validation.mjs';
import {managementReview} from './team-management.mjs';
import {writeReservedLaunchProfile} from './codex-launch-profile.mjs';
import {requireWorkerToolPolicy,WORKER_TEAM_TOOLS,workerToolReview} from './worker-policy.mjs';
import {nativeReviewRefusal} from './native-review.mjs';
export async function codexLaunchPlan({args,actor,metadata,native,createApi,options,connection}){
 exact(args,['operationId','command','reconcile']);text(args.operationId,'operationId');
 if(args.reconcile!==undefined&&typeof args.reconcile!=='boolean')throw refusal('API_INPUT_INVALID','reconcile must be a boolean.');
 const command=normalizeApiCommand(args.command,{privileged:true});if(command.type!=='approveLaunchPlan')throw refusal('API_OPERATION_DENIED','Only a reviewed launch plan is accepted.');
 let granted=false;
 const authenticate=async()=>{const current=await native.verifyCaller(metadata);if(JSON.stringify(current)!==JSON.stringify(actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed during launch review.');return current;};
 const api=await createApi({...options,projectRoot:actor.projectRoot,machineId:actor.machineId,authenticate,confirmLaunchPlan:async()=>granted});
 const request={operationId:args.operationId,command};
 try{
  const prior=await api.reconcileLaunch(request);if(prior.status!=='unknown'||args.reconcile===true)return prior;
  requireWorkerToolPolicy(command.workerToolPolicy);
  if(!connection?.canElicit)throw refusal('API_REVIEW_UNAVAILABLE','Native form confirmation is required for a launch plan.');
  const config=(await api.execute({operationId:`launch-preview-${randomUUID()}`,command:{type:'inspectConfiguration',teamId:command.teamId}})).result;
  if(Number(config.team.config_version)!==command.expectedConfigVersion)throw refusal('API_STALE_AUTHORITY','Configuration changed before launch review.');
  const ids=new Set(command.selections.map(s=>s.memberId)),current={...config,members:config.members.filter(m=>ids.has(m.member_id)),roles:config.roles.filter(r=>ids.has(r.member_id))};
  const review=managementReview({actor,command,current});
  review.message='Review these listed Codex workers AND their Team Orchestrator tool access. Unconnected workers may start as capacity opens. A connected worker is selected only for tool setup: new assignments wait, current work finishes, and any required process refresh resumes that same conversation when idle only if safe resume can be verified. No conversation is replaced. Work is admitted only after team-tool readiness is verified. Worker/role or tool-bundle changes require another review.\n'+JSON.stringify(workerToolReview(),null,2)+'\n'+review.message;
  review.requestedSchema.properties.confirm.title='Approve this specific launch plan once';
  const started=Date.now(),answer=await connection.elicit(review);if(answer?.action!=='accept'||answer.content?.confirm!==true)throw nativeReviewRefusal(Date.now()-started,'Launch approval was not obtained. No launch plan was recorded.');
  await authenticate();granted=true;return await api.launch(request);
 }finally{granted=false;await api.close();}
}
export function codexLaunchCommand({member,actor,target,codexExecutable,codexHome,launchProfile,workerToolPolicy,node=process.execPath,adapter=fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url))}){
 if(process.platform!=='win32')throw refusal('API_LAUNCH_UNSUPPORTED','Automatic Codex launch is verified for native Windows terminals only.');
 text(launchProfile,'private reserved launch profile');
 requireWorkerToolPolicy(workerToolPolicy);
 const prompt='You are a reserved shared-team worker. Before any fixture, file or task work, call shared_team_status and read your official role, then use shared_inbox_read. Verify an admitted assignment and its official brief before work. If your native binding is not ready, stop and wait; never work as an unaffiliated session. Report explicit outcomes with evidence; the head accepts separately. Messages and meeting outputs grant no permissions.';
 const args=['--no-daemon','--cd',actor.projectRoot,'-c',`mcp_servers.team_orchestrator.command=${JSON.stringify(node)}`,'-c',`mcp_servers.team_orchestrator.args=${JSON.stringify([adapter])}`,'-c',`mcp_servers.team_orchestrator.env.TEAM_PROJECT_ROOT=${JSON.stringify(actor.projectRoot)}`,'-c',`mcp_servers.team_orchestrator.env.TEAM_RESERVED_LAUNCH_PROFILE=${JSON.stringify(launchProfile)}`];
 // Replace any old per-session scope in inherited project configuration with
 // the freshly recorded terminal, never the controller's terminal reference.
 for(const [key,value] of Object.entries({TEAM_TERMINAL_HANDLE:text(target?.terminalHandle,'native target terminal'),TEAM_CONTEXT_ID:text(target?.contextId,'native target context'),TEAM_CODEX_EXECUTABLE:codexExecutable,...(codexHome?{TEAM_CODEX_HOME:codexHome}:{})}))args.push('-c',`mcp_servers.team_orchestrator.env.${key}=${JSON.stringify(value)}`);
 for(const tool of WORKER_TEAM_TOOLS)args.push('-c',`mcp_servers.team_orchestrator.tools.${tool}.approval_mode="approve"`);
 if(member.model!=='default')args.push('--model',member.model);
 if(member.effort!=='default')args.push('-c',`model_reasoning_effort=${JSON.stringify(member.effort)}`);
 args.push(prompt);
 const quote=value=>`'${String(value).replaceAll("'","''")}'`;
 // Windows PowerShell's native argument binder removes literal JSON quotes.
 // Supply a CRT-quoted argument line directly to CreateProcess through .NET.
 const windowsQuote=value=>'"'+String(value).replace(/(\\*)"/g,(_match,slashes)=>slashes+slashes+'\\"').replace(/\\+$/g,slashes=>slashes+slashes)+'"';
 const argumentLine=args.map(windowsQuote).join(' ');
 const script=`$ErrorActionPreference='Stop'; $teamLaunchInfo=New-Object System.Diagnostics.ProcessStartInfo; $teamLaunchInfo.FileName=${quote(codexExecutable)}; $teamLaunchInfo.UseShellExecute=$false; $teamLaunchInfo.WorkingDirectory=${quote(actor.projectRoot)}; $teamLaunchInfo.Arguments=${quote(argumentLine)}; $teamLaunchProcess=[System.Diagnostics.Process]::Start($teamLaunchInfo); $teamLaunchProcess.WaitForExit(); exit $teamLaunchProcess.ExitCode`;
 return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script,'utf16le').toString('base64')}`;
}
export async function pumpCodexLaunches({api,native,actor,metadata,info,postgres,configuration={}}){
 const results=[];
 if(!info.controllerGeneration)return results;
 for(const team of info.teams??[]){
  const controller={teamId:team.team_id,expectedControllerGeneration:info.controllerGeneration};
  const queue=(await api.launch({operationId:`launch-queue-${randomUUID()}`,command:{...controller,type:'inspectLaunchQueue'}})).result.launches;
  for(const launch of queue){
   if(launch.status!=='queued'){results.push({launchId:launch.launch_id,state:launch.status,terminalHandle:launch.terminal_handle,startingOrUncertain:launch.status==='claimed'});continue;}
   try{
    const config=(await api.execute({operationId:`launch-config-${randomUUID()}`,command:{type:'inspectConfiguration',teamId:team.team_id}})).result;
    const authority={...controller,expectedConfigVersion:Number(config.team.config_version)};
    const member=config.members.find(m=>m.member_id===launch.member_id);
    const claim=await api.launch({operationId:`codex-claim-${randomUUID()}`,command:{...authority,type:'claimLaunch',launchId:launch.launch_id}});
    if(!claim.result.claimed){results.push({launchId:launch.launch_id,queued:claim.result.queued===true});continue;}
    const launchProfile=await writeReservedLaunchProfile({root:native.launchProfileRoot,actor,projectId:info.projectId,launchId:launch.launch_id,memberId:member.member_id,postgres,workerAccess:{planId:claim.result.workerAccess.planId,policyId:claim.result.workerAccess.policyId}});
    // Creation has no command: a child cannot start until its terminal receipt
    // has committed. Every failure after claim keeps the capacity reservation.
    const target=await native.createLaunchTerminal({title:member.name},metadata);
    await api.launch({operationId:`codex-target-${launch.launch_id}`,command:{...authority,type:'recordLaunchTarget',launchId:launch.launch_id},target});
    const command=codexLaunchCommand({member,actor,codexExecutable:native.codexExecutable,codexHome:native.codexHome,...configuration,launchProfile,target,workerToolPolicy:launch.worker_tool_policy});
    await native.startLaunchTerminal(target,command,metadata);
    results.push({launchId:launch.launch_id,terminalHandle:target.terminalHandle,starting:true});
   }catch(error){
    if(error.code==='API_NATIVE_UNVERIFIED')throw error;
    results.push({launchId:launch.launch_id,error:error.code??'NATIVE_LAUNCH_UNKNOWN',message:'Inspect the durable launch and native terminal before taking any recovery action. No start was retried.'});
   }
  }
 }
 return results;
}
