import {realpath} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createOrcaHost} from './runtime/src/orca-host.mjs';
import {createCodexThreadInspector} from './runtime/src/codex-inspector.mjs';
import {verifyCodexThreadOwner,independentContext} from './runtime/src/codex-independent-native.mjs';
import {discoverCodexExecutable} from './codex-executable.mjs';
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function hostError(error,stage){
 if(['EACCES','EPERM'].includes(error?.code)||/(?:runtime_access_denied|\bEACCES\b|\bEPERM\b|access is denied)/i.test(String(error?.stderr??'')))fail('SETUP_HOST_ACCESS_DENIED',`Local Orca access was denied during ${stage}. Check the sandbox's access to the current Orca profile and local connection. No configuration was changed.`);
 if(error?.code==='ENOENT')fail('SETUP_HOST_UNAVAILABLE',`The Orca executable or current local profile could not be found during ${stage}. No configuration was changed.`);
 if(error?.code==='API_NATIVE_UNVERIFIED')fail('SETUP_HOST_UNVERIFIED',`Orca refused ${stage}: ${error.message} No configuration was changed.`);
 if(typeof error?.code==='string'&&error.code.startsWith('SETUP_'))throw error;
 if(Number.isInteger(error?.code))fail('SETUP_HOST_COMMAND_FAILED',`The Orca CLI failed during ${stage} (exit ${error.code}). Check its availability and sandbox access. No configuration was changed.`);
 fail('SETUP_HOST_UNVERIFIED',`The local Orca connection could not complete ${stage}. No configuration was changed.`);
}
export function setupHostMode({env=process.env,hostMode}={}){
 if(hostMode!==undefined&&!['orca','independent'].includes(hostMode))fail('SETUP_INPUT','Host must be orca or independent.');
 return hostMode??(env.ORCA_TERMINAL_HANDLE||env.ORCA_WORKTREE_ID?'orca':'independent');
}
async function independentRoot({env=process.env,codexExecutable,projectRoot,createInspector=createCodexThreadInspector,discoverExecutable=discoverCodexExecutable,threadOwners,inspectProcess}={}){
 const threadId=env.CODEX_THREAD_ID||env.CODEX_SESSION_ID;
 if(!threadId)fail('SETUP_HOST_UNSUPPORTED','Run setup inside the intended native Codex conversation so its current thread can be verified.');
 let inspector;
 try{
  const executable=await discoverExecutable({executable:codexExecutable||env.TEAM_CODEX_EXECUTABLE,env}),home=await realpath(env.CODEX_HOME||join(homedir(),'.codex'));
  const dependencies={...(threadOwners?{threadOwners}:{}),...(inspectProcess?{inspectProcess}:{})};
  const owner=await verifyCodexThreadOwner({threadId,codexExecutable:executable,codexHome:home},dependencies);
  inspector=createInspector({codexExecutable:executable,codexHome:home,projectRoot:projectRoot||process.cwd(),env});const current=await inspector.inspect(threadId),root=await realpath(current.projectRoot);
  if(current.threadId!==threadId||projectRoot&&root!==await realpath(projectRoot))fail('SETUP_HOST_SCOPE','The native Codex thread belongs to another project. No configuration was changed.');
  await verifyCodexThreadOwner({threadId,codexExecutable:executable,codexHome:home,expectedPid:owner.pid,expectedBirth:owner.createdAt},dependencies);
  return root;
 }catch(error){if(error.code?.startsWith('SETUP_'))throw error;fail('SETUP_HOST_UNVERIFIED','Independent Codex process/thread/project verification failed. No configuration was changed.');}
 finally{await inspector?.close();}
}
export async function verifySetupHost(project,options={}){
 const {env=process.env,createHost=createOrcaHost}=options;
 if(setupHostMode(options)==='independent'){const root=await independentRoot({...options,projectRoot:project});return {hostMode:'independent',contextId:independentContext(root)};}
 const conversationId=env.CODEX_THREAD_ID||env.CODEX_SESSION_ID;
 if(!env.ORCA_TERMINAL_HANDLE||!env.ORCA_WORKTREE_ID||!conversationId)fail('SETUP_HOST_UNSUPPORTED','Run setup inside the intended Orca-hosted Codex session. Its native scope could not be discovered.');
 try{const host=await createHost({env});await host.verifyTerminal({projectRoot:project,conversationId,terminalHandle:env.ORCA_TERMINAL_HANDLE,contextId:env.ORCA_WORKTREE_ID},'codex');return {hostMode:'orca',contextId:env.ORCA_WORKTREE_ID};}
 catch(error){hostError(error,'conversation/project verification');}
}
export async function nativeProjectRoot(options={}){
 const {env=process.env,createHost=createOrcaHost}=options;
 if(setupHostMode(options)==='independent')return independentRoot(options);
 if(!env.ORCA_TERMINAL_HANDLE||!env.ORCA_WORKTREE_ID)fail('SETUP_HOST_UNSUPPORTED','Setup requires the intended Orca-hosted Codex session.');
 try{
  const host=await createHost({env}),{terminal}=await host.rpc('terminal.show',{terminal:env.ORCA_TERMINAL_HANDLE});
  if(terminal?.handle!==env.ORCA_TERMINAL_HANDLE||terminal.connected!==true||terminal.executionHostId!=='local'||terminal.worktreeId!==env.ORCA_WORKTREE_ID)fail('SETUP_HOST_SCOPE','The current local Orca terminal/project scope changed. No configuration was changed.');
  return await realpath(terminal.worktreePath);
 }catch(error){hostError(error,'project discovery');}
}
