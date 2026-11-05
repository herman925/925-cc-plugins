// Zero-inference acceptance of the actual Codex MCP transport. This deliberately
// creates an ephemeral thread without a native writer lock and proves that its
// metadata alone cannot borrow a managed identity. No shared store is opened or changed.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {configurationEnvironment} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-environment.mjs';
const [root,executable,project]=process.argv.slice(2);
if(![root,executable,project].every(v=>v&&isAbsolute(v)))throw Error('Supply absolute new evidence directory, native Codex executable and project paths.');
await mkdir(root,{recursive:false});const home=join(root,'codex-home');await mkdir(home);
const child=spawn(executable,['app-server','--listen','stdio://'],{cwd:root,env:configurationEnvironment(home),windowsHide:true,stdio:['pipe','pipe','pipe']});
let serial=0,stderr='';const pending=new Map(),events=[];child.stderr.setEncoding('utf8');child.stderr.on('data',x=>stderr+=x);
const timer=setTimeout(()=>child.kill(),60000);
const reader=(async()=>{for await(const line of createInterface({input:child.stdout})){
 let row;try{row=JSON.parse(line);}catch{continue;}
 if(pending.has(row.id)){const p=pending.get(row.id);pending.delete(row.id);row.error?p.reject(Error(JSON.stringify(row.error))):p.resolve(row.result);}else if(row.method)events.push(row.method);
}})();
child.on('exit',()=>{for(const p of pending.values())p.reject(Error('Owned native app-server exited.'));pending.clear();});
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const evidence={modelTurnsStarted:0,checks:[],events};
try{
 await rpc('initialize',{clientInfo:{name:'team_native_adapter_acceptance',version:'0.5.55'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const nativeThread=await rpc('thread/start',{cwd:root,ephemeral:true,config:{'features.hooks':false,mcp_servers:{team_orchestrator:{command:process.execPath,args:[fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url))],env:{TEAM_PROJECT_ROOT:project,TEAM_TERMINAL_HANDLE:process.env.ORCA_TERMINAL_HANDLE,TEAM_CONTEXT_ID:process.env.ORCA_WORKTREE_ID,TEAM_CODEX_EXECUTABLE:executable,TEAM_CODEX_HOME:home,TEAM_ORCA_COMMAND:process.env.ORCA_CLI_COMMAND||'orca',ORCA_USER_DATA_PATH:process.env.ORCA_USER_DATA_PATH},startup_timeout_sec:30}}}});
 const call=(tool,args)=>rpc('mcpServer/tool/call',{threadId:nativeThread.thread.id,server:'team_orchestrator',tool,arguments:args});
 const guard=await call('team_guard',{tool:'apply_patch',input:{command:'*** Add File: should-not-exist.txt\n+blocked'}});
 const guardValue=JSON.parse(guard.content[0].text);assert.equal(guardValue.hookSpecificOutput.permissionDecision,'deny');assert.equal(guard.isError??false,false);evidence.checks.push('native MCP callback returns a supported denial for an ephemeral thread without ownership proof');
 const result=await call('shared_team',{operationId:'outside-orca',command:{type:'inspectCaller'}}),value=JSON.parse(result.content[0].text);
 assert.equal(result.isError,true);assert.equal(value.ok,false);assert.equal(value.error.code,'API_NATIVE_UNVERIFIED');evidence.checks.push('native API call refuses an unowned thread before opening the store');
 evidence.refusal=value.error;evidence.guard=guardValue;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);process.exitCode=1;}
finally{
 child.stdin.end();const cleanup=setTimeout(()=>{if(child.exitCode===null)child.kill();},3000);await reader;clearTimeout(cleanup);clearTimeout(timer);
 await writeFile(join(root,'native-evidence.json'),JSON.stringify(evidence,null,2));await writeFile(join(root,'stderr.log'),stderr);
}
console.log(JSON.stringify(evidence));
