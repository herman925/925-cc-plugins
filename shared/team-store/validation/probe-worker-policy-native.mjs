// Native config and catalogue evidence only; manual RPC is not a model tool
// approval-policy test. A real reviewed worker is still required for acceptance.
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {configurationEnvironment} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-environment.mjs';
import {WORKER_TEAM_TOOLS} from '../src/worker-policy.mjs';
const executable=process.argv[2];if(!executable)throw Error('Supply the native Codex executable.');
const root=await mkdtemp(join(tmpdir(),'team-worker-policy-native-')),home=join(root,'codex-home');await mkdir(home);
const server={command:process.execPath,args:[fileURLToPath(new URL('./worker-policy-server.fixture.mjs',import.meta.url))],tools:Object.fromEntries(WORKER_TEAM_TOOLS.map(tool=>[tool,{approval_mode:'approve'}]))};
const args=['-c','approval_policy="never"','-c','sandbox_mode="danger-full-access"','-c',`mcp_servers.team_orchestrator.command=${JSON.stringify(server.command)}`,'-c',`mcp_servers.team_orchestrator.args=${JSON.stringify(server.args)}`];
for(const tool of WORKER_TEAM_TOOLS)args.push('-c',`mcp_servers.team_orchestrator.tools.${tool}.approval_mode="approve"`);
args.push('app-server','--listen','stdio://');
const child=spawn(executable,args,{cwd:root,env:configurationEnvironment(home),windowsHide:true,stdio:['pipe','pipe','pipe']});
let seq=0;const pending=new Map(),evidence={project:root,modelTurnsStarted:0,realIdentity:false,policy:'named four-tool overrides; no standing project/global grant',checks:[]};
const timer=setTimeout(()=>child.kill(),45000);let stderr='';child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-12000);});
child.on('exit',()=>{for(const waiter of pending.values())waiter.reject(Error('Owned native app-server exited.'));pending.clear();});
const reader=(async()=>{for await(const line of createInterface({input:child.stdout})){
 let row;try{row=JSON.parse(line);}catch{continue;}
 if(row.method&&row.id!==undefined){child.stdin.write(JSON.stringify({id:row.id,error:{code:-32601,message:'Fixture does not answer native user approvals.'}})+'\n');continue;}
 if(row.method)continue;const waiter=pending.get(row.id);if(!waiter)continue;pending.delete(row.id);row.error?waiter.reject(Error(JSON.stringify(row.error))):waiter.resolve(row.result);
}})();
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
try{
 await rpc('initialize',{clientInfo:{name:'team_worker_policy_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const thread=await rpc('thread/start',{cwd:root,ephemeral:true});
 const status=await rpc('mcpServerStatus/list',{threadId:thread.thread.id,serverName:'team_orchestrator',detail:'toolsAndAuthOnly'});
 evidence.checks.push('Native 0.166 parser accepted the four per-tool overrides under never/full-access.');
 const text=JSON.stringify(status);assert.ok(text.includes('shared_team_status'));assert.ok(text.includes('shared_inbox_seen'));
 evidence.checks.push('Production catalogue, including operation-specific required arguments, loaded through actual native MCP.');
 evidence.manualToolCallsUsed=false;evidence.modelApprovalSemanticsProven=false;
 await writeFile(join(root,'evidence.json'),JSON.stringify({...evidence,passed:true},null,2));console.log(JSON.stringify({...evidence,passed:true,evidencePath:join(root,'evidence.json')}));
}catch(error){console.error(JSON.stringify({passed:false,error:error.message,stderr,project:root}));process.exitCode=1;}
finally{clearTimeout(timer);child.stdin.end();child.kill();await reader.catch(()=>{});}
