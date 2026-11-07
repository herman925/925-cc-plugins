// Exercise real native tool-policy routing with a deterministic local model
// fixture. This is stronger than parser/manual-RPC evidence, but is NOT a real
// model worker, native identity, delivered human review or lifecycle acceptance.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {configurationEnvironment} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-environment.mjs';
import {WORKER_TEAM_TOOLS} from '../src/worker-policy.mjs';
const executable=process.argv[2];if(!executable)throw Error('Supply the native Codex executable.');
const root=await mkdtemp(join(tmpdir(),'team-worker-approval-native-'));
const requested=[...WORKER_TEAM_TOOLS,'shared_team_manage'];
const argumentsFor=name=>name==='shared_team'?{operationId:'fixture-inspection',command:{type:'inspectCaller'}}:name==='shared_inbox_seen'?{readReceiptId:'fixture-receipt'}:name==='shared_team_manage'?{operationId:'fixture-management',command:{type:'approveController'}}:{};
function functions(tools,namespace=null){
 return tools.flatMap(tool=>tool.type==='namespace'?functions(tool.tools??[],tool.name):tool.type==='function'?[{name:tool.name,namespace}]:[]);
}
async function run(mode){
 const home=join(root,mode),audit=join(root,mode+'-calls.jsonl');await mkdir(home);await writeFile(audit,'');
 const result={mode,model:'local deterministic fixture',modelRequests:0,serverRequests:[],outputCodes:[],published:[],notifications:[]};let modelFailure;
 const server=createServer(async(req,res)=>{
  try{
   if(req.method!=='POST'||!req.url.endsWith('/responses')){res.writeHead(404);res.end();return;}
   const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>4*1024*1024)throw Error('Fixture request exceeds bound.');chunks.push(chunk);}
   const request=JSON.parse(Buffer.concat(chunks));if(++result.modelRequests>3)throw Error('Unexpected model fixture loop.');
   result.outputCodes.push(...(JSON.stringify((request.input??[]).filter(v=>v.type==='function_call_output')).match(/API_[A-Z_]+/g)??[]));
   res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
   const output=[],id='resp_fixture_'+result.modelRequests;
   const event=value=>res.write('data: '+JSON.stringify(value)+'\n\n');
   event({type:'response.created',response:{id,object:'response',status:'in_progress',output:[]}});
   if(result.modelRequests===1){
    const available=functions(request.tools??[]);result.published=available.map(v=>({name:v.name,namespace:v.namespace}));
    for(const name of requested){
     const tool=available.find(v=>v.name===name||v.name.endsWith('__'+name));assert.ok(tool,'Native model catalogue missing '+name);
     const item={type:'function_call',id:'fc_'+output.length,call_id:'call_'+output.length,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(argumentsFor(name))};
     event({type:'response.output_item.added',output_index:output.length,item:{...item,arguments:''}});
     event({type:'response.function_call_arguments.delta',item_id:item.id,output_index:output.length,delta:item.arguments});
     event({type:'response.function_call_arguments.done',item_id:item.id,output_index:output.length,arguments:item.arguments});
     event({type:'response.output_item.done',output_index:output.length,item});output.push(item);
    }
   }else{
    const item={id:'msg_fixture',type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic policy probe complete.',annotations:[]}]};
    event({type:'response.output_item.added',output_index:0,item:{...item,content:[]}});
    event({type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:item.content[0].text});
    event({type:'response.output_item.done',output_index:0,item});output.push(item);
   }
   event({type:'response.completed',response:{id,object:'response',status:'completed',output,usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
  }catch(error){modelFailure=error.message;res.destroy(error);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const policy=mode==='never'?'approval_policy="never"':'approval_policy={granular={sandbox_approval=false,rules=false,mcp_elicitations=true,skill_approval=false}}';
 const args=['-c',policy,'-c','sandbox_mode="danger-full-access"','-c','model="gpt-5.1-codex"','-c','model_provider="policy_fixture"','-c','model_providers.policy_fixture.name="Disposable policy fixture"','-c',`model_providers.policy_fixture.base_url="http://127.0.0.1:${server.address().port}/v1"`,'-c','model_providers.policy_fixture.wire_api="responses"','-c','model_providers.policy_fixture.requires_openai_auth=false','-c','model_providers.policy_fixture.supports_websockets=false','-c','mcp_servers.team_orchestrator.default_tools_approval_mode="prompt"','-c',`mcp_servers.team_orchestrator.command=${JSON.stringify(process.execPath)}`,'-c',`mcp_servers.team_orchestrator.args=${JSON.stringify([fileURLToPath(new URL('./worker-approval-server.fixture.mjs',import.meta.url))])}`,'-c',`mcp_servers.team_orchestrator.env.TEAM_POLICY_AUDIT=${JSON.stringify(audit)}`];
 if(mode!=='granular-no-overrides')for(const tool of WORKER_TEAM_TOOLS)args.push('-c',`mcp_servers.team_orchestrator.tools.${tool}.approval_mode="approve"`);
 args.push('app-server','--listen','stdio://');
 const env=configurationEnvironment(home);delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
 const child=spawn(executable,args,{cwd:home,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let sequence=0,stderr='',activeThread,activeTurn,interrupted=false;const pending=new Map();let completedResolve,completedReject;
 const completed=new Promise((resolve,reject)=>{completedResolve=resolve;completedReject=reject;});completed.catch(()=>{});
 const timer=setTimeout(()=>{completedReject(Error('Owned policy fixture timed out.'));child.kill();},45000);
 child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-6000);});
 child.on('exit',()=>{for(const waiter of pending.values())waiter.reject(Error('Owned native app-server exited.'));pending.clear();completedReject(Error('Owned native app-server exited before completion.'));});
 const reader=(async()=>{for await(const line of createInterface({input:child.stdout})){
  let row;try{row=JSON.parse(line);}catch{continue;}
  if(row.method&&row.id!==undefined){result.serverRequests.push(row.method);
   if(row.method==='mcpServer/elicitation/request'){
    // Do not answer a form. Cancel this disposable turn with the real pending
    // request intact, exercising normal cancellation instead of implying consent.
    if(!interrupted){interrupted=true;rpc('turn/interrupt',{threadId:activeThread,turnId:activeTurn}).catch(completedReject);}
   }else child.stdin.write(JSON.stringify({id:row.id,error:{code:-32601,message:'Synthetic fixture cannot answer native approval requests.'}})+'\n');
   continue;
  }
  if(row.method){if(row.method==='turn/started')activeTurn=row.params.turn.id;if(['turn/completed','error'].includes(row.method))result.notifications.push({method:row.method,params:row.params});if(row.method==='turn/completed')completedResolve(row.params);continue;}
  const waiter=pending.get(row.id);if(!waiter)continue;pending.delete(row.id);row.error?waiter.reject(Error(JSON.stringify(row.error))):waiter.resolve(row.result);
 }})();
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 try{
  await rpc('initialize',{clientInfo:{name:'synthetic_worker_policy_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const thread=await rpc('thread/start',{cwd:home,ephemeral:true});activeThread=thread.thread.id;
  await rpc('mcpServerStatus/list',{threadId:thread.thread.id,serverName:'team_orchestrator',detail:'toolsAndAuthOnly'});
  await rpc('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Run the deterministic fixture tool-policy probe.'}]});
  const finish=await completed;if(modelFailure)throw Error(modelFailure);assert.equal(finish.turn.status,mode==='never'?'completed':'interrupted');
  const records=(await readFile(audit,'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));result.calls=records.filter(v=>v.kind==='call').map(v=>v.tool);result.managementEffects=records.filter(v=>v.kind==='management-effect').length;
  assert.deepEqual([...result.calls].sort(),mode==='never'?[...requested].sort():mode==='granular-no-overrides'?[]:[...WORKER_TEAM_TOOLS].sort());assert.equal(result.managementEffects,0);
  if(mode==='never')assert.ok(result.outputCodes.includes('API_APPROVAL_UNVERIFIED'),'The actual native management handler must refuse an unreviewed effect.');
  if(mode==='never')assert.deepEqual(result.serverRequests,[]);
  else{assert.ok(result.serverRequests.length>=1);assert.ok(result.serverRequests.every(method=>method==='mcpServer/elicitation/request'));}
  result.passed=true;
 }catch(error){result.passed=false;result.error=modelFailure??error.message;result.stderr=stderr;}
 finally{clearTimeout(timer);child.stdin.end();child.kill();await reader.catch(()=>{});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 await writeFile(join(root,mode+'-evidence.json'),JSON.stringify(result,null,2));return result;
}
const cases=[];for(const mode of ['granular-no-overrides','never','granular-review'])cases.push(await run(mode));
const evidence={root,passed:cases.every(v=>v.passed),realModel:false,nativeIdentity:false,humanReviewsAnswered:0,realTeamOperations:0,cases};
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!evidence.passed)process.exitCode=1;
