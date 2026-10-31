import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyError, applyDraft, createDraft, createMemoryGateway, policyHash } from '../src/index.mjs';

const policy = {
  schema_version: 1,
  project_id: 'orca-ade-example',
  candidates: ['cheap-worker', 'strong-worker'],
  fallback: 'cheap-worker',
  default_worker_mode: 'per-turn',
};

test('Draft becomes an Applied record with a stable hash and monotonic revision', () => {
  const draft = createDraft(policy, { savedAt: '2026-10-31T00:00:00.000Z' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.revision, undefined);
  assert.equal(draft.policy_hash, undefined);
  const gateway = createMemoryGateway();
  const first = gateway.apply(draft, {
    appliedBy: 'synthetic-gateway',
    appliedAt: '2026-10-31T01:00:00.000Z',
  });
  const second = gateway.apply(draft, {
    appliedBy: 'synthetic-gateway',
    appliedAt: '2026-10-31T02:00:00.000Z',
  });
  assert.equal(first.status, 'applied');
  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(first.policy_hash, second.policy_hash);
  assert.equal(first.policy_hash, policyHash(policy));
  assert.equal(first.policy_hash, policyHash({ ...policy, default_worker_mode: 'per-turn' }));
  assert.notEqual(policyHash(policy), policyHash({ ...policy, fallback: 'strong-worker' }));
  assert.deepEqual(gateway.read('orca-ade-example'), second);
  assert.equal(gateway.read('missing'), null);
  draft.policy.candidates.push('extra-worker');
  assert.deepEqual(second.policy.candidates, ['cheap-worker', 'strong-worker']);
  assert.equal(JSON.stringify(second).includes('sha256:'), true);
  for (const field of ['project_id', 'revision', 'policy_hash', 'applied_at', 'applied_by', 'policy']) {
    assert.equal(Object.hasOwn(second, field), true);
  }
});

test('Apply rejects an invalid draft and any credential-shaped label', () => {
  assert.throws(() => applyDraft({ status: 'draft', project_id: 'x', policy: { schema_version: 1 } }, {
    appliedBy: 'synthetic-gateway',
    appliedAt: '2026-10-31T01:00:00.000Z',
  }), error => error instanceof PolicyError);
  const draft = createDraft(policy);
  assert.throws(() => applyDraft(draft, {
    appliedBy: 'Bearer synthetic',
    appliedAt: '2026-10-31T01:00:00.000Z',
  }), error => error.code === 'policy_secret');
});
