import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=process.argv[2],home=join(root,'codex-home');await mkdir(root,{recursive:true});await mkdir(home);
const bin=process.argv[3];if(!bin)throw Error('Supply an absolute path to the installed Codex executable.');
const child=spawn(bin,['app-server','--listen','stdio://'],{cwd:root,env:{...process.env,CODEX_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map(),events=[];let seq=0,stderr='';child.stderr.on('data',x=>{stderr+=x.toString()});
const timeout=setTimeout(()=>{child.kill();},45000);
const lines=createInterface({input:child.stdout});const reader=(async()=>{for await(const line of lines){let r;try{r=JSON.parse(line)}catch{continue}if(r.id!==undefined&&pending.has(r.id)){const p=pending.get(r.id);pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result)}else if(r.method)events.push({method:r.method,params:r.params});}})();
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n')});
child.on('exit',()=>{for(const p of pending.values())p.reject(Error('Owned app-server exited'));pending.clear()});
const evidence={kind:'native_codex_mcp_identity_probe',modelTurnsStarted:0,root};
try{
 evidence.initialize=await rpc('initialize',{clientInfo:{name:'team_orchestrator_identity_probe',version:'0.0.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const thread=await rpc('thread/start',{cwd:root,ephemeral:true,config:{'features.hooks':false,mcp_servers:{team_identity_probe:{command:process.execPath,args:[fileURLToPath(new URL('./server.mjs',import.meta.url)),join(root,'received.jsonl')],startup_timeout_sec:10}}}});evidence.threadId=thread.thread.id;
 evidence.call=await rpc('mcpServer/tool/call',{threadId:thread.thread.id,server:'team_identity_probe',tool:'inspect_native_context',arguments:{}});
 evidence.received=(await readFile(join(root,'received.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
}catch(error){evidence.error=String(error)}finally{evidence.events=events.map(e=>e.method);await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await writeFile(join(root,'stderr.log'),stderr);child.stdin.end();setTimeout(()=>{if(child.exitCode===null)child.kill()},3000);clearTimeout(timeout);}
await reader;console.log(JSON.stringify(evidence));



