import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCodexAdapter} from '../codex-mcp.mjs';
import {createTeamApi} from '../api.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:8,launch:'demand',batch:3,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
const modRelease=JSON.parse(await readFile(new URL('../../../team-orchestrator/.claude-plugin/plugin.json',import.meta.url),'utf8')).version;
for(const engine of ['sqlite','postgres'])describe(`${engine} Codex-native management`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 async function setup(t,{launchWorkers=false}={}){
  const f=await runtimeFixture(t,engine),actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'codex-head',executionHostId:'local',contextId:'context',terminalHandle:'codex-head-terminal',incarnationId:'inc'};
  const state={actor,reply:{action:'accept',content:{confirm:true}},reviews:[],lost:false},metadata={threadId:'native-fixed'};
  const native={launchWorkers,verifyCaller:async m=>{assert.equal(m,metadata);return {...state.actor};},verifyTarget:async target=>{if(target.conversationId!=='codex-head')throw Error('Unverified');return {...state.actor};},listTargets:async()=>({sessions:[]})};
  const make=async(writer={client:'team-orchestrator',version:'0.5.56'})=>{const adapter=await createCodexAdapter({...f.options,writer,observation:false},{createIdentity:async()=>native,createApi:async options=>{
   const api=await createTeamApi({...options,...f.options});
   return {...api,manageTeam:async request=>{const result=await api.manageTeam(request);if(state.lost){state.lost=false;throw Object.assign(Error('Lost reply'),{code:'STORE_COMMIT_UNKNOWN'});}return result;}};
  }});t.after(()=>adapter.close());return adapter;};
  // A real person takes time to answer. Replies are delayed past the review floor
  // so the tests exercise the human path unless they deliberately opt out.
  const adapter=await make(),connection={canElicit:true,elicit:async p=>{state.reviews.push(p);await new Promise(r=>setTimeout(r,state.replyDelayMs??1100));return typeof state.reply==='function'?state.reply(p):state.reply;}};
  const create={type:'createFreshTeam',teamId:'team',name:'Codex team',functionText:'Native management',settings,members:[{memberId:'head',name:'Head',bossMemberId:null,role:'Lead',officialText:'Delegate and review.',cli:'codex'},{memberId:'worker',name:'Worker',bossMemberId:'head',role:'Verify',officialText:'Verify before reporting.',cli:'codex'}],expectedControllerGeneration:1};
  const call=(command,operationId='create',extra={})=>adapter.call('shared_team_manage',{operationId,command,...extra},metadata,connection);
  const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
  return {...f,state,metadata,connection,adapter,make,call,create,rows,actor};
 }
 test('the production Codex writer can read and edit after the current Mod advances the shared fence',async t=>{
  const f=await setup(t);await f.call(f.create);
  const mod=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:modRelease},authenticate:async()=>f.actor,confirmManagement:async()=>true});
  try{await mod.manageTeam({operationId:'mod-edit',command:{type:'editTeam',teamId:'team',expectedConfigVersion:5,expectedControllerGeneration:1,changes:[{type:'updateTeam',name:'Edited by Mod',functionText:'Shared configuration'}]}});}finally{await mod.close();}
  const current=await f.make(null),status=await current.call('shared_team_status',{},f.metadata,f.connection);
  assert.equal(status.info.controllerGeneration,1);
  const edited=await current.call('shared_team_manage',{operationId:'codex-after-mod',command:{type:'editTeam',teamId:'team',expectedConfigVersion:6,expectedControllerGeneration:1,changes:[{type:'updateTeam',name:'Edited by Codex',functionText:'Shared configuration'}]}},f.metadata,f.connection);
  assert.equal(edited.result.configVersion,7);
  await assert.rejects(f.adapter.call('shared_team_status',{},f.metadata,f.connection),e=>e.code==='STORE_WRITER_TOO_OLD');
  assert.equal((await f.rows("SELECT writer_version FROM writer_fences WHERE writer_client='team-orchestrator'"))[0].writer_version,modRelease);
  assert.equal((await f.rows('SELECT name FROM teams'))[0].name,'Edited by Codex');
 });
 test('one native review approves this Codex conversation and creates its team without a Claude session',async t=>{
  const f=await setup(t);const result=await f.call(f.create);assert.equal(result.result.configVersion,5);assert.equal(f.state.reviews.length,1);assert.ok(f.state.reviews[0].message.includes('"approveController": true'));
  assert.deepEqual((await f.rows('SELECT provider,conversation_id FROM controller_approvals')).map(r=>[r.provider,r.conversation_id]),[['codex','codex-head']]);
  assert.equal((await f.rows('SELECT cli FROM members')).every(m=>m.cli==='codex'),true);
  const resumed=await f.make();const status=await resumed.call('shared_team_status',{},f.metadata,f.connection);assert.equal(status.info.controllerGeneration,1);assert.equal(status.guardTrust,'not-attested');
 });
 test('decline, cancel, false confirmation, missing native review and forged approval fields never grant authority',async t=>{
  const f=await setup(t);
  for(const reply of [{action:'decline'},{action:'cancel'},{action:'accept',content:{confirm:false}},{action:'accept',content:{confirm:'true'}}]){f.state.reply=reply;await assert.rejects(f.call(f.create),e=>e.code==='API_APPROVAL_REQUIRED');}
  await assert.rejects(f.adapter.call('shared_team_manage',{operationId:'create',command:f.create},f.metadata,{canElicit:false}),e=>e.code==='API_REVIEW_UNAVAILABLE');
  await assert.rejects(f.call(f.create,'forged',{approval:true}),e=>e.code==='API_INPUT_INVALID');
  await assert.rejects(f.adapter.call('shared_team',{operationId:'bypass',command:f.create},f.metadata,f.connection),e=>e.code==='API_MANAGEMENT_REVIEW_REQUIRED');
  if(engine==='sqlite')await assert.rejects(access(join(f.root,'.team-orchestrator','team.sqlite')));
 });
 test('a client that answers the form itself is never reported as a human decline',async t=>{
  const f=await setup(t);
  // The observed lockout: mcp_elicitations disabled makes Codex answer
  // {"action":"decline"} in about 1ms without ever showing a form. That must be
  // reported as approval-not-obtained, never as consent refused.
  f.state.replyDelayMs=0;
  for(const reply of [{action:'decline'},{action:'cancel'}]){f.state.reply=reply;
   const error=await f.call(f.create).then(()=>null,e=>e);
   assert.equal(error?.code,'API_APPROVAL_UNVERIFIED');
   assert.equal(error.message,'Approval not obtained; delivery unverified. No changes made.');
   // It must claim nothing about what the person did or saw.
   assert.ok(!/declined or cancelled/.test(error.message));
   assert.ok(!/No native form reached the person/.test(error.message));
   assert.ok(!/consent was given or withheld/.test(error.message));
   // The actionable detail travels as structured fields, not as prose claims.
   assert.equal(error.details?.elapsedMs<1000,true);
   assert.equal(error.details?.reviewFloorMs,1000);
   assert.match(error.details?.hint??'',/automatic decline by the client is one possible cause/);
   assert.match(error.details?.hint??'',/MCP confirmation prompts/);}
  assert.equal((await f.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")).length,0);
  // The probe reports the timing observation without a delivery claim.
  const silent=await f.adapter.call('shared_team_status',{},f.metadata,f.connection);
  assert.equal(silent.elicitationProbe.classification,'replies-too-fast-for-a-person-delivery-unverified');
  assert.equal(silent.elicitationProbe.humanPaced,0);
  assert.ok(silent.elicitationProbe.fastReplies>0);
  // A human-paced decline still reads as an ordinary decline.
  f.state.replyDelayMs=1100;f.state.reply={action:'decline'};
  await assert.rejects(f.call(f.create),e=>e.code==='API_APPROVAL_REQUIRED');
  const human=await f.adapter.call('shared_team_status',{},f.metadata,f.connection);
  assert.equal(human.elicitationProbe.classification,'human-paced-reply-delivery-unverified');
  assert.equal(human.elicitationProbe.delivery,'unverified');
 });
 test('a failed native review wait is not counted as a human-paced reply',async t=>{
  const f=await setup(t);
  const connection={canElicit:true,elicit:async()=>{await new Promise(r=>setTimeout(r,1100));throw Object.assign(Error('Disconnected'),{code:'API_REVIEW_UNAVAILABLE'});}};
  await assert.rejects(f.adapter.call('shared_team_manage',{operationId:'failed-wait',command:f.create},f.metadata,connection),{code:'API_REVIEW_UNAVAILABLE'});
  const {elicitationProbe:p}=await f.adapter.call('shared_team_status',{},f.metadata,connection);
  assert.equal(p.attempts,1);assert.equal(p.failedWaits,1);assert.equal(p.humanPaced,0);assert.equal(p.fastReplies,0);assert.equal(p.lastOutcome,'failed');assert.equal(p.classification,'no-reply');assert.equal(p.delivery,'unverified');
  assert.equal((await f.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='teams'")).length,0);
 });
 test('create and edit receipts survive interruption and never ask again or duplicate effects',async t=>{
  const f=await setup(t);f.state.lost=true;await assert.rejects(f.call(f.create),e=>e.code==='STORE_COMMIT_UNKNOWN');
  const recovered=await f.call(f.create);assert.equal(recovered.result.teamId,'team');assert.equal(f.state.reviews.length,1);
  const edit={type:'editTeam',teamId:'team',expectedConfigVersion:5,expectedControllerGeneration:1,changes:[{type:'updateTeam',name:'Revised',functionText:'Revised purpose'},{type:'addMember',memberId:'claude-worker',name:'Claude worker',bossMemberId:'head',role:'Implement',officialText:'Read the task.',cli:'claude'},{type:'updateMember',memberId:'worker',expectedMemberGeneration:1,patch:{name:'Verifier',officialText:'Check independently.',allowAgent:true}}]};
  const changed=await f.call(edit,'edit');assert.equal(changed.result.changesApplied,3);assert.equal(f.state.reviews.length,2);assert.ok(f.state.reviews[1].message.includes('"current"'));
  assert.deepEqual(await f.call(edit,'edit',{reconcile:true}),changed);assert.equal(f.state.reviews.length,2);
  const snapshot=await f.adapter.call('shared_team',{operationId:'inspect',command:{type:'inspectTeam',teamId:'team'}},f.metadata,f.connection);
  assert.equal(snapshot.result.team.name,'Revised');assert.equal(snapshot.result.members.find(m=>m.member_id==='worker').name,'Verifier');assert.equal(snapshot.result.roles.find(r=>r.member_id==='worker').official_text,'Check independently.');
 });
 test('edit is atomic, stale versions refuse, and native scope changes during review grant nothing',async t=>{
  const f=await setup(t);await f.call(f.create);
  const edit={type:'editTeam',teamId:'team',expectedConfigVersion:5,expectedControllerGeneration:1,changes:[{type:'updateTeam',name:'Must roll back',functionText:'Rollback'},{type:'updateMember',memberId:'worker',expectedMemberGeneration:99,patch:{name:'Stale'}}]};
  await assert.rejects(f.call(edit,'bad-edit'),e=>e.code==='API_STALE_AUTHORITY');assert.equal((await f.rows('SELECT name FROM teams'))[0].name,'Codex team');
  await assert.rejects(f.call({...edit,expectedConfigVersion:99},'stale'),e=>e.code==='API_STALE_AUTHORITY');
  const before=f.state.reviews.length;await assert.rejects(f.call({...edit,changes:[{type:'updateMember',memberId:'worker',expectedMemberGeneration:1,patch:{cli:'claude'}}]},'convert'),e=>e.code==='API_EDIT_INVALID');assert.equal(f.state.reviews.length,before);
  f.state.reply=()=>{f.state.actor={...f.state.actor,incarnationId:'new'};return {action:'accept',content:{confirm:true}};};
  await assert.rejects(f.call({...edit,changes:[{type:'updateTeam',name:'Rejected scope',functionText:'No'}]},'changed-scope'),e=>e.code==='API_STALE_AUTHORITY');assert.equal((await f.rows('SELECT name FROM teams'))[0].name,'Codex team');
 });
 test('management edits cannot bypass the private native confirmation API',async t=>{
  const f=await setup(t);await f.call(f.create);const api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.56'},authenticate:async()=>f.actor});
  try{const request={operationId:'raw-edit',command:{type:'editTeam',teamId:'team',expectedConfigVersion:5,expectedControllerGeneration:1,changes:[{type:'updateTeam',name:'Bypass',functionText:''}]}};await assert.rejects(api.execute(request),e=>e.code==='API_OPERATION_DENIED');await assert.rejects(api.manageTeam(request),e=>e.code==='API_APPROVAL_REQUIRED');}finally{await api.close();}
 });
 test('resumed controller approval can explicitly reconnect its stale member binding',async t=>{
  const f=await setup(t);await f.call(f.create);
  const bind={type:'bindMember',teamId:'team',memberId:'head',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:0,expectedControllerGeneration:1},target={projectRoot:f.root,conversationId:'codex-head',terminalHandle:'codex-head-terminal',contextId:'context'};
  await f.call(bind,'bind',{target});f.state.actor={...f.state.actor,incarnationId:'resumed'};
  const status=await f.adapter.call('shared_team_status',{},f.metadata,f.connection);assert.equal(status.info.controllerGeneration,1);assert.equal(status.info.bindingState,'stale-needs-explicit-reconnect');assert.equal(status.info.recovery,'shared_team_manage bindMember with a native review');
  const reviewsBefore=f.state.reviews.length;
  const result=await f.call({...bind,expectedBindingGeneration:1},'reconnect',{target});assert.equal(result.result.bindingGeneration,2);assert.equal((await f.rows('SELECT incarnation_id FROM member_bindings'))[0].incarnation_id,'resumed');
  // The loop must close through a human review, not around it.
  assert.equal(f.state.reviews.length,reviewsBefore+1,'the rebind must require exactly one native review');
  assert.match(f.state.reviews.at(-1).message,/bindMember/);
  const after=await f.adapter.call('shared_team_status',{},f.metadata,f.connection);
  assert.equal(after.info.bindingState,undefined,'a completed rebind must clear the stale state');
  assert.equal(after.info.member.member_id,'head');
 });
 test('launch-enabled stale recovery still requires native approval before rebinding',async t=>{
  const f=await setup(t,{launchWorkers:true});await f.call(f.create);
  const bind={type:'bindMember',teamId:'team',memberId:'head',expectedConfigVersion:5,expectedMemberGeneration:1,expectedBindingGeneration:0,expectedControllerGeneration:1},target={projectRoot:f.root,conversationId:'codex-head',terminalHandle:'codex-head-terminal',contextId:'context'};
  await f.call(bind,'initial-bind',{target});f.state.actor={...f.state.actor,incarnationId:'resumed-launch-enabled'};
  const status=await f.adapter.call('shared_team_status',{},f.metadata,f.connection);
  assert.equal(status.info.bindingState,'stale-needs-explicit-reconnect');
  assert.equal(status.elicitationProbe.classification,'human-paced-reply-delivery-unverified');
  assert.deepEqual(await f.adapter.call('shared_team_sessions',{},f.metadata),{sessions:[]});
  const recovered={...bind,expectedBindingGeneration:1};
  const unchanged=async()=>{
   const [binding]=await f.rows('SELECT generation,incarnation_id FROM member_bindings');
   assert.equal(Number(binding.generation),1);assert.equal(binding.incarnation_id,'inc');
   assert.equal(Number((await f.rows('SELECT generation FROM controller_approvals'))[0].generation),1);
  };
  f.state.replyDelayMs=0;
  for(const command of [{type:'approveController'},recovered]){
   const extra=command.type==='bindMember'?{target}:{};
   await assert.rejects(f.adapter.call('shared_team_manage',{operationId:'missing-review-'+command.type,command,...extra},f.metadata,{canElicit:false}),{code:'API_REVIEW_UNAVAILABLE'});
   for(const [i,reply] of [{action:'decline'},{action:'cancel'},{action:'accept',content:{confirm:false}}].entries()){
    f.state.reply=reply;
    await assert.rejects(f.call(command,'refused-'+command.type+'-'+i,extra),{code:'API_APPROVAL_UNVERIFIED'});
    await unchanged();
   }
  }
  await assert.rejects(f.call(recovered,'forged-recovery',{target,approval:true}),{code:'API_INPUT_INVALID'});
  await unchanged();
  f.state.reply={action:'accept',content:{confirm:true}};f.state.replyDelayMs=1100;
  const reviewsBefore=f.state.reviews.length;
  const result=await f.call(recovered,'approved-recovery',{target});
  assert.equal(result.result.bindingGeneration,2);
  assert.equal(f.state.reviews.length,reviewsBefore+1);
  assert.match(f.state.reviews.at(-1).message,/bindMember/);
  assert.equal((await f.rows('SELECT incarnation_id FROM member_bindings'))[0].incarnation_id,'resumed-launch-enabled');
  const after=await f.adapter.call('shared_team_status',{},f.metadata,f.connection);
  assert.equal(after.info.bindingState,undefined);assert.equal(after.info.member.member_id,'head');
 });
 test('revoked controller approvals are refused without another misleading review',async t=>{
  const f=await setup(t);await f.call(f.create);await rawWrite(f,'UPDATE controller_approvals SET revoked=1,generation=generation+1');const count=f.state.reviews.length;
  await assert.rejects(f.call({...f.create,teamId:'another'},'revoked'),e=>e.code==='API_CONTROLLER_REVOKED');assert.equal(f.state.reviews.length,count);
 });
});
