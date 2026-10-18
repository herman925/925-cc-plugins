import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {openTeamStore} from '../src/local/store.mjs';import {DEFAULT_FORM} from '../src/team.mjs';import {nativeLaunchIntent,publicOperation} from '../src/local/native-launch.mjs';import {createWorkService} from '../src/local/teamwork.mjs';import {dispatchInstructions} from '../src/local/dispatch.mjs';
async function setup(t,{lost=false,permission=false}={}){
 const profile=await mkdtemp(join(tmpdir(),'team-session-setup-'));let store=await openTeamStore({userData:profile});
 const scope={workspaceId:'folder:/work',executionHostId:'local',kind:'folder',displayName:'Work',workspaceKey:createHash('sha256').update(JSON.stringify(['folder:/work','local'])).digest('hex')};
 const team=store.createTeam({requestId:'team',expectedRevision:0,form:{...DEFAULT_FORM,sessionMode:true}},scope).teams[0],head=team.members[0];
 const op=store.prepareOperation({requestId:'root',teamId:team.id,memberId:head.id,configVersion:1},{scope,nativeRequest:nativeLaunchIntent(team,head,scope),roleVersion:1,title:'Head',executionHostId:'local',runtimeId:'runtime'}).operation;
 const patch={status:'created',kind:'terminal',handle:'head',paneKey:'tab:leaf',observation:{ptyId:'pty',incarnationId:'instance'}};store.settleOperation(op.requestId,op.nativeRequest.operationId,{...patch,public:publicOperation({...op,...patch})});
 const db=new DatabaseSync(join(profile,'orchestration.db'));db.exec('PRAGMA user_version=43; CREATE TABLE runs(id TEXT,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER)');
 const sent=[];const rpc=async(method,params,envelope)=>{
  if(method==='status.get')return {runtimeId:'runtime',capabilities:['orchestration.contract.v1','terminal.prompt-delivery.v1']};
  if(method==='worktree.show')return {worktree:{id:scope.workspaceId,hostId:'local'}};
  if(method==='terminal.show')return {terminal:{handle:'head',worktreeId:scope.workspaceId,executionHostId:'local',connected:true,writable:true,ptyId:'pty',incarnationId:'instance',agentIdentity:'codex',tabId:'tab',leafId:'leaf'}};
  if(method==='terminal.agentStatus')return {agentStatus:{handle:'head',isRunningAgent:true,status:permission?'permission':'idle'}};
  if(method==='terminal.send'){sent.push(params.text);const work=store.listWorks()[0];assert.equal(work.mode,'supervisor-session');assert.equal(work.input.state,'sending');db.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?)').run('run',work.nativeObjective,'this_database','head','tab:leaf',null,null,1,0);if(lost)throw Error('Receipt lost');return {send:{handle:'head',accepted:true,prompt:{requestId:envelope.orchestrationRequestId,processIncarnation:'instance'}}};}
  if(method==='orchestration.runShow')return {run:db.prepare('SELECT * FROM runs WHERE id=?').get(params.id)};
  if(method==='orchestration.taskList')return {tasks:[]};throw Error('Unexpected effect '+method);
 };
 const service=()=>createWorkService({store,rpc,userData:profile,consent:async()=>{}});
 t.after(async()=>{db.close();store.close();await rm(profile,{recursive:true,force:true});});
 return {team,sent,service,get store(){return store;},async restart(){store.close();store=await openTeamStore({userData:profile});}};
}
test('launching a team initializes persistent supervisor coordination without a panel objective, exactly once',async t=>{
 const f=await setup(t);const work=await f.service().ensureSession(f.team.id);assert.equal(work.run.state,'verified');assert.equal(work.mode,'supervisor-session');assert.match(f.sent[0],/^TEAM_SESSION_SETUP/);assert.match(f.sent[0],/Receive tasks and follow-up tasks directly from the user here/);
 await f.restart();await f.service().ensureSession(f.team.id);assert.equal(f.sent.length,1);assert.equal(f.store.listWorks().length,1);
 const protocol=JSON.parse(dispatchInstructions(work,f.team,{token:'token',generation:1}).split('\n')[1]);assert.doesNotMatch(protocol.instructions,/creates a separate native Task/);assert.match(protocol.instructions,/reports outcomes directly to the user/);assert.equal(f.store.listGoals().length,0);
});
test('automatic session setup never resends an uncertain submission after restart',async t=>{
 const f=await setup(t,{lost:true});const work=await f.service().ensureSession(f.team.id);assert.equal(work.input.state,'unknown');await f.restart();await f.service().ensureSession(f.team.id);assert.equal(f.sent.length,1);
});
test('a supervisor awaiting native permission is not sent setup and gets no fabricated active work',async t=>{
 const f=await setup(t,{permission:true});await assert.rejects(f.service().ensureSession(f.team.id),/permission/);assert.equal(f.sent.length,0);assert.equal(f.store.listWorks().length,0);
});
