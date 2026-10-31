/**
 * Loopback adapter in front of src/hook.mjs.
 *
 * LiteLLM's CustomLogger posts the request here. This process calls
 * planPreCall, which is the function asyncPreCallHook delegates to, and
 * returns planned.data. It does not reimplement allowlist, fail-open, or
 * excerpt policy.
 *
 * M5 stickiness is composed here. planPreCall does not parse headers.
 * Native x-claude-code-* ids are the client bridge. Caller, project, and
 * revision come from the Applied mock record. Custom X-Jev-* headers are
 * not accepted as that bridge.
 *
 * The Applied policy is the example project fixture after the existing
 * in-process mock Apply / read-back. The selector transport posts to the
 * loopback TypeSafe stub only.
 */
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planPreCall } from '../../src/hook.mjs';
import { PolicyError } from '../../src/errors.mjs';
import { createMockControlPlane } from '../../src/mock-apply.mjs';
import { policyHash } from '../../src/records.mjs';
import {
  createRequestContext,
  headersAuthorizeApply,
  normalizeHeaders,
} from '../../src/request-context.mjs';
import { SENTINEL_MODEL } from '../../src/schema.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = process.env.JEV_POLICY_PATH
  ?? path.join(here, '../../examples/project-a/.925-jev-router/config.json');

export const LOOPBACK_REDIRECT = 'manual';

export function assertLoopbackBase(value) {
  if (typeof value !== 'string' || value === '' || value.trim() !== value) {
    throw new Error('loopback URL must be a non-empty string.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('loopback URL is not absolute.');
  }
  if (url.username || url.password) {
    throw new Error('loopback URL rejects userinfo.');
  }
  if (url.protocol !== 'http:') {
    throw new Error('loopback URL must be http.');
  }
  const hostOk = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]';
  if (!hostOk) {
    throw new Error('loopback URL host is not loopback.');
  }
  const port = Number(url.port);
  if (!url.port || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('loopback URL requires an explicit port.');
  }
  if (url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('loopback URL rejects a path, query, or fragment.');
  }
  const host = url.hostname === '::1' || url.hostname === '[::1]' ? '[::1]' : url.hostname;
  return `http://${host}:${port}`;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(entry)).href;
  } catch {
    return false;
  }
}

const token = 'synthetic-jev-test-token';
const draft = JSON.parse(readFileSync(policyPath, 'utf8'));
const plane = createMockControlPlane({
  token,
  configuredAliases: ['cheap-worker', 'strong-worker', 'large-leader'],
  now: () => '2026-10-31T03:00:00.000Z',
});
const applied = plane.request({
  method: 'POST',
  path: `/jev/v1/projects/${draft.project_id}/apply`,
  headers: { Authorization: `Bearer ${token}` },
  body: { schema_version: 1, policy: draft, policy_hash: policyHash(draft) },
});
if (applied.status !== 200) {
  process.stderr.write(`mock apply failed: ${JSON.stringify(applied.body)}\n`);
  process.exit(1);
}
const readBack = plane.request({
  method: 'GET',
  path: `/jev/v1/projects/${draft.project_id}/applied`,
  headers: { Authorization: `Bearer ${token}` },
});
if (readBack.status !== 200) {
  process.stderr.write(`mock read-back failed: ${JSON.stringify(readBack.body)}\n`);
  process.exit(1);
}
let appliedRecord = readBack.body;
let policy = appliedRecord.policy;
let inflightDeadlineMs = null;
let eligibleOverride = null;
let stores = makeStores();

const NATIVE_FIELDS = Object.freeze([
  'x-claude-code-session-id',
  'x-claude-code-agent-id',
  'x-claude-code-parent-agent-id',
  'x-claude-code-prompt-id',
]);

let selectorCalls = 0;
let hookRequests = 0;
let last = null;
let recent = [];

function makeStores() {
  const options = inflightDeadlineMs == null ? {} : { inflightDeadlineMs };
  return {
    session: createRequestContext({ promptMode: false, ...options }),
    prompt: createRequestContext({ promptMode: true, ...options }),
  };
}

function stickyMode(workerMode) {
  if (workerMode === 'per-session') return 'session';
  if (workerMode === 'per-turn') return 'prompt';
  return 'routed';
}

function nativePresent(headers) {
  return NATIVE_FIELDS.some(name => {
    const value = headers[name];
    if (Array.isArray(value)) return value.some(item => String(item ?? '').trim() !== '');
    return String(value ?? '').trim() !== '';
  });
}

export function trustedIdentityHeaders(clientHeaders, record) {
  const normalized = normalizeHeaders(clientHeaders ?? {});
  return {
    'x-jev-caller': record.applied_by,
    'x-jev-project': record.project_id,
    'x-jev-revision': String(record.revision),
    'x-jev-session': normalized['x-claude-code-session-id'] ?? '',
    'x-jev-agent': normalized['x-claude-code-agent-id'] ?? '',
    'x-jev-parent-agent': normalized['x-claude-code-parent-agent-id'] ?? '',
    'x-jev-prompt': normalized['x-claude-code-prompt-id'] ?? '',
  };
}

function restoreApplied() {
  const result = plane.request({
    method: 'POST',
    path: `/jev/v1/projects/${draft.project_id}/apply`,
    headers: { Authorization: `Bearer ${token}` },
    body: { schema_version: 1, policy: draft, policy_hash: policyHash(draft) },
  });
  if (result.status !== 200) {
    throw new PolicyError(result.body?.error ?? 'apply_failed', result.body?.message ?? 'reset apply failed');
  }
  appliedRecord = result.body;
  policy = appliedRecord.policy;
}

function resetRuntime() {
  restoreApplied();
  inflightDeadlineMs = null;
  eligibleOverride = null;
  stores = makeStores();
  selectorCalls = 0;
  hookRequests = 0;
  last = null;
  recent = [];
}

function remember(entry) {
  last = entry;
  recent.push(entry);
  if (recent.length > 32) recent.shift();
}

function snapshot(data) {
  const copy = (value) => (value === undefined ? null : JSON.parse(JSON.stringify(value)));
  return {
    model: typeof data?.model === 'string' ? data.model : null,
    tools: copy(data?.tools ?? null),
    messages: copy(data?.messages ?? null),
  };
}

let typesafeOrigin = '';

async function transport(body) {
  if (!typesafeOrigin) {
    const error = new Error('loopback URL host is not loopback.');
    error.status = 400;
    error.transient = false;
    throw error;
  }
  selectorCalls += 1;
  const response = await fetch(`${typesafeOrigin}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    redirect: LOOPBACK_REDIRECT,
  });
  if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
    const error = new Error('typesafe stub refused a redirect.');
    error.status = 400;
    error.transient = false;
    throw error;
  }
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) {
    const error = new Error(`typesafe stub status ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

async function routePreCall(data) {
  hookRequests += 1;
  const before = selectorCalls;
  const mode = stickyMode(policy.default_worker_mode);
  const native = data?.native_headers;
  let hasNative = false;
  if (native != null) {
    hasNative = nativePresent(normalizeHeaders(native));
  }
  if (data?.model !== SENTINEL_MODEL || mode === 'routed' || !hasNative) {
    if (data?.model === SENTINEL_MODEL && mode !== 'routed' && !hasNative) {
      const context = { ok: false, code: 'binding_incomplete', mode, selectorInvoked: false, shared: false, cached: false };
      remember({
        decision: null,
        selectorCalls: 0,
        inbound: snapshot(data),
        outbound: null,
        context,
      });
      throw new PolicyError('binding_incomplete', 'Request identity is missing or blank. Refusing to switch model per request.');
    }
    const planned = await planPreCall(data, { policy, transport });
    remember({
      decision: planned.decision,
      selectorCalls: selectorCalls - before,
      inbound: snapshot(data),
      outbound: snapshot(planned.data),
      context: null,
    });
    return planned;
  }

  const identityHeaders = trustedIdentityHeaders(native, appliedRecord);
  const promptMode = mode === 'prompt';
  const store = promptMode ? stores.prompt : stores.session;
  const eligible = eligibleOverride ? [...eligibleOverride] : [...policy.candidates];
  const policySnapshot = policy;
  const agentId = String(identityHeaders['x-jev-agent'] ?? '').trim();
  const resolved = await store.resolve({
    headers: identityHeaders,
    eligible,
    select: async () => {
      const planned = await planPreCall(data, {
        policy: policySnapshot,
        eligible,
        agent: agentId || null,
        transport,
      });
      return { model: planned.data.model, planned };
    },
  });
  const context = {
    ok: resolved.ok,
    code: resolved.code ?? null,
    mode,
    agent: resolved.agent ?? null,
    parentAgent: resolved.parentAgent ?? null,
    selectorInvoked: Boolean(resolved.selectorInvoked),
    shared: Boolean(resolved.shared),
    cached: Boolean(resolved.cached),
    binding: resolved.binding ?? null,
  };
  if (!resolved.ok) {
    remember({
      decision: null,
      selectorCalls: selectorCalls - before,
      inbound: snapshot(data),
      outbound: null,
      context,
    });
    throw new PolicyError(resolved.code, 'Request context refused the call.');
  }
  const planned = resolved.selectorInvoked && resolved.planned
    ? resolved.planned
    : {
      data: { ...data, model: resolved.model },
      decision: {
        reason: 'context-pin',
        model: resolved.model,
        jev: true,
        attempt: 0,
        agent: resolved.agent ?? null,
        parentAgent: resolved.parentAgent ?? null,
      },
    };
  remember({
    decision: planned.decision,
    selectorCalls: selectorCalls - before,
    inbound: snapshot(data),
    outbound: snapshot(planned.data),
    context,
  });
  return planned;
}

function send(res, status, payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(raw.length),
  });
  res.end(raw);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        reject(Object.assign(new Error('body too large'), { code: 'body_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid json'), { code: 'invalid_json' }));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      send(res, 200, { ok: true, project_id: policy.project_id, fallback: policy.fallback });
      return;
    }
    if (req.method === 'GET' && req.url === '/stats') {
      send(res, 200, {
        selectorCalls,
        hookRequests,
        last,
        recent,
        headersAuthorizeApply: headersAuthorizeApply(),
        policy: {
          project_id: appliedRecord.project_id,
          revision: appliedRecord.revision,
          applied_by: appliedRecord.applied_by,
          mode: policy.default_worker_mode,
          candidates: policy.candidates,
        },
        pins: {
          session: stores.session.size(),
          prompt: stores.prompt.size(),
        },
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/reset') {
      resetRuntime();
      send(res, 200, { ok: true, revision: appliedRecord.revision });
      return;
    }
    if (req.method === 'POST' && req.url === '/control') {
      const body = await readJson(req);
      if (body.inflightDeadlineMs != null) {
        const ms = body.inflightDeadlineMs;
        if (!Number.isInteger(ms) || ms < 1 || ms > 15 * 60 * 1000) {
          throw new PolicyError('binding_conflict', 'inflightDeadlineMs must be a positive integer up to the pin lifetime.');
        }
        inflightDeadlineMs = ms;
        stores = makeStores();
      }
      if (Object.hasOwn(body, 'eligible')) {
        if (body.eligible == null) {
          eligibleOverride = null;
        } else if (!Array.isArray(body.eligible) || body.eligible.some(alias => typeof alias !== 'string')) {
          throw new PolicyError('no_eligible_model', 'Eligible override must be a list of alias strings.');
        } else {
          eligibleOverride = [...body.eligible];
        }
      }
      send(res, 200, { ok: true, inflightDeadlineMs, eligible: eligibleOverride });
      return;
    }
    if (req.method === 'POST' && req.url === '/apply') {
      const body = await readJson(req);
      if (!body.policy || typeof body.policy !== 'object' || Array.isArray(body.policy)) {
        send(res, 400, { error: 'apply_shape', message: 'Apply body must include a policy object.' });
        return;
      }
      const result = plane.request({
        method: 'POST',
        path: `/jev/v1/projects/${body.policy.project_id}/apply`,
        headers: { authorization: req.headers.authorization ?? '' },
        body: { schema_version: 1, policy: body.policy, policy_hash: policyHash(body.policy) },
      });
      if (result.status !== 200) {
        send(res, result.status, result.body);
        return;
      }
      appliedRecord = result.body;
      policy = appliedRecord.policy;
      send(res, 200, {
        revision: appliedRecord.revision,
        project_id: appliedRecord.project_id,
        mode: policy.default_worker_mode,
        candidates: policy.candidates,
      });
      return;
    }
    if (req.method === 'POST' && req.url === '/pre-call') {
      const outcome = await routePreCall(await readJson(req));
      send(res, 200, {
        data: outcome.data,
        decision: outcome.decision,
        selectorCalls,
      });
      return;
    }
    send(res, 404, { error: 'not_found' });
  } catch (error) {
    const code = error instanceof PolicyError ? error.code : (error?.code ?? 'hook_failed');
    const message = error instanceof Error ? error.message : 'hook failed';
    if (!res.headersSent) send(res, 400, { error: { code, message } });
  }
});

if (isDirectRun()) {
  try {
    typesafeOrigin = assertLoopbackBase(process.env.JEV_TYPESAFE_BASE ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'loopback URL rejected.';
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
  const port = Number(process.env.JEV_HOOK_PORT || 0);
  server.listen(port, '127.0.0.1', () => {
    const address = server.address();
    process.stdout.write(`hook 127.0.0.1:${address.port}\n`);
  });
}
