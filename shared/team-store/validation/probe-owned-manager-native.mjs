// Real native Codex + production dispatcher/owner/MCP/API in an isolated team.
// A deterministic loopback model drives tool calls. Fixture grants are explicit
// test callbacks, not evidence that a real person approved a launch or a form.
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';
import {independentContext} from '../src/codex-independent-native.mjs';
import {dispatcherLocation,serveProjectDispatcher,projectOwnedRequest} from '../src/dispatcher-service.mjs';
import {writeReservedLaunchProfile} from '../src/codex-launch-profile.mjs';
import {connectSqlite} from '../src/engines.mjs';
const executable=process.argv[2];if(!executable)throw Error('Supply the native Codex executable.');
const root=await realpath(await mkdtemp(join(tmpdir(),'team-owned-manager-native-'))),project=join(root,'project'),home=join(root,'home');await mkdir(project);await mkdir(home);
const stage=value=>process.stderr.write('Owned native fixture: '+value+'\n');stage(root);
let calls=0,failure=null,receiptId,service,api,target,bootstrapFinished=false,wakeFinished=false;
const observed=[],functions=(tools,namespace)=>tools.flatMap(tool=>tool.type==='namespace'?functions(tool.tools??[],tool.name):tool.type==='function'?[{name:tool.name,namespace}]:[]);
function receipts(value){if(Array.isArray(value))return value.flatMap(receipts);if(value&&typeof value==='object')return [...(typeof value.readReceiptId==='string'?[value.readReceiptId]:[]),...Object.values(value).flatMap(receipts)];if(typeof value==='string'){try{return receipts(JSON.parse(value));}catch{}}return [];}
const model=createServer(async(req,res)=>{
 try{
  if(req.method!=='POST'||!req.url.endsWith('/responses')){res.writeHead(404);res.end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls++;stage('model call '+calls);assert.ok(calls<=9,'No duplicate bootstrap or inbox turn may reach even the synthetic model.');
  const latest=receipts(body.input??[]).at(-1);if(latest)receiptId=latest;
  const steps={1:['shared_team_status',{}],2:['shared_team',{operationId:'native-role',command:{type:'inspectTeam',teamId:'team'}}],3:['shared_inbox_read',{}],4:['shared_inbox_seen',{readReceiptId:receiptId}],6:['shared_team',{operationId:'native-wake-caller',command:{type:'inspectCaller'}}],7:['shared_inbox_read',{}],8:['shared_inbox_seen',{readReceiptId:receiptId}]};
  res.writeHead(200,{'content-type':'text/event-stream'});const event=row=>res.write('data: '+JSON.stringify(row)+'\n\n'),id='owned_response_'+calls;let item;
  event({type:'response.created',response:{id,object:'response',status:'in_progress',output:[]}});
  if(steps[calls]){
   const [name,args]=steps[calls],tool=functions(body.tools??[]).find(row=>row.name.endsWith(name));assert.ok(tool,'Native worker tool missing: '+name);if(name==='shared_inbox_seen')assert.ok(receiptId,'Only an actually returned receipt may be confirmed.');observed.push({call:calls,tool:name,...(name==='shared_inbox_seen'?{readReceiptId:receiptId}:{})});
   item={id:'owned_call_'+calls,type:'function_call',call_id:'owned_call_'+calls,name:tool.name,...(tool.namespace?{namespace:tool.namespace}:{}),arguments:JSON.stringify(args)};
   event({type:'response.output_item.added',output_index:0,item:{...item,arguments:''}});event({type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:item.arguments});event({type:'response.function_call_arguments.done',item_id:item.id,output_index:0,arguments:item.arguments});
  }else{item={id:'owned_done_'+calls,type:'message',role:'assistant',content:[{type:'output_text',text:'Synthetic owned-worker tool sequence complete.',annotations:[]}]};event({type:'response.output_item.added',output_index:0,item:{...item,content:[]}});event({type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:item.content[0].text});if(calls===5)bootstrapFinished=true;else wakeFinished=true;}
  event({type:'response.output_item.done',output_index:0,item});event({type:'response.completed',response:{id,object:'response',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}});res.end();
 }catch(error){failure=error.message;res.destroy(error);}
});await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
await writeFile(join(home,'config.toml'),`model="gpt-5.1-codex"\nmodel_provider="owned_fixture"\nsandbox_mode="read-only"\napproval_policy={granular={sandbox_approval=false,rules=false,mcp_elicitations=true,skill_approval=false}}\n[model_providers.owned_fixture]\nname="Disposable owned-worker fixture"\nbase_url="http://127.0.0.1:${model.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\n`);
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:2,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:60000,exemptMemberIds:[]};
const actor={projectRoot:project,machineId:hostname(),provider:'codex',conversationId:randomUUID(),executionHostId:'local',contextId:independentContext(project),terminalHandle:'synthetic-reviewed-head',incarnationId:'fixture-head-process'},launchId='owned-native-worker';
const request=(type,input={})=>projectOwnedRequest({projectRoot:project,machineId:actor.machineId,operation:{type,input},launch:false,timeoutMs:40000});
const rows=async sql=>{const db=await connectSqlite({path:join(project,'.team-orchestrator','team.sqlite')});try{return await db.query(sql);}finally{await db.close();}};
const until=async condition=>{const deadline=Date.now()+90000;while(Date.now()<deadline){if(failure)throw Error(failure);if(await condition())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Native owned-worker sequence timed out.');};
let evidence={passed:false,root,realModel:false,humanReviewsAnswered:0,fixtureApprovalCallbacks:true,liveTeamsChanged:false};
try{
 const location=await dispatcherLocation({projectRoot:project,machineId:actor.machineId});service=await serveProjectDispatcher(location,{tickMs:50,idleMs:15000});assert.equal(service.owner,true);
 api=await createTeamApi({projectRoot:project,machineId:actor.machineId,writer:SHARED_WRITER,authenticate:async()=>actor,confirmController:async()=>true,confirmManagement:async()=>true,confirmLaunchPlan:async()=>true,verifyTarget:async()=>actor,verifyLaunchTarget:async reference=>{const actual=await request('inspect',{launchId});assert.deepEqual(reference,actual.target);return reference;}});
 await api.approveController({operationId:'fixture-approve'});await api.manageTeam({operationId:'fixture-create',command:{type:'createFreshTeam',teamId:'team',name:'Disposable owned Codex worker',functionText:'Validate real native bootstrap and inbox receipt.',settings,expectedControllerGeneration:1,members:[{memberId:'head',name:'Fixture head',bossMemberId:null,role:'Coordinate',officialText:'Synthetic fixture head; no live approval.',cli:'codex'},{memberId:'worker',name:'Native Codex worker',bossMemberId:'head',role:'Verify',officialText:'Read your role and exact inbox receipt before any work.',cli:'codex'}]}});
 const info=(await api.execute({operationId:'fixture-caller',command:{type:'inspectCaller'}})).result,configuration=(await api.execute({operationId:'fixture-config',command:{type:'inspectConfiguration',teamId:'team'}})).result,version=Number(configuration.team.config_version),authority={teamId:'team',expectedConfigVersion:version,expectedControllerGeneration:1};
 await api.manageTeam({operationId:'fixture-bind-head',command:{...authority,type:'bindMember',memberId:'head',expectedMemberGeneration:1,expectedBindingGeneration:0},target:{projectRoot:project,conversationId:actor.conversationId,terminalHandle:actor.terminalHandle,contextId:actor.contextId}});
 await api.launch({operationId:'fixture-plan',command:{...authority,type:'approveLaunchPlan',planId:'fixture-plan',workerToolPolicy:'team-worker-v1',selections:[{memberId:'worker',launchId,expectedMemberGeneration:1,expectedOfficialGeneration:1,expectedNotesGeneration:1}]}});
 const claim=await api.launch({operationId:'fixture-claim',command:{...authority,type:'claimLaunch',launchId}});assert.equal(claim.result.claimed,true);
 const launchProfile=await writeReservedLaunchProfile({root:join(home,'925-to','launch-profiles'),actor,projectId:info.projectId,launchId,memberId:'worker',workerAccess:claim.result.workerAccess});
 stage('preparing worker');const prepared=await request('prepare',{actor,launchId,launchProfile,codexExecutable:executable,codexHome:home,model:'default',effort:'default',adapter:fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url)),node:process.execPath,workerToolPolicy:'team-worker-v1'});assert.equal(prepared.state,'prepared');target=prepared.target;assert.equal(calls,0,'Preparing a worker must not send model input.');stage('worker prepared');
 await api.launch({operationId:'fixture-target',command:{...authority,type:'recordLaunchTarget',launchId},target});const started=await request('start',{launchId,target});assert.ok(started.bootstrap.turnId);
 stage('bootstrap accepted');await until(async()=>bootstrapFinished&&(await request('inspect',{launchId})).nativeState==='idle');stage('bootstrap idle');
 const [binding]=await rows("SELECT * FROM member_bindings WHERE member_id='worker'"),[ready]=await rows("SELECT * FROM worker_readiness WHERE member_id='worker'");assert.equal(binding.conversation_id,prepared.identity.conversationId);assert.equal(ready.state,'ready');assert.ok(observed[3].readReceiptId.startsWith('bootstrap-read-'));
 const memberAuthority={teamId:'team',expectedConfigVersion:version,expectedMemberGeneration:1,expectedBindingGeneration:1};
 await api.execute({operationId:'fixture-question',command:{...memberAuthority,type:'askQuestion',threadId:'fixture-question',runId:'fixture-run',assignmentId:null,recipientMemberId:'worker',question:'Read this synthetic inbox question; it grants no task or permission.'}});
 const deliveries=(await api.execute({operationId:'fixture-deliver',command:{...memberAuthority,type:'prepareDeliveries'}})).result.deliveries;assert.equal(deliveries.length,1);const delivery=deliveries[0],pointer=Object.fromEntries(['deliveryId','messageId','threadId'].map(key=>[key,delivery[key]])),requestId=randomUUID();
 const wake=await request('sendWake',{launchId,identity:prepared.identity,requestId,pointer});assert.equal(wake.accepted,true);await until(async()=>wakeFinished&&(await request('inspect',{launchId})).nativeState==='idle');const repeated=await request('sendWake',{launchId,identity:prepared.identity,requestId,pointer});assert.deepEqual(repeated,wake);assert.equal(calls,9);
 const inbox=await rows("SELECT d.* FROM deliveries d JOIN messages m ON m.message_id=d.message_id WHERE m.recipient_member_id='worker'");assert.equal(inbox.length,1);assert.notEqual(inbox[0].read_at_ms,null);assert.deepEqual(await request('pending',{launchId}),[]);assert.equal((await rows('SELECT * FROM tasks')).length,0);
 evidence={...evidence,passed:true,modelRequests:calls,observed,binding:{conversationId:binding.conversation_id,incarnationId:binding.incarnation_id,generation:binding.generation},readiness:ready.state,bootstrap:started.bootstrap,wake,repeatedWake:repeated,inboxReadAt:inbox[0].read_at_ms,effectivePolicy:prepared.effectivePolicy,limitation:'Fixture-only approvals, synthetic head and model; no real human review, task acceptance, Claude transport or external-conversation wake acceptance.'};
}catch(error){evidence={...evidence,error:error.message,code:error.code??null,modelRequests:calls,observed,fixtureFailure:failure};process.exitCode=1;}
finally{await api?.close();await service?.close();model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
