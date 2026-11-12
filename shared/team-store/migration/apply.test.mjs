import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {createTeamApi} from '../api.mjs';
import {SHARED_WRITER} from '../src/runtime-release.mjs';
import {codexTools} from '../codex-mcp.mjs';
import {runtimeFixture,rawWrite} from '../test/support/runtime-fixture.mjs';
import {postgresTestUrl} from '../test/support/engines.mjs';
import {captureClassicSource} from './preview.mjs';
import {backupClassicSource} from './backup.mjs';
import {classicImportCommand} from './command.mjs';
const settings={autoClose:false,idleMinutes:10,reopen:'resume',maxOpen:4,launch:'demand',batch:1,autoScratch:false,assumptions:false,scratchDir:'.scratch',pickupWindowMinutes:2,answerWindowMinutes:3,taskWindowMinutes:null,replayIntervalMs:1000,exemptMemberIds:[]};
async function fixture(t,engine){
 let api;t.after(()=>api?.close());const f=await runtimeFixture(t,engine),source=join(f.root,'.claude','team-orchestrator');await mkdir(source,{recursive:true});
 const sourceBytes=JSON.stringify([{name:'Worker',team:'Demo',role:'Verify',boss:'Head',note:'Old unfinished brief',allowAgent:true},{name:'Head',team:'Demo',role:'Coordinate',boss:'user',allowWrite:true,cli:'codex'}]);await writeFile(join(source,'roster.json'),sourceBytes);
 const privateRoot=await mkdtemp(join(tmpdir(),'team-migration-private-'));t.after(async()=>{assert.equal(dirname(privateRoot),tmpdir());assert.ok(basename(privateRoot).startsWith('team-migration-private-'));await rm(privateRoot,{recursive:true,force:true});});
 const snapshot=await captureClassicSource({projectRoot:f.root}),backup=await backupClassicSource({snapshot,projectRoot:f.root,privateRoot});
 const state={approved:false,idle:true},actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'controller',executionHostId:'local',contextId:'context',terminalHandle:'term-controller',incarnationId:'inc-controller'};
 api=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>actor,confirmController:async()=>true,confirmClassicImport:async()=>state.approved,
  verifyClassicImport:async({command})=>state.idle&&(await captureClassicSource({projectRoot:f.root})).fingerprint===command.sourceFingerprint&&(await backupClassicSource({snapshot,projectRoot:f.root,privateRoot})).sha256===command.backupDigest});
 await api.approveController({operationId:'controller-approval'});
 const command=classicImportCommand({snapshot,backup,targetHome:actor,teamId:'imported',name:'Imported',functionText:'Import review',settings,expectedControllerGeneration:1}),request={operationId:'classic-import',command};
 const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
 return {...f,api,actor,state,source,sourceBytes,snapshot,backup,command,request,rows};
}
for(const engine of ['sqlite','postgres'])describe(`${engine} atomic native classic import`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 test('a complete native import preserves source and review notes, starts permissions off and creates no execution state',async t=>{
  const f=await fixture(t,engine);await assert.rejects(f.api.importClassicTeam(f.request),{code:'API_APPROVAL_REQUIRED'});assert.equal((await f.rows('SELECT * FROM teams')).length,0);
  f.state.approved=true;const result=await f.api.importClassicTeam(f.request);assert.equal(result.result.permissionPolicy,'start-disabled');assert.equal(result.result.sourceFingerprint,f.snapshot.fingerprint);
  const members=await f.rows('SELECT * FROM members');assert.equal(members.length,2);for(const m of members){assert.equal(Number(m.allow_write),0);assert.equal(Number(m.allow_agent),0);}
  const roles=await f.rows('SELECT * FROM role_documents');assert.ok(roles.some(r=>r.advisory_notes.includes('Old unfinished brief')));
  for(const table of ['member_bindings','member_launches','tasks','assignments','deliveries'])assert.equal((await f.rows(`SELECT * FROM ${table}`)).length,0);
  assert.equal(await readFile(join(f.source,'roster.json'),'utf8'),f.sourceBytes);
  f.state.approved=false;f.state.idle=false;await writeFile(join(f.source,'later-note.md'),'Changed after the completed import');assert.deepEqual(await f.api.reconcileClassicImport(f.request),result);assert.equal((await f.rows('SELECT * FROM teams')).length,1);
 });
 test('ordinary tools and model JSON cannot import or restore old permission switches',async t=>{
  const f=await fixture(t,engine);f.state.approved=true;
  await assert.rejects(f.api.execute(f.request),{code:'API_OPERATION_DENIED'});await assert.rejects(f.api.reconcile(f.request),{code:'API_OPERATION_DENIED'});
  await assert.rejects(f.api.manageTeam(f.request),{code:'API_OPERATION_DENIED'});
  const forged=structuredClone(f.request);forged.command.members[0].allowWrite=true;await assert.rejects(f.api.importClassicTeam(forged),{code:'API_INPUT_INVALID'});
  const missingCli=structuredClone(f.request);delete missingCli.command.members[1].cli;await assert.rejects(f.api.importClassicTeam(missingCli),{code:'API_INPUT_INVALID'});
  const wrongHome=structuredClone(f.request);wrongHome.command.targetHome.machineId='other-machine';await assert.rejects(f.api.importClassicTeam(wrongHome),{code:'API_IMPORT_HOME_UNVERIFIED'});
  const unverified=await createTeamApi({...f.options,projectRoot:f.root,machineId:'machine',writer:SHARED_WRITER,authenticate:async()=>f.actor,confirmClassicImport:async()=>true});try{await assert.rejects(unverified.importClassicTeam(f.request),{code:'API_IMPORT_SOURCE_UNVERIFIED'});}finally{await unverified.close();}
  assert.ok(!JSON.stringify(codexTools).includes('importClassicTeam'));assert.equal((await f.rows('SELECT * FROM teams')).length,0);
 });
 test('changed source, unsafe native source state and changed backup stop before any target write',async t=>{
  const f=await fixture(t,engine);f.state.approved=true;f.state.idle=false;await assert.rejects(f.api.importClassicTeam(f.request),{code:'API_IMPORT_SOURCE_UNVERIFIED'});f.state.idle=true;
  await writeFile(join(f.source,'new-notes.md'),'Changed after review');await assert.rejects(f.api.importClassicTeam(f.request),{code:'API_IMPORT_SOURCE_UNVERIFIED'});assert.equal((await f.rows('SELECT * FROM teams')).length,0);
  const changedBackup=await fixture(t,engine);changedBackup.state.approved=true;await writeFile(changedBackup.backup.path,'Incomplete external backup');await assert.rejects(changedBackup.api.importClassicTeam(changedBackup.request),{code:'MIGRATION_BACKUP_UNVERIFIED'});assert.equal((await changedBackup.rows('SELECT * FROM teams')).length,0);
 });
 test('a mid-import constraint failure rolls back the whole new hierarchy and role documents',async t=>{
  const f=await fixture(t,engine);f.state.approved=true;const bad=structuredClone(f.request);bad.command.members[1].name=bad.command.members[0].name;
  await assert.rejects(f.api.importClassicTeam(bad));for(const table of ['teams','members','role_documents'])assert.equal((await f.rows(`SELECT * FROM ${table}`)).length,0);
  assert.equal((await f.api.importClassicTeam(f.request)).result.memberIds.length,2);
 });
 test('remote original homes require mapping instead of relocating members to the importing machine',async t=>{
  const f=await fixture(t,engine),roster=JSON.parse(f.sourceBytes);roster[0].machine='another-machine';await writeFile(join(f.source,'roster.json'),JSON.stringify(roster));
  const snapshot=await captureClassicSource({projectRoot:f.root}),backup=await backupClassicSource({snapshot,projectRoot:f.root,privateRoot:dirname(f.backup.path)});
  assert.throws(()=>classicImportCommand({snapshot,backup,targetHome:f.command.targetHome,teamId:'other',name:'Other',functionText:'Review',settings,expectedControllerGeneration:1}),{code:'MIGRATION_MAPPING_REQUIRED'});assert.equal((await f.rows('SELECT * FROM teams')).length,0);
 });
 test('a revoked controller cannot recover an import receipt after losing authority',async t=>{
  const f=await fixture(t,engine);f.state.approved=true;await f.api.importClassicTeam(f.request);await rawWrite(f,'UPDATE controller_approvals SET revoked=1,generation=generation+1');
  await assert.rejects(f.api.reconcileClassicImport(f.request),{code:'API_CONTROLLER_REQUIRED'});assert.equal((await f.rows('SELECT * FROM teams')).length,1);
 });
});
