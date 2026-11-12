// Real owned Codex app-server + deterministic loopback model, isolated home.
// No real model credit, Orca call, human approval answer or team-store mutation.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {configurationEnvironment} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-environment.mjs';
import {createOwnedProviderWake,createOwnedCodexTransport} from '../src/owned-provider-wake.mjs';
import {createManagedWakeBackend} from '../src/managed-wake.mjs';
import {createWakeRouter} from '../src/wake-routing.mjs';
import {dispatcherLocation,serveProjectDispatcher,connectProjectReceiver} from '../src/dispatcher-service.mjs';
const executable=process.argv[2];if(!executable)throw Error('Supply the native Codex executable.');
const fallbackMode=process.argv.includes('--fallback');
const root=await mkdtemp(join(tmpdir(),'team-single-dispatch-native-'));
let modelRequests=0,fixtureFailure=null,alive=true;
const model=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!req.url.endsWith('/responses')){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const request=JSON.parse(Buffer.concat(chunks));
  assert.ok(JSON.stringify(request.input).includes('fixture-delivery'));assert.equal(++modelRequests,1,'A duplicate native turn must not reach even the local model.');
  res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'});
  const event=value=>res.write('data: '+JSON.stringify(value)+'\n\n'),id='response_fixture';
  const item={id:'message_fixture',type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic owned receiver awake. Inbox acknowledgement was not performed.',annotations:[]}]};
  event({type:'response.created',response:{id,object:'response',status:'in_progress',output:[]}});
  event({type:'response.output_item.added',output_index:0,item:{...item,content:[]}});
  event({type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:item.content[0].text});
  event({type:'response.output_item.done',output_index:0,item});
  event({type:'response.completed',response:{id,object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 }catch(e){fixtureFailure=e.message;res.destroy(e);}
});
await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const args=['-c','model="gpt-5.1-codex"','-c','model_provider="dispatcher_fixture"','-c','model_providers.dispatcher_fixture.name="Disposable dispatcher fixture"','-c',`model_providers.dispatcher_fixture.base_url="http://127.0.0.1:${model.address().port}/v1"`,'-c','model_providers.dispatcher_fixture.wire_api="responses"','-c','model_providers.dispatcher_fixture.requires_openai_auth=false','-c','model_providers.dispatcher_fixture.supports_websockets=false','app-server','--listen','stdio://'];
const env=configurationEnvironment(root);delete env.OPENAI_API_KEY;delete env.OPENAI_BASE_URL;
const child=spawn(executable,args,{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const pending=new Map(),requests=[],events=[];let sequence=0,stderr='',finish;
const completed=new Promise(resolve=>finish=resolve);
const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
child.stderr.on('data',chunk=>stderr=(stderr+chunk.toString()).slice(-4000));
child.on('exit',()=>{alive=false;for(const waiter of pending.values())waiter.reject(Error('Owned fixture process exited.'));pending.clear();});
child.on('error',()=>{alive=false;});
const reader=(async()=>{for await(const line of createInterface({input:child.stdout})){
 let row;try{row=JSON.parse(line);}catch{continue;}
 if(row.method){if(row.id!==undefined){requests.push(row.method);continue;}events.push(row.method);if(row.method==='turn/completed')finish(row.params);continue;}
 const waiter=pending.get(row.id);if(waiter){pending.delete(row.id);row.error?waiter.reject(Error(JSON.stringify(row.error))):waiter.resolve(row.result);}
}})();
let receiver,service,result={passed:false,root,fallbackMode,realModel:false,orcaCalls:0,humanReviewsAnswered:0,teamStoreMutations:0};
let rejectDeadline;const deadline=new Promise((_,reject)=>rejectDeadline=reject);deadline.catch(()=>{});
const timer=setTimeout(()=>{rejectDeadline(Error('Owned native dispatcher fixture timed out.'));child.kill();},45000);
try{
 await rpc('initialize',{clientInfo:{name:'owned_dispatcher_fixture',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const started=await rpc('thread/start',{cwd:root});
 const identity={projectRoot:started.thread.cwd,machineId:'fixture-machine',provider:'codex',conversationId:started.thread.id,incarnationId:`owned-${child.pid}`,terminalHandle:'owned-fixture',contextId:'owned-fixture'};
 const delivery={deliveryId:'fixture-delivery',messageId:'fixture-message',threadId:'fixture-task-thread',recipient:{member_id:'worker',machine_id:identity.machineId,execution_host_id:'local',provider:'codex',conversation_id:identity.conversationId,incarnation_id:identity.incarnationId,terminal_handle:identity.terminalHandle,context_id:identity.contextId}};
 const transport=createOwnedCodexTransport({identity,rpc,alive:()=>alive,hasPendingReview:()=>requests.length>0});
 const wakeOptions={transport,journalRoot:join(root,'journal'),checkEligible:async()=>({eligible:true})};
 const wake=fallbackMode?createWakeRouter({...wakeOptions,primary:{id:'provider-direct',availability:async()=>({state:'unavailable',reason:'owned-input-unavailable'}),wake:async()=>assert.fail('Unavailable primary must not send.')},fallback:createManagedWakeBackend({...wakeOptions,id:'provider-managed'})}):createOwnedProviderWake(wakeOptions);
 const privateRoot=join(root,'private'),location=await dispatcherLocation({projectRoot:identity.projectRoot,machineId:identity.machineId,root:privateRoot});
 service=await serveProjectDispatcher(location,{intervalMs:100,tickMs:5,idleMs:10000});
 const receipts=[];let passResolve;const firstPass=new Promise(resolve=>passResolve=resolve);
 receiver=connectProjectReceiver({projectRoot:identity.projectRoot,machineId:identity.machineId,root:privateRoot,id:'owned-codex-fixture',launch:false,onPass:async({assertCurrent})=>{assertCurrent();const receipt=await wake(delivery,{projectRoot:identity.projectRoot,machineId:identity.machineId});receipts.push(receipt);passResolve();return {teamId:'fixture-team'};}});
 receiver.request();await Promise.race([firstPass,deadline]);
 assert.equal(receipts[0].state,'input-accepted',JSON.stringify(receipts[0]));const done=await Promise.race([completed,deadline]);assert.equal(done.turn.status,'completed');assert.equal(fixtureFailure,null);assert.equal(modelRequests,1);assert.deepEqual(requests,[]);
 if(fallbackMode){assert.equal(receipts[0].selectedRoute,'provider-managed');assert.equal(receipts[0].usingFallback,true);}
 const repeated=await wake(delivery,{projectRoot:identity.projectRoot,machineId:identity.machineId});assert.equal(repeated.state,'awaiting-inbox-progress');assert.equal(modelRequests,1);
 result={...result,passed:true,modelRequests,receipts:[receipts[0],repeated],threadId:started.thread.id,events,serverRequests:requests,limitation:'Transport fixture only: no real team binding, inbox read, task pickup, human approval or Claude process.'};
}catch(e){result={...result,error:e.message,fixtureFailure,stderr};process.exitCode=1;}
finally{clearTimeout(timer);await receiver?.close();await service?.close();child.stdin.end();child.kill();await reader.catch(()=>{});model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
await writeFile(join(root,'evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
