import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {upgradeTeamStore} from '../index.mjs';
import {openBackend,inspectSchema} from '../src/bootstrap.mjs';
import * as legacy from '../src/schema5-contract.mjs';
import {runtimeFixture,rawWrite} from './support/runtime-fixture.mjs';
import {seedLayout,seedDelivery} from './support/seed-layout.mjs';
import {postgresTestUrl} from './support/engines.mjs';
import {connectSqlite} from '../src/engines.mjs';

const code=expected=>error=>error.code===expected;
for(const engine of ['sqlite','postgres'])describe(`${engine} explicit schema 5 upgrade`,{skip:engine==='postgres'&&!postgresTestUrl()},()=>{
 async function setup(t) {
  const f=await runtimeFixture(t,engine),db=await f.raw();
  try {
   await db.begin();await db.exec(legacy.ddlFor(engine));await seedLayout(db);
   await db.exec(`INSERT INTO runs VALUES ('run',1,'fixture-team');
    INSERT INTO tasks VALUES ('pickup','run','open',NULL),('rejected','run','blocked',NULL);
    INSERT INTO assignments (assignment_id,task_id,member_id,admitted_at_ms,assigned_by_member_id,pickup_deadline_ms,pickup_expired_at_ms,returned_to_member_id)
     VALUES ('pickup','pickup','worker',1000,'head',2000,2500,'head');
    INSERT INTO assignments (assignment_id,task_id,member_id,admitted_at_ms,assigned_by_member_id,pickup_deadline_ms,pickup_observed_at_ms)
     VALUES ('rejected','rejected','worker',1000,'head',2000,1500);
    INSERT INTO assignment_attempts VALUES ('pickup',2,NULL,NULL,NULL,NULL),('rejected',3,'succeeded','Original result','Original evidence',2500);
    INSERT INTO task_acceptances VALUES ('rejected','rejected','head','rejected','Original rejection',3000);
    INSERT INTO threads (thread_id,run_id,status,generation,task_id,endpoint_a_member_id,endpoint_b_member_id,team_id,assignment_id)
     VALUES ('thread','run','fenced',2,'rejected','head','worker','fixture-team','rejected');
    INSERT INTO controller_approvals VALUES ('approved','machine','claude','conversation',1,1000,0);
    INSERT INTO operations VALUES ('original','fingerprint','{"original":true}',1000);`);
   await seedDelivery(db,{thread:'thread',status:'fenced'});await db.commit();
  }finally{await db.close();}
  const options={...f.options,projectRoot:f.root,machineId:'machine',writer:{client:'team-orchestrator',version:'0.5.50'},operationId:'upgrade',backupRoot:join(f.root,'observations'),caller:{principalId:'explicit-ui-action'},authorize:()=>true};
  const rows=async sql=>{const db=await f.raw();try{return await db.query(sql);}finally{await db.close();}};
  return {...f,options,rows};
 }
 test('upgrade keeps a complete schema-5 backup, imports known returns, and preserves approvals/messages/receipts',async t=>{
  const f=await setup(t),beforeMessages=await f.rows('SELECT * FROM messages'),beforeApprovals=await f.rows('SELECT * FROM controller_approvals');
  const receipt=await upgradeTeamStore(f.options);assert.equal(receipt.status,'upgraded');
  const backup=JSON.parse(await readFile(receipt.backupPath,'utf8'));assert.equal(backup.schemaVersion,5);assert.deepEqual(backup.tables.messages,beforeMessages);
  assert.equal(backup.tables.operations[0].operation_id,'original');assert.ok(backup.schemaSql.includes("'team-orchestrator-shared', 5"));
  assert.deepEqual(await f.rows('SELECT * FROM messages'),beforeMessages);assert.deepEqual(await f.rows('SELECT * FROM controller_approvals'),beforeApprovals);
  assert.equal((await f.rows('SELECT * FROM operations'))[0].request_fingerprint,'fingerprint');
  assert.equal(Number((await f.rows('SELECT schema_version FROM store_metadata'))[0].schema_version),9);
  const returns=await f.rows('SELECT * FROM assignment_returns ORDER BY assignment_id');assert.deepEqual(returns.map(r=>r.reason),['pickup_expired','rejected']);
  assert.equal((await f.rows('SELECT * FROM task_acceptances'))[0].reason,'Original rejection');
  assert.deepEqual(await upgradeTeamStore(f.options),receipt);assert.equal((await readdir(join(receipt.backupPath,'..'))).length,1);
  assert.equal((await upgradeTeamStore({...f.options,operationId:'new-check'})).status,'already_current');
  const {db}=await openBackend(f.options);try{assert.equal((await inspectSchema(db)).version,9);}finally{await db.close();}
  if(engine==='sqlite') {
   // Exercise recovery in a separate disposable file, never over the source.
   // The backup carries frozen schema-5 SQL and all contract data. Generated
   // endpoint columns are recomputed, then every FK and complete row is checked.
   assert.equal(backup.schemaSql,legacy.ddlFor('sqlite'));
   const restored=await connectSqlite({path:join(f.root,'backup-restored.sqlite')});
   try {
    await restored.exec('PRAGMA foreign_keys=OFF');await restored.begin();await restored.exec(backup.schemaSql);
    const tables=Object.keys(backup.tables);
    for(const name of tables){assert.match(name,/^[a-z_]+$/);await restored.exec(`DELETE FROM ${name}`);}
    for(const name of tables) {
     const columns=(await restored.query(`PRAGMA table_xinfo(${name})`)).filter(c=>Number(c.hidden)===0).map(c=>c.name);
     for(const column of columns)assert.match(column,/^[a-z_]+$/);
     for(const row of backup.tables[name])await restored.query(`INSERT INTO ${name} (${columns.join(',')}) VALUES (${columns.map(c=>`:${c}`).join(',')})`,Object.fromEntries(columns.map(c=>[c,row[c]])));
    }
    await restored.commit();await restored.exec('PRAGMA foreign_keys=ON');
    assert.equal((await restored.query('PRAGMA foreign_keys'))[0].foreign_keys,1);
    assert.deepEqual(await restored.query('PRAGMA foreign_key_check'),[]);
    const rowKey=row=>JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key=>[key,row[key]])));
    for(const name of tables)assert.deepEqual((await restored.query(`SELECT * FROM ${name}`)).map(rowKey).sort(),backup.tables[name].map(rowKey).sort(),`restored ${name}`);
    assert.equal((await inspectSchema(restored,{format:legacy.FORMAT,version:legacy.SCHEMA_VERSION,ddl:legacy.DDL,render:legacy.ddlFor,label:'restored team store'})).version,5);
   }catch(error){await restored.rollback().catch(()=>{});throw error;}finally{await restored.close();}
  }
  await assert.rejects(rawWrite(f,'DELETE FROM assignment_returns'),e=>e.message.includes('STORE_HISTORY_IMMUTABLE'));
 });
 test('upgrade preserves opaque gate history, blocks open gates, and refuses terminal/open ambiguity',async t=>{
  const f=await setup(t);
  await rawWrite(f,`INSERT INTO decision_gates (gate_id,task_id,question,options_json) VALUES ('open-gate','pickup','Historical question','opaque old options');
   INSERT INTO decision_gates (gate_id,task_id,question,status,options_json,resolution_json,resolved_at_ms) VALUES ('answered','rejected','Old answer','resolved','["A","B"]','opaque old answer',1000)`);
  await upgradeTeamStore(f.options);
  assert.equal((await f.rows("SELECT status FROM tasks WHERE task_id='pickup'"))[0].status,'blocked');
  assert.equal((await f.rows("SELECT options_json FROM decision_gates WHERE gate_id='open-gate'"))[0].options_json,'opaque old options');
  assert.equal((await f.rows("SELECT resolution_json FROM decision_gates WHERE gate_id='answered'"))[0].resolution_json,'opaque old answer');
  await assert.rejects(rawWrite(f,"UPDATE tasks SET status='open' WHERE task_id='pickup'"),/STORE_GATE_OPEN/);
  const ambiguous=await setup(t);await rawWrite(ambiguous,"UPDATE tasks SET status='succeeded',outcome='succeeded' WHERE task_id='pickup';INSERT INTO decision_gates (gate_id,task_id,question) VALUES ('ambiguous','pickup','Unanswered?')");
  await assert.rejects(upgradeTeamStore(ambiguous.options),code('STORE_UPGRADE_INVALID'));
  assert.equal(Number((await ambiguous.rows('SELECT schema_version FROM store_metadata'))[0].schema_version),5);
 });
 test('authorization, unsupported versions, ambiguous history and live leases refuse before backup or DDL',async t=>{
  const f=await setup(t);await assert.rejects(upgradeTeamStore({...f.options,authorize:()=>false}),code('STORE_AUTHORITY_DENIED'));
  await rawWrite(f,'UPDATE store_metadata SET schema_version=4');await assert.rejects(upgradeTeamStore(f.options),code('STORE_VERSION_UNSUPPORTED'));
  await rawWrite(f,'UPDATE store_metadata SET schema_version=5');
  await rawWrite(f,"UPDATE assignments SET returned_to_member_id=NULL WHERE assignment_id='pickup'");
  await assert.rejects(upgradeTeamStore(f.options),code('STORE_UPGRADE_DATA_UNMAPPED'));
  await rawWrite(f,"UPDATE assignments SET returned_to_member_id='head' WHERE assignment_id='pickup'");
  await rawWrite(f,`UPDATE store_lease SET holder_machine_id='other',holder_token='live',generation=1,expires_at_ms=${Date.now()+600000}`);
  await assert.rejects(upgradeTeamStore(f.options),code('STORE_LEASE_HELD'));
  assert.equal(Number((await f.rows('SELECT schema_version FROM store_metadata'))[0].schema_version),5);
  assert.equal((await readdir(f.root)).includes('observations'),false);
 });
 test('changes after backup refuse the upgrade and leave the old schema usable',async t=>{
  const f=await setup(t);
  await assert.rejects(upgradeTeamStore(f.options,{afterBackup:()=>rawWrite(f,"UPDATE teams SET name='Concurrent change'")}),code('STORE_UPGRADE_CHANGED'));
  assert.equal(Number((await f.rows('SELECT schema_version FROM store_metadata'))[0].schema_version),5);
  assert.equal((await f.rows('SELECT name FROM teams'))[0].name,'Concurrent change');
  assert.equal((await upgradeTeamStore(f.options)).status,'upgraded');
 });
 test('a lost upgrade commit reply reconciles the committed migration without another backup or replay',async t=>{
  const f=await setup(t);let fail=true;
  await assert.rejects(upgradeTeamStore(f.options,{openBackend:async(options,definition)=>{
   const opened=await openBackend(options,definition),db=opened.db;let changed=false;
   return {...opened,db:new Proxy(db,{get(target,key){
    if(key==='exec')return async sql=>{if(sql.includes('SET schema_version=9'))changed=true;return target.exec(sql);};
    if(key==='commit')return async()=>{await target.commit();if(changed&&fail){fail=false;throw Error('Reply lost');}};
    return target[key];
   }})};
  }}),code('STORE_COMMIT_UNKNOWN'));
  const recovered=await upgradeTeamStore(f.options);assert.equal(recovered.status,'upgraded');
  assert.equal((await f.rows('SELECT * FROM schema_migrations')).length,1);assert.equal((await readdir(join(recovered.backupPath,'..'))).length,1);
 });
});
