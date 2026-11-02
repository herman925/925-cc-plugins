// Identity component for the local Codex MCP adapter. Scope, executable and
// metadata are supplied by trusted setup/transport code, never tool arguments.
// Identity alone does not establish guard coverage or authorize team membership.
import {realpath,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {homedir} from 'node:os';
import {createOrcaHost} from './src/orca-host.mjs';
import {exact} from './src/api-domain.mjs';
import {refusal} from './src/errors.mjs';
import {inspectWindowsProcess,windowsFileOwners} from './src/windows-native.mjs';

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
 const locks=await realpath(join(codexHome||env.CODEX_HOME||join(homedir(),'.codex'),'thread-writer-locks'));
 const ownsThread=async threadId=>{
  const path=join(locks,`${threadId}.lock`),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink())deny('The native Codex thread ownership record is not a regular file.');
  const owners=await (dependencies.threadOwners??windowsFileOwners)(path);
  if(!Array.isArray(owners)||owners.length!==1||owners[0].pid!==parentPid||owners[0].createdAt!==birth)deny('The native Codex parent does not uniquely own this thread writer lock.');
 };
 const host=await createOrcaHost({orcaCommand,env},dependencies);
 // Capture immutable setup facts. Mutating the caller's original object cannot
 // move a running connection to another project or transport.
 const reference=Object.freeze({projectRoot:root,terminalHandle:scope.terminalHandle,contextId:scope.contextId});
 return Object.freeze({
  hostKind:'orca',runtimeId:host.runtimeId,
  async verifyCaller(metadata) {
   const threadId=metadata?.threadId;
   if(typeof threadId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(threadId)||typeof metadata!=='object'||!Object.hasOwn(metadata,'threadId'))deny('Native Codex transport did not supply a thread identity.');
   if(await identity()!==birth)deny('The native Codex parent incarnation changed.');
   await ownsThread(threadId);
   const current=await host.verifyTerminal({...reference,conversationId:threadId},'codex');
   await ownsThread(threadId);
   if(await identity()!==birth)deny('The native Codex parent changed before verification completed.');
   return current.actor;
  },
 });
}
