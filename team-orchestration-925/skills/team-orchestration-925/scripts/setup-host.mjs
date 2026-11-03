import {realpath} from 'node:fs/promises';
import {createOrcaHost} from './runtime/src/orca-host.mjs';
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
function hostError(error,stage){
 if(['EACCES','EPERM'].includes(error?.code)||/(?:runtime_access_denied|\bEACCES\b|\bEPERM\b|access is denied)/i.test(String(error?.stderr??'')))fail('SETUP_HOST_ACCESS_DENIED',`Local Orca access was denied during ${stage}. Check the sandbox's access to the current Orca profile and local connection. No configuration was changed.`);
 if(error?.code==='ENOENT')fail('SETUP_HOST_UNAVAILABLE',`The Orca executable or current local profile could not be found during ${stage}. No configuration was changed.`);
 if(error?.code==='API_NATIVE_UNVERIFIED')fail('SETUP_HOST_UNVERIFIED',`Orca refused ${stage}: ${error.message} No configuration was changed.`);
 if(typeof error?.code==='string'&&error.code.startsWith('SETUP_'))throw error;
 if(Number.isInteger(error?.code))fail('SETUP_HOST_COMMAND_FAILED',`The Orca CLI failed during ${stage} (exit ${error.code}). Check its availability and sandbox access. No configuration was changed.`);
 fail('SETUP_HOST_UNVERIFIED',`The local Orca connection could not complete ${stage}. No configuration was changed.`);
}
export async function verifySetupHost(project,{env=process.env,createHost=createOrcaHost}={}){
 const conversationId=env.CODEX_THREAD_ID||env.CODEX_SESSION_ID;
 if(!env.ORCA_TERMINAL_HANDLE||!env.ORCA_WORKTREE_ID||!conversationId)fail('SETUP_HOST_UNSUPPORTED','Run setup inside the intended Orca-hosted Codex session. Its native scope could not be discovered.');
 try{const host=await createHost({env});await host.verifyTerminal({projectRoot:project,conversationId,terminalHandle:env.ORCA_TERMINAL_HANDLE,contextId:env.ORCA_WORKTREE_ID},'codex');}
 catch(error){hostError(error,'conversation/project verification');}
}
export async function nativeProjectRoot({env=process.env,createHost=createOrcaHost}={}){
 if(!env.ORCA_TERMINAL_HANDLE||!env.ORCA_WORKTREE_ID)fail('SETUP_HOST_UNSUPPORTED','Setup requires the intended Orca-hosted Codex session.');
 try{
  const host=await createHost({env}),{terminal}=await host.rpc('terminal.show',{terminal:env.ORCA_TERMINAL_HANDLE});
  if(terminal?.handle!==env.ORCA_TERMINAL_HANDLE||terminal.connected!==true||terminal.executionHostId!=='local'||terminal.worktreeId!==env.ORCA_WORKTREE_ID)fail('SETUP_HOST_SCOPE','The current local Orca terminal/project scope changed. No configuration was changed.');
  return await realpath(terminal.worktreePath);
 }catch(error){hostError(error,'project discovery');}
}
