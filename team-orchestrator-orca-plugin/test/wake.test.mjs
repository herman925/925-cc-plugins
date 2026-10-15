import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {openTeamStore} from '../src/local/store.mjs';import {DEFAULT_FORM} from '../src/team.mjs';import {nativeLaunchIntent,publicOperation} from '../src/local/native-launch.mjs';
import {createWakeService} from '../src/local/wake.mjs';
async function fixture(t,agent='codex'){
 const profile=await mkdtemp(join(tmpdir(),'wake118-')),store=await openTeamStore({userData:profile});t.after(async()=>{store.close();await rm(profile,{recursive:true,force:true});});
 const scope={workspaceId:'folder:/work',executionHostId:'local',kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex')};
 const team=store.createTeam({requestId:'team',expectedRevision:0,form:{...DEFAULT_FORM,agents:[agent,agent,agent]}},scope).teams[0],member=team.members[0];
 let op=store.prepareOperation({teamId:team.id,memberId:member.id,requestId:'launch',configVersion:1},{scope,nativeRequest:nativeLaunchIntent(team,member,scope),runtimeId:'runtime',roleVersion:1,title:'Head',executionHostId:'local',hostGeneration:null}).operation;
 const patch={status:'created',kind:'structured',handle:'chat',sessionId:'session-118',observation:{state:'unknown',ownerFence:7}};op=store.settleOperation('launch',op.nativeRequest.operationId,{...patch,public:publicOperation({...op,...patch})});
 const db=new DatabaseSync(join(profile,'agent-session-journal.db'));t.after(()=>db.close());db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_records(session_id TEXT PRIMARY KEY,record_json TEXT)');
 let dead=false,offers=true,outcome='continued',fence=7;const calls=[];
 const write=()=>db.prepare('INSERT OR REPLACE INTO agent_session_records VALUES(?,?)').run(op.sessionId,JSON.stringify({schemaVersion:2,sessionId:op.sessionId,provider:agent,location:scope,lease:{sessionId:op.sessionId,runtimeFence:fence,claimStatus:dead?'released':'live',ownerProcess:dead?null:{pid:1},deathEvidence:dead?{kind:'exit-observed',ownerFence:7,observedAt:Date.now()}:null}}));write();
 const rpc=async(method,params)=>{calls.push({method,params});if(method==='status.get')return {runtimeId:'runtime'};if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:'local'}};if(method==='agentSession.restartResumable')return {sessions:offers?[{sessionId:op.sessionId,workspaceId:scope.workspaceId,executionHostId:'local',agent}]:[],failed:[]};if(method==='agentSession.restartContinue'){if(outcome==='throw')throw Error('lost receipt');return {resumed:[],continued:[{sessionId:op.sessionId,outcome}]};}if(method==='agentSession.history')return {ok:true,page:{sessionId:op.sessionId,fence}};throw Error('Unsupported fixture method '+method);};
 const service=createWakeService({store,rpc,userData:profile,consent:async()=>{}});
 return {store,scope,team,member,op,rpc,calls,service,input:{teamId:team.id,memberId:member.id,requestId:'wake-1',bindingRequestId:'launch'},set dead(value){dead=value;write();},set offers(value){offers=value;},set outcome(value){outcome=value;},set fence(value){fence=value;write();}};
}
test('a live or unknown old owner blocks wake without launching or deleting the member',async t=>{
 const f=await fixture(t);const result=await f.service.wake(f.input);
 assert.equal(result.state,'blocked');assert.match(result.detail,/stopped|death/);assert.equal(f.store.readSnapshot().teams[0].members[0].id,f.member.id);
 assert.equal(f.calls.some(c=>/restartContinue|send|launchReplay|ensureAgentSession/.test(c.method)),false);
});
for(const agent of ['codex','claude'])test(`${agent} restart continuation uses only the saved conversation and persists its accepted effect without claiming ready`,async t=>{
 const f=await fixture(t,agent);f.dead=true;const result=await f.service.wake(f.input);
 assert.equal(result.state,'accepted');assert.equal(result.memberId,f.member.id);assert.deepEqual(f.calls.find(c=>c.method==='agentSession.restartContinue').params,{sessionIds:['session-118']});
 assert.equal(f.calls.some(c=>c.method==='agentSession.restartResume'),false);
 await f.service.wake(f.input);assert.equal(f.calls.filter(c=>c.method==='agentSession.restartContinue').length,1);
 assert.equal(f.store.readWake('wake-1').oldBinding.requestId,'launch');
});
