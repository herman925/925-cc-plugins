import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createCodexAdapter} from '../codex-mcp.mjs';
import * as schema9 from '../src/schema9-contract.mjs';
import {SCHEMA_VERSION} from '../contract.mjs';
import {inspectGuardCaller} from '../src/guard-reader.mjs';
import {runtimeFixture} from './support/runtime-fixture.mjs';
import {seedLayout} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
for(const engine of ['sqlite','postgres'])test(`${engine}: resumed schema-9 session can review an upgrade before its explicit rebind`,{skip:engine==='postgres'&&!postgresTestUrl()},async t=>{
 const f=await runtimeFixture(t,engine),db=await f.raw();
 try{await db.begin();await db.exec(schema9.ddlFor(engine));await seedLayout(db);
  await db.query("UPDATE members SET worktree='context',home_context_kind='worktree',home_execution_host_id='local',home_original_path=:root,machine_id='machine'",{root:f.root});
  await db.query("INSERT INTO member_bindings VALUES ('head','machine','codex','head-conversation','local','context','old-terminal','old-incarnation',1)");await db.commit();
 }finally{await db.close();}
 const actor={projectRoot:f.root,machineId:'machine',provider:'codex',conversationId:'head-conversation',executionHostId:'local',contextId:'context',terminalHandle:'resumed-terminal',incarnationId:'resumed-incarnation'};
 const adapter=await createCodexAdapter({...f.options,observation:false,backupRoot:join(f.root,'fixture-backups')},{createIdentity:async()=>({launchWorkers:true,verifyCaller:async()=>actor})});t.after(()=>adapter.close());
 const request={operationId:'reviewed-stale-upgrade'};
 for(const tool of ['shared_team_upgrade','mcp__team_orchestrator__shared_team_upgrade'])assert.deepEqual(await adapter.call('team_guard',{tool,input:request},{}),{});
 for(const tool of ['apply_patch','spawn_agent','shared_team_launch'])assert.equal((await adapter.call('team_guard',{tool,input:{}},{})).hookSpecificOutput.permissionDecision,'deny');
 const status=await adapter.call('shared_team_status',{},{});assert.equal(status.info.upgradeRequired,true);assert.equal(status.info.storeVersion,9);
 let reviews=0;
 const connection=accept=>({canElicit:true,elicit:async form=>{reviews++;assert.match(form.message,/schema 9 to 10/);return accept?{action:'accept',content:{confirm:true}}:{action:'decline'};}});
 await assert.rejects(adapter.call('shared_team_upgrade',request,{},connection(false)),{code:'API_APPROVAL_UNVERIFIED'});assert.equal(reviews,1);
 const unchanged=await f.raw();try{assert.equal(Number((await unchanged.query('SELECT schema_version FROM store_metadata'))[0].schema_version),9);assert.equal((await unchanged.query('SELECT * FROM schema_migrations')).length,0);}finally{await unchanged.close();}
 const receipt=await adapter.call('shared_team_upgrade',request,{},connection(true));assert.equal(reviews,2);assert.equal(receipt.status,'upgraded');assert.equal(receipt.toVersion,SCHEMA_VERSION);
 assert.equal(JSON.parse(await readFile(receipt.backupPath,'utf8')).schemaVersion,9);
 await assert.rejects(inspectGuardCaller({actor,...(f.options.postgres?{postgres:f.options.postgres}:{})}),{code:'API_STALE_BINDING'});
 const after=await f.raw();try{const binding=(await after.query('SELECT * FROM member_bindings'))[0];assert.equal(binding.incarnation_id,'old-incarnation');assert.equal(Number(binding.generation),1);assert.equal((await after.query('SELECT * FROM worker_tool_consents')).length,0);assert.equal((await after.query('SELECT * FROM worker_readiness')).length,0);}finally{await after.close();}
 const recovery=await adapter.call('shared_team_status',{},{});assert.equal(recovery.info.bindingState,'stale-needs-explicit-reconnect');
 assert.deepEqual(await adapter.call('shared_team_upgrade',{...request,reconcile:true},{},connection(true)),receipt);assert.equal(reviews,2);
});
