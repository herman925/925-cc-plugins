import { PolicyError } from './errors.mjs';
import { SENTINEL_MODEL, validatePolicy } from './schema.mjs';
import { planPreCall } from './hook.mjs';
import { createRequestContext, readIdentity } from './request-context.mjs';

const CONTEXT_ERRORS = Object.freeze({
  binding_incomplete: 'Request identity is missing or blank. Refusing to switch model per request.',
  binding_conflict: 'Request identity headers conflict. Refusing to switch model per request.',
  binding_mismatch: 'Header project or revision does not match the applied policy.',
  auxiliary_unpinned: 'Auxiliary traffic has no pin. Refusing to invent a leader selection.',
  selection_rejected: 'Selection did not produce an eligible model. No pin was committed.',
  selection_failed: 'Selection failed before a pin was committed.',
  admission_rejected: 'In-flight selection cap is full. Refusing to start another selector.',
  admission_expired: 'In-flight selection missed its deadline and was not committed.',
});

function trustedApplied(fixture) {
  const applied = fixture.applied && typeof fixture.applied === 'object' ? fixture.applied : null;
  const rawPolicy = applied?.policy ?? fixture.policy;
  if (!rawPolicy) {
    throw new PolicyError('policy_missing', 'Applied policy is required before identity execution.');
  }
  const policy = validatePolicy(rawPolicy);
  if (applied?.project_id != null && applied.project_id !== policy.project_id) {
    throw new PolicyError('binding_mismatch', 'Applied project does not match the policy project.');
  }
  const revisionSource = applied?.revision ?? fixture.revision;
  if (revisionSource == null || String(revisionSource).trim() === '') {
    throw new PolicyError('binding_incomplete', 'Applied revision is required before identity execution.');
  }
  return { policy, project: policy.project_id, revision: String(revisionSource).trim() };
}

function intersectEligible(policy, requested) {
  if (requested == null) return [...policy.candidates];
  if (!Array.isArray(requested)) {
    throw new PolicyError('no_eligible_model', 'Eligible set must be a list of project candidates.');
  }
  const allowed = [];
  for (const alias of requested) {
    if (policy.candidates.includes(alias) && !allowed.includes(alias)) allowed.push(alias);
  }
  return allowed;
}

async function executePlan(fixture, execution = null) {
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
    policy: execution?.policy ?? fixture.policy,
    eligible: execution ? execution.eligible : fixture.eligible,
    agent: execution ? execution.agent : fixture.agent,
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
    parentAgent: resolved.parentAgent ?? null,
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
      parentAgent: resolved.parentAgent ?? null,
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
  const promptMode = fixture.contextOptions?.promptMode ?? true;
  const trusted = trustedApplied(fixture);
  const identity = readIdentity(fixture.headers, { promptMode });
  if (identity.project && identity.revision && (identity.project !== trusted.project || identity.revision !== trusted.revision)) {
    throw new PolicyError('binding_mismatch', CONTEXT_ERRORS.binding_mismatch);
  }
  if (fixture.agent != null && text(fixture.agent) !== identity.agent) {
    throw new PolicyError('binding_conflict', 'Agent id does not match the validated request identity.');
  }
  const eligible = intersectEligible(trusted.policy, fixture.eligible);
  const execution = { policy: trusted.policy, eligible, agent: identity.agent };
  const resolved = await store.resolve({
    headers: fixture.headers,
    eligible,
    select: async () => {
      const executed = await executePlan(fixture, execution);
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
      parentAgent: resolved.parentAgent ?? null,
      binding: resolved.binding,
      shared: false,
      cached: false,
    },
  };
}

function text(value) {
  return String(value ?? '').trim();
}
