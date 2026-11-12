import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {upgradeTeamStore} from '../index.mjs';
import * as legacy from '../src/schema7-contract.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
for(const engine of ['sqlite','postgres'])test(`${engine}: explicit schema 7 update preserves roster and backs it up before installing meetings`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const f=await runtimeFixture(t,engine),db=await f.raw();try{await db.begin();await db.exec(legacy.ddlFor(engine));await seedLayout(db);await db.commit();}finally{await db.close();}
 const options={...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.55'},operationId:'upgrade7',backupRoot:join(f.root,'backups'),caller:{principalId:'native-ui'},authorize:()=>true};
 let authorizedScope;options.authorize=value=>{authorizedScope=value.scope;return true;};
 const result=await upgradeTeamStore(options);assert.equal(result.fromVersion,7);assert.equal(result.toVersion,SCHEMA_VERSION);assert.equal(authorizedScope.fromVersion,7);
 const backup=JSON.parse(await readFile(result.backupPath,'utf8'));assert.equal(backup.schemaVersion,7);assert.equal(backup.schemaSql,legacy.ddlFor(engine));
 assert.deepEqual(await upgradeTeamStore(options),result);
 const check=await f.raw();try{assert.equal((await check.query('SELECT * FROM meetings')).length,0);assert.equal((await check.query('SELECT * FROM members')).length,6);}finally{await check.close();}
});
import {SCHEMA_VERSION} from '../contract.mjs';
