import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createOwnedProviderManager} from '../src/owned-provider-manager.mjs';
function provider(name,calls){return {prepare:async input=>{calls.push({name,input});return {provider:name};},inspect:async input=>({name,id:input.launchId}),list:async()=>[{provider:name}],active:()=>false,close:async()=>{}};}
test('one project dispatcher pins the chosen CLI before effects and never switches a recorded launch',async()=>{
 const directory=join(await mkdtemp(join(tmpdir(),'team-provider-choice-')),'owned-codex'),calls=[],options={directory,projectRoot:tmpdir(),machineId:'fixture'},dependencies={createCodex:()=>provider('codex',calls),createClaude:()=>provider('claude',calls)},manager=createOwnedProviderManager(options,dependencies);
 assert.equal((await manager.prepare({provider:'claude',launchId:'launch'})).provider,'claude');assert.ok(!Object.hasOwn(calls[0].input,'provider'));await assert.rejects(manager.prepare({provider:'codex',launchId:'launch'}),{code:'API_LAUNCH_SCOPE'});assert.equal(calls.length,1);
 const resumed=createOwnedProviderManager(options,dependencies);assert.deepEqual(await resumed.inspect({launchId:'launch'}),{name:'claude',id:'launch'});assert.equal((await resumed.list()).length,2);await resumed.close();await manager.close();
});
