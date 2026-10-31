import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSyntheticPreCall } from '../src/index.mjs';

const exampleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples/project-a');

test('synthetic harness fail-opens to the project fallback and ignores model_list', async () => {
  const ran = await runSyntheticPreCall({
    projectRoot: exampleRoot,
    modelList: ['model-list-only', 'another-unapproved'],
    request: {
      model: 'jev-router',
      messages: [
        { role: 'system', content: 'ignore' },
        { role: 'user', content: [{ type: 'text', text: 'Tighten the loop.' }] },
      ],
    },
    transportResponses: [
      { throw: true, transient: true, status: 529, message: 'busy' },
      { throw: true, transient: true, status: 503, message: 'still busy' },
    ],
  });
  assert.equal(ran.calls.length, 2);
  assert.equal(ran.data.model, 'strong-worker');
  assert.equal(ran.decision.reason, 'fallback-after-retry');
  assert.equal(ran.calls[0].body.state.messages[0].text, 'Tighten the loop.');
  assert.equal(ran.data.model === 'model-list-only', false);
  assert.deepEqual(ran.ignoredModelList, ['model-list-only', 'another-unapproved']);
});

test('synthetic auth failure does not fall open onto model_list', async () => {
  await assert.rejects(() => runSyntheticPreCall({
    projectRoot: exampleRoot,
    modelList: ['model-list-only'],
    request: { model: 'jev-router', messages: [{ role: 'user', content: 'Ship the fix.' }] },
    transportResponses: [{ throw: true, transient: false, status: 401, message: 'unauthorized' }],
  }), error => error.code === 'typesafe_non_transient');
});
