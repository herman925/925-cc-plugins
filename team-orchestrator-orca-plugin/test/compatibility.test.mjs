import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {validateRuntime} from '../src/local/runtime-contract.mjs';
import {REQUIRED_HOST_CAPABILITIES,validateHostCapabilities,inspectEvidenceSchemas,probeHostCompatibility} from '../src/local/host-compatibility.mjs';
import {inspectAdapterContract} from '../src/local/adapter.mjs';
import {questionFixture} from './questions-fixture.mjs';

const gate=(0,eval)(`(${validateRuntime.toString()})`);
const runtime={appName:'Orca',appVersion:'1.4.229',platform:'darwin',arch:'arm64',electron:'43.7.5',node:'24.21.0',sqlite:true,build:{version:'1.4.229',commit:'37c314bcc96063c42c468e564df2c34bac8ef8a1',buildId:'current-build',platform:'darwin',architecture:'arm64'}};
const status={runtimeId:'actual-runtime',appVersion:runtime.appVersion,capabilities:[...REQUIRED_HOST_CAPABILITIES]};
const settings={settings:{}};
const temp=async t=>{const root=await mkdtemp(join(tmpdir(),'team-compatibility-'));t.after(()=>rm(root,{recursive:true,force:true}));return root;};

test('validation history identifies tested builds without excluding later Orca, Electron or Node versions',()=>{
 assert.equal(gate(runtime).testedBuild,true);
 for(const patch of [{appVersion:'1.4.230',build:null},{appVersion:'2.0.0-beta.1',electron:'44.0.0',node:'25.0.0',build:null},{electron:'44.1.0',node:'26.1.0'},{build:null}]){
  const result=gate({...runtime,...patch});assert.equal(result.verification,'runtime-prerequisites');assert.equal(result.liveProviderVerified,false);
 }
});
test('platform support, process identity and required Node APIs remain enforced',()=>{
 for(const patch of [{platform:'linux'},{platform:'win32'},{arch:'x64'}])assert.throws(()=>gate({...runtime,...patch}),{code:'platform_unverified'});
 for(const patch of [{appName:'Other'},{appVersion:'unknown'},{electron:null},{build:{...runtime.build,version:'1.4.222'}},{build:{...runtime.build,platform:'linux'}}])assert.throws(()=>gate({...runtime,...patch}),{code:'runtime_identity_mismatch'});
 assert.throws(()=>gate({...runtime,sqlite:false}),{code:'node_capability_missing'});
});
test('actual advertised interfaces and response shapes determine admission, including unlisted releases',()=>{
 assert.equal(validateHostCapabilities({...status,appVersion:'9.0.0'},settings,'9.0.0').runtimeId,status.runtimeId);
 for(const missing of REQUIRED_HOST_CAPABILITIES)assert.throws(()=>validateHostCapabilities({...status,capabilities:status.capabilities.filter(c=>c!==missing)},settings,runtime.appVersion),{code:'runtime_capability_missing'});
 for(const value of [null,{}, {...status,runtimeId:''},{...status,capabilities:'all'}])assert.throws(()=>validateHostCapabilities(value,settings,runtime.appVersion),{code:'runtime_contract_incompatible'});
 assert.throws(()=>validateHostCapabilities(status,{settings:[]},runtime.appVersion),{code:'runtime_contract_incompatible'});
 assert.throws(()=>validateHostCapabilities(status,settings,'another-instance'),{code:'runtime_identity_mismatch'});
});
test('transport contract inspection checks real handlers without wrapping or invoking them',()=>{
 const names=['plugins:readPanelEntry','plugins:panelAction','plugins:invokeCommand','plugins:setEnabled','plugins:remove','runtime:call','session:get'];let calls=0;
 const handlers=new Map(names.map(n=>[n,()=>{calls++;}])),ipcMain={_invokeHandlers:handlers,handle(){calls++;},removeHandler(){calls++;}};
 assert.deepEqual(inspectAdapterContract({ipcMain}).handlers,names);assert.equal(calls,0);
 for(const name of names){const fn=handlers.get(name);handlers.delete(name);assert.throws(()=>inspectAdapterContract({ipcMain}),{code:'plugin_transport_incompatible'});handlers.set(name,fn);}
 assert.equal(calls,0);
});
test('a fresh profile is inspected without creating native databases',async t=>{
 const profile=await temp(t),result=await inspectEvidenceSchemas(profile);
 assert.ok(result.every(r=>r.state==='not-created'));assert.deepEqual(await readdir(profile),[]);
});
test('compatible native evidence is read without rewriting or migrating it',async t=>{
 const f=await questionFixture(t),before=f.db.prepare('SELECT count(*) AS n FROM runs').get().n;
 const results=await inspectEvidenceSchemas(f.profile);assert.equal(results[0].state,'verified');assert.equal(results[0].version,43);assert.equal(f.db.prepare('SELECT count(*) AS n FROM runs').get().n,before);
});
test('changed schema and missing evidence columns fail closed while preserving data',async t=>{
 const f=await questionFixture(t);f.db.exec('PRAGMA user_version=44');await assert.rejects(inspectEvidenceSchemas(f.profile),{code:'evidence_schema_incompatible'});assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,44);
 f.db.exec('PRAGMA user_version=43; ALTER TABLE runs RENAME COLUMN objective TO changed_objective');await assert.rejects(inspectEvidenceSchemas(f.profile),{code:'evidence_schema_incompatible'});assert.ok(f.db.prepare('PRAGMA table_info(runs)').all().some(c=>c.name==='changed_objective'));
});
test('journal formats and escaped profile paths cannot be treated as compatible',async t=>{
 const profile=await temp(t),other=await temp(t),file=join(other,'journal.db'),db=new DatabaseSync(file);db.exec('PRAGMA user_version=5');db.close();
 await symlink(file,join(profile,'agent-session-journal.db'));await assert.rejects(inspectEvidenceSchemas(profile),{code:'profile_mismatch'});
 const own=await temp(t),journal=new DatabaseSync(join(own,'agent-session-journal.db'));journal.exec('PRAGMA user_version=5');journal.close();await assert.rejects(inspectEvidenceSchemas(own),{code:'evidence_schema_incompatible'});
});
test('connection probe uses only read methods and keeps provider readiness unverified',async t=>{
 const profile=await temp(t),calls=[];const rpc=async method=>{calls.push(method);return method==='status.get'?status:settings;};
 const result=await probeHostCompatibility({rpc,userData:profile,appVersion:runtime.appVersion});assert.deepEqual(calls,['status.get','settings.get']);assert.equal(result.verification,'runtime-contract');assert.equal(result.liveProviderVerified,false);
});
