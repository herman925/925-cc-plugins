import { PolicyError } from './errors.mjs';
import { SENTINEL_MODEL } from './schema.mjs';

/** Pin lifetime from commit. A read does not extend it. */
export const PIN_TTL_MS = 15 * 60 * 1000;
/** Oldest committed pin is dropped after this many live bindings. */
export const CACHE_LIMIT = 64;

const UNIT = '\u001f';
const REQUIRED = ['caller', 'project', 'revision', 'session', 'agent'];
const HEADER_FIELDS = Object.freeze({
  caller: 'x-jev-caller',
  project: 'x-jev-project',
  revision: 'x-jev-revision',
  session: 'x-jev-session',
  agent: 'x-jev-agent',
  prompt: 'x-jev-prompt',
  parentAgent: 'x-jev-parent-agent',
  traffic: 'x-jev-traffic',
});

const MESSAGES = Object.freeze({
  binding_incomplete: 'Request identity is missing or blank. Refusing to switch model per request.',
  binding_conflict: 'Request identity headers conflict. Refusing to switch model per request.',
  auxiliary_unpinned: 'Auxiliary traffic has no pin. Refusing to invent a leader selection.',
  selection_rejected: 'Selection did not produce an eligible model. No pin was committed.',
});

function text(value) {
  if (value == null) return '';
  return String(value).trim();
}

export function headersAuthorizeApply() {
  return false;
}

export function normalizeHeaders(headers) {
  if (headers == null) return {};
  if (typeof headers !== 'object' || Array.isArray(headers)) {
    throw new PolicyError('binding_conflict', MESSAGES.binding_conflict);
  }
  const grouped = new Map();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = String(rawName).toLowerCase();
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    if (!grouped.has(name)) grouped.set(name, []);
    grouped.get(name).push(...values);
  }
  const out = {};
  for (const [name, values] of grouped) {
    const distinct = [...new Set(values.map(text))];
    if (distinct.length > 1) {
      throw new PolicyError('binding_conflict', MESSAGES.binding_conflict);
    }
    out[name] = distinct[0] ?? '';
  }
  return out;
}

function field(headers, key) {
  return text(headers[HEADER_FIELDS[key]]);
}

export function readIdentity(headers, { promptMode = true } = {}) {
  const normalized = normalizeHeaders(headers);
  const parentAgent = field(normalized, 'parentAgent');
  return {
    caller: field(normalized, 'caller'),
    project: field(normalized, 'project'),
    revision: field(normalized, 'revision'),
    session: field(normalized, 'session'),
    agent: parentAgent || field(normalized, 'agent'),
    prompt: promptMode ? field(normalized, 'prompt') : '',
    traffic: field(normalized, 'traffic').toLowerCase(),
  };
}

function bindingKey(identity, promptMode) {
  const parts = [identity.caller, identity.project, identity.revision, identity.session, identity.agent];
  if (promptMode) parts.push(identity.prompt);
  return parts.join(UNIT);
}

function missingFields(identity, promptMode) {
  const missing = REQUIRED.filter(key => !identity[key]);
  if (promptMode && !identity.prompt) missing.push('prompt');
  return missing;
}

function eligibleHit(model, eligible) {
  return Array.isArray(eligible) && eligible.includes(model);
}

function failure(code, identity, binding = null) {
  return {
    ok: false,
    code,
    model: null,
    agent: identity?.agent || null,
    selectorInvoked: false,
    shared: false,
    binding,
    missing: undefined,
  };
}

export function createRequestContext({
  promptMode = true,
  ttlMs = PIN_TTL_MS,
  limit = CACHE_LIMIT,
  now = () => Date.now(),
} = {}) {
  const pins = new Map();
  const inflight = new Map();

  function remember(key, record) {
    if (pins.has(key)) pins.delete(key);
    pins.set(key, record);
    while (pins.size > limit) {
      const oldest = pins.keys().next().value;
      if (oldest === undefined || oldest === key) break;
      pins.delete(oldest);
    }
  }

  function touch(key) {
    const record = pins.get(key);
    if (!record) return;
    pins.delete(key);
    pins.set(key, record);
  }

  function live(record, clock, eligible) {
    if (!record) return false;
    if (clock - record.at > ttlMs) return false;
    return eligibleHit(record.model, eligible);
  }

  async function resolve({ headers, eligible, select } = {}) {
    let identity;
    try {
      identity = readIdentity(headers, { promptMode });
    } catch (error) {
      if (error instanceof PolicyError) return failure(error.code, null);
      throw error;
    }
    const missing = missingFields(identity, promptMode);
    if (missing.length > 0) {
      return { ...failure('binding_incomplete', identity), missing };
    }

    const key = bindingKey(identity, promptMode);
    const auxiliary = identity.traffic === 'auxiliary' || identity.traffic === 'compaction';
    const clock = now();

    if (auxiliary) {
      const hit = pins.get(key);
      if (!live(hit, clock, eligible)) {
        if (hit) pins.delete(key);
        return failure('auxiliary_unpinned', identity, key);
      }
      touch(key);
      return {
        ok: true,
        model: hit.model,
        agent: identity.agent,
        selectorInvoked: false,
        shared: false,
        binding: key,
        cached: true,
      };
    }

    const existing = pins.get(key);
    if (existing) {
      if (live(existing, clock, eligible)) {
        touch(key);
        return {
          ok: true,
          model: existing.model,
          agent: identity.agent,
          selectorInvoked: false,
          shared: false,
          binding: key,
          cached: true,
        };
      }
      pins.delete(key);
    }

    const pending = inflight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, selectorInvoked: false, shared: true };
    }

    let publish;
    const flight = new Promise(resolveFlight => {
      publish = resolveFlight;
    });
    inflight.set(key, flight);

    try {
      const selected = await select();
      const model = selected?.model;
      if (typeof model !== 'string' || model.length === 0 || model === SENTINEL_MODEL || (eligible != null && !eligibleHit(model, eligible))) {
        const rejected = failure('selection_rejected', identity, key);
        publish(rejected);
        return { ...rejected, selectorInvoked: true };
      }
      remember(key, { model, agent: identity.agent, at: now() });
      publish({
        ok: true,
        model,
        agent: identity.agent,
        selectorInvoked: false,
        shared: true,
        binding: key,
      });
      return {
        ok: true,
        model,
        agent: identity.agent,
        selectorInvoked: true,
        shared: false,
        binding: key,
        planned: selected.planned ?? null,
        calls: selected.calls ?? null,
      };
    } catch (error) {
      publish(failure(error?.code || 'selection_failed', identity, key));
      throw error;
    } finally {
      inflight.delete(key);
    }
  }

  return {
    resolve,
    size: () => pins.size,
    headersAuthorizeApply,
  };
}
