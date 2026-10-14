import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../src/bridge.mjs';
test('bridge accepts replies only from its parent and correlates request IDs', async () => {
  let handler;
  let sent;
  const parent = { postMessage: value => { sent = value; } };
  const call = createBridge(parent, { addEventListener: (_, fn) => { handler = fn; } }, 100);
  const result = call('storage.get', { key: 'test' });
  handler({ source: {}, data: { type: 'orca-panel-action-result', requestId: sent.requestId, ok: true, value: 'spoof' } });
  handler({ source: parent, data: { type: 'orca-panel-action-result', requestId: 'other', ok: true, value: 'wrong' } });
  handler({ source: parent, data: { type: 'orca-panel-action-result', requestId: sent.requestId, ok: true, value: 'real' } });
  assert.equal(await result, 'real');
});
test('bridge times out and retains host error codes', async () => {
  let handler;
  let sent;
  const parent = { postMessage: value => { sent = value; } };
  const call = createBridge(parent, { addEventListener: (_, fn) => { handler = fn; } }, 10);
  await assert.rejects(call('storage.get', {}), /did not answer/);
  const result = call('storage.get', {});
  handler({ source: parent, data: { type: 'orca-panel-action-result', requestId: sent.requestId, ok: false, errorCode: 'panel_forbidden', error: 'Forbidden' } });
  await assert.rejects(result, error => error.code === 'panel_forbidden');
});
