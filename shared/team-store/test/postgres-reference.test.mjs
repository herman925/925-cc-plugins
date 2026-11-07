import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {postgresReference,resolvePostgresReference,postgresConnectionOptions} from '../src/postgres-reference.mjs';
import {writeReservedLaunchProfile,readReservedLaunchProfile} from '../src/codex-launch-profile.mjs';
import {connectPostgres} from '../src/engines.mjs';
test('the persisted PostgreSQL reference rejects secrets and resolves redacted database identity',()=>{
 const reference=postgresReference({connectionEnvironment:'TEAM_PROJECT_DATABASE'});
 assert.deepEqual(reference,{connectionEnvironment:'TEAM_PROJECT_DATABASE',connectionTimeoutMs:5000});
 const secret='postgresql://private-user:unique-private-password@database.example/project?sslmode=verify-full';
 const resolved=resolvePostgresReference(reference,{TEAM_PROJECT_DATABASE:secret});
 assert.equal(resolved.connectionString,secret);assert.deepEqual(resolved.identity,{engine:'postgres',host:'database.example',port:'5432',database:'project',connectionEnvironment:'TEAM_PROJECT_DATABASE',tls:'verify-full'});
 assert.ok(!JSON.stringify(reference).includes('private'));assert.ok(!JSON.stringify(resolved.identity).includes('private'));
 for(const input of [{connectionEnvironment:'TEAM_DB',connectionString:secret},{connectionEnvironment:'X; echo leaked'},{connectionEnvironment:'X',password:'secret'},[],null])assert.throws(()=>postgresReference(input),{code:'STORE_CONNECTION_REFERENCE_INVALID'});
});
test('missing or invalid external credentials refuse without a local fallback or secret-bearing diagnostics',async()=>{
 for(const value of [undefined,'', 'not-a-url-secret', 'postgresql://user:secret@db.example/project', 'postgresql://user:secret@db.example/project?sslmode=require', 'postgresql://user:secret@db.example/project?sslmode=verify-full&host=other.example', 'postgresql://user:secret@db.example/project?sslmode=verify-full&sslmode=disable']){
  let loaded=false;
  const name='TEAM_REFERENCE_TEST_'+randomUUID().replaceAll('-','');if(value!==undefined)process.env[name]=value;
  try{await assert.rejects(connectPostgres({connectionEnvironment:name,loadDriver:async()=>{loaded=true;throw Error('Must not load');}}),error=>{assert.ok(!JSON.stringify(error).includes('user:secret'));assert.ok(!String(error.stack).includes('user:secret'));return /^STORE_(CONNECTION_ENV_MISSING|CONNECTION_REFERENCE_INVALID|TLS_REQUIRED)$/.test(error.code);});assert.equal(loaded,false);}
  finally{delete process.env[name];}
 }
});
test('only loopback may omit verified TLS; environment resolution is pinned and does not use ambient PG defaults',()=>{
 const name='TEAM_REFERENCE_TEST_'+randomUUID().replaceAll('-','');
 process.env[name]='postgresql://user:secret@127.0.0.1/project';
 try{
  const options=postgresConnectionOptions({connectionEnvironment:name});assert.equal(options.connectionString,process.env[name]);assert.ok(!Object.hasOwn(options,'connectionEnvironment'));
  process.env[name]='postgresql://other:second@127.0.0.1/other';assert.ok(options.connectionString.endsWith('/project'));
  assert.throws(()=>postgresConnectionOptions({connectionEnvironment:name,connectionString:'postgresql://127.0.0.1/third'}),{code:'STORE_CONNECTION_REFERENCE_INVALID'});
 }finally{delete process.env[name];}
});
test('new worker profiles save only an environment name, keep reviewed tool scope, and refuse a missing variable',async t=>{
 const root=await mkdtemp(join(tmpdir(),'team-pg-reference-'));t.after(()=>rm(root,{recursive:true,force:true}));const projectRoot=join(root,'project');await mkdir(projectRoot);
 const name='TEAM_REFERENCE_TEST_'+randomUUID().replaceAll('-',''),secret='postgresql://user:private-profile-password@127.0.0.1/project';process.env[name]=secret;t.after(()=>{delete process.env[name];});
 const config={root:join(root,'private'),actor:{projectRoot,machineId:'machine',contextId:'context'},projectId:randomUUID(),launchId:'launch',memberId:'worker',workerAccess:{planId:'reviewed',policyId:'team-worker-v1'},postgres:{connectionEnvironment:name}};
 const path=await writeReservedLaunchProfile(config),body=await readFile(path,'utf8');assert.ok(!body.includes('private-profile-password'));assert.ok(!body.includes('postgresql://'));
 const parsed=JSON.parse(body);assert.equal(parsed.version,3);assert.equal(parsed.postgres.connectionEnvironment,name);
 const loaded=await readReservedLaunchProfile(path,projectRoot);assert.equal(loaded.workerAccess.planId,'reviewed');assert.equal(loaded.postgres.connectionEnvironment,name);assert.equal(loaded.postgres.connectionString,undefined);
 await assert.rejects(writeReservedLaunchProfile({...config,postgres:{connectionString:secret}}),{code:'STORE_CONNECTION_REFERENCE_INVALID'});
 delete process.env[name];await assert.rejects(readReservedLaunchProfile(path,projectRoot),{code:'API_LAUNCH_PROFILE_INVALID'});
});
