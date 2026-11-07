import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {upgradeTeamStore} from '../index.mjs';
import * as schema9 from '../src/schema9-contract.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {workerReadiness} from '../src/worker-readiness.mjs';
import {inspectSchema} from '../src/bootstrap.mjs';
for(const engine of ['sqlite','postgres'])describe(`${engine} explicit schema 9 upgrade`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 test('upgrade preserves process-only plans and history without manufacturing worker consent or readiness',async t=>{
  const f=await runtimeFixture(t,engine),db=await f.raw();
  try{await db.begin();await db.exec(schema9.ddlFor(engine));await seedLayout(db);
   await db.query("UPDATE members SET cli='codex' WHERE member_id='worker'");
   await db.exec("INSERT INTO controller_approvals VALUES ('controller','machine','codex','head',1,1,0); INSERT INTO member_launches VALUES ('old-launch','worker','controller','machine','old-conversation','bound',3,2); INSERT INTO launch_plans VALUES ('old-plan','fixture-team','controller','machine',1,'[]',3); INSERT INTO launch_plan_members VALUES ('old-launch','old-plan',1,1,1); INSERT INTO operations VALUES ('preserved','fingerprint','{}',4)");
   await db.commit();
  }finally{await db.close();}
  const options={...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.61'},operationId:'upgrade9',backupRoot:join(f.root,'backups'),caller:{principalId:'explicit-fixture-review'},authorize:()=>true};
  const receipt=await upgradeTeamStore(options);assert.equal(receipt.fromVersion,9);assert.equal(receipt.toVersion,10);
  const backup=JSON.parse(await readFile(receipt.backupPath,'utf8'));assert.equal(backup.schemaVersion,9);assert.equal(backup.tables.launch_plans[0].plan_id,'old-plan');
  const after=await f.raw();try{
   assert.equal((await inspectSchema(after)).version,10);
   assert.equal((await after.query('SELECT * FROM worker_tool_consents')).length,0);assert.equal((await after.query('SELECT * FROM worker_readiness')).length,0);
   assert.equal((await workerReadiness(after,'worker',Date.now())).state,'setup_required');
   assert.equal((await after.query('SELECT * FROM launch_plans'))[0].plan_id,'old-plan');assert.equal((await after.query('SELECT * FROM operations'))[0].operation_id,'preserved');
  }finally{await after.close();}
  assert.deepEqual(await upgradeTeamStore(options),receipt);
 });
});
