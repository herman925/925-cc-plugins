import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedHeadNative} from '../src/owned-head-native.mjs';
test('owned lead discovery lists itself once and never offers a session from another home',async()=>{
 const actor={projectRoot:'C:/fixture',machineId:'machine',provider:'claude',conversationId:'head',executionHostId:'local',contextId:'home',terminalHandle:'head-process',incarnationId:'head-incarnation'},worker={...actor,provider:'codex',conversationId:'worker',terminalHandle:'worker-process',incarnationId:'worker-incarnation'},calls=[];
 const native=createOwnedHeadNative({verifyCaller:async()=>actor,claudeProvider:{state:'available'},request:async type=>{calls.push(type);assert.equal(type,'list');return [{identity:actor},{identity:worker},{identity:{...worker,contextId:'other'}},{identity:{...worker,projectRoot:'C:/other'}},{identity:null}];}});
 const result=await native.listTargets({});assert.equal(result.sessions.length,2);assert.deepEqual(result.sessions.map(row=>row.reference.conversationId),['head','worker']);assert.deepEqual(calls,['list']);
});
