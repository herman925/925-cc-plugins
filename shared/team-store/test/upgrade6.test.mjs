import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {upgradeTeamStore,openTeamStore} from '../index.mjs';
import * as legacy from '../src/schema6-contract.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
for(const engine of ['sqlite','postgres'])test(`${engine}: explicit schema 6 update preserves complete history and adds bounded runtime guards`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const f=await runtimeFixture(t,engine),db=await f.raw();
 try{await db.begin();await db.exec(legacy.ddlFor(engine));await seedLayout(db);await db.commit();}finally{await db.close();}
 const options={...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.52'},operationId:'upgrade6',backupRoot:join(f.root,'backups'),caller:{principalId:'user-action'},authorize:()=>true};
 await assert.rejects(openTeamStore({...options,create:false}),e=>e.code==='STORE_VERSION_UNSUPPORTED');
 const receipt=await upgradeTeamStore(options);assert.equal(receipt.fromVersion,6);assert.equal(receipt.toVersion,8);
 const backup=JSON.parse(await readFile(receipt.backupPath,'utf8'));assert.equal(backup.schemaVersion,6);assert.equal(backup.schemaSql,legacy.ddlFor(engine));assert.equal(backup.tables.members.length,6);
 assert.deepEqual(await upgradeTeamStore(options),receipt);
 const check=await f.raw();try{
  assert.equal(Number((await check.query('SELECT schema_version FROM store_metadata'))[0].schema_version),8);
  assert.equal((await check.query('SELECT * FROM members')).length,6);
  await check.begin();
  await check.query("INSERT INTO controller_approvals VALUES ('c','machine','claude','conversation',1,1,0)");
  await check.query("INSERT INTO member_launches VALUES ('l','worker','c','machine','reserved','queued',1,1)");
  await check.query("UPDATE member_launches SET status='claimed',generation=2 WHERE launch_id='l'");
  await assert.rejects(check.query("UPDATE member_launches SET status='queued',generation=3 WHERE launch_id='l'"),/STORE_RUNTIME_IMMUTABLE/);
  if(engine==='sqlite')await assert.rejects(check.query("INSERT OR REPLACE INTO member_launches VALUES ('new','worker','c','machine','other','queued',1,1)"),/STORE_RUNTIME_IMMUTABLE/);
 }finally{await check.rollback().catch(()=>{});await check.close();}
});
