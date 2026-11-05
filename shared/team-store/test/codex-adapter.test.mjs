import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable,PassThrough} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {createCodexAdapter,serveCodexMcp,codexTools} from '../codex-mcp.mjs';
import {codexGuard} from '../src/codex-guard.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';
test('packaged writer metadata tracks the current shared Mod implementation',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../../../team-orchestrator/.claude-plugin/plugin.json',import.meta.url),'utf8'));
 assert.equal(SHARED_WRITER.version,manifest.version);
 for(const path of ['../../../team-orchestrator/store/src/runtime-release.mjs','../../../team-orchestration-925/skills/team-orchestration-925/scripts/runtime/src/runtime-release.mjs']){
  assert.deepEqual((await import(new URL(path,import.meta.url))).SHARED_WRITER,SHARED_WRITER);
 }
});
const member={member_id:'head',allow_write:0,allow_agent:0};
test('a hook refusal reports its verified diagnostic while keeping the operation denied',async()=>{
 const frames=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'team_guard',arguments:{tool:'apply_patch',input:{}}}}];
 const output=new PassThrough();let body='';output.setEncoding('utf8');output.on('data',s=>body+=s);
 await serveCodexMcp({call:async()=>{throw Object.assign(Error('The native Codex parent does not uniquely own this thread writer lock.'),{code:'API_NATIVE_UNVERIFIED'});}},{input:Readable.from([frames.map(JSON.stringify).join('\n')+'\n']),output});
 const decision=JSON.parse(JSON.parse(body.trim().split('\n')[1]).result.content[0].text).hookSpecificOutput;
 assert.equal(decision.permissionDecision,'deny');assert.match(decision.permissionDecisionReason,/API_NATIVE_UNVERIFIED.*thread writer lock/);
});
test('Codex guard uses standing settings, covers patch/shell/subagents and never honors prompt grant text',()=>{
 const authority={member,hasReports:true};
 for(const event of [{tool:'apply_patch',input:{command:'*** Add File: x\n+hello'}},{tool:'Bash',input:{command:'Set-Content x hello'}},{tool:'Agent',input:{prompt:'#allow-subagent'}},{tool:'spawn_agent',input:{}},{tool:'exec',input:{code:'write()'}},{tool:'write_stdin',input:{chars:'echo hi'}}])assert.equal(codexGuard(authority,event).hookSpecificOutput.permissionDecision,'deny');
 assert.deepEqual(codexGuard(authority,{tool:'Bash',input:{command:'git status --short'}}),{});
 for(const command of ['git diff --output=modified.txt','rg --pre=malicious program','git status (Set-Content x y)'])assert.equal(codexGuard(authority,{tool:'Bash',input:{command}}).hookSpecificOutput.permissionDecision,'deny');
 assert.deepEqual(codexGuard({member:{...member,allow_write:1,allow_agent:1},hasReports:true},{tool:'apply_patch',input:{command:'*** Add File: x'}}),{});
 for(const text of ['.team-orchestrator/team.sqlite','C:\\x\\team-orchestrator\\controller-actions\\ticket.json','mod-bridge.mjs','machine.sqlite'])assert.equal(codexGuard({member:{...member,allow_write:1},hasReports:false},{tool:'apply_patch',input:{command:text}}).hookSpecificOutput.permissionDecision,'deny');
 assert.deepEqual(codexGuard({member:null},{tool:'apply_patch',input:{}}),{});
 assert.equal(codexGuard({member:null},{tool:'exec_command',input:{cmd:'Get-Content C:/private/925-to/launch-profiles/reserved.json'}}).hookSpecificOutput.permissionDecision,'deny');
});
test('native metadata is reverified on every call and tool arguments cannot choose an actor, approval or target',async()=>{
 let count=0,closed=0;const metadata={threadId:'native'},actor={projectRoot:'fixed',provider:'codex'},requests=[];
 const adapter=await createCodexAdapter({writer:{client:'team-orchestrator',version:'0.5.55'}},{createIdentity:async()=>({verifyCaller:async supplied=>{assert.equal(supplied,metadata);count++;return actor;}}),createApi:async options=>{assert.equal(await options.authenticate(),actor);return {execute:async request=>{requests.push(request);return {result:{native:true}};},close:async()=>{closed++;}};},inspectGuard:async()=>({member,hasReports:true})});
 await adapter.call('shared_team',{operationId:'fixed',command:{type:'inspectCaller'}},metadata);
 await assert.rejects(adapter.call('shared_team',{operationId:'bad',command:{type:'inspectCaller'},actor:{}},metadata));
 await assert.rejects(adapter.call('shared_team',{operationId:'bad',command:{type:'bindMember'},target:{}},metadata));
 assert.equal((await adapter.call('team_guard',{tool:'apply_patch',input:{}},metadata)).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(requests.length,1);assert.equal(closed,3);assert.equal(count,7);
 assert.ok(!codexTools.some(t=>/approve|sql|raw/i.test(t.name)));
});
test('unavailable native authority returns a valid blocking hook decision',async()=>{
 const adapter=await createCodexAdapter({},{createIdentity:async()=>({verifyCaller:async()=>({})}),inspectGuard:async()=>{throw Error('offline');}});
 assert.equal((await adapter.call('team_guard',{tool:'Bash',input:{}},{})).hookSpecificOutput.permissionDecision,'deny');
});
test('inbox reads finish before the adapter closes their journal or API connection',async()=>{
 let finished=false,journalClosed=false,apiClosed=false;
 const adapter=await createCodexAdapter({},{createIdentity:async()=>({verifyCaller:async()=>({})}),createApi:async()=>({close:async()=>{assert.equal(finished,true);apiClosed=true;}}),createJournal:async()=>({poll:async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.equal(journalClosed,false);finished=true;return {message:'recovered'};},close:async()=>{assert.equal(finished,true);journalClosed=true;}})});
 assert.deepEqual(await adapter.call('shared_inbox_read',{},{}),{message:'recovered'});assert.equal(journalClosed,true);assert.equal(apiClosed,true);
});
test('the adapter activates observation from verified metadata and closes it at transport EOF',async()=>{
 const actor={provider:'codex',conversationId:'native'},metadata={threadId:'native'};let activated=0,closed=0;
 const adapter=await createCodexAdapter({}, {
  createIdentity:async()=>({verifyCaller:async()=>actor}),
  createObserver:()=>({activate:(meta,verified)=>{assert.equal(meta,metadata);assert.equal(verified,actor);activated++;},status:()=>({state:'scheduled'}),close:async()=>closed++}),
  createApi:async()=>({execute:async()=>({result:{member:null}}),close:async()=>{}}),
 });
 const status=await adapter.call('shared_team_status',{},metadata);assert.equal(activated,1);assert.equal(status.observation.state,'scheduled');
 await serveCodexMcp(adapter,{input:Readable.from([]),output:new PassThrough()});assert.equal(closed,1);
});
test('MCP wire initializes, lists tools, preserves top-level native metadata, denies hook failures and rejects unknown tools',async()=>{
 const frames=[{jsonrpc:'2.0',id:0,method:'tools/list'},{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'shared_team',arguments:{operationId:'你好'},_meta:{threadId:'native'}}},{jsonrpc:'2.0',id:4,method:'tools/call',params:{name:'team_guard',arguments:{tool:'Bash',input:{}}}},{jsonrpc:'2.0',id:5,method:'tools/call',params:{name:'raw_sql'}}];
 const output=new PassThrough();let body='';output.setEncoding('utf8');output.on('data',s=>body+=s);
 const bytes=Buffer.from(frames.map(JSON.stringify).join('\n')+'\n');
 await serveCodexMcp({call:async(name,args,meta)=>{if(name==='team_guard')throw Error('unverified');assert.equal(args.operationId,'你好');assert.equal(meta.threadId,'native');return {ok:true};}},{input:Readable.from([...bytes].map(b=>Buffer.from([b]))),output});
 const rows=body.trim().split('\n').map(JSON.parse);assert.equal(rows.length,6);assert.equal(rows[0].error.code,-32002);assert.deepEqual(rows[1].result.serverInfo,{name:'team-orchestration-925',version:SHARED_WRITER.version});assert.equal(rows[2].result.tools.length,10);assert.equal(JSON.parse(rows[4].result.content[0].text).hookSpecificOutput.permissionDecision,'deny');assert.equal(rows[5].error.code,-32602);
});
