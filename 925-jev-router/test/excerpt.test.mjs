import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXCERPT_MAX_CHARS, buildSystemOneBody, credentialFreeExcerpt, parseChoice } from '../src/index.mjs';

const policy = {
  schema_version: 1,
  project_id: 'orca-ade-example',
  candidates: ['cheap-worker', 'strong-worker'],
  fallback: 'strong-worker',
  default_worker_mode: 'per-session',
};

test('excerpt strips credentials and stays within 500 characters', () => {
  const key = ['sk', 'testfixturekey1234567890'].join('-');
  const text = `Please ${key} update the helper. password=hunter2\nAPI_TOKEN=abc123 ` + 'x'.repeat(800);
  const excerpt = credentialFreeExcerpt(text);
  assert.equal(Array.from(excerpt).length, EXCERPT_MAX_CHARS);
  assert.equal(excerpt.includes(key), false);
  assert.equal(/password=hunter2/.test(excerpt), false);
  assert.equal(/API_TOKEN=abc123/.test(excerpt), false);
  assert.match(excerpt, /\[redacted\]/);
});

test('system one body uses candidate criteria and omits project identity', () => {
  const body = buildSystemOneBody({
    policy,
    taskText: `Work in ${policy.project_id}. session sess-99. Fix the parser.`,
  });
  assert.equal(body.model, 'jev-latest');
  assert.deepEqual(Object.keys(body.questions.model.criteria), policy.candidates);
  assert.equal(body.questions.model.type, 'choice');
  assert.equal(Object.hasOwn(body.state, 'project_id'), false);
  assert.equal(JSON.stringify(body.state).includes('sess-99'), true);
  assert.equal(body.state.messages[0].text.length <= EXCERPT_MAX_CHARS, true);
  const parsed = parseChoice({ answers: { model: { choice: 'cheap-worker', confidence: 0.4 } } });
  assert.deepEqual(parsed, { ok: true, choice: 'cheap-worker', confidence: 0.4 });
  assert.equal(parseChoice({ answers: {} }).ok, false);
});
