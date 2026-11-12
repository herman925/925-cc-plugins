import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createIndependentCodexIdentity} from '../src/codex-independent-native.mjs';
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-independent-identity-'))),threadId=randomUUID(),executable=join(root,'codex.exe');await writeFile(executable,'fixture, not executable');await mkdir(join(root,'thread-writer-locks'));await writeFile(join(root,'thread-writer-locks',threadId+'.lock'),'');
 let owners=[{pid:process.ppid,createdAt:'12345'}],parent={pid:process.ppid,createdAt:'12345',executable},project=root,inspections=0,closed=0;
 const identity=await createIndependentCodexIdentity({scope:{projectRoot:root},codexExecutable:executable,codexHome:root},{requestOwned:async()=>[],threadOwners:async()=>owners,inspectProcess:async()=>parent,createInspector:()=>({inspect:async id=>{inspections++;return {threadId:id,projectRoot:project};},close:async()=>closed++})});t.after(()=>identity.close());
 return {identity,root,threadId,metadata:{threadId},setOwners:value=>owners=value,setParent:value=>parent=value,setProject:value=>project=value,inspections:()=>inspections,closed:()=>closed};
}
test('independent identity binds actual parent/thread/project without Orca or a supplied terminal',async t=>{
 const f=await fixture(t),actor=await f.identity.verifyCaller(f.metadata);assert.equal(actor.projectRoot,f.root);assert.equal(actor.terminalHandle,'codex-thread:'+f.threadId);assert.match(actor.incarnationId,/12345$/);assert.equal(f.identity.hostKind,'independent');assert.equal(f.identity.launchWorkers,true);assert.equal((await f.identity.listTargets(f.metadata)).sessions.length,1);
 const target={projectRoot:f.root,conversationId:f.threadId,terminalHandle:actor.terminalHandle,contextId:actor.contextId};assert.deepEqual(await f.identity.verifyTarget(target,f.metadata),actor);await assert.rejects(f.identity.verifyTarget({...target,conversationId:randomUUID()},f.metadata));
});
test('copied IDs, writer ambiguity and process birth changes cannot produce an actor',async t=>{
 const f=await fixture(t);await assert.rejects(f.identity.verifyCaller({threadId:randomUUID()}));f.setOwners([{pid:process.ppid,createdAt:'12345'},{pid:process.pid,createdAt:'12345'}]);await assert.rejects(f.identity.verifyCaller(f.metadata));f.setOwners([{pid:process.ppid,createdAt:'99999'}]);await assert.rejects(f.identity.verifyCaller(f.metadata));
});
test('guard-only membership proof cannot substitute for strict API project verification',async t=>{
 const f=await fixture(t),other=await realpath(await mkdtemp(join(tmpdir(),'team-other-scope-')));f.setProject(other);assert.ok(await f.identity.verifyGuardCaller(f.metadata));assert.equal(f.inspections(),0);await assert.rejects(f.identity.verifyCaller(f.metadata),/another project/);assert.equal(f.inspections(),1);
});
test('closing the inspector does not leave a reusable native identity',async t=>{const f=await fixture(t);await f.identity.close();await assert.rejects(f.identity.verifyCaller(f.metadata));assert.equal(f.closed(),1);});
