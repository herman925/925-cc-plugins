import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PolicyError, selectExecuteModel } from '../src/index.mjs';

const policy = {
  schema_version: 1,
  project_id: 'orca-ade-example',
  candidates: ['cheap-worker', 'strong-worker'],
  fallback: 'strong-worker',
  default_worker_mode: 'routed',
};

test('a TypeSafe choice on the project list is executed', () => {
  const decision = selectExecuteModel({
    policy,
    choice: 'cheap-worker',
    calledDecide: true,
    attempt: 0,
  });
  assert.deepEqual(decision, { model: 'cheap-worker', reason: 'typesafe-choice', attempt: 0, retry: false });
});

test('a model that is only on model_list is never executed', () => {
  const decision = selectExecuteModel({
    policy,
    choice: 'model-list-only',
    calledDecide: true,
    attempt: 0,
  });
  assert.equal(decision.model, 'strong-worker');
  assert.equal(decision.reason, 'fallback-invalid-choice');
  assert.throws(() => selectExecuteModel({
    policy,
    eligible: ['model-list-only'],
    calledDecide: false,
  }), error => error instanceof PolicyError && error.code === 'no_eligible_model');
});

test('transient TypeSafe failure retries once, then uses the project fallback', () => {
  const retry = selectExecuteModel({
    policy,
    transportError: { transient: true, status: 529 },
    calledDecide: true,
    attempt: 0,
  });
  assert.equal(retry.retry, true);
  assert.equal(retry.reason, 'typesafe-retry');
  const opened = selectExecuteModel({
    policy,
    transportError: { transient: true, status: 529 },
    calledDecide: true,
    attempt: 1,
  });
  assert.equal(opened.model, 'strong-worker');
  assert.equal(opened.reason, 'fallback-after-retry');
});

test('non-transient TypeSafe rejection does not retry or fall open', () => {
  assert.throws(() => selectExecuteModel({
    policy,
    transportError: { transient: false, status: 401 },
    calledDecide: true,
    attempt: 0,
  }), error => error.code === 'typesafe_non_transient');
});

test('no eligible model is a clear error and does not pick the first candidate', () => {
  assert.throws(() => selectExecuteModel({
    policy,
    eligible: [],
    choice: 'cheap-worker',
    calledDecide: true,
  }), error => error.code === 'no_eligible_model' && /first candidate/.test(error.message));
  assert.throws(() => selectExecuteModel({
    policy,
    eligible: ['cheap-worker'],
    choice: 'not-a-choice',
    calledDecide: true,
  }), error => error.code === 'fallback_ineligible');
});

test('one remaining eligible model is used without a decide call', () => {
  const decision = selectExecuteModel({
    policy,
    eligible: ['cheap-worker'],
    calledDecide: false,
  });
  assert.equal(decision.reason, 'single-eligible');
  assert.equal(decision.model, 'cheap-worker');
});

test('several eligible models still need a decision before fallback', () => {
  const decision = selectExecuteModel({ policy, calledDecide: false });
  assert.equal(decision.reason, 'needs-decide');
  assert.equal(decision.model, null);
});
