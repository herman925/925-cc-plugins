import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import * as schema5 from '../src/schema5-contract.mjs';
import * as schema6 from '../src/schema6-contract.mjs';
import * as schema7 from '../src/schema7-contract.mjs';
import * as schema8 from '../src/schema8-contract.mjs';
import * as schema9 from '../src/schema9-contract.mjs';
import * as current from '../contract.mjs';
import {inspectGuardCaller,inspectGuardSchema} from '../src/guard-reader.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const engine of ['sqlite','postgres'])for(const schema of [schema5,schema6,schema7,schema8,schema9,current])test(`${engine}: schema ${schema.SCHEMA_VERSION} guard reads live authority without migration, lease or operation writes`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const f=await runtimeFixture(t,engine),db=await f.raw();
 try{await db.begin();await db.exec(schema.ddlFor(engine));await seedLayout(db);
  await db.query("UPDATE members SET worktree='context',home_context_kind='worktree',home_execution_host_id='local',home_original_path=:root,machine_id='machine'",{root:f.root});
  await db.query("INSERT INTO member_bindings VALUES ('head','machine','claude','head-conversation','local','context','head-terminal','head-incarnation',1)");await db.commit();
 }finally{await db.close();}
 const actor={projectRoot:f.root,machineId:'machine',provider:'claude',conversationId:'head-conversation',executionHostId:'local',contextId:'context',terminalHandle:'head-terminal',incarnationId:'head-incarnation'};
 const before=engine==='sqlite'?hash(await readFile(f.path)):null;
 const head=await inspectGuardCaller({actor,...(f.options.postgres?{postgres:f.options.postgres}:{})});
 assert.equal(head.member.member_id,'head');assert.equal(head.hasReports,true);assert.equal(head.member.allow_write,0);assert.equal(head.member.allow_agent,0);assert.equal(head.upgradeRequired,schema.SCHEMA_VERSION!==current.SCHEMA_VERSION);
 const unbound=await inspectGuardCaller({actor:{...actor,conversationId:'ordinary-conversation',terminalHandle:'ordinary-terminal'},...(f.options.postgres?{postgres:f.options.postgres}:{})});assert.equal(unbound.member,null);
 await assert.rejects(inspectGuardCaller({actor:{...actor,incarnationId:'wrong'},...(f.options.postgres?{postgres:f.options.postgres}:{})}),e=>e.code==='API_STALE_BINDING');
 const metadata=await inspectGuardSchema({actor:{...actor,incarnationId:'wrong'},...(f.options.postgres?{postgres:f.options.postgres}:{})});assert.deepEqual(metadata,{storeVersion:schema.SCHEMA_VERSION,upgradeRequired:schema.SCHEMA_VERSION!==current.SCHEMA_VERSION});
 if(engine==='sqlite')assert.equal(hash(await readFile(f.path)),before);
 const check=await f.raw();try{assert.equal(Number((await check.query('SELECT schema_version FROM store_metadata'))[0].schema_version),schema.SCHEMA_VERSION);assert.equal((await check.query('SELECT * FROM operations')).length,0);assert.equal((await check.query('SELECT holder_token FROM store_lease'))[0].holder_token,null);}finally{await check.close();}
});
test('unknown schemas remain refused; a store mismatch never becomes permission evidence',async t=>{
 const f=await runtimeFixture(t,'sqlite'),db=await f.raw();try{await db.begin();await db.exec(schema7.ddlFor('sqlite'));await seedLayout(db);await db.exec('UPDATE store_metadata SET schema_version=99');await db.commit();}finally{await db.close();}
 const actor={projectRoot:f.root,machineId:'machine',provider:'claude',conversationId:'unknown',executionHostId:'local',contextId:'context',terminalHandle:'terminal',incarnationId:'incarnation'};
 const before=hash(await readFile(f.path));await assert.rejects(inspectGuardCaller({actor}),e=>e.code==='STORE_VERSION_UNSUPPORTED');assert.equal(hash(await readFile(f.path)),before);
 await assert.rejects(inspectGuardSchema({actor}),{code:'STORE_VERSION_UNSUPPORTED'});assert.equal(hash(await readFile(f.path)),before);
});
