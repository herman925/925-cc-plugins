// Native Claude SDK/CLI transport probe. Isolated home/project and loopback
// model only; no live session, permission response or shared team mutation.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {inspectWindowsProcess} from '../src/windows-native.mjs';
import {createOwnedClaudeTransport,createOwnedProviderWake} from '../src/owned-provider-wake.mjs';
const [sdkPath,executable]=process.argv.slice(2);if(!sdkPath||!executable)throw Error('Supply the installed official SDK module and native Claude executable.');
const sdk=await import(pathToFileURL(sdkPath).href),root=await realpath(await mkdtemp(join(tmpdir(),'team-claude-stream-'))),home=join(root,'home'),project=join(root,'project');await mkdir(home);await mkdir(project);
let calls=0,failure=null,child,warm,query,reader,closing=false,permissionRequests=0,metadata=null,idle=false,resultCount=0,spawnArguments;
const model=createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):{};
 if(req.url.includes('count_tokens')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({input_tokens:10}));return;}
 if(req.method!=='POST'||!req.url.includes('/messages')){res.writeHead(404);res.end();return;}
 assert.ok(++calls<=2,'No additional model turn may be submitted.');const message={id:'msg_fixture_'+calls,type:'message',role:'assistant',model:body.model,content:[{type:'text',text:'Synthetic owned Claude receiver ready.'}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:10,output_tokens:5}};
 if(body.stream!==true){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return;}
 res.writeHead(200,{'content-type':'text/event-stream'});const event=(name,data)=>res.write('event: '+name+'\ndata: '+JSON.stringify({type:name,...data})+'\n\n');
 event('message_start',{message:{...message,content:[],stop_reason:null,usage:{input_tokens:10,output_tokens:0}}});event('content_block_start',{index:0,content_block:{type:'text',text:''}});event('content_block_delta',{index:0,delta:{type:'text_delta',text:message.content[0].text}});event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:5}});event('message_stop',{});res.end();
 }catch(error){failure=error.message;res.destroy(error);}});await new Promise(resolve=>model.listen(0,'127.0.0.1',resolve));
const env={...process.env};for(const key of Object.keys(env))if(/^(?:ANTHROPIC|CLAUDE|ORCA|TEAM_|CODEX_)/i.test(key))delete env[key];Object.assign(env,{CLAUDE_CONFIG_DIR:home,ANTHROPIC_API_KEY:'fixture-not-a-real-key',ANTHROPIC_BASE_URL:`http://127.0.0.1:${model.address().port}`,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'});
const sessionId=randomUUID(),queue=[],waiting=[],replays=new Map(),events=[],hooks=[];
const input={async *[Symbol.asyncIterator](){while(!closing){if(!queue.length)await new Promise(resolve=>waiting.push(resolve));if(closing)break;while(queue.length)yield queue.shift();}}};
const enqueue=message=>new Promise((resolve,reject)=>{if(replays.has(message.uuid))return reject(Error('Duplicate fixture input ID.'));replays.set(message.uuid,{resolve,reject});queue.push(message);waiting.splice(0).forEach(resolve=>resolve());});
 let evidence={passed:false,root,realModel:false,humanReviewsAnswered:0};
const until=async test=>{const deadline=Date.now()+60000;while(Date.now()<deadline){if(failure)throw Error(failure);if(await test())return;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Owned Claude fixture timed out.');};
try{
 warm=await sdk.startup({initializeTimeoutMs:30000,options:{cwd:project,env,sessionId,model:'claude-sonnet-4-6',pathToClaudeCodeExecutable:executable,settingSources:['user','project','local'],extraArgs:{'replay-user-messages':null},hooks:{SessionStart:[{hooks:[async value=>{hooks.push({event:value.hook_event_name,sessionId:value.session_id,cwd:value.cwd});metadata={sessionId:value.session_id,projectRoot:await realpath(value.cwd)};return {}; }],onFailure:'block'}]},canUseTool:async()=>{permissionRequests++;return new Promise(()=>{});},spawnClaudeCodeProcess:options=>{spawnArguments=options.args;child=spawn(options.command,options.args,{cwd:options.cwd,env:options.env,signal:options.signal,windowsHide:true,stdio:['pipe','pipe','pipe']});child.stderr.resume();return child;}}});
 assert.equal(calls,0,'Native preparation must not send model input.');const owner=await inspectWindowsProcess(child.pid);assert.equal(await realpath(owner.executable),await realpath(executable));
 const preparationMetadata=structuredClone(metadata);query=warm.query(input);reader=(async()=>{for await(const message of query){events.push({type:message.type,subtype:message.subtype,sessionId:message.session_id,isReplay:message.isReplay,uuid:message.uuid});if(message.type==='system'&&message.subtype==='init'){metadata={sessionId:message.session_id,projectRoot:await realpath(message.cwd)};idle=true;}if(message.type==='user'&&message.isReplay){replays.get(message.uuid)?.resolve(message);replays.delete(message.uuid);}if(message.type==='result'){idle=true;resultCount++;if(message.is_error)failure='Native Claude returned an error result.';}}})().catch(error=>{if(!closing)failure=error.message;});
 const first={type:'user',uuid:randomUUID(),session_id:sessionId,parent_tool_use_id:null,message:{role:'user',content:'Synthetic native bootstrap fixture; run no tools.'}};const firstReceipt=enqueue(first);idle=false;await until(()=>resultCount===1);await firstReceipt;assert.equal(metadata.sessionId,sessionId);assert.equal(metadata.projectRoot,project);
 const identity={projectRoot:project,machineId:hostname(),provider:'claude',conversationId:sessionId,incarnationId:`claude-process:${child.pid}:${owner.createdAt}`,terminalHandle:`claude-session:${sessionId}`,contextId:'fixture-context'};
 const transport=createOwnedClaudeTransport({identity,alive:()=>child.exitCode===null&&!child.killed,readState:async()=>({...metadata,idle,pendingReview:permissionRequests>0}),enqueue:message=>{idle=false;return enqueue(message);}}),delivery={deliveryId:'fixture-delivery',messageId:'fixture-message',threadId:'fixture-thread',recipient:{member_id:'worker',machine_id:identity.machineId,execution_host_id:'local',provider:'claude',conversation_id:sessionId,incarnation_id:identity.incarnationId,terminal_handle:identity.terminalHandle,context_id:identity.contextId}};
 const wake=createOwnedProviderWake({transport,journalRoot:join(root,'journal'),checkEligible:async()=>({eligible:true})});const receipt=await wake(delivery,{projectRoot:project,machineId:identity.machineId});assert.equal(receipt.state,'input-accepted',JSON.stringify(receipt));await until(()=>resultCount===2);const repeated=await wake(delivery,{projectRoot:project,machineId:identity.machineId});assert.equal(repeated.state,'awaiting-inbox-progress');assert.equal(calls,2);assert.equal(permissionRequests,0);assert.equal((await inspectWindowsProcess(child.pid)).createdAt,owner.createdAt);
 evidence={...evidence,passed:true,calls,preparationMetadata,nativeMetadata:metadata,nativeVersion:(await query.initializationResult()).claude_code_version,owner:{pid:owner.pid,createdAt:owner.createdAt},receipt,repeated,firstReplay:true,hooks,events,spawnArguments,limitation:'Native transport proof only. No shared binding/readiness, real human consent, task or live session was exercised.'};
}catch(error){evidence={...evidence,error:error.message,fixtureFailure:failure,calls,hooks,events,permissionRequests,spawnArguments};process.exitCode=1;}
finally{closing=true;waiting.splice(0).forEach(resolve=>resolve());query?.close();warm?.close();child?.stdin?.end();child?.kill();await reader?.catch(()=>{});model.closeAllConnections();await new Promise(resolve=>model.close(resolve));}
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
