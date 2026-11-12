import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rm,symlink} from 'node:fs/promises';
import {join,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareClaudeProvider,applyClaudeProvider,inspectClaudeProvider} from '../src/claude-provider.mjs';
import {CLAUDE_SDK_VERSION} from '../src/claude-driver.mjs';
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'team-claude-component-'))),executable=join(root,'claude.exe');await writeFile(executable,'fixture native executable; never executed');t.after(async()=>{assert.equal(dirname(root),await realpath(tmpdir()));assert.ok(basename(root).startsWith('team-claude-component-'));await rm(root,{recursive:true,force:true});});return {root:join(root,'private'),executable};}
const fakeInstall=async stage=>{const directory=join(stage,'node_modules','@anthropic-ai','claude-agent-sdk');await mkdir(directory,{recursive:true});await writeFile(join(directory,'package.json'),JSON.stringify({name:'@anthropic-ai/claude-agent-sdk',version:CLAUDE_SDK_VERSION}));await writeFile(join(directory,'sdk.mjs'),'// Fixture module, not executable SDK code.');};
test('optional component preview creates no directory, launches nothing and names its pinned package',async t=>{
 const f=await fixture(t),plan=await prepareClaudeProvider(f,{findExecutable:async()=>({executable:f.executable,nativeVersion:'fixture'})});assert.equal(plan.summary.state,'preview');assert.equal(plan.summary.launchesWorkers,false);assert.equal(plan.summary.teamStoreChanged,false);assert.equal((await inspectClaudeProvider({root:f.root})).state,'setup-required');assert.ok(plan.summary.changes[0].includes(CLAUDE_SDK_VERSION));
});
test('optional driver installs in private staging and rejects a modified runtime without overwriting it',async t=>{
 const f=await fixture(t),plan=await prepareClaudeProvider(f,{findExecutable:async()=>({executable:f.executable,nativeVersion:'fixture'})}),result=await applyClaudeProvider(plan,{install:fakeInstall});assert.equal(result.state,'available');assert.equal(result.launchesWorkers,false);assert.equal((await prepareClaudeProvider(f)).noop,true);
 await writeFile(result.sdkModule,'// Changed independently.');await assert.rejects(inspectClaudeProvider({root:f.root}),{code:'API_CLAUDE_SETUP_REQUIRED'});await assert.rejects(prepareClaudeProvider(f),{code:'API_CLAUDE_SETUP_REQUIRED'});assert.equal(await readFile(result.sdkModule,'utf8'),'// Changed independently.');
});
test('redirected SDK files are refused before activation',async t=>{
 const f=await fixture(t),plan=await prepareClaudeProvider(f,{findExecutable:async()=>({executable:f.executable,nativeVersion:'fixture'})});
 await assert.rejects(applyClaudeProvider(plan,{install:async stage=>{await fakeInstall(stage);await symlink(dirname(f.executable),join(stage,'redirected'),'junction');}}),{code:'API_CLAUDE_SETUP_REQUIRED'});assert.equal((await inspectClaudeProvider({root:f.root})).state,'setup-required');
});
