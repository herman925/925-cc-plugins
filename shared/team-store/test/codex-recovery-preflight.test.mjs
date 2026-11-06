import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable,PassThrough} from 'node:stream';
import {createCodexAdapter,serveCodexMcp} from '../codex-mcp.mjs';

const stale=()=>Object.assign(Error('The current native runtime does not match the active member binding.'),{code:'API_STALE_BINDING'});
async function fixture(t,{verifyCaller=async()=>({}),inspectGuard=async()=>{throw stale();}}={}){
 const adapter=await createCodexAdapter({observation:false},{
  createIdentity:async()=>({launchWorkers:true,verifyCaller}),inspectGuard,
  createApi:async()=>{assert.fail('A refused preflight must not reach an API or launch effect.');},
 });
 t.after(()=>adapter.close());return adapter;
}

test('launch-enabled stale preflight preserves bare and prefixed inspection and reviewed recovery hooks',async t=>{
 const adapter=await fixture(t);
 const allowed=[
  {tool:'shared_team_status',input:{}},
  {tool:'shared_team_sessions',input:{}},
  ...['inspectCaller','inspectController'].map(type=>({tool:'shared_team',input:{operationId:'inspect',command:{type}}})),
  ...['approveController','bindMember'].map(type=>({tool:'shared_team_manage',input:{operationId:'recover',command:{type}}})),
 ];
 const refused=[
  {tool:'apply_patch',input:{command:'*** Add File: x\n+blocked'}},
  {tool:'exec_command',input:{cmd:'Set-Content x blocked'}},
  {tool:'spawn_agent',input:{}},
  {tool:'write_stdin',input:{chars:'work\n'}},
  ...['shared_team_launch','shared_team_upgrade','shared_team_interview','shared_inbox_read','shared_inbox_seen'].map(tool=>({tool,input:{}})),
  ...['editTeam','createFreshTeam'].map(type=>({tool:'shared_team_manage',input:{operationId:'effect',command:{type}}})),
  ...['readInbox','reportOutcome','createFreshTeam','bindMember'].map(type=>({tool:'shared_team',input:{operationId:'effect',command:{type}}})),
 ];
 for(const [events,decision] of [[allowed,'allow'],[refused,'deny']])for(const event of events){
  for(const tool of [event.tool,...(event.tool.startsWith('shared_')?['mcp__team_orchestrator__'+event.tool]:[])]){
   const result=await adapter.call('team_guard',{...event,tool},{});
   assert.equal(result.hookSpecificOutput?.permissionDecision??'allow',decision,tool+' '+JSON.stringify(event.input));
  }
 }
 await assert.rejects(adapter.call('team_guard',{tool:'shared_team_status',input:{},extra:true},{}),{code:'API_INPUT_INVALID'});
});

test('launch-enabled stale preflight refuses direct effects before dispatch',async t=>{
 const adapter=await fixture(t);
 for(const [name,args] of [
  ['shared_team_launch',{}],['shared_team_upgrade',{}],['shared_team_interview',{}],['shared_inbox_read',{}],
  ...['editTeam','createFreshTeam'].map(type=>['shared_team_manage',{operationId:'effect',command:{type}}]),
  ['shared_team',{operationId:'effect',command:{type:'reportOutcome'}}],
 ])await assert.rejects(adapter.call(name,args,{}),{code:'API_STALE_BINDING'},name);
});

test('launch-enabled recovery never relaxes unrelated authority or native identity failures',async t=>{
 for(const code of ['API_NATIVE_UNVERIFIED','STORE_PROTOCOL_UNSUPPORTED','STORE_VERSION_UNSUPPORTED']){
  const adapter=await fixture(t,{inspectGuard:async()=>{throw Object.assign(Error('Refused fixture authority'),{code});}});
  for(const [name,args] of [['team_guard',{tool:'shared_team_status',input:{}}],['shared_team_status',{}],['shared_team_manage',{command:{type:'bindMember'}}]]){
   await assert.rejects(adapter.call(name,args,{}),{code});
  }
 }
 const adapter=await fixture(t,{verifyCaller:async()=>{throw Object.assign(Error('Refused fixture native identity'),{code:'API_NATIVE_UNVERIFIED'});},inspectGuard:async()=>{assert.fail('Native identity must be verified first.');}});
 await assert.rejects(adapter.call('team_guard',{tool:'shared_team_status',input:{}},{}),{code:'API_NATIVE_UNVERIFIED'});
});

test('launch-enabled stale recovery survives the MCP hook wire',async t=>{
 const adapter=await fixture(t),output=new PassThrough();let body='';output.setEncoding('utf8');output.on('data',s=>body+=s);
 const frames=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},
  ...['shared_team_status','mcp__team_orchestrator__shared_team_manage','shared_team_launch'].map((tool,i)=>({jsonrpc:'2.0',id:i+2,method:'tools/call',params:{name:'team_guard',arguments:{tool,input:tool.endsWith('manage')?{command:{type:'bindMember'}}:{}}}})),
 ];
 await serveCodexMcp(adapter,{input:Readable.from([frames.map(JSON.stringify).join('\n')+'\n']),output});
 const results=body.trim().split('\n').slice(1).map(row=>JSON.parse(JSON.parse(row).result.content[0].text));
 assert.deepEqual(results.slice(0,2),[{},{}]);
 assert.equal(results[2].hookSpecificOutput.permissionDecision,'deny');
 assert.match(results[2].hookSpecificOutput.permissionDecisionReason,/binding is stale/);
});
