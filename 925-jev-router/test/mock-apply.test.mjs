import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockControlPlane, policyHash } from '../src/index.mjs';

const token = 'synthetic-jev-test-token';
const aliases = ['cheap-worker', 'mid-worker', 'strong-worker', 'unapproved-on-gateway'];

function policy(overrides = {}) {
  return {
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidates: ['cheap-worker', 'strong-worker'],
    fallback: 'strong-worker',
    default_worker_mode: 'routed',
    ...overrides,
  };
}

function plane(now = () => '2026-10-31T03:00:00.000Z') {
  return createMockControlPlane({ token, configuredAliases: aliases, now });
}

function apply(control, document, headers = { Authorization: `Bearer ${token}` }) {
  return control.request({
    method: 'POST',
    path: `/jev/v1/projects/${document.project_id}/apply`,
    headers,
    body: {
      schema_version: 1,
      policy: document,
      policy_hash: policyHash(document),
      source: 'html-picker',
    },
  });
}

test('mock apply and read-back require the synthetic token and return the applied record', () => {
  const control = plane();
  const document = policy();
  assert.equal(control.request({
    method: 'POST',
    path: '/jev/v1/projects/orca-ade-example/apply',
    body: { schema_version: 1, policy: document, policy_hash: policyHash(document) },
  }).status, 401);
  assert.equal(apply(control, document, { authorization: 'Bearer wrong-token-value' }).status, 401);
  const applied = apply(control, document, { authorization: `bearer ${token}` });
  assert.equal(applied.status, 200);
  assert.equal(applied.body.revision, 1);
  assert.equal(applied.body.applied_by, 'mock-verifier');
  assert.equal(applied.body.policy_hash, policyHash(document));
  assert.equal(JSON.stringify(applied.body).includes(token), false);
  const read = control.request({
    method: 'GET',
    path: '/jev/v1/projects/orca-ade-example/applied',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.policy.candidates, ['cheap-worker', 'strong-worker']);
  assert.equal(control.request({
    method: 'GET',
    path: '/jev/v1/projects/missing-project/applied',
    headers: { Authorization: `Bearer ${token}` },
  }).status, 404);
});

test('a rejected apply does not change the stored record, and the response is a copy', () => {
  const control = plane(() => '2026-10-31T04:00:00.000Z');
  const document = policy();
  const first = apply(control, document);
  first.body.policy.candidates.push('extra-worker');
  first.body.revision = 99;
  const mismatched = control.request({
    method: 'POST',
    path: '/jev/v1/projects/orca-ade-example/apply',
    headers: { Authorization: `Bearer ${token}` },
    body: {
      schema_version: 1,
      policy: document,
      policy_hash: 'sha256:not-the-hash',
    },
  });
  assert.equal(mismatched.status, 400);
  assert.equal(mismatched.body.error, 'policy_hash_mismatch');
  const unknown = apply(control, policy({ candidates: ['not-configured'], fallback: 'not-configured' }));
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'alias_unknown');
  const other = policy({ project_id: 'other-project' });
  const otherProject = control.request({
    method: 'POST',
    path: '/jev/v1/projects/orca-ade-example/apply',
    headers: { Authorization: `Bearer ${token}` },
    body: { schema_version: 1, policy: other, policy_hash: policyHash(other) },
  });
  assert.equal(otherProject.status, 400);
  assert.equal(otherProject.body.error, 'apply_shape');
  const read = control.request({
    method: 'GET',
    path: '/jev/v1/projects/orca-ade-example/applied',
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(read.body.revision, 1);
  assert.deepEqual(read.body.policy.candidates, ['cheap-worker', 'strong-worker']);
  const second = apply(control, policy({ default_worker_mode: 'per-turn' }));
  assert.equal(second.body.revision, 2);
});

test('null, scalar, and array apply bodies are structured errors and do not change the store', () => {
  const control = plane();
  const document = policy();
  assert.equal(apply(control, document).status, 200);
  const headers = { Authorization: `Bearer ${token}` };
  const path = '/jev/v1/projects/orca-ade-example/apply';
  const bodies = ['null', '42', '[1]', null, 42, [1]];
  for (const body of bodies) {
    const rejected = control.request({ method: 'POST', path, headers, body });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.error, 'apply_shape');
    assert.equal(typeof rejected.body.message, 'string');
  }
  const read = control.request({
    method: 'GET',
    path: '/jev/v1/projects/orca-ade-example/applied',
    headers,
  });
  assert.equal(read.status, 200);
  assert.equal(read.body.revision, 1);
  assert.deepEqual(read.body.policy.candidates, ['cheap-worker', 'strong-worker']);
});

test('gateway alias existence is not project approval', () => {
  const control = plane();
  const applied = apply(control, policy());
  assert.equal(applied.status, 200);
  assert.equal(applied.body.policy.candidates.includes('unapproved-on-gateway'), false);
});
