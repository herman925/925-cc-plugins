import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { asyncPreCallHook, planPreCall } from '../src/index.mjs';

const exampleRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../examples/project-a');
const header = ['Bearer', 'synthetic-header'].join(' ');

function request(model, content = 'Rename the helper and add a test.') {
  return {
    model,
    messages: [{ role: 'user', content }],
    metadata: { headers: { Authorization: header } },
  };
}

test('leader calls bypass Jev and do not read a missing project', async () => {
  let called = false;
  const result = await asyncPreCallHook(request('large-leader'), {
    projectRoot: path.join(exampleRoot, 'does-not-exist'),
    transport: async () => { called = true; return {}; },
  });
  assert.equal(result.model, 'large-leader');
  assert.equal(called, false);
});

test('sentinel hook finds the project file and rewrites to the TypeSafe choice', async () => {
  const planned = await planPreCall(request('jev-router', `Use ${header} in the task text.`), {
    projectRoot: exampleRoot,
    transport: async body => {
      assert.equal(JSON.stringify(body).includes(header), false);
      assert.equal(JSON.stringify(body).includes('orca-ade-example'), false);
      assert.equal(Object.hasOwn(body.state, 'project_id'), false);
      return { answers: { model: { choice: 'cheap-worker' } } };
    },
  });
  assert.equal(planned.data.model, 'cheap-worker');
  assert.equal(planned.decision.reason, 'typesafe-choice');
  assert.equal(planned.data.metadata.headers.Authorization, header);
});

test('fixed agent override bypasses TypeSafe and stays on the allowlist', async () => {
  let called = false;
  const planned = await planPreCall(request('jev-router'), {
    projectRoot: exampleRoot,
    agent: 'reviewer',
    transport: async () => { called = true; return {}; },
  });
  assert.equal(called, false);
  assert.equal(planned.data.model, 'strong-worker');
  assert.equal(planned.decision.reason, 'agent-fixed');
});

test('sentinel routing that cannot select a model errors instead of keeping the sentinel', async () => {
  const input = request('jev-router');
  const policy = {
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidates: ['cheap-worker', 'mid-worker', 'strong-worker'],
    fallback: 'strong-worker',
    default_worker_mode: 'routed',
  };
  let called = false;
  await assert.rejects(() => planPreCall(input, {
    policy,
    eligible: ['cheap-worker', 'mid-worker'],
    transport: async () => {
      called = true;
      return { answers: { model: { choice: 'not-on-list' } } };
    },
  }), error => error.code === 'fallback_ineligible');
  assert.equal(called, true);
  assert.equal(input.model, 'jev-router');
  await assert.rejects(() => planPreCall(request('jev-router'), { projectRoot: exampleRoot }), error => error.code === 'transport_missing');
});

test('decision criteria are exactly the validated eligible models', async () => {
  const policy = {
    schema_version: 1,
    project_id: 'orca-ade-example',
    candidates: ['cheap-worker', 'mid-worker', 'strong-worker'],
    fallback: 'strong-worker',
    default_worker_mode: 'routed',
  };
  const data = request('jev-router', 'Pick a model for the edit.');
  data.model_list = ['model-list-only'];
  const planned = await planPreCall(data, {
    policy,
    eligible: ['mid-worker', 'cheap-worker'],
    transport: async body => {
      assert.deepEqual(body.questions.model.criteria, {
        'mid-worker': 'mid-worker',
        'cheap-worker': 'cheap-worker',
      });
      assert.deepEqual(Object.keys(body.questions.model.criteria), ['mid-worker', 'cheap-worker']);
      return { answers: { model: { choice: 'mid-worker' } } };
    },
  });
  assert.equal(planned.data.model, 'mid-worker');
  assert.equal(JSON.stringify(planned.requestBody).includes('strong-worker'), false);
  assert.equal(JSON.stringify(planned.requestBody).includes('model-list-only'), false);
});

test('a single eligible candidate does not call TypeSafe', async () => {
  let called = false;
  const planned = await planPreCall(request('jev-router'), {
    projectRoot: exampleRoot,
    eligible: ['cheap-worker'],
    transport: async () => { called = true; return {}; },
  });
  assert.equal(called, false);
  assert.equal(planned.decision.reason, 'single-eligible');
  assert.equal(planned.data.model, 'cheap-worker');
});
