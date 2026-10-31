import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PolicyError, validatePolicy, loadProjectPolicy } from '../src/index.mjs';

const exampleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples/project-a');

const valid = () => ({
  schema_version: 1,
  project_id: 'orca-ade-example',
  candidates: ['cheap-worker', 'strong-worker'],
  fallback: 'strong-worker',
  default_worker_mode: 'routed',
});

function rejects(input, code) {
  assert.throws(() => validatePolicy(input), error => error instanceof PolicyError && error.code === code);
}

test('example project policy loads from .925-jev-router/config.json', () => {
  const policy = loadProjectPolicy(exampleRoot);
  assert.equal(policy.project_id, 'orca-ade-example');
  assert.deepEqual(policy.candidates, ['cheap-worker', 'strong-worker']);
  assert.equal(policy.fallback, 'strong-worker');
  assert.equal(policy.agents.reviewer.mode, 'fixed');
});

test('schema accepts a minimal allowlist and optional agents', () => {
  const policy = validatePolicy({
    ...valid(),
    agents: { coder: { mode: 'per-turn' }, reviewer: { mode: 'fixed', model: 'cheap-worker' } },
  });
  assert.equal(policy.schema_version, 1);
  assert.equal(policy.agents.reviewer.model, 'cheap-worker');
});

test('schema rejects unknown versions, empty candidates, and sentinel aliases', () => {
  rejects({ ...valid(), schema_version: 2 }, 'policy_schema');
  rejects({ ...valid(), candidates: [] }, 'policy_candidates');
  rejects({ ...valid(), candidates: ['jev-router'], fallback: 'jev-router' }, 'policy_sentinel');
  rejects({ ...valid(), candidates: ['team-jev-router'], fallback: 'team-jev-router' }, 'policy_sentinel');
});

test('fallback and agent models must be project candidates, not loose names', () => {
  rejects({ ...valid(), fallback: 'model-list-only' }, 'policy_fallback');
  rejects({
    ...valid(),
    agents: { coder: { mode: 'fixed', model: 'model-list-only' } },
  }, 'policy_agent');
  rejects({ ...valid(), agents: { coder: { mode: 'fixed' } } }, 'policy_agent');
});

test('policy file rejects credentials, provider URLs, and unknown fields', () => {
  rejects({ ...valid(), api_key: 'present' }, 'policy_secret');
  rejects({ ...valid(), candidates: ['https://gateway.example/v1'] }, 'policy_secret');
  const token = ['sk', 'testfixturekey1234567890'].join('-');
  rejects({ ...valid(), candidates: [token], fallback: token }, 'policy_secret');
  rejects({ ...valid(), model_list: ['strong-worker'] }, 'policy_schema');
});

test('missing and invalid policy files are clear errors', () => {
  assert.throws(() => loadProjectPolicy(path.join(exampleRoot, 'missing-child')), error => error.code === 'policy_missing');
  const root = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'jev-policy-'));
  fs.mkdirSync(path.join(root, '.925-jev-router'));
  fs.writeFileSync(path.join(root, '.925-jev-router', 'config.json'), '{', 'utf8');
  assert.throws(() => loadProjectPolicy(root), error => error.code === 'policy_invalid_json');
  const parent = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'jev-parent-'));
  const child = path.join(parent, 'child');
  fs.mkdirSync(path.join(parent, '.925-jev-router'), { recursive: true });
  fs.writeFileSync(path.join(parent, '.925-jev-router', 'config.json'), `${JSON.stringify(valid())}\n`);
  fs.mkdirSync(child);
  assert.throws(() => loadProjectPolicy(child), error => error.code === 'policy_missing');
});
