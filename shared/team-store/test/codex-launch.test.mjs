import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {pumpCodexLaunches} from '../src/codex-launch.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
import {createCodexObserver} from '../src/codex-observer.mjs';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,cp,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {writeReservedLaunchProfile,readReservedLaunchProfile} from '../src/codex-launch-profile.mjs';
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:2,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:60000,exemptMemberIds:[]};
async function fixture(t,engine){
 const closers=[];t.after(async()=>{for(const close of closers)await close();});const f=await runtimeFixture(t,engine);
 if(f.options.postgres){const name='TEAM_LAUNCH_TEST_'+randomUUID().replaceAll('-','');process.env[name]=f.options.postgres.connectionString;t.after(()=>{delete process.env[name];});f.options.postgres={...f.options.postgres,connectionEnvironment:name};delete f.options.postgres.connectionString;}
 const actor=(id,terminal=`term-${id}`)=>({projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:id,executionHostId:'local',contextId:'context',terminalHandle:terminal,incarnationId:`inc-${terminal}`});
 const state={actor:actor('head'),approved:true,target:null};
 const make=async overrides=>{const api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>state.actor,confirmController:async()=>true,confirmManagement:async()=>true,confirmLaunchPlan:async()=>state.approved,verifyTarget:async()=>state.actor,verifyLaunchTarget:async()=>state.target,...overrides});closers.push(()=>api.close());return api;};
 const launchProfileRoot=await mkdtemp(join(tmpdir(),'team-launch-private-'));t.after(()=>rm(launchProfileRoot,{recursive:true,force:true}));
 const api=await make();await api.approveController({operationId:'approve'});
 await api.manageTeam({operationId:'create',command:{type:'createFreshTeam',teamId:'team',name:'Launch',functionText:'Launch acceptance',settings,expectedControllerGeneration:1,members:['head','a','b'].map(id=>({memberId:id,name:id,bossMemberId:id==='head'?null:'head',role:id==='head'?'Coordinate':'Verify',officialText:'Read role before admitted work.',cli:'codex'}))}});
 const info=(await api.execute({operationId:'configuration',command:{type:'inspectConfiguration',teamId:'team'}})).result,version=Number(info.team.config_version);
 const authority={teamId:'team',expectedConfigVersion:version,expectedControllerGeneration:1};
 await api.manageTeam({operationId:'bind-head',command:{...authority,type:'bindMember',memberId:'head',expectedMemberGeneration:1,expectedBindingGeneration:0},target:{projectRoot:f.root,conversationId:'head',terminalHandle:'term-head',contextId:'context'}});
 const request={operationId:'plan-review',command:{...authority,type:'approveLaunchPlan',planId:'plan',workerToolPolicy:'team-worker-v1',selections:['a','b'].map(id=>({memberId:id,launchId:`launch-${id}`,expectedMemberGeneration:1,expectedOfficialGeneration:1,expectedNotesGeneration:1}))}};
 const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
 return {...f,api,make,state,actor,authority,request,rows,launchProfileRoot};
}
for(const engine of ['sqlite','postgres'])describe(`${engine} reviewed Codex launch`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 test('the independent owner path commits its target before bootstrap without a terminal command',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);let prepared=0,started=0;
  const native={launchProfileRoot:f.launchProfileRoot,createLaunchTarget:async({member,launchId,launchProfile,workerToolPolicy})=>{assert.equal(member.member_id,'a');assert.equal(launchId,'launch-a');assert.equal(workerToolPolicy,'team-worker-v1');await access(launchProfile);prepared++;const child=f.actor('actual-native-worker','codex-thread:actual-native-worker');f.state.target=Object.fromEntries(Object.entries(child).filter(([key])=>!['provider','conversationId'].includes(key)));return f.state.target;},startLaunchTarget:async target=>{assert.equal((await f.rows("SELECT * FROM launch_targets WHERE launch_id='launch-a'"))[0].terminal_handle,target.terminalHandle);started++;},createLaunchTerminal:()=>assert.fail('Independent workers do not create host terminals.'),startLaunchTerminal:()=>assert.fail('Independent workers do not submit shell commands.')};
  const info=(await f.api.execute({operationId:'managed-head',command:{type:'inspectCaller'}})).result;
  await pumpCodexLaunches({api:f.api,native,actor:f.state.actor,info,postgres:f.options.postgres});await pumpCodexLaunches({api:f.api,native,actor:f.state.actor,info,postgres:f.options.postgres});assert.equal(prepared,1);assert.equal(started,1);
 });
 test('a private reserved profile pins the same engine and project through a copied runtime',async t=>{
  const f=await fixture(t,engine),projectId=(await f.api.execute({operationId:'profile-caller',command:{type:'inspectCaller'}})).result.projectId;
  const path=await writeReservedLaunchProfile({root:f.launchProfileRoot,actor:f.state.actor,projectId,launchId:'launch-a',memberId:'a',postgres:f.options.postgres});
  const runtime=join(f.launchProfileRoot,'copied-runtime');await cp(new URL('../../../team-orchestrator/store/',import.meta.url),runtime,{recursive:true});
  const {readReservedLaunchProfile:read}=await import(pathToFileURL(join(runtime,'src/codex-launch-profile.mjs')));
  const options=await read(path,f.root);assert.equal(Boolean(options.postgres),engine==='postgres');assert.equal(options.reservedLaunch.projectId,projectId);
  const {createTeamApi:create}=await import(pathToFileURL(join(runtime,'api.mjs')));
  const api=await create({...options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>f.state.actor});
  try{assert.equal((await api.execute({operationId:'copied-runtime-inspection',command:{type:'inspectCaller'}})).result.projectId,projectId);}finally{await api.close();}
  if(engine==='postgres')await assert.rejects(access(join(f.root,'.team-orchestrator','team.sqlite')),{code:'ENOENT'});
  await assert.rejects(readReservedLaunchProfile(path,f.launchProfileRoot),{code:'API_LAUNCH_PROFILE_INVALID'});
 });
 test('reserved scope and missing native target are refused before binding; changed incarnation needs review',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);await f.api.launch({operationId:'claim',command:{...f.authority,type:'claimLaunch',launchId:'launch-a'}});
  const fixed={projectRoot:f.root,machineId:'machine',contextId:'context',projectId:(await f.api.execute({operationId:'project',command:{type:'inspectCaller'}})).result.projectId,launchId:'launch-a',memberId:'a'};
  const child=f.actor('native-child','new-terminal');f.state.actor=child;
  const adapter=async expected=>createCodexAdapter({...f.options,observation:false,reservedLaunch:expected},{createIdentity:async()=>({verifyCaller:async()=>f.state.actor})});
  const probe=async(expected,code)=>{const a=await adapter(expected);try{await assert.rejects(a.call('team_guard',{tool:'exec_command',input:{cmd:'task work'}},{threadId:'native-child'}),{code});}finally{await a.close();}};
  await probe(fixed,'API_LAUNCH_ATTACH_REQUIRED');
  f.state.actor=f.actor('head');f.state.target=Object.fromEntries(Object.entries(child).filter(([k])=>!['provider','conversationId'].includes(k)));
  await f.api.launch({operationId:'target',command:{...f.authority,type:'recordLaunchTarget',launchId:'launch-a'},target:{fixture:true}});f.state.actor=child;
  await probe({...fixed,projectId:randomUUID()},'API_LAUNCH_SCOPE');await probe({...fixed,memberId:'b'},'API_LAUNCH_SCOPE');
  assert.equal((await f.rows("SELECT * FROM member_bindings WHERE member_id='a'")).length,0);
  const a=await adapter(fixed);try{const decision=await a.call('team_guard',{tool:'spawn_agent',input:{}},{threadId:'native-child'});assert.equal(decision.hookSpecificOutput.permissionDecision,'deny');}finally{await a.close();}
  f.state.actor={...child,incarnationId:'new-process-incarnation'};await probe(fixed,'API_STALE_BINDING');
  assert.equal((await f.rows("SELECT incarnation_id FROM member_bindings WHERE member_id='a'"))[0].incarnation_id,child.incarnationId);
 });
 test('a reserved worker cannot use the ordinary unbound-session allowance when its store is missing',async t=>{
  const f=await runtimeFixture(t,engine),actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'child',contextId:'context',executionHostId:'local',terminalHandle:'term-child',incarnationId:'inc-child'};
  const adapter=await createCodexAdapter({...f.options,observation:false,reservedLaunch:{projectRoot:f.root,machineId:'machine',contextId:'context',projectId:randomUUID(),launchId:'expected-launch',memberId:'expected-worker'}},{createIdentity:async()=>({verifyCaller:async()=>actor})});
  try{await assert.rejects(adapter.call('team_guard',{tool:'exec_command',input:{cmd:'arbitrary worker task'}},{threadId:'child'}),{code:engine==='sqlite'?'STORE_NOT_FOUND':'STORE_EMPTY'});}finally{await adapter.close();}
 });
 test('one native-reviewed plan reserves exactly its workers without inventing conversation identities',async t=>{
  const f=await fixture(t,engine);
  await assert.rejects(f.api.execute(f.request),{code:'API_OPERATION_DENIED'});
  f.state.approved=false;await assert.rejects(f.api.launch(f.request),{code:'API_APPROVAL_REQUIRED'});
  assert.equal((await f.rows('SELECT * FROM member_launches')).length,0);
  f.state.approved=true;const receipt=await f.api.launch(f.request);assert.equal(receipt.result.planId,'plan');
  assert.deepEqual(await f.api.reconcileLaunch(f.request),receipt);
  assert.equal((await f.rows('SELECT * FROM launch_plans')).length,1);
  const launches=await f.rows('SELECT * FROM member_launches ORDER BY member_id');assert.deepEqual(launches.map(l=>l.member_id),['a','b']);assert.ok(launches.every(l=>l.status==='queued'&&l.conversation_id===null));
 });
 test('capacity includes uncertain starts, and only the recorded terminal can attach its native conversation',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);
  const claim=id=>f.api.launch({operationId:`claim-${id}`,command:{...f.authority,type:'claimLaunch',launchId:`launch-${id}`}});
  assert.equal((await claim('a')).result.claimed,true);assert.equal((await claim('b')).result.queued,true);
  assert.equal((await f.api.launch({operationId:'claim-again',command:{...f.authority,type:'claimLaunch',launchId:'launch-a'}})).result.claimed,false);
  const child=f.actor('native-assigned-thread','new-terminal');f.state.target=Object.fromEntries(Object.entries(child).filter(([k])=>!['provider','conversationId'].includes(k)));
  await f.api.launch({operationId:'target',command:{...f.authority,type:'recordLaunchTarget',launchId:'launch-a'},target:{nativeReceipt:'fixture'}});
  f.state.actor=f.actor('unrelated');assert.equal((await f.api.launch({operationId:'wrong-attach',command:{type:'attachLaunch'}})).result.attached,false);
  f.state.actor=child;const attached=await f.api.launch({operationId:'attach',command:{type:'attachLaunch'}});assert.equal(attached.result.memberId,'a');
  assert.equal((await f.api.execute({operationId:'child-caller',command:{type:'inspectCaller'}})).result.member.member_id,'a');
  assert.equal((await f.rows("SELECT conversation_id FROM member_launches WHERE launch_id='launch-a'"))[0].conversation_id,'native-assigned-thread');
  f.state.actor=f.actor('head');assert.equal((await f.api.launch({operationId:'still-full',command:{...f.authority,type:'claimLaunch',launchId:'launch-b'}})).result.queued,true);
 });
 test('a worker role edit invalidates its queued approval and a fresh reviewed plan can renew it',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);
  const edit=await f.api.manageTeam({operationId:'role-edit',command:{...f.authority,type:'editTeam',changes:[{type:'updateMember',memberId:'a',expectedMemberGeneration:1,patch:{officialText:'Changed reviewed role'}}]}});
  const authority={...f.authority,expectedConfigVersion:edit.result.configVersion};
  await assert.rejects(f.api.launch({operationId:'stale-claim',command:{...authority,type:'claimLaunch',launchId:'launch-a'}}),{code:'API_STALE_AUTHORITY'});
  await f.api.launch({operationId:'renewed-review',command:{...f.request.command,...authority,planId:'reviewed-again',selections:[{...f.request.command.selections[0],expectedOfficialGeneration:2}]}});
  assert.equal((await f.api.launch({operationId:'renewed-claim',command:{...authority,type:'claimLaunch',launchId:'launch-a'}})).result.claimed,true);
 });
 test('the approved queue starts once, records its terminal before input, and launches later workers when capacity grows',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);let creates=0,starts=0;
  const native={codexExecutable:'C:/native/codex.exe',launchProfileRoot:f.launchProfileRoot,createLaunchTerminal:async()=>{creates++;const child=f.actor(`native-${creates}`,`new-${creates}`);f.state.target=Object.fromEntries(Object.entries(child).filter(([k])=>!['provider','conversationId'].includes(k)));return f.state.target;},startLaunchTerminal:async target=>{assert.equal((await f.rows(`SELECT * FROM launch_targets WHERE terminal_handle='${target.terminalHandle}'`)).length,1);starts++;}};
  const pump=async()=>pumpCodexLaunches({api:f.api,postgres:f.options.postgres,native,actor:f.state.actor,metadata:{threadId:'head'},info:(await f.api.execute({operationId:`info-${creates}-${starts}`,command:{type:'inspectCaller'}})).result});
  await pump();await pump();assert.equal(creates,1);assert.equal(starts,1);
  await f.api.manageTeam({operationId:'capacity',command:{...f.authority,type:'editTeam',changes:[{type:'saveSettings',settings:{...settings,maxOpen:3}}]}});
  await pump();assert.equal(creates,2);assert.equal(starts,2);assert.equal((await f.rows('SELECT * FROM launch_plans')).length,1);
 });
 test('an unknown native creation result keeps its claimed slot and is never automatically retried',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);let creates=0;
  const native={codexExecutable:'C:/native/codex.exe',launchProfileRoot:f.launchProfileRoot,createLaunchTerminal:async()=>{creates++;throw Error('Creation result lost');},startLaunchTerminal:async()=>assert.fail('No confirmed terminal')};
  const info=(await f.api.execute({operationId:'info',command:{type:'inspectCaller'}})).result;
  await pumpCodexLaunches({api:f.api,postgres:f.options.postgres,native,actor:f.state.actor,info});await pumpCodexLaunches({api:f.api,postgres:f.options.postgres,native,actor:f.state.actor,info});
  assert.equal(creates,1);const launches=await f.rows('SELECT status FROM member_launches ORDER BY member_id');assert.deepEqual(launches.map(l=>l.status),['claimed','queued']);assert.equal((await f.rows('SELECT * FROM launch_targets')).length,0);
 });
 test('native plan review cannot be replaced by arguments and its lost reply reconciles without a second review',async t=>{
  const f=await fixture(t,engine);let reviews=0,lost=true,accept=false;
  const native={launchWorkers:true,verifyCaller:async()=>f.state.actor};
  const adapter=await createCodexAdapter({observation:false,...f.options},{createIdentity:async()=>native,createApi:async options=>{const api=await createTeamApi({...options,...f.options});return {...api,launch:async request=>{const answer=await api.launch(request);if(lost){lost=false;throw Object.assign(Error('Lost committed reply'),{code:'STORE_COMMIT_UNKNOWN'});}return answer;}};}});
  const connection={canElicit:true,elicit:async review=>{reviews++;assert.match(review.message,/listed Codex workers/);assert.match(review.message,/Read role before admitted work/);return {action:accept?'accept':'decline',content:{confirm:true}};}};
  await assert.rejects(adapter.call('shared_team_launch',{...f.request,confirm:true},{threadId:'head'},connection),{code:'API_INPUT_INVALID'});
  await assert.rejects(adapter.call('shared_team_launch',f.request,{threadId:'head'},connection),error=>error.code==='API_APPROVAL_UNVERIFIED'&&error.message==='Approval not obtained; delivery unverified. No changes made.');assert.equal((await f.rows('SELECT * FROM launch_plans')).length,0);
  accept=true;await assert.rejects(adapter.call('shared_team_launch',f.request,{threadId:'head'},connection),{code:'STORE_COMMIT_UNKNOWN'});
  const result=await adapter.call('shared_team_launch',{...f.request,reconcile:true},{threadId:'head'},connection);assert.equal(result.result.planId,'plan');assert.equal(reviews,2);assert.equal((await f.rows('SELECT * FROM launch_plans')).length,1);await adapter.close();
 });
 test('the child binds through its verified terminal before the first permission hook can allow work',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);await f.api.launch({operationId:'claim',command:{...f.authority,type:'claimLaunch',launchId:'launch-a'}});
  const child=f.actor('native-child','new-terminal');f.state.target=Object.fromEntries(Object.entries(child).filter(([k])=>!['provider','conversationId'].includes(k)));
  await f.api.launch({operationId:'target',command:{...f.authority,type:'recordLaunchTarget',launchId:'launch-a'},target:{fixture:true}});f.state.actor=child;
  const unbound=await f.make();try{await assert.rejects(unbound.execute({operationId:'before-attach',command:{type:'inspectCaller'}}),{code:'API_LAUNCH_ATTACH_REQUIRED'});}finally{await unbound.close();}
  const adapter=await createCodexAdapter({observation:false,...f.options},{createIdentity:async()=>({launchWorkers:true,verifyCaller:async()=>child}),createApi:options=>createTeamApi({...options,...f.options})});
  const decision=await adapter.call('team_guard',{tool:'spawn_agent',input:{prompt:'Unapproved delegation'}},{threadId:'native-child'});
  assert.equal(decision.hookSpecificOutput.permissionDecision,'deny');assert.equal((await f.api.execute({operationId:'after-attach',command:{type:'inspectCaller'}})).result.member.member_id,'a');await adapter.close();
 });
 test('an approved unbound controller processes only its reviewed queue from the periodic loop',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);await rawWrite(f,"DELETE FROM member_bindings WHERE member_id='head'");let tick,starts=0;
  const native={launchWorkers:true,codexExecutable:'C:/native/codex.exe',launchProfileRoot:f.launchProfileRoot,verifyCaller:async()=>f.state.actor,verifyLaunchTarget:async()=>f.state.target,createLaunchTerminal:async()=>{const a=f.actor('native',`new-${starts}`);f.state.target=Object.fromEntries(Object.entries(a).filter(([k])=>!['provider','conversationId'].includes(k)));return f.state.target;},startLaunchTerminal:async()=>{starts++;},wake:async()=>assert.fail('Unbound controllers do not consume member mail')};
  const observer=createCodexObserver({native,postgres:f.options.postgres,createApi:options=>createTeamApi({...options,...f.options}),timers:{setTimeout:fn=>{tick=fn;return 1;},clearTimeout:()=>{tick=null;}}});
  try{observer.activate({threadId:'head'},f.state.actor);assert.equal(starts,0);await tick();assert.equal(starts,2);assert.equal(observer.status().state,'waiting-for-member');await tick();assert.equal(starts,2);}finally{await observer.close();}
 });
 test('launch approval history and native targets cannot be rewritten or replaced',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);
  await assert.rejects(rawWrite(f,"UPDATE launch_plans SET selection_json='{}'"));await assert.rejects(rawWrite(f,'DELETE FROM launch_plan_members'));
  assert.equal((await f.rows('SELECT * FROM launch_plan_members')).length,2);assert.equal((await f.rows('SELECT * FROM launch_plans')).length,1);
 });
 test('lost claim replies never authorize a native effect or release capacity',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);let lost=false;
  const api={...f.api,launch:async request=>{const receipt=await f.api.launch(request);if(request.command.type==='claimLaunch'&&receipt.result.claimed&&!lost){lost=true;throw Object.assign(Error('Lost claim reply'),{code:'STORE_COMMIT_UNKNOWN'});}return receipt;}};
  const native={codexExecutable:'C:/native/codex.exe',launchProfileRoot:f.launchProfileRoot,createLaunchTerminal:async()=>assert.fail('Unknown claim cannot start'),startLaunchTerminal:async()=>assert.fail('Unknown claim cannot send')};
  const info=(await f.api.execute({operationId:'info',command:{type:'inspectCaller'}})).result;
  await pumpCodexLaunches({api,postgres:f.options.postgres,native,actor:f.state.actor,info});await pumpCodexLaunches({api,postgres:f.options.postgres,native,actor:f.state.actor,info});
  assert.equal((await f.rows("SELECT status FROM member_launches WHERE launch_id='launch-a'"))[0].status,'claimed');assert.equal((await f.rows("SELECT status FROM member_launches WHERE launch_id='launch-b'"))[0].status,'queued');
 });
 test('explicit connections cannot race a queued or claimed start into duplicate sessions',async t=>{
  const f=await fixture(t,engine);await f.api.launch(f.request);
  const api=await f.make({verifyTarget:async()=>f.actor('existing-session','existing-terminal')});
  const target={projectRoot:f.root,conversationId:'existing-session',terminalHandle:'existing-terminal',contextId:'context'};
  const bind=(id,authority)=>api.manageTeam({operationId:`connect-${id}`,command:{...authority,type:'bindMember',memberId:id,expectedMemberGeneration:1,expectedBindingGeneration:0},target});
  await bind('b',f.authority);
  await assert.rejects(api.launch({operationId:'cannot-duplicate-b',command:{...f.authority,type:'claimLaunch',launchId:'launch-b'}}),{code:'API_LAUNCH_BOUND'});
  const edited=await api.manageTeam({operationId:'more-capacity',command:{...f.authority,type:'editTeam',changes:[{type:'saveSettings',settings:{...settings,maxOpen:3}}]}}),authority={...f.authority,expectedConfigVersion:edited.result.configVersion};
  assert.equal((await api.launch({operationId:'claim-a',command:{...authority,type:'claimLaunch',launchId:'launch-a'}})).result.claimed,true);
  await assert.rejects(bind('a',authority),{code:'API_LAUNCH_PENDING'});
 });
});
