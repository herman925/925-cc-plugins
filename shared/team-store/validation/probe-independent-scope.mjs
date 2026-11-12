import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,mkdir,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {connectOwnedProviderRpc} from '../src/provider-rpc.mjs';
import {configurationEnvironment} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-environment.mjs';
const executable=process.argv[2];if(!executable)throw Error('Supply the native Codex executable.');
const root=await mkdtemp(join(tmpdir(),'team-independent-scope-')),project=join(root,'project'),home=join(root,'home'),audit=join(root,'scope.jsonl');await mkdir(project);await mkdir(home);await writeFile(audit,'');let calls=0,fixtureFailure;
const functions=(tools,namespace)=>tools.flatMap(tool=>tool.type==='namespace'?functions(tool.tools??[],tool.name):tool.type==='function'?[{name:tool.name,namespace}]:[]);
const model=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!req.url.endsWith('/responses')){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));assert.ok(++calls<=2);
  res.writeHead(200,{'content-type':'text/event-stream'});const event=row=>res.write('data: '+JSON.stringify(row)+'\n\n'),id=`scope_response_${calls}`;let item;
  event({type:'response.created',response:{id,object:'response',status:'in_progress',output:[]}});
  if(calls===1){
   const tool=functions(body.tools??[]).find(row=>row.name.endsWith('scope_probe'));assert.ok(tool);
   item={id:'scope_call',type:'function_call',call_id:'scope_call',name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:'{}'};
   event({type:'response.output_item.added',output_index:0,item:{...item,arguments:''}});event({type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:'{}'});event({type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:'{}'});
  }else{item={id:'scope_done',type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic native scope inspection complete.',annotations:[]}]};event({type:'response.output_item.added',output_index:0,item:{...item,content:[]}});event({type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:item.content[0].text});}
  event({type:'response.output_item.done',output_index:0,item});event({type:'response.completed',response:{id,object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 }catch(error){fixtureFailure=error.message;res.destroy(error);}
});await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const args=['-c','model="gpt-5.1-codex"','-c','model_provider="scope_fixture"','-c','model_providers.scope_fixture.name="Disposable native scope fixture"','-c',`model_providers.scope_fixture.base_url="http://127.0.0.1:${model.address().port}/v1"`,'-c','model_providers.scope_fixture.wire_api="responses"','-c','model_providers.scope_fixture.requires_openai_auth=false','-c','model_providers.scope_fixture.supports_websockets=false','-c',`mcp_servers.scope_probe.command=${JSON.stringify(process.execPath)}`,'-c',`mcp_servers.scope_probe.args=${JSON.stringify([fileURLToPath(new URL('./native-scope-server.fixture.mjs',import.meta.url))])}`,'-c',`mcp_servers.scope_probe.env.TEAM_SCOPE_AUDIT=${JSON.stringify(audit)}`,'-c','mcp_servers.scope_probe.tools.scope_probe.approval_mode="approve"','app-server','--listen','stdio://'];
for(const [key,value] of Object.entries({TEAM_SCOPE_NATIVE_PROOF:'true',TEAM_SCOPE_SETUP:'true',TEAM_SCOPE_PROJECT_ROOT:project,TEAM_SCOPE_CODEX_EXECUTABLE:executable,TEAM_SCOPE_CODEX_HOME:home}))args.splice(args.length-3,0,'-c',`mcp_servers.scope_probe.env.${key}=${JSON.stringify(value)}`);
const env=configurationEnvironment(home);delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
const child=spawn(executable,args,{cwd:project,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let complete,timeoutReject,stderr='';
const completed=new Promise(resolve=>complete=resolve),timeout=new Promise((_,reject)=>timeoutReject=reject);timeout.catch(()=>{});
const rpc=connectOwnedProviderRpc({child,onNotification:row=>{if(row.method==='turn/completed')complete(row.params);},onRequest:()=>timeoutReject(Error('Unexpected native request; no human approval was answered.'))});
child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-4000));const timer=setTimeout(()=>timeoutReject(Error('Native scope fixture timed out.')),40000);let inspectorChild,inspector;let evidence={passed:false,root,realModel:false,humanReviewsAnswered:0};
try{
 await Promise.race([rpc.call('initialize',{clientInfo:{name:'independent_scope_fixture',version:'0.1.0'},capabilities:{experimentalApi:true}}),timeout]);rpc.notify('initialized');
 const started=await rpc.call('thread/start',{cwd:project});await rpc.call('mcpServerStatus/list',{threadId:started.thread.id,serverName:'scope_probe',detail:'toolsAndAuthOnly'});
 await rpc.call('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Run the read-only deterministic scope probe.'}]});const done=await Promise.race([completed,timeout]);assert.equal(done.turn.status,'completed');assert.equal(fixtureFailure,undefined);
 inspectorChild=spawn(executable,['app-server','--listen','stdio://'],{cwd:project,env,windowsHide:true,stdio:['pipe','pipe','pipe']});inspectorChild.stderr.resume();
 inspector=connectOwnedProviderRpc({child:inspectorChild,requestTimeoutMs:10000,onRequest:()=>timeoutReject(Error('Read-only inspector requested a human action.'))});
 await inspector.call('initialize',{clientInfo:{name:'read_only_scope_inspector',version:'0.1.0'},capabilities:{experimentalApi:true}});inspector.notify('initialized');
 const inspected=await inspector.call('thread/read',{threadId:started.thread.id,includeTurns:false});assert.equal(inspected.thread.id,started.thread.id);assert.equal(inspected.thread.cwd,project);
 const records=(await readFile(audit,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));assert.ok(records.some(row=>row.kind==='call'));assert.equal(records.filter(row=>row.kind==='initialize').length,1,'A metadata-only inspector must not recursively start MCP servers.');const native=records.find(row=>row.kind==='native-actor');assert.equal(native?.actor?.conversationId,started.thread.id);assert.equal(native?.actor?.projectRoot,project);assert.equal(native?.host,'independent');
 const status=records.find(row=>row.kind==='adapter-status')?.status;assert.equal(status?.host,'independent');assert.equal(status.info.storeExists,false);assert.equal(status.actions.automaticCodexLaunch,true);assert.deepEqual(records.find(row=>row.kind==='ordinary-guard')?.result,{});
 const applied=records.find(row=>row.kind==='setup-applied')?.summary;assert.equal(applied?.status,'complete');assert.equal(applied.globalConfigurationChanged,false);assert.equal(applied.teamStoreChanged,false);
 const installed=JSON.parse(await readFile(join(project,'.codex','925-to-installation.json'),'utf8'));assert.equal(installed.hostMode,'independent');assert.equal(installed.runtimeDigest,applied.runtimeDigest);await assert.rejects(access(join(project,'.team-orchestrator')));
 evidence={...evidence,passed:true,threadId:started.thread.id,inspector:{sameThread:true,projectRoot:inspected.thread.cwd,status:inspected.thread.status},installedRuntimeDigest:installed.runtimeDigest,records};
}catch(error){evidence={...evidence,error:error.message,fixtureFailure,stderr};process.exitCode=1;}
finally{clearTimeout(timer);inspector?.disconnect();inspectorChild?.stdin.end();inspectorChild?.kill();rpc.disconnect();child.stdin.end();child.kill();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
