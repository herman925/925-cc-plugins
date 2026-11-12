// Explicit disposable installation using the production preview/apply path.
// Downloads pinned packages only; never starts a worker or changes user config.
import {mkdtemp,realpath,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {prepareClaudeProvider,applyClaudeProvider,inspectClaudeProvider} from '../src/claude-provider.mjs';
const executable=process.argv[2];if(!executable)throw Error('Supply the existing native Claude executable.');
const directory=await realpath(await mkdtemp(join(tmpdir(),'team-claude-install-native-'))),root=join(directory,'provider');
let evidence={passed:false,node:process.version,root,teamStoreChanged:false,globalConfigurationChanged:false,launchesWorkers:false};
try{
 const plan=await prepareClaudeProvider({root,executable});assert.equal(plan.summary.state,'preview');assert.equal((await inspectClaudeProvider({root})).state,'setup-required');
 const installed=await applyClaudeProvider(plan),verified=await inspectClaudeProvider({root}),noop=await prepareClaudeProvider({root,executable});assert.equal(installed.state,'available');assert.equal(installed.digest,verified.digest);assert.equal(noop.noop,true);
 evidence={...evidence,passed:true,version:verified.version,digest:verified.digest,sdkModule:verified.sdkModule,executable:verified.executable,preview:plan.summary,normalPinnedInstall:true};
}catch(error){evidence={...evidence,code:error.code??null,error:error.message};process.exitCode=1;}
await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
