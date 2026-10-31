/**
 * Loopback adapter in front of src/hook.mjs.
 *
 * LiteLLM's CustomLogger posts the request here. This process calls
 * planPreCall, which is the function asyncPreCallHook delegates to, and
 * returns planned.data. It does not reimplement allowlist, fail-open, or
 * excerpt policy.
 *
 * M3 stickiness is not wired. This file does not import request-context.mjs
 * and does not read X-Jev-* headers.
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
const policy = readBack.body.policy;

let selectorCalls = 0;
let hookRequests = 0;
let last = null;

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
      send(res, 200, { selectorCalls, hookRequests, last });
      return;
    }
    if (req.method === 'POST' && req.url === '/reset') {
      selectorCalls = 0;
      hookRequests = 0;
      last = null;
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && req.url === '/pre-call') {
      hookRequests += 1;
      const data = await readJson(req);
      const before = selectorCalls;
      const planned = await planPreCall(data, { policy, transport });
      last = {
        decision: planned.decision,
        selectorCalls: selectorCalls - before,
        inbound: snapshot(data),
        outbound: snapshot(planned.data),
      };
      send(res, 200, { data: planned.data, decision: planned.decision, selectorCalls });
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
