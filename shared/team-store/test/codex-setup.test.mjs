import {describe,test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareSetup as nativePrepareSetup,applySetup,recoverSetup} from '../../../925-to/skills/925-to/scripts/setup.mjs';
const native=process.env.TEAM_TEST_CODEX_EXECUTABLE;
const prepareSetup=options=>nativePrepareSetup(options,{verifyHost:async()=>{}});
describe('Codex project setup with native config writer',{skip:!native},()=>{
 async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'925-to-install-test-'));t.after(async()=>{assert.equal(dirname(root),tmpdir());assert.ok(basename(root).startsWith('925-to-install-test-'));await rm(root,{recursive:true,force:true});});
  const projectRoot=join(root,'project');await mkdir(join(projectRoot,'.codex'),{recursive:true});
  const options={projectRoot,stateRoot:join(root,'private-state'),codexExecutable:native};
  return {root,projectRoot,options,config:join(projectRoot,'.codex','config.toml'),hooks:join(projectRoot,'.codex','hooks.json'),receipt:join(projectRoot,'.codex','925-to-installation.json')};
 }
 test('preview writes no project configuration; install/update/remove preserve unrelated settings and hooks',async t=>{
  const f=await fixture(t);await writeFile(f.config,'# Keep this comment\nmodel = "gpt-6.1"\n[mcp_servers.other]\ncommand = "other-program"\n');
  const unrelated={hooks:{PreToolUse:[{matcher:'Bash',hooks:[{type:'command',command:'echo existing'}]}]}};await writeFile(f.hooks,JSON.stringify(unrelated));
  const before=await readFile(f.config,'utf8'),preview=await prepareSetup(f.options);assert.equal(await readFile(f.config,'utf8'),before);await assert.rejects(access(f.receipt));assert.equal(preview.summary.hookTrustGranted,false);
  await applySetup(preview);assert.ok((await readFile(f.config,'utf8')).includes('[mcp_servers.other]'));assert.ok((await readFile(f.config,'utf8')).includes('# Keep this comment'));
  const installed=JSON.parse(await readFile(f.hooks,'utf8'));assert.deepEqual(installed.hooks.PreToolUse[0],unrelated.hooks.PreToolUse[0]);assert.equal(installed.hooks.PreToolUse.length,2);
  await writeFile(f.config,(await readFile(f.config,'utf8'))+'\n[features]\nmy_own_feature = true\n');
  await applySetup(await prepareSetup(f.options));assert.equal(JSON.parse(await readFile(f.hooks,'utf8')).hooks.PreToolUse.length,2);
  await applySetup(await prepareSetup({...f.options,action:'remove'}));const after=await readFile(f.config,'utf8');assert.ok(after.includes('my_own_feature = true'));assert.ok(after.includes('[mcp_servers.other]'));assert.ok(!after.includes('[mcp_servers.team_orchestrator]'));assert.deepEqual(JSON.parse(await readFile(f.hooks,'utf8')),unrelated);
 });
 test('interrupted setup records recovery and restores exact originals',async t=>{
  const f=await fixture(t);await writeFile(f.config,'model = "existing-model"\n');const before=await readFile(f.config);
  await assert.rejects(applySetup(await prepareSetup(f.options),{afterWrite:async()=>{throw Error('interrupted');}}),e=>e.code==='SETUP_RECOVERY_REQUIRED');
  await assert.rejects(prepareSetup(f.options),e=>e.code==='SETUP_RECOVERY_REQUIRED');
  assert.equal((await recoverSetup(f.options)).status,'recovered');assert.deepEqual(await readFile(f.config),before);await assert.rejects(access(f.hooks));await assert.rejects(access(f.receipt));
 });
 test('unowned and independently modified server/hook configuration is never overwritten',async t=>{
  const f=await fixture(t);await writeFile(f.config,'[mcp_servers.team_orchestrator]\ncommand = "owned-by-user"\n');const before=await readFile(f.config);await assert.rejects(prepareSetup(f.options),e=>e.code==='SETUP_UNOWNED');assert.deepEqual(await readFile(f.config),before);
  await writeFile(f.config,'');await applySetup(await prepareSetup(f.options));const hooks=JSON.parse(await readFile(f.hooks,'utf8'));hooks.hooks.PreToolUse[0].hooks[0].timeout=99;await writeFile(f.hooks,JSON.stringify(hooks));await assert.rejects(prepareSetup(f.options),e=>e.code==='SETUP_UNOWNED');
 });
 test('setup refuses stale previews and recovery refuses a concurrent user edit',async t=>{
  const f=await fixture(t);const plan=await prepareSetup(f.options);await writeFile(f.config,'model = "user-changed"\n');await assert.rejects(applySetup(plan),e=>e.code==='SETUP_CHANGED');
  await assert.rejects(applySetup(await prepareSetup(f.options),{afterWrite:async()=>{throw Error('interrupted');}}));await writeFile(f.config,'model = "changed-after-interruption"\n');await assert.rejects(recoverSetup(f.options),e=>e.code==='SETUP_CHANGED');assert.equal(await readFile(f.config,'utf8'),'model = "changed-after-interruption"\n');
 });
 test('a hard process exit releases the native installer lock and recovery remains possible',async t=>{
  const f=await fixture(t);await writeFile(f.config,'model = "before-crash"\n');
  const script=join(f.root,'crash.mjs'),helper=new URL('../../../925-to/skills/925-to/scripts/setup.mjs',import.meta.url).href;
  await writeFile(script,`import {prepareSetup,applySetup} from ${JSON.stringify(helper)};const plan=await prepareSetup(JSON.parse(process.argv[2]),{verifyHost:async()=>{}});await applySetup(plan,{afterWrite:async()=>process.exit(9)});`);
  const child=spawn(process.execPath,[script,JSON.stringify(f.options)],{windowsHide:true,stdio:'ignore'});const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(exit,9);
  let result;for(let attempt=0;attempt<20;attempt++){try{result=await recoverSetup(f.options);break;}catch(e){if(e.code!=='SETUP_BUSY')throw e;await new Promise(resolve=>setTimeout(resolve,25));}}
  assert.equal(result?.status,'recovered');assert.equal(await readFile(f.config,'utf8'),'model = "before-crash"\n');
 });
});
