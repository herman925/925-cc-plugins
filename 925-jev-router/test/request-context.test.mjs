import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_LIMIT,
  PIN_TTL_MS,
  PolicyError,
  createMockControlPlane,
  createRequestContext,
  headersAuthorizeApply,
  normalizeHeaders,
  policyHash,
  runSyntheticPreCall,
} from '../src/index.mjs';

const ELIGIBLE = ['cheap-worker', 'mid-worker', 'strong-worker'];

const policy = {
  schema_version: 1,
  project_id: 'proj-1',
  candidates: ELIGIBLE,
  fallback: 'strong-worker',
  default_worker_mode: 'routed',
};

function headers(overrides = {}) {
  return {
    'X-Jev-Caller': 'caller-1',
    'X-Jev-Project': 'proj-1',
    'X-Jev-Revision': '1',
    'X-Jev-Session': 'sess-1',
    'X-Jev-Agent': 'agent-1',
    'X-Jev-Prompt': 'prompt-1',
    ...overrides,
  };
}

function request(text = 'Edit the file.') {
  return { model: 'jev-router', messages: [{ role: 'user', content: text }] };
}

async function pick(store, headerSet, model, extra = {}) {
  return store.resolve({
    headers: headerSet,
    eligible: extra.eligible ?? ELIGIBLE,
    select: extra.select ?? (async () => ({ model })),
  });
}

test('normalizes header names case-insensitively', async () => {
  const normalized = normalizeHeaders({
    'X-Jev-Caller': ' caller-1 ',
    'X-JEV-SESSION': ['sess-1'],
  });
  assert.equal(normalized['x-jev-caller'], 'caller-1');
  assert.equal(normalized['x-jev-session'], 'sess-1');

  const store = createRequestContext();
  const first = await pick(store, {
    'X-Jev-Caller': 'caller-1',
    'X-Jev-Project': 'proj-1',
    'X-Jev-Revision': '1',
    'X-Jev-Session': 'sess-1',
    'X-Jev-Agent': 'agent-1',
    'X-Jev-Prompt': 'prompt-1',
  }, 'cheap-worker');
  const second = await pick(store, {
    'x-jev-caller': 'caller-1',
    'x-jev-project': 'proj-1',
    'x-jev-revision': '1',
    'x-jev-session': 'sess-1',
    'x-jev-agent': 'agent-1',
    'x-jev-prompt': 'prompt-1',
  }, 'mid-worker');
  assert.equal(first.selectorInvoked, true);
  assert.equal(second.selectorInvoked, false);
  assert.equal(second.model, 'cheap-worker');
  assert.equal(second.binding, first.binding);
});

test('isolates bindings across caller, project, revision, session, and agent', async () => {
  const store = createRequestContext();
  const models = ['model-base', 'model-caller', 'model-project', 'model-revision', 'model-session', 'model-agent'];
  let index = 0;
  const select = async () => ({ model: models[index++] });
  const first = await pick(store, headers(), 'unused', { select, eligible: models });
  const variants = [
    headers({ 'X-Jev-Caller': 'caller-2' }),
    headers({ 'X-Jev-Project': 'proj-2' }),
    headers({ 'X-Jev-Revision': '2' }),
    headers({ 'X-Jev-Session': 'sess-2' }),
    headers({ 'X-Jev-Agent': 'agent-2' }),
  ];
  const isolated = [];
  for (const variant of variants) {
    isolated.push(await pick(store, variant, 'unused', { select, eligible: models }));
  }
  assert.equal(index, 6);
  assert.equal(store.size(), 6);
  for (const result of isolated) {
    assert.equal(result.selectorInvoked, true);
    assert.notEqual(result.binding, first.binding);
    assert.notEqual(result.model, first.model);
  }
  const again = await pick(store, headers(), 'model-agent', { select, eligible: models });
  assert.equal(again.selectorInvoked, false);
  assert.equal(again.model, first.model);
  assert.equal(index, 6);
});

test('prompt mode adds the prompt id to the binding', async () => {
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: calls === 1 ? 'cheap-worker' : 'mid-worker' };
  };
  const on = createRequestContext({ promptMode: true });
  const first = await pick(on, headers({ 'X-Jev-Prompt': 'prompt-a' }), 'unused', { select });
  const second = await pick(on, headers({ 'X-Jev-Prompt': 'prompt-b' }), 'unused', { select });
  assert.equal(calls, 2);
  assert.notEqual(first.binding, second.binding);
  assert.equal(first.model, 'cheap-worker');
  assert.equal(second.model, 'mid-worker');

  calls = 0;
  const off = createRequestContext({ promptMode: false });
  const left = await pick(off, headers({ 'X-Jev-Prompt': 'prompt-a' }), 'unused', { select });
  const right = await pick(off, headers({ 'X-Jev-Prompt': 'prompt-b' }), 'unused', { select });
  assert.equal(calls, 1);
  assert.equal(right.selectorInvoked, false);
  assert.equal(right.model, left.model);
  assert.equal(left.binding, right.binding);
});

test('one prompt keeps the selection across tool results and retries', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: 'cheap-worker' };
  };
  const first = await pick(store, headers(), 'unused', { select });
  const tool = await pick(store, headers({ 'X-Jev-Traffic': 'tool-result' }), 'mid-worker', { select });
  const retry = await pick(store, headers({ 'X-Jev-Traffic': 'retry' }), 'strong-worker', { select });
  assert.equal(calls, 1);
  assert.equal(tool.selectorInvoked, false);
  assert.equal(retry.selectorInvoked, false);
  assert.equal(tool.model, first.model);
  assert.equal(retry.model, first.model);
  assert.equal(tool.agent, 'agent-1');
  assert.equal(retry.agent, first.agent);
  assert.equal(store.size(), 1);
});

test('prompt ids may span subagents without dropping the agent id', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: calls === 1 ? 'cheap-worker' : 'mid-worker' };
  };
  const parent = 'agent-parent';
  const childA = await pick(store, headers({
    'X-Jev-Agent': 'child-a',
    'X-Jev-Parent-Agent': parent,
    'X-Jev-Prompt': 'prompt-shared',
  }), 'unused', { select });
  const childB = await pick(store, headers({
    'X-Jev-Agent': 'child-b',
    'X-Jev-Parent-Agent': parent,
    'X-Jev-Prompt': 'prompt-shared',
  }), 'unused', { select });
  const again = await pick(store, headers({
    'X-Jev-Agent': 'child-a',
    'X-Jev-Parent-Agent': parent,
    'X-Jev-Prompt': 'prompt-shared',
  }), 'strong-worker', { select });
  const parentOnly = await pick(store, headers({
    'X-Jev-Agent': '   ',
    'X-Jev-Parent-Agent': parent,
    'X-Jev-Prompt': 'prompt-shared',
  }), 'unused', { select });
  assert.equal(childA.agent, 'child-a');
  assert.equal(childB.agent, 'child-b');
  assert.equal(childA.parentAgent, parent);
  assert.equal(childB.parentAgent, parent);
  assert.notEqual(childA.binding, childB.binding);
  assert.equal(JSON.parse(childA.binding)[4], 'child-a');
  assert.equal(JSON.parse(childB.binding)[4], 'child-b');
  assert.equal(JSON.parse(childA.binding).includes(parent), false);
  assert.equal(again.selectorInvoked, false);
  assert.equal(again.model, 'cheap-worker');
  assert.equal(again.agent, 'child-a');
  assert.equal(again.parentAgent, parent);
  assert.equal(parentOnly.ok, false);
  assert.equal(parentOnly.code, 'binding_incomplete');
  assert.equal(calls, 2);
  assert.equal(store.size(), 2);
});

test('a new prompt may select again without requiring a different model', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: 'cheap-worker' };
  };
  const first = await pick(store, headers({ 'X-Jev-Prompt': 'prompt-1' }), 'unused', { select });
  const next = await pick(store, headers({ 'X-Jev-Prompt': 'prompt-2' }), 'unused', { select });
  assert.equal(calls, 2);
  assert.equal(next.selectorInvoked, true);
  assert.equal(next.model, first.model);
  assert.equal(next.agent, first.agent);
  assert.notEqual(next.binding, first.binding);
});

test('missing blank or conflicting ids pin or error', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: 'cheap-worker' };
  };
  const withoutSession = headers();
  delete withoutSession['X-Jev-Session'];
  const missing = await pick(store, withoutSession, 'unused', { select });
  const blank = await pick(store, headers({ 'X-Jev-Project': '   ' }), 'unused', { select });
  const conflict = await pick(store, headers({ 'X-Jev-Caller': ['caller-1', 'caller-2'] }), 'unused', { select });
  const bearerOnly = await pick(store, {
    Authorization: 'Bearer synthetic-jev-test-token',
    'X-Jev-Project': 'proj-1',
    'X-Jev-Revision': '1',
    'X-Jev-Session': 'sess-1',
    'X-Jev-Agent': 'agent-1',
    'X-Jev-Prompt': 'prompt-1',
  }, 'unused', { select });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'binding_incomplete');
  assert.equal(missing.model, null);
  assert.equal(blank.code, 'binding_incomplete');
  assert.equal(conflict.code, 'binding_conflict');
  assert.equal(bearerOnly.code, 'binding_incomplete');
  assert.equal(calls, 0);
  assert.equal(store.size(), 0);

  const pinned = await pick(store, headers(), 'unused', { select });
  const held = await pick(store, headers(), 'mid-worker', { select });
  assert.equal(pinned.ok, true);
  assert.equal(held.selectorInvoked, false);
  assert.equal(held.model, 'cheap-worker');
  assert.equal(calls, 1);
  assert.equal(store.size(), 1);
});

test('identity headers do not authorize apply', () => {
  const token = 'synthetic-jev-test-token';
  const plane = createMockControlPlane({
    token,
    configuredAliases: ELIGIBLE,
  });
  const identity = headers();
  const denied = plane.request({
    method: 'POST',
    path: '/jev/v1/projects/proj-1/apply',
    headers: identity,
    body: { schema_version: 1, policy, policy_hash: policyHash(policy) },
  });
  assert.equal(denied.status, 401);
  assert.equal(headersAuthorizeApply(identity), false);
  assert.equal(headersAuthorizeApply({ ...identity, Authorization: `Bearer ${token}` }), false);

  const allowed = plane.request({
    method: 'POST',
    path: '/jev/v1/projects/proj-1/apply',
    headers: { ...identity, Authorization: `Bearer ${token}` },
    body: { schema_version: 1, policy, policy_hash: policyHash(policy) },
  });
  assert.equal(allowed.status, 200);
  assert.equal(JSON.stringify(allowed.body).includes(token), false);
});

test('concurrent requests for one binding share one selection', async () => {
  const store = createRequestContext();
  let started = 0;
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  const select = async () => {
    started += 1;
    await gate;
    return { model: 'cheap-worker' };
  };
  const first = pick(store, headers(), 'unused', { select });
  const second = pick(store, headers(), 'mid-worker', { select });
  assert.equal(started, 1);
  release();
  const [left, right] = await Promise.all([first, second]);
  assert.equal(started, 1);
  assert.equal(left.selectorInvoked, true);
  assert.equal(left.shared, false);
  assert.equal(right.selectorInvoked, false);
  assert.equal(right.shared, true);
  assert.equal(left.model, 'cheap-worker');
  assert.equal(right.model, 'cheap-worker');
  assert.equal(left.binding, right.binding);
  assert.equal(store.size(), 1);

  const other = createRequestContext();
  let separate = 0;
  const otherSelect = async () => {
    separate += 1;
    return { model: separate === 1 ? 'cheap-worker' : 'mid-worker' };
  };
  const [a, b] = await Promise.all([
    pick(other, headers({ 'X-Jev-Session': 'sess-a' }), 'unused', { select: otherSelect }),
    pick(other, headers({ 'X-Jev-Session': 'sess-b' }), 'unused', { select: otherSelect }),
  ]);
  assert.equal(separate, 2);
  assert.notEqual(a.binding, b.binding);
  assert.notEqual(a.model, b.model);
  assert.equal(other.size(), 2);
});

test('auxiliary and compaction traffic keep the pin', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: 'cheap-worker' };
  };
  const pinned = await pick(store, headers(), 'unused', { select });
  const auxiliary = await pick(store, headers({ 'X-Jev-Traffic': 'Auxiliary' }), 'mid-worker', { select });
  const compaction = await pick(store, headers({ 'X-Jev-Traffic': 'compaction' }), 'strong-worker', { select });
  assert.equal(calls, 1);
  assert.equal(auxiliary.ok, true);
  assert.equal(auxiliary.selectorInvoked, false);
  assert.equal(auxiliary.model, pinned.model);
  assert.equal(compaction.model, pinned.model);
  assert.equal(compaction.agent, pinned.agent);
  assert.equal(store.size(), 1);
});

test('auxiliary traffic before a pin does not invent a leader', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: 'large-leader' };
  };
  const early = await pick(store, headers({ 'X-Jev-Traffic': 'auxiliary' }), 'unused', { select });
  assert.equal(early.ok, false);
  assert.equal(early.code, 'auxiliary_unpinned');
  assert.equal(early.model, null);
  assert.equal(calls, 0);
  assert.equal(store.size(), 0);

  await assert.rejects(() => runSyntheticPreCall({
    contextStore: store,
    headers: headers({ 'X-Jev-Traffic': 'compaction' }),
    policy,
    revision: 1,
    request: request(),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  }), error => error instanceof PolicyError && error.code === 'auxiliary_unpinned');
  assert.equal(calls, 0);
  assert.equal(store.size(), 0);
});

test('a failed selection does not leave a pin', async () => {
  const store = createRequestContext();
  let calls = 0;
  await assert.rejects(() => pick(store, headers(), 'unused', {
    select: async () => {
      calls += 1;
      throw new Error('select failed');
    },
  }));
  assert.equal(store.size(), 0);
  const retried = await pick(store, headers(), 'unused', {
    select: async () => {
      calls += 1;
      return { model: 'mid-worker' };
    },
  });
  assert.equal(calls, 2);
  assert.equal(retried.ok, true);
  assert.equal(retried.model, 'mid-worker');
  assert.equal(store.size(), 1);
});

test('an ineligible cached model is revoked before execution', async () => {
  const store = createRequestContext();
  const first = await pick(store, headers(), 'cheap-worker');
  assert.equal(first.model, 'cheap-worker');
  let calls = 0;
  const next = await store.resolve({
    headers: headers(),
    eligible: ['mid-worker', 'strong-worker'],
    select: async () => {
      calls += 1;
      return { model: 'mid-worker' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(next.model, 'mid-worker');
  assert.notEqual(next.model, 'cheap-worker');
  assert.equal(store.size(), 1);

  const ran = await runSyntheticPreCall({
    contextStore: store,
    headers: headers(),
    policy,
    revision: 1,
    eligible: ['cheap-worker', 'strong-worker'],
    request: request('Revoke the cached worker.'),
    transportResponses: [{ answers: { model: { choice: 'strong-worker' } } }],
  });
  assert.equal(ran.wire.selectorCalls, 1);
  assert.equal(ran.wire.execution.model, 'strong-worker');
  assert.notEqual(ran.wire.execution.model, 'mid-worker');
});

test('the pin cache is bounded and expires', async () => {
  assert.equal(PIN_TTL_MS, 15 * 60 * 1000);
  assert.equal(CACHE_LIMIT, 64);

  const bounded = createRequestContext({ limit: 2 });
  await pick(bounded, headers({ 'X-Jev-Prompt': 'prompt-a' }), 'cheap-worker');
  await pick(bounded, headers({ 'X-Jev-Prompt': 'prompt-b' }), 'mid-worker');
  await pick(bounded, headers({ 'X-Jev-Prompt': 'prompt-c' }), 'strong-worker');
  assert.equal(bounded.size(), 2);
  let revived = 0;
  const again = await pick(bounded, headers({ 'X-Jev-Prompt': 'prompt-a' }), 'unused', {
    select: async () => {
      revived += 1;
      return { model: 'cheap-worker' };
    },
  });
  assert.equal(revived, 1);
  assert.equal(again.selectorInvoked, true);
  assert.equal(again.model, 'cheap-worker');

  let clock = 0;
  const expiring = createRequestContext({ ttlMs: 1000, now: () => clock });
  await pick(expiring, headers(), 'cheap-worker');
  clock = 1000;
  const held = await pick(expiring, headers(), 'mid-worker');
  assert.equal(held.selectorInvoked, false);
  assert.equal(held.model, 'cheap-worker');
  clock = 1001;
  const expired = await pick(expiring, headers(), 'mid-worker');
  assert.equal(expired.selectorInvoked, true);
  assert.equal(expired.model, 'mid-worker');
  assert.notEqual(expired.model, 'cheap-worker');
});

test('harness records the downstream model and selector call count', async () => {
  const store = createRequestContext();
  const first = await runSyntheticPreCall({
    contextStore: store,
    headers: headers(),
    policy,
    revision: 1,
    request: request('Rename the helper.'),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  const second = await runSyntheticPreCall({
    contextStore: store,
    headers: headers({ 'X-Jev-Traffic': 'tool-result' }),
    policy,
    revision: 1,
    request: request('Rename the helper.'),
    transportResponses: [{ answers: { model: { choice: 'mid-worker' } } }],
  });
  assert.equal(first.wire.hook, 'sentinel');
  assert.equal(first.wire.selectorCalls, 1);
  assert.equal(first.wire.execution.model, 'cheap-worker');
  assert.equal(first.data.model, 'cheap-worker');
  assert.equal(second.wire.selectorCalls, 0);
  assert.equal(second.wire.execution.model, 'cheap-worker');
  assert.equal(second.decision.reason, 'context-pin');
  assert.equal(second.context.agent, 'agent-1');
});

test('a sentinel with incomplete identity is not the leader path', async () => {
  const store = createRequestContext();
  await assert.rejects(() => runSyntheticPreCall({
    contextStore: store,
    headers: headers({ 'X-Jev-Agent': '  ', 'X-Jev-Parent-Agent': '' }),
    policy,
    revision: 1,
    request: request(),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  }), error => error instanceof PolicyError && error.code === 'binding_incomplete');
  assert.equal(store.size(), 0);

  const leader = await runSyntheticPreCall({
    contextStore: store,
    headers: headers(),
    policy,
    request: { model: 'large-leader', messages: [{ role: 'user', content: 'Review the patch.' }] },
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(leader.wire.hook, 'leader-bypass');
  assert.equal(leader.wire.selectorCalls, 0);
  assert.equal(leader.wire.execution.model, 'large-leader');
  assert.equal(store.size(), 0);
});

test('a shared waiter revalidates eligibility before execution', async () => {
  const store = createRequestContext();
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let calls = 0;
  const select = async () => {
    calls += 1;
    await gate;
    return { model: 'cheap-worker' };
  };
  const first = store.resolve({
    headers: headers(),
    eligible: ['cheap-worker', 'strong-worker'],
    select,
  });
  const waiter = store.resolve({
    headers: headers(),
    eligible: ['strong-worker'],
    select,
  });
  assert.equal(calls, 1);
  release();
  const [leader, shared] = await Promise.all([first, waiter]);
  assert.equal(leader.ok, true);
  assert.equal(leader.model, 'cheap-worker');
  assert.equal(leader.selectorInvoked, true);
  assert.equal(shared.ok, false);
  assert.equal(shared.code, 'selection_rejected');
  assert.equal(shared.model, null);
  assert.equal(shared.shared, true);
  assert.equal(shared.selectorInvoked, false);
  assert.equal(calls, 1);
  assert.equal(store.size(), 1);
});

test('execution intersects eligibility with the applied policy', async () => {
  const store = createRequestContext();
  await pick(store, headers(), 'cheap-worker');
  const narrowed = {
    ...policy,
    candidates: ['strong-worker'],
    fallback: 'strong-worker',
  };
  const ran = await runSyntheticPreCall({
    contextStore: store,
    headers: headers(),
    policy: narrowed,
    revision: 1,
    eligible: ['cheap-worker', 'strong-worker'],
    request: request('Use the current policy.'),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(ran.wire.execution.model, 'strong-worker');
  assert.notEqual(ran.wire.execution.model, 'cheap-worker');
  assert.equal(ran.data.model, 'strong-worker');

  await assert.rejects(() => runSyntheticPreCall({
    contextStore: store,
    headers: headers({ 'X-Jev-Project': 'other-proj' }),
    policy,
    revision: 1,
    request: request(),
  }), error => error instanceof PolicyError && error.code === 'binding_mismatch');
  await assert.rejects(() => runSyntheticPreCall({
    contextStore: store,
    headers: headers({ 'X-Jev-Revision': '9' }),
    applied: { project_id: 'proj-1', revision: 1, policy },
    request: request(),
  }), error => error instanceof PolicyError && error.code === 'binding_mismatch');
  await assert.rejects(() => runSyntheticPreCall({
    headers: headers(),
    applied: { project_id: 'other-proj', revision: 1, policy },
    request: request(),
  }), error => error instanceof PolicyError && error.code === 'binding_mismatch');
  const matched = await runSyntheticPreCall({
    headers: headers({ 'X-Jev-Revision': '4' }),
    applied: { project_id: 'proj-1', revision: 4, policy },
    request: request('Trust the applied revision.'),
    transportResponses: [{ answers: { model: { choice: 'mid-worker' } } }],
  });
  assert.equal(matched.wire.execution.model, 'mid-worker');
  assert.equal(matched.context.agent, 'agent-1');
});

test('a fixed agent override uses the validated header identity', async () => {
  const fixedPolicy = {
    ...policy,
    agents: { reviewer: { mode: 'fixed', model: 'strong-worker' } },
  };
  const ran = await runSyntheticPreCall({
    headers: headers({ 'X-Jev-Agent': 'reviewer' }),
    policy: fixedPolicy,
    revision: 1,
    request: request('Review the patch.'),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(ran.wire.hook, 'fixed-agent');
  assert.equal(ran.wire.selectorCalls, 0);
  assert.equal(ran.wire.execution.model, 'strong-worker');
  assert.equal(ran.context.agent, 'reviewer');

  const store = createRequestContext();
  await assert.rejects(() => runSyntheticPreCall({
    contextStore: store,
    headers: headers({ 'X-Jev-Agent': 'reviewer' }),
    agent: 'other-agent',
    policy: fixedPolicy,
    revision: 1,
    request: request(),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  }), error => error instanceof PolicyError && error.code === 'binding_conflict');
  assert.equal(store.size(), 0);

  const child = await runSyntheticPreCall({
    headers: headers({
      'X-Jev-Agent': 'worker-1',
      'X-Jev-Parent-Agent': 'reviewer',
    }),
    policy: fixedPolicy,
    revision: 1,
    request: request('Child work.'),
    transportResponses: [{ answers: { model: { choice: 'cheap-worker' } } }],
  });
  assert.equal(child.wire.hook, 'sentinel');
  assert.equal(child.wire.selectorCalls, 1);
  assert.equal(child.wire.execution.model, 'cheap-worker');
  assert.equal(child.context.agent, 'worker-1');
  assert.equal(child.context.parentAgent, 'reviewer');
});

test('identity keys reject controls and do not collide', async () => {
  const store = createRequestContext();
  let calls = 0;
  const select = async () => {
    calls += 1;
    return { model: calls === 1 ? 'cheap-worker' : 'mid-worker' };
  };
  const left = await pick(store, headers({ 'X-Jev-Caller': 'a\u001fb', 'X-Jev-Project': 'c' }), 'unused', { select });
  const right = await pick(store, headers({ 'X-Jev-Caller': 'a', 'X-Jev-Project': 'b\u001fc' }), 'unused', { select });
  const newline = await pick(store, headers({ 'X-Jev-Session': 'sess\n1' }), 'unused', { select });
  assert.equal(left.ok, false);
  assert.equal(left.code, 'binding_conflict');
  assert.equal(left.model, null);
  assert.equal(right.code, 'binding_conflict');
  assert.equal(newline.code, 'binding_conflict');
  assert.equal(calls, 0);
  assert.equal(store.size(), 0);

  const quoted = await pick(store, headers({ 'X-Jev-Caller': 'a","b', 'X-Jev-Project': 'c' }), 'unused', { select });
  const other = await pick(store, headers({ 'X-Jev-Caller': 'a', 'X-Jev-Project': 'b","c' }), 'unused', { select });
  assert.equal(quoted.ok, true);
  assert.equal(other.ok, true);
  assert.notEqual(quoted.binding, other.binding);
  assert.equal(JSON.parse(quoted.binding)[0], 'a","b');
  assert.equal(JSON.parse(other.binding)[1], 'b","c');
  assert.equal(calls, 2);
  assert.equal(store.size(), 2);
});

test('in-flight admission is bounded and expired flights do not commit', async () => {
  let clock = 0;
  const store = createRequestContext({ limit: 2, inflightDeadlineMs: 1000, now: () => clock });
  let release;
  const gate = new Promise(resolve => {
    release = resolve;
  });
  let calls = 0;
  const select = async () => {
    calls += 1;
    await gate;
    return { model: 'cheap-worker' };
  };
  const pending = [];
  for (let index = 0; index < 80; index += 1) {
    pending.push(store.resolve({
      headers: headers({ 'X-Jev-Prompt': `prompt-${index}` }),
      eligible: ELIGIBLE,
      select,
    }));
  }
  assert.equal(calls, 2);
  assert.equal(store.size(), 0);
  assert.equal(store.inflightSize(), 2);
  const joined = store.resolve({
    headers: headers({ 'X-Jev-Prompt': 'prompt-0' }),
    eligible: ELIGIBLE,
    select,
  });
  assert.equal(calls, 2);
  assert.equal(store.inflightSize(), 2);
  release();
  const results = await Promise.all([...pending, joined]);
  const rejected = results.filter(result => result.code === 'admission_rejected');
  const committed = results.filter(result => result.ok);
  assert.equal(rejected.length, 78);
  assert.equal(committed.length, 3);
  assert.equal(calls, 2);
  assert.equal(store.size(), 2);
  assert.equal(store.inflightSize(), 0);
  assert.equal(committed.every(result => result.model === 'cheap-worker'), true);

  let lateClock = 0;
  const late = createRequestContext({ limit: 1, inflightDeadlineMs: 500, now: () => lateClock });
  let releaseLate;
  const lateGate = new Promise(resolve => {
    releaseLate = resolve;
  });
  const first = late.resolve({
    headers: headers({ 'X-Jev-Prompt': 'prompt-a' }),
    eligible: ELIGIBLE,
    select: async () => {
      await lateGate;
      return { model: 'cheap-worker' };
    },
  });
  assert.equal(late.inflightSize(), 1);
  lateClock = 501;
  const second = await late.resolve({
    headers: headers({ 'X-Jev-Prompt': 'prompt-b' }),
    eligible: ELIGIBLE,
    select: async () => ({ model: 'mid-worker' }),
  });
  assert.equal(second.ok, true);
  assert.equal(second.model, 'mid-worker');
  releaseLate();
  const expired = await first;
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'admission_expired');
  assert.equal(expired.model, null);
  const retry = await late.resolve({
    headers: headers({ 'X-Jev-Prompt': 'prompt-a' }),
    eligible: ELIGIBLE,
    select: async () => ({ model: 'strong-worker' }),
  });
  assert.equal(retry.selectorInvoked, true);
  assert.equal(retry.model, 'strong-worker');
  assert.notEqual(retry.model, 'cheap-worker');
});
