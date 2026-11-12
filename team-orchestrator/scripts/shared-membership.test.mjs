import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SHARED_MEMBERSHIP_PROBE,sharedGuardMembership} from '../hooks/shared-membership.mjs';
import {runtimeFixture} from '../../shared/team-store/test/support/runtime-fixture.mjs';
import {seedLayout} from '../../shared/team-store/test/support/seed-layout.mjs';
import * as current from '../../shared/team-store/contract.mjs';
import * as schema5 from '../../shared/team-store/src/schema5-contract.mjs';
import * as schema6 from '../../shared/team-store/src/schema6-contract.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(t,definition=current){
 const f=await runtimeFixture(t,'sqlite'),db=await f.raw();
 try{await db.begin();await db.exec(definition.ddlFor('sqlite'));await seedLayout(db);await db.commit();}finally{await db.close();}
 const write=async(sql,params={})=>{const db=await f.raw();try{await db.begin();await db.query(sql,params);await db.commit();}finally{await db.close();}};
 const bind=async(provider='claude',machine=hostname())=>write("INSERT INTO member_bindings VALUES ('head',:machine,:provider,'current-session','local','context','current-terminal','incarnation',1)",{machine,provider});
 const reserve=async(machine=hostname(),conversation='current-session')=>{await write("INSERT INTO controller_approvals VALUES ('owner',:machine,'claude','owner-session',1,1,0)",{machine});await write("INSERT INTO member_launches VALUES ('launch','head','owner',:machine,:conversation,'bound',3,1)",{machine,conversation});};
 const probe=async(input={})=>{
  const before=hash(await readFile(f.path));
  const result=spawnSync(process.execPath,['--input-type=commonjs','-e',SHARED_MEMBERSHIP_PROBE],{input:JSON.stringify({root:f.root,sessionId:'current-session',handle:'current-terminal',libraryRoot:fileURLToPath(new URL('../',import.meta.url)),...input}),encoding:'utf8',windowsHide:true,timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.equal(hash(await readFile(f.path)),before,'membership discovery must not change the database');
  return JSON.parse(result.stdout);
 };
 return {...f,write,bind,reserve,probe};
}
test('absent shared storage needs neither Node nor native identity probing',async()=>{
 const $={session:{root:async()=>'/fixture',id:async()=>'current-session'},fs:{exists:async()=>false},process:{run:async()=>assert.fail('Absent store must not start a process.')}};
 assert.deepEqual(await sharedGuardMembership($,{node:'node'}),{membership:'none'});
});

test('an SDK filesystem permission error is unknown, not proof that the store is absent',async()=>{
 const $={session:{root:async()=>'/fixture',id:async()=>'current-session'},fs:{exists:async()=>{throw Object.assign(new Error('denied'),{code:'EACCES'});}},process:{run:async()=>assert.fail('Failed discovery must not start a process.')}};
 assert.deepEqual(await sharedGuardMembership($,{node:'node'}),{membership:'unknown'});
});
test('a failed discovery process remains unknown rather than inventing nonmembership',async()=>{
 let calls=0;
 const $={plugin:{root:'/plugin'},session:{root:async()=>'/fixture',id:async()=>'current-session'},fs:{exists:async()=>true},env:{get:async()=>''},process:{run:async()=>{calls++;return {exitCode:1,stdout:''};}}};
 assert.deepEqual(await sharedGuardMembership($,{node:'missing-node'}),{membership:'unknown'});
 assert.equal(calls,1);
});
test('a store and another conversation are not membership of this session',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.probe(),{membership:'none'});await f.bind();
 assert.deepEqual(await f.probe({sessionId:'other-session'}),{membership:'none'});
 assert.deepEqual(await f.probe(),{membership:'member'});
});
test('discovery does not use another provider binding as a Claude identity',async t=>{
 const f=await fixture(t);await f.bind('codex');assert.deepEqual(await f.probe(),{membership:'none'});
});

test('a matching conversation under another machine key cannot silently release enforcement',async t=>{
 const f=await fixture(t);await f.bind('claude',hostname()+'-renamed');
 assert.deepEqual(await f.probe(),{membership:'unknown'});
 assert.deepEqual(await f.probe({sessionId:'unrelated-session',handle:'unrelated-terminal'}),{membership:'none'});
});

test('a matching launch reservation under another machine key is uncertain',async t=>{
 const f=await fixture(t);await f.reserve(hostname()+'-renamed');assert.deepEqual(await f.probe(),{membership:'unknown'});
});

test('native launch targets retain enforcement and reject a mismatched machine key',async t=>{
 for(const machine of [hostname(),hostname()+'-renamed']){
  const f=await fixture(t);await f.reserve(hostname(),'pending-launch');
  await f.write("INSERT INTO launch_targets VALUES ('launch','current-terminal','context','incarnation','local',:root,:machine,4)",{root:f.root,machine});
  assert.deepEqual(await f.probe(),{membership:machine===hostname()?'member':'unknown'});
 }
});

test('a malformed database cannot prove nonmembership',async t=>{
 const f=await fixture(t);await writeFile(f.path,'not a SQLite database');assert.deepEqual(await f.probe(),{membership:'unknown'});
});

test('an inaccessible store path cannot prove nonmembership',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.probe({root:f.path}),{membership:'unknown'});
});
test('retired ordinary membership is absent while a launch reservation stays a candidate',async t=>{
 const f=await fixture(t);await f.bind();await f.write("UPDATE members SET membership_state='retired',generation=generation+1 WHERE member_id='head'");
 assert.deepEqual(await f.probe(),{membership:'none'});await f.reserve();assert.deepEqual(await f.probe(),{membership:'member'});
});
test('an unbound reserved session still needs full enforcement',async t=>{
 const f=await fixture(t);await f.reserve();assert.deepEqual(await f.probe(),{membership:'member'});
});
for(const definition of [schema5,schema6])test(`schema ${definition.SCHEMA_VERSION} is queried without newer launch tables or migration`,async t=>{
 const f=await fixture(t,definition);assert.deepEqual(await f.probe(),{membership:'none'});await f.bind();assert.deepEqual(await f.probe(),{membership:'member'});
});
test('unknown schemas and protocol requirements never become a negative membership proof',async t=>{
 const f=await fixture(t);await f.write('UPDATE store_metadata SET schema_version=99');assert.deepEqual(await f.probe(),{membership:'unknown'});
 await f.write('UPDATE store_metadata SET schema_version=9');await f.write('UPDATE project_identity SET minimum_writer_protocol=2');assert.deepEqual(await f.probe(),{membership:'unknown'});
});
test('missing schema protections remain unknown rather than releasing a possible member',async t=>{
 const f=await fixture(t);await f.write('DROP TRIGGER messages_immutable_update');assert.deepEqual(await f.probe(),{membership:'unknown'});
});
