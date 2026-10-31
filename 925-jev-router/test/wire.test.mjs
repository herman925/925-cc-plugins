import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockControlPlane, policyHash, runSyntheticPreCall } from '../src/index.mjs';

const token = 'synthetic-jev-test-token';
const aliases = ['cheap-worker', 'mid-worker', 'strong-worker'];

function policy(overrides = {}) {
  return {
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidates: ['cheap-worker', 'mid-worker', 'strong-worker'],
    fallback: 'strong-worker',
    default_worker_mode: 'routed',
    ...overrides,
  };
}

function control() {
  return createMockControlPlane({
    token,
    configuredAliases: aliases,
    now: () => '2026-10-31T03:00:00.000Z',
  });
}

function apply(plane, document) {
  return plane.request({
    method: 'POST',
    path: `/jev/v1/projects/${document.project_id}/apply`,
    headers: { Authorization: `Bearer ${token}` },
    body: { schema_version: 1, policy: document, policy_hash: policyHash(document) },
  });
}

function read(plane) {
  return plane.request({
    method: 'GET',
    path: '/jev/v1/projects/orca-ade-example/applied',
    headers: { Authorization: `Bearer ${token}` },
  });
}

test('fixed leader is pinned and does not call the selector', async () => {
  const plane = control();
  assert.equal(apply(plane, policy()).status, 200);
  const applied = read(plane).body;
  const ran = await runSyntheticPreCall({
    policy: applied.policy,
    request: { model: 'large-leader', messages: [{ role: 'user', content: 'Review the patch.' }] },
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(ran.wire.hook, 'leader-bypass');
  assert.equal(ran.wire.selectorCalls, 0);
  assert.equal(ran.wire.execution.model, 'large-leader');
  assert.equal(ran.decision.jev, false);
});

test('hook, decision adapter, and execution rewrite use the read-back policy', async () => {
  const plane = control();
  apply(plane, policy());
  const applied = read(plane).body;
  const ran = await runSyntheticPreCall({
    policy: applied.policy,
    modelList: ['unapproved-on-gateway'],
    request: {
      model: 'jev-router',
      messages: [{ role: 'user', content: 'Rename the helper.' }],
    },
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(ran.wire.hook, 'sentinel');
  assert.equal(ran.wire.decision.reason, 'typesafe-choice');
  assert.equal(ran.wire.selectorCalls, 1);
  assert.deepEqual(Object.keys(ran.requestBody.questions.model.criteria), ['cheap-worker', 'mid-worker', 'strong-worker']);
  assert.equal(ran.wire.execution.model, 'cheap-worker');
  assert.equal(ran.data.model, 'cheap-worker');
});

test('a missing agent id does not turn sentinel work into the leader path', async () => {
  const plane = control();
  apply(plane, policy());
  const ran = await runSyntheticPreCall({
    policy: read(plane).body.policy,
    request: { model: 'jev-router', messages: [{ role: 'user', content: 'Edit the file.' }] },
    transportResponses: [{ answers: { model: { choice: 'mid-worker' } } }],
  });
  assert.equal(ran.wire.hook, 'sentinel');
  assert.notEqual(ran.wire.hook, 'leader-bypass');
  assert.equal(ran.wire.selectorCalls, 1);
  assert.equal(ran.wire.execution.model, 'mid-worker');
});

test('a later apply changes the policy the next execution revalidates', async () => {
  const plane = control();
  apply(plane, policy());
  const narrowed = policy({ candidates: ['mid-worker', 'strong-worker'] });
  const second = apply(plane, narrowed);
  assert.equal(second.body.revision, 2);
  const ran = await runSyntheticPreCall({
    policy: read(plane).body.policy,
    request: { model: 'jev-router', messages: [{ role: 'user', content: 'Try the old model.' }] },
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(ran.wire.selectorCalls, 1);
  assert.equal(ran.wire.execution.model, 'strong-worker');
  assert.equal(ran.wire.decision.reason, 'fallback-invalid-choice');
  assert.deepEqual(Object.keys(ran.requestBody.questions.model.criteria), ['mid-worker', 'strong-worker']);
});
