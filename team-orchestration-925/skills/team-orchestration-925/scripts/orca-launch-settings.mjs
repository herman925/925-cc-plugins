// Setup-only integration with Orca's typed launch preferences. Never exposed as
// an MCP tool, and never edits Orca's persistence or any team records directly.
import {readFile,realpath,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {randomUUID} from 'node:crypto';
import {createOrcaHost} from './runtime/src/orca-host.mjs';
const fail=message=>{throw Object.assign(Error(message),{code:'SETUP_ORCA_LAUNCH_REFUSED'});};
export const codexMcpLaunchArguments="--sandbox danger-full-access -c 'approval_policy={granular={sandbox_approval=false,rules=false,mcp_elicitations=true,request_permissions=false,skill_approval=false}}' -c approvals_reviewer=user";
export function prepareOrcaMcpLaunch(result){
 const settings=result?.settings,permission=settings?.agentPermission;
 const mode=permission?.overrides?.codex??permission?.default;
 const before=permission?.userArgs?.codex??settings?.agentChoices?.userArgs?.codex;
 if(mode!=='full-access'||typeof before!=='string')fail('This setup supports the verified Full access launch profile only; other execution profiles are left unchanged.');
 if(before!==''&&before!==codexMcpLaunchArguments)fail('Custom Codex arguments need review before changing MCP confirmation policy; no arguments were replaced.');
 if(before===''&&settings.agentDefaultArgs?.codex!=='--dangerously-bypass-approvals-and-sandbox')fail('The effective Codex launch recipe changed; preview its execution permissions before continuing.');
 return {before,after:codexMcpLaunchArguments,summary:{status:before===codexMcpLaunchArguments?'already-configured':'launch-setup-ready',orcaLaunchConfigurationChanged:before!==codexMcpLaunchArguments,executionPermissionsChanged:false,executionProfile:'danger-full-access',launchMcpConfirmationsEnabled:true,otherPromptCategoriesEnabled:false,teamStoreChanged:false,globalCodexConfigurationChanged:false,activeSessionPolicy:'not-inspected',requiresEffectivePolicyVerification:true}};
}
export async function applyOrcaMcpLaunch(plan,{client,backupRoot,projectRoot}){
 const current=prepareOrcaMcpLaunch(await client.read());
 if(current.before!==plan.before)fail('Codex launch preferences changed after preview; preview again.');
 if(!plan.summary.orcaLaunchConfigurationChanged)return plan.summary;
 await mkdir(backupRoot,{recursive:true,mode:0o700});
 const backupPath=join(backupRoot,'orca-launch-'+randomUUID()+'.json');
 await writeFile(backupPath,JSON.stringify({projectRoot,before:plan.before,after:plan.after,phase:'prepared'},null,2)+'\n',{flag:'wx',mode:0o600});
 await client.setCodexArguments(plan.after);
 const installed=prepareOrcaMcpLaunch(await client.read());
 if(installed.before!==plan.after)fail('Orca did not retain the reviewed Codex launch arguments. The backup was preserved.');
 await writeFile(backupPath,JSON.stringify({projectRoot,before:plan.before,after:plan.after,phase:'installed'},null,2)+'\n',{mode:0o600});
 return {...plan.summary,status:'complete',backupRecorded:true};
}
export async function openOrcaLaunchSettings({env=process.env,createHost=createOrcaHost,read=readFile,connect=createConnection}={}){
 const host=await createHost({env}),status=await host.cli(['status']);
 if(!host.capabilities.includes('settings.agent-launch.v1'))fail('This Orca host does not support typed launch preferences.');
 const profile=await realpath(env.ORCA_USER_DATA_PATH),path=join(profile,'orca-runtime.json');
 const readMetadata=async()=>JSON.parse(await read(path,'utf8'));
 const metadata=await readMetadata();
 if(metadata.pid!==status.app?.pid||metadata.runtimeId!==host.runtimeId||!metadata.authToken)fail('Orca changed before launch preferences could be read.');
 const transport=(metadata.transports??[metadata.transport]).find(t=>t?.kind==='named-pipe'&&t.endpoint?.startsWith('\\\\.\\pipe\\'));
 if(!transport)fail('Launch preference setup requires the verified local Windows Orca pipe.');
 const unchanged=async()=>{const current=await readMetadata();if(current.pid!==metadata.pid||current.runtimeId!==metadata.runtimeId||current.authToken!==metadata.authToken)fail('Orca changed while launch preferences were being checked.');};
 const request=async(method,params)=>{
  await unchanged();
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),socket=connect(transport.endpoint);let buffer='',done=false,validating=false;
   const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
   const timer=setTimeout(()=>finish(Object.assign(Error('Orca launch preference request timed out; inspect before retrying a change.'),{code:'SETUP_ORCA_LAUNCH_UNKNOWN'})),15000);
   socket.setEncoding('utf8');socket.on('error',()=>finish(Object.assign(Error('The local Orca launch preference connection failed.'),{code:'SETUP_ORCA_LAUNCH_UNKNOWN'})));
   socket.on('close',()=>{if(!done&&!validating)finish(Object.assign(Error('Orca closed before a launch preference receipt arrived.'),{code:'SETUP_ORCA_LAUNCH_UNKNOWN'}));});
   socket.on('connect',()=>socket.write(JSON.stringify({id,authToken:metadata.authToken,method,params})+'\n'));
   socket.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>2*1024*1024){finish(Error('Orca launch preference response is oversized.'));return;}
    for(let cut;(cut=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(!line.trim())continue;
     let value;try{value=JSON.parse(line);}catch{finish(Error('Malformed Orca launch preference response.'));return;}
     if(value._keepalive===true)continue;
     if(value.id!==id||value._meta?.runtimeId!==metadata.runtimeId||value.ok!==true){finish(Object.assign(Error('Orca refused '+method+': '+String(value.error?.message??'The native request was not accepted.').slice(0,600)),{code:value.error?.code??'SETUP_ORCA_LAUNCH_REFUSED'}));return;}
     validating=true;unchanged().then(()=>finish(null,value.result)).catch(error=>finish(error));return;
    }
   });
  });
 };
 return Object.freeze({read:async()=>request('settings.getAgentLaunch',{}),
  setCodexArguments:async value=>{if(typeof value!=='string'||!value||value.length>8192||value.includes('\0'))fail('Invalid Codex launch arguments.');return request('settings.mutateAgentLaunch',{type:'user-arguments',agent:'codex',value});},
  resumeCodex:async conversationId=>{
   if(typeof conversationId!=='string'||!(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/).test(conversationId)||!env.ORCA_WORKTREE_ID)fail('Resume needs the exact conversation and verified current Orca workspace.');
   const plan=prepareOrcaMcpLaunch(await request('settings.getAgentLaunch',{}));
   if(plan.summary.orcaLaunchConfigurationChanged)fail('Apply the previewed launch policy before resuming.');
   const result=await request('terminal.ensureAgentSession',{kind:'explicit',resumeOrigin:'saved',worktree:'id:'+env.ORCA_WORKTREE_ID,agent:'codex',providerSession:{key:'session_id',id:conversationId},agentArgs:plan.after,presentation:'focused'});
   const terminal=result.terminal;
   return {conversationId,disposition:result.disposition,terminal:terminal?{handle:terminal.handle,processId:terminal.processId,worktreeId:terminal.worktreeId,incarnationId:terminal.incarnationId,savedResumeDecision:terminal.savedResumeDecision?.verdict,surface:terminal.surface}:null,requiresEffectivePolicyVerification:true};
  },
 });
}
