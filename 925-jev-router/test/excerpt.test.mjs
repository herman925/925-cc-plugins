import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXCERPT_MAX_CHARS, PolicyError, buildSystemOneBody, credentialFreeExcerpt, parseChoice } from '../src/index.mjs';

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

test('excerpt redacts quoted, JSON, multiline, and outgoing-payload credentials', () => {
  const marker = 'CREDENTIALMARKER';
  const secret = `${marker} with spaces`;
  const cases = [
    {
      name: 'json',
      text: JSON.stringify({ task: 'rename helper', api_key: secret, note: 'keep' }),
      keep: 'rename helper',
    },
    {
      name: 'quoted-spaces',
      text: `token="${secret}" and then continue the rename`,
      keep: 'continue the rename',
    },
    {
      name: 'multiline-env',
      text: `API_TOKEN="${secret}\nstill ${marker}"\nKeep this sentence.`,
      keep: 'Keep this sentence.',
    },
    {
      name: 'outgoing-payload',
      text: [
        'POST /v1/chat/completions',
        `Authorization: "Bearer ${secret}"`,
        JSON.stringify({ model: 'cheap-worker', password: secret, task: 'do the work' }),
      ].join('\n'),
      keep: 'do the work',
    },
  ];
  for (const sample of cases) {
    const excerpt = credentialFreeExcerpt(sample.text);
    assert.equal(excerpt.includes(marker), false, sample.name);
    assert.equal(excerpt.includes(secret), false, sample.name);
    assert.equal(Array.from(excerpt).length <= EXCERPT_MAX_CHARS, true, sample.name);
    assert.equal(excerpt.includes(sample.keep), true, sample.name);
    const outgoing = JSON.stringify(buildSystemOneBody({ policy, taskText: sample.text }));
    assert.equal(outgoing.includes(marker), false, sample.name);
    assert.equal(outgoing.includes(sample.keep), true, sample.name);
  }
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
  assert.throws(() => buildSystemOneBody({
    policy,
    taskText: 'Pick a model.',
    eligible: ['cheap-worker', 'model-list-only'],
  }), error => error instanceof PolicyError && error.code === 'no_eligible_model');
  const eligibleBody = buildSystemOneBody({
    policy: {
      ...policy,
      candidates: ['cheap-worker', 'mid-worker', 'strong-worker'],
      fallback: 'strong-worker',
    },
    taskText: 'Pick a model.',
    eligible: ['mid-worker', 'cheap-worker'],
  });
  assert.deepEqual(eligibleBody.questions.model.criteria, {
    'mid-worker': 'mid-worker',
    'cheap-worker': 'cheap-worker',
  });
  const parsed = parseChoice({ answers: { model: { choice: 'cheap-worker', confidence: 0.4 } } });
  assert.deepEqual(parsed, { ok: true, choice: 'cheap-worker', confidence: 0.4 });
  assert.equal(parseChoice({ answers: {} }).ok, false);
});
