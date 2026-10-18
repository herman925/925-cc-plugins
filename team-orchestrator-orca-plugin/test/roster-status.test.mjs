import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contextUsage,createRosterStatusService} from '../src/local/roster-status.mjs';
function fixture(kind='terminal'){
 const scope={workspaceId:'folder:/work',executionHostId:'local'},member={id:'head',agent:'codex',model:'future-model',effort:'low'},team={id:'team',members:[member,{id:'worker',agent:'claude',model:'default',effort:'default'}],launch:{members:{head:{status:'created'}}}};
 const operation={requestId:'created-head',status:'created',kind,handle:'term-head',sessionId:'head-chat',paneKey:'tab:leaf',observation:{ptyId:'pty',incarnationId:'instance'},scope,nativeRequest:{agent:'codex',sessionOptions:{model:'launch-model',effort:'high'}}};
 let agent='codex',state='working',fence=7,changed=false,requests=false,options=true,missing=false;
 const marker={sessionId:'head-chat',version:'v',owner:'owner',epoch:'epoch',publisher:'publisher'},calls=[];
 const store={readSnapshot:()=>({teams:[team]}),readMemberOperation:id=>id==='head'?operation:null,readMemberDispatch:()=>null,readScope:()=>scope};
 const rpc=async(method,params)=>{calls.push(method);
  if(method==='status.get')return {runtimeId:'runtime'};
  if(method==='worktree.show')return {worktree:{id:'folder:/work',hostId:'local'}};
  if(method==='terminal.show'){if(missing)throw Error('terminal_handle_stale');return {terminal:{handle:'term-head',worktreeId:'folder:/work',executionHostId:'local',connected:true,agentIdentity:agent,ptyId:'pty',incarnationId:changed?'new-instance':'instance',tabId:'tab',leafId:'leaf'}};}
  if(method==='terminal.agentStatus')return {agentStatus:{handle:'term-head',isRunningAgent:state!=='closed',status:state}};
  if(method==='orchestration.sessionAddress')return {orcaSessionId:'orca_session_id:head-chat'};
  if(method==='orchestration.partyLocation')return {location:{kind:'chat',sessionId:'head-chat',worktreeId:'folder:/work'}};
  if(method==='agentSession.handoffStatus')return {owner:'native',phase:'idle',stage:null};
  if(method==='agentSession.history')return {ok:true,page:{sessionId:'head-chat',fence,epoch:'epoch',currentRequests:marker,latestTurn:{turn:{state:state==='working'?'running':'completed'}}}};
  if(method==='agentSession.currentRequests')return {marker,json:JSON.stringify(requests?[{body:{kind:'question',resolution:{state:'pending'}}}]:[]),nextCursor:null};
  if(method==='agentSession.options'){if(!options)throw Error('Unsupported');if(changed)fence++;return {current:{model:'actual-model',effort:'medium',confirmed:['model','effort']},contextUsage:{current:{used:{kind:'report',usedTokens:40000,windowTokens:100000,capturedAt:123}}}};}
  throw Error('Unexpected or effectful method: '+method);
 };
 return {service:createRosterStatusService({store,rpc,consent:async()=>{}}),calls,operation,team,store,rpc,setAgent:v=>agent=v,setState:v=>state=v,setChanged:()=>changed=true,setRequests:()=>requests=true,setMissing:()=>missing=true,setNoOptions:()=>options=false};
}
test('terminal activity is fresh, never inferred from launch success or a previous working receipt',async()=>{
 const f=fixture();assert.equal((await f.service.read()).members.head.state,'working');f.setState('idle');let row=(await f.service.read()).members.head;assert.equal(row.state,'idle');assert.equal(row.context,null);assert.equal(row.model,null);assert.equal(row.requestedModel,'launch-model');
 f.setState('permission');assert.equal((await f.service.read()).members.head.state,'asking');f.setMissing();row=(await f.service.read()).members.head;assert.equal(row.state,'unknown');assert.equal(row.context,null);assert.equal(row.sessionRequestId,undefined);
 assert.equal((await f.service.read()).members.worker.state,'not-started');assert.ok(f.calls.every(m=>!['agent.launchReplay','terminal.send','agentSession.send','orchestration.workerStart'].includes(m)));
});
test('all levels expose measured context and provider-confirmed options for structured sessions',async()=>{
 const f=fixture('structured');const row=(await f.service.read()).members.head;assert.equal(row.state,'working');assert.equal(row.context.percent,40);assert.equal(row.model,'actual-model');assert.equal(row.effort,'medium');
 f.setState('idle');assert.equal((await f.service.read()).members.head.state,'idle');f.setRequests();assert.equal((await f.service.read()).members.head.state,'asking');
});
test('unreported context and changed session owners remain unknown',async()=>{
 const f=fixture('structured');f.setNoOptions();assert.equal((await f.service.read()).members.head.context,null);
 const changed=fixture('structured');changed.setChanged();const row=(await changed.service.read()).members.head;assert.equal(row.state,'unknown');assert.equal(row.model,null);assert.equal(row.context,null);
 const term=fixture();term.setChanged();assert.equal((await term.service.read()).members.head.state,'unknown');
});
test('context percentages use native context counts, exclude output tokens, and preserve unavailable and over-limit states',()=>{
 assert.equal(contextUsage({used:{kind:'unknown'}}),null);assert.equal(contextUsage({used:{kind:'report',usedTokens:0,windowTokens:100}}).percent,0);
 assert.equal(contextUsage({window:{tokens:100},used:{kind:'estimate',usage:{inputTokens:20,cacheCreationInputTokens:10,cacheReadInputTokens:30,outputTokens:1000}}}).percent,60);
 assert.equal(contextUsage({used:{kind:'report',usedTokens:120,windowTokens:100}}).percent,120);
 for(const used of [null,{kind:'report',usedTokens:-1,windowTokens:100},{kind:'report',usedTokens:1,windowTokens:0}])assert.equal(contextUsage({used}),null);
});
test('on-demand worker observations retain their exact native Dispatch session identity',async()=>{
 const f=fixture();f.setAgent('claude');f.store.readMemberOperation=()=>null;
 f.store.readMemberDispatch=id=>id==='worker'?{id:'attempt',scope:{workspaceId:'folder:/work',executionHostId:'local'},startParams:{agent:'claude',model:'worker-model',effort:'high'},binding:{kind:'terminal',handle:'term-head',paneKey:'tab:leaf',incarnationId:'pty:instance'}}:null;
 const row=(await f.service.read()).members.worker;assert.equal(row.state,'working');assert.equal(row.sessionRequestId,'attempt');assert.equal(row.requestedModel,'worker-model');
});
