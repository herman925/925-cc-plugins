import { PolicyError } from './errors.mjs';
import { SENTINEL_MODEL } from './schema.mjs';
import { planPreCall } from './hook.mjs';
import { createRequestContext } from './request-context.mjs';

const CONTEXT_ERRORS = Object.freeze({
  binding_incomplete: 'Request identity is missing or blank. Refusing to switch model per request.',
  binding_conflict: 'Request identity headers conflict. Refusing to switch model per request.',
  auxiliary_unpinned: 'Auxiliary traffic has no pin. Refusing to invent a leader selection.',
  selection_rejected: 'Selection did not produce an eligible model. No pin was committed.',
  selection_failed: 'Selection failed before a pin was committed.',
});

async function executePlan(fixture) {
  const responses = [...(fixture.transportResponses ?? [])];
  const calls = [];
  const transport = async (body, meta) => {
    calls.push({ body, attempt: meta?.attempt ?? 0 });
    if (responses.length === 0) {
      const error = new Error('Synthetic transport has no further response.');
      error.transient = false;
      throw error;
    }
    const next = responses.shift();
    if (next && next.throw) {
      const error = new Error(next.message ?? 'Synthetic TypeSafe failure');
      error.transient = Boolean(next.transient);
      error.status = next.status ?? null;
      throw error;
    }
    return next;
  };
  const planned = await planPreCall(fixture.request, {
    projectRoot: fixture.projectRoot,
    policy: fixture.policy,
    eligible: fixture.eligible,
    agent: fixture.agent,
    transport,
  });
  return { planned, calls };
}

function wireResult(planned, calls, fixture, selectorCalls) {
  const reason = planned.decision.reason;
  const hook = reason === 'leader-bypass' ? 'leader-bypass' : (reason === 'agent-fixed' ? 'fixed-agent' : 'sentinel');
  return {
    ...planned,
    calls,
    ignoredModelList: fixture.modelList ?? null,
    wire: {
      hook,
      decision: planned.decision,
      selectorCalls,
      execution: { model: planned.data.model },
    },
  };
}

function pinnedResult(fixture, resolved) {
  const decision = {
    reason: 'context-pin',
    model: resolved.model,
    jev: true,
    attempt: 0,
    agent: resolved.agent,
  };
  return {
    data: { ...fixture.request, model: resolved.model },
    decision,
    calls: [],
    ignoredModelList: fixture.modelList ?? null,
    wire: {
      hook: 'sentinel',
      decision,
      selectorCalls: 0,
      execution: { model: resolved.model },
    },
    context: {
      agent: resolved.agent,
      binding: resolved.binding,
      shared: resolved.shared,
      cached: true,
    },
  };
}

export async function runSyntheticPreCall(fixture) {
  const model = fixture.request?.model;
  const useContext = Object.hasOwn(fixture, 'headers') || fixture.contextStore != null;
  if (!useContext || model !== SENTINEL_MODEL) {
    const { planned, calls } = await executePlan(fixture);
    return wireResult(planned, calls, fixture, calls.length);
  }

  const store = fixture.contextStore ?? createRequestContext(fixture.contextOptions);
  const eligible = fixture.eligible ?? fixture.policy?.candidates;
  const resolved = await store.resolve({
    headers: fixture.headers,
    eligible,
    select: async () => {
      const executed = await executePlan(fixture);
      return { model: executed.planned.data.model, planned: executed.planned, calls: executed.calls };
    },
  });
  if (!resolved.ok) {
    throw new PolicyError(resolved.code, CONTEXT_ERRORS[resolved.code] ?? 'Request context refused the call.');
  }
  if (!resolved.selectorInvoked) {
    return pinnedResult(fixture, resolved);
  }
  return {
    ...wireResult(resolved.planned, resolved.calls, fixture, resolved.calls.length),
    context: {
      agent: resolved.agent,
      binding: resolved.binding,
      shared: false,
      cached: false,
    },
  };
}
