import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { validatePolicy } from '../src/index.mjs';

const pickerDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples/project-a/.925-jev-router');

function loadDraftForm() {
  const sandbox = {};
  sandbox.globalThis = sandbox;
  vm.runInNewContext(fs.readFileSync(path.join(pickerDir, 'draft-form.js'), 'utf8'), sandbox);
  return sandbox.JevRouterDraft;
}

test('picker local-save payload is a Draft the schema accepts', () => {
  const api = loadDraftForm();
  const saved = api.validate({
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidatesText: 'cheap-worker\nstrong-worker\n',
    fallback: 'strong-worker',
    default_worker_mode: 'routed',
    agentsText: '{\n  "coder": { "mode": "per-turn" }\n}',
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.policy.status, undefined);
  assert.deepEqual(validatePolicy(saved.policy).candidates, ['cheap-worker', 'strong-worker']);
});

test('picker rejects sentinel aliases and credentials before save', () => {
  const api = loadDraftForm();
  const sentinel = api.validate({
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidatesText: 'jev-router\nstrong-worker',
    fallback: 'strong-worker',
    default_worker_mode: 'routed',
    agentsText: '',
  });
  assert.equal(sentinel.ok, false);
  assert.equal(sentinel.errors.some(error => error.code === 'policy_sentinel'), true);
  const secret = api.validate({
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidatesText: 'https://gateway.example/v1',
    fallback: 'https://gateway.example/v1',
    default_worker_mode: 'routed',
    agentsText: '',
  });
  assert.equal(secret.ok, false);
  assert.equal(secret.errors.some(error => error.code === 'policy_secret' || error.code === 'policy_candidates'), true);
});

test('picker html is draft-only and has no gateway token', () => {
  const html = fs.readFileSync(path.join(pickerDir, 'picker.html'), 'utf8');
  const script = fs.readFileSync(path.join(pickerDir, 'draft-form.js'), 'utf8');
  assert.match(html, /id="local-save"/);
  assert.match(html, /Local Save/);
  assert.match(html, /Apply is deferred/);
  assert.doesNotMatch(html, /<button[^>]*>\s*Apply/i);
  assert.doesNotMatch(html, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(script, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(`${html}\n${script}`, /type\s*=\s*["']password["']/);
  assert.doesNotMatch(html, /admin[_-]?key|master[_-]?key|LITELLM_MASTER|TYPESAFE_API_KEY|Bearer\s/i);
  assert.doesNotMatch(`${html}\n${script}`, /api\.typesafe\.ai|litellm/i);
});
