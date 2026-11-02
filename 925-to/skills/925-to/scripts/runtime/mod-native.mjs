import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,realpath,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {exact} from './src/api-domain.mjs';
import {createOrcaHost} from './src/orca-host.mjs';
import {refusal} from './src/errors.mjs';

const execute=promisify(execFile);
const deny=message=>{throw refusal('API_NATIVE_UNVERIFIED',message);};
// Windows Claude registry procStart is the process creation FILETIME, preserved
// as decimal text. A live PID alone can refer to a replacement process. Other
// hosts keep the explicit native-provider path until their registry creation
// fingerprint format has been verified; never guess a portable conversion.
async function processStart(pid) {
 if(process.platform!=='win32')return null;
 const {stdout}=await execute(join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
  ['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToFileTimeUtc().ToString()`],
  {timeout:5000,maxBuffer:8192,windowsHide:true});
 const value=stdout.trim();return /^\d+$/.test(value)?value:null;
}
export async function createModNative({orcaCommand=process.env.ORCA_CLI_COMMAND||'orca',env=process.env}={},dependencies={}) {
 const host=await createOrcaHost({orcaCommand,env},dependencies);
 const {cli,rpc}=host;
 const verify=async (input,caller=false)=>{
  const native=await host.verifyTerminal(input,'claude',{allowMissingClaudeSession:caller});
  const root=native.actor.projectRoot;
  const providerId=native.hasProviderSession?input.conversationId:undefined;
  const config=env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude');
  const registry=join(config,'sessions');let records=[];
  for(const name of await readdir(registry)){
   if(!/^\d+\.json$/.test(name))continue;
   try{const row=JSON.parse(await readFile(join(registry,name),'utf8'));if(row.sessionId===input.conversationId && Number.isSafeInteger(row.pid) && row.pid>0 && await realpath(row.cwd)===root){process.kill(row.pid,0);records.push(row);}}catch{}
  }
  if(records.length!==1)deny('The exact live local Claude conversation could not be verified.');
  if(caller && (env.ORCA_TERMINAL_HANDLE!==input.terminalHandle || env.ORCA_WORKTREE_ID!==input.contextId || records[0].pid!==process.ppid))deny('The private bridge is not a direct child of the verified Claude caller.');
  if(providerId===undefined){
   // Idle Orca projections omit providerSession. Only the actual hook child can
   // substitute its own OS parent + registry creation fingerprint. A requested
   // other target, copied ID or terminal title cannot use this route. Exact
   // self-binding below repeats this same caller verification.
   let birth;try{birth=await (dependencies.processStart??processStart)(process.ppid);}catch{}
   if(typeof records[0].procStart!=='string'||!/^\d+$/.test(records[0].procStart)||!birth||birth!==records[0].procStart)deny('The idle Claude caller process creation fingerprint is unverified.');
  }
  return native.actor;
 };
 const referenceKeys=['projectRoot','conversationId','terminalHandle','contextId'];
 const verifyBinding=async(input,callerReference)=>{
  exact(input,referenceKeys);exact(callerReference,referenceKeys);
  if(referenceKeys.some(key=>!Object.hasOwn(input,key)||!Object.hasOwn(callerReference,key)||typeof input[key]!=='string'||!input[key]||typeof callerReference[key]!=='string'||!callerReference[key]))deny('Binding references require four nonempty own string fields.');
  // Only the privately supplied exact caller reference may use caller proof.
  // Reverify now; picker display state never becomes binding authority.
  const current=await verify(callerReference,true);
  if(referenceKeys.every(key=>input[key]===callerReference[key]))return current;
  try{return await verify(input);}catch(error){
   // The API still checks the configured member CLI. The host must explicitly
   // prove a Codex conversation; a failed Claude proof is never an assumed match.
   try{return (await host.verifyTerminal(input,'codex')).actor;}catch{throw error;}
  }
 };
 const listTargets=async input=>{
  const caller=await verify(input,true);
  const response=await rpc('session.tabs.list',{worktree:caller.contextId.startsWith('folder:')?caller.contextId:`id:${caller.contextId}`});
  const sessions=[{reference:Object.fromEntries(referenceKeys.map(key=>[key,input[key]])),provider:'claude',label:'This verified conversation'}];
  const seen=new Set([JSON.stringify(referenceKeys.map(key=>input[key]))]);
  for(const tab of response.tabs??[]) {
   const status=tab.agentStatus;
   if(tab.type!=='terminal'||!['claude','codex'].includes(status?.agentType)||typeof status.providerSession?.id!=='string'||typeof status.terminalHandle!=='string')continue;
   const reference={projectRoot:input.projectRoot,conversationId:status.providerSession.id,terminalHandle:status.terminalHandle,contextId:caller.contextId};
   const key=JSON.stringify(referenceKeys.map(field=>reference[field]));if(seen.has(key))continue;
   try{if(status.agentType==='claude')await verify(reference);else await host.verifyTerminal(reference,'codex');sessions.push({reference,provider:status.agentType,label:typeof tab.title==='string'?tab.title:status.terminalHandle});seen.add(key);}catch{/* An unverifiable candidate is not a binding choice. */}
  }
  return sessions;
 };
 return Object.freeze({createTerminal:async({context,title,command})=>cli(['terminal','create','--worktree',context,'--title',title,'--command',command]),verify:input=>verify(input),verifyCaller:input=>verify(input,true),verifyBinding,listTargets});
}
