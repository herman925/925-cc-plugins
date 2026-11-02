import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const executable=process.argv[2];if(!executable)throw Error('Supply native Codex executable.');
const root=await mkdtemp(join(tmpdir(),'925-to-native-management-')),home=join(root,'codex-home');await mkdir(home);
const child=spawn(executable,['app-server','--listen','stdio://'],{cwd:root,env:{...process.env,CODEX_HOME:home},windowsHide:true,stdio:['pipe','pipe','pipe']});
let seq=0,threadId,stderr='';const pending=new Map(),evidence={project:root,modelTurnsStarted:0,identity:'substituted TEMP fixture; real Orca identity is not asserted',confirmationSource:'test harness response through native Codex form transport',reviews:[],checks:[]};
child.stderr.setEncoding('utf8');child.stderr.on('data',x=>stderr+=x);
const timer=setTimeout(()=>child.kill(),60000);
const reader=(async()=>{for await(const line of createInterface({input:child.stdout})){
 let row;try{row=JSON.parse(line);}catch{continue;}
 if(row.method==='mcpServer/elicitation/request'){
  assert.equal(row.params.threadId,threadId);assert.equal(row.params.mode,'form');const menu=Boolean(row.params.requestedSchema.properties.action);if(!menu){assert.equal(JSON.parse(row.params.message.slice(row.params.message.indexOf('{'))).project,root);assert.equal(row.params.requestedSchema.properties.confirm.type,'boolean');}evidence.reviews.push({mode:row.params.mode,kind:menu?'draft-menu':'effect-review',projectMatched:!menu});
  child.stdin.write(JSON.stringify({id:row.id,result:{action:'accept',content:menu?{action:'create-team'}:{confirm:true}}})+'\n');continue;
 }
 if(row.method)continue;
 if(pending.has(row.id)){const p=pending.get(row.id);pending.delete(row.id);row.error?p.reject(Error(JSON.stringify(row.error))):p.resolve(row.result);}
}})().catch(error=>{for(const waiter of pending.values())waiter.reject(error);pending.clear();child.kill();});
child.on('exit',()=>{for(const p of pending.values())p.reject(Error('Owned app-server exited.'));pending.clear();});
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
try{
 await rpc('initialize',{clientInfo:{name:'925_to_native_management_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const thread=await rpc('thread/start',{cwd:root,ephemeral:true,config:{'features.hooks':false,mcp_servers:{team_orchestrator:{command:process.execPath,args:[fileURLToPath(new URL('./codex-management-server.fixture.mjs',import.meta.url)),root],startup_timeout_sec:20}}}});threadId=thread.thread.id;
 const call=async(tool,args)=>{const result=await rpc('mcpServer/tool/call',{threadId,server:'team_orchestrator',tool,arguments:args});const value=JSON.parse(result.content[0].text);assert.notEqual(result.isError,true,JSON.stringify(value));return value;};
 const menu=await call('shared_team_interview',{step:'action'});assert.equal(menu.draftOnly,true);assert.equal(menu.response.content.action,'create-team');evidence.checks.push('native action menu returned draft data without granting permission');
 const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:8,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
 const command={type:'createFreshTeam',teamId:'native-team',name:'Native Codex fixture',functionText:'Transport acceptance',settings,members:[{memberId:'native-head',name:'Native head',bossMemberId:null,role:'Lead',officialText:'Delegate and review.',cli:'codex'}],expectedControllerGeneration:1};
 const created=await call('shared_team_manage',{operationId:'native-create',command});assert.equal(created.result.configVersion,3);evidence.checks.push('native Codex form transport created a fixture team with no Claude session');
 const edited=await call('shared_team_manage',{operationId:'native-edit',command:{type:'editTeam',teamId:'native-team',expectedControllerGeneration:1,expectedConfigVersion:3,changes:[{type:'updateTeam',name:'Native edited fixture',functionText:'Edit verified'}]}});assert.equal(edited.result.configVersion,4);
 const current=await call('shared_team',{operationId:'native-inspect',command:{type:'inspectTeam',teamId:'native-team'}});assert.equal(current.result.team.name,'Native edited fixture');evidence.checks.push('native reviewed edit and shared readback agreed');
 assert.deepEqual(await call('shared_team_manage',{operationId:'native-create',command,reconcile:true}),created);assert.equal(evidence.reviews.filter(r=>r.kind==='effect-review').length,2);evidence.checks.push('receipt recovery did not issue another confirmation or repeat creation');evidence.passed=true;
}catch(e){evidence.passed=false;evidence.error=String(e);process.exitCode=1;}
finally{child.stdin.end();const stop=setTimeout(()=>{if(child.exitCode===null)child.kill();},3000);await reader;clearTimeout(stop);clearTimeout(timer);await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));await writeFile(join(root,'stderr.log'),stderr);}
console.log(JSON.stringify(evidence));
