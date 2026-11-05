import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import * as legacy from '../src/schema8-contract.mjs';
import {upgradeTeamStore} from '../index.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
for(const engine of ['sqlite','postgres'])test(`${engine}: schema 8 upgrade backs up existing launches and preserves their native conversation identities`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const f=await runtimeFixture(t,engine),db=await f.raw();
 try{await db.begin();await db.exec(legacy.ddlFor(engine));await seedLayout(db);await db.exec("INSERT INTO controller_approvals VALUES ('approved','machine','claude','conversation',1,1000,0); INSERT INTO member_launches VALUES ('old-launch','worker','approved','machine','reserved-native-conversation','claimed',2,1000)");await db.commit();}finally{await db.close();}
 const options={...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.58'},operationId:'upgrade8',backupRoot:join(f.root,'backups'),caller:{principalId:'explicit-upgrade'},authorize:()=>true};
 const result=await upgradeTeamStore(options);assert.equal(result.fromVersion,8);assert.equal(result.toVersion,9);
 const backup=JSON.parse(await readFile(result.backupPath,'utf8'));assert.equal(backup.schemaVersion,8);assert.equal(backup.tables.member_launches[0].conversation_id,'reserved-native-conversation');
 const check=await f.raw();try{assert.equal((await check.query('SELECT * FROM member_launches'))[0].conversation_id,'reserved-native-conversation');assert.equal((await check.query('SELECT * FROM launch_plans')).length,0);assert.equal(Number((await check.query('SELECT schema_version FROM store_metadata'))[0].schema_version),9);}finally{await check.close();}
 assert.deepEqual(await upgradeTeamStore(options),result);
});
for(const engine of ['sqlite','postgres'])test(`${engine}: Codex status never upgrades and native update requires its own review`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const f=await runtimeFixture(t,engine),db=await f.raw();try{await db.begin();await db.exec(legacy.ddlFor(engine));await seedLayout(db);await db.commit();}finally{await db.close();}
 const actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'native',terminalHandle:'terminal',contextId:'context',executionHostId:'local',incarnationId:'inc'};
 const adapter=await createCodexAdapter({...f.options,observation:false,backupRoot:join(f.root,'backups')},{createIdentity:async()=>({verifyCaller:async()=>actor})});
 let accept=false,reviews=0;const metadata={threadId:'native'},connection={canElicit:true,elicit:async form=>{reviews++;assert.match(form.message,/from schema 8 to 9/);return {action:accept?'accept':'decline',content:{confirm:true}};}};
 try{
  const status=await adapter.call('shared_team_status',{},metadata,connection);assert.equal(status.info.upgradeRequired,true);assert.equal(status.info.storeVersion,8);assert.equal(reviews,0);
  const args={operationId:'native-update'};
  await assert.rejects(adapter.call('shared_team_upgrade',args,metadata,connection),{code:'API_APPROVAL_REQUIRED'});
  assert.equal((await adapter.call('shared_team_upgrade',{...args,reconcile:true},metadata,connection)).status,'unknown');
  accept=true;const result=await adapter.call('shared_team_upgrade',args,metadata,connection);assert.equal(result.toVersion,9);assert.equal(JSON.parse(await readFile(result.backupPath,'utf8')).schemaVersion,8);
  assert.deepEqual(await adapter.call('shared_team_upgrade',{...args,reconcile:true},metadata,connection),result);assert.equal(reviews,2);
 }finally{await adapter.close();}
});
