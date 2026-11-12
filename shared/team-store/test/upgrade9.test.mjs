import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {upgradeTeamStore} from '../index.mjs';
import * as schema9 from '../src/schema9-contract.mjs';
import * as schema10 from '../src/schema10-contract.mjs';
import {SCHEMA_VERSION} from '../contract.mjs';
import {WORKER_TOOL_POLICY,WORKER_TOOL_BUNDLE_JSON} from '../src/worker-policy.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {workerReadiness} from '../src/worker-readiness.mjs';
import {inspectSchema} from '../src/bootstrap.mjs';
for(const engine of ['sqlite','postgres'])for(const legacy of [schema9,schema10])describe(`${engine} explicit schema ${legacy.SCHEMA_VERSION} upgrade`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 test('upgrade preserves process-only plans and history without manufacturing worker consent or readiness',async t=>{
  const f=await runtimeFixture(t,engine),db=await f.raw();
  try{await db.begin();await db.exec(legacy.ddlFor(engine));await seedLayout(db);
   await db.query("UPDATE members SET cli='codex' WHERE member_id='worker'");
   await db.exec("INSERT INTO controller_approvals VALUES ('controller','machine','codex','head',1,1,0); INSERT INTO member_launches VALUES ('old-launch','worker','controller','machine','old-conversation','bound',3,2); INSERT INTO launch_plans VALUES ('old-plan','fixture-team','controller','machine',1,'[]',3); INSERT INTO launch_plan_members VALUES ('old-launch','old-plan',1,1,1); INSERT INTO operations VALUES ('preserved','fingerprint','{}',4)");
   if(legacy.SCHEMA_VERSION===10)await db.query('INSERT INTO worker_tool_consents VALUES (:launch,:plan,:policy,:tools,4)',{launch:'old-launch',plan:'old-plan',policy:WORKER_TOOL_POLICY,tools:WORKER_TOOL_BUNDLE_JSON});
   await db.commit();
  }finally{await db.close();}
  const options={...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.61'},operationId:'upgrade9',backupRoot:join(f.root,'backups'),caller:{principalId:'explicit-fixture-review'},authorize:()=>true};
  const receipt=await upgradeTeamStore(options);assert.equal(receipt.fromVersion,legacy.SCHEMA_VERSION);assert.equal(receipt.toVersion,SCHEMA_VERSION);
  const backup=JSON.parse(await readFile(receipt.backupPath,'utf8'));assert.equal(backup.schemaVersion,legacy.SCHEMA_VERSION);assert.equal(backup.tables.launch_plans[0].plan_id,'old-plan');
  const after=await f.raw();try{
   assert.equal((await inspectSchema(after)).version,SCHEMA_VERSION);
   const consents=await after.query('SELECT * FROM worker_tool_consents');assert.equal(consents.length,legacy.SCHEMA_VERSION===10?1:0);if(legacy.SCHEMA_VERSION===10)assert.deepEqual(consents,backup.tables.worker_tool_consents);assert.equal((await after.query('SELECT * FROM worker_readiness')).length,0);
   assert.equal((await after.query('SELECT * FROM managed_head_options')).length,0);assert.equal((await after.query('SELECT * FROM managed_head_tool_consents')).length,0);
   assert.equal((await workerReadiness(after,'worker',Date.now())).state,'setup_required');
   assert.equal((await after.query('SELECT * FROM launch_plans'))[0].plan_id,'old-plan');assert.equal((await after.query('SELECT * FROM operations'))[0].operation_id,'preserved');
  }finally{await after.close();}
  assert.deepEqual(await upgradeTeamStore(options),receipt);
 });
});
