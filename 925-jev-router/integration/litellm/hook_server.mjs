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
import { fileURLToPath } from 'node:url';
import { planPreCall } from '../../src/hook.mjs';
import { PolicyError } from '../../src/errors.mjs';
import { createMockControlPlane } from '../../src/mock-apply.mjs';
import { policyHash } from '../../src/records.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const policyPath = process.env.JEV_POLICY_PATH
  ?? path.join(here, '../../examples/project-a/.925-jev-router/config.json');
const typesafeBase = process.env.JEV_TYPESAFE_BASE ?? '';
if (!typesafeBase.startsWith('http://127.0.0.1:')) {
  process.stderr.write('JEV_TYPESAFE_BASE must be the loopback TypeSafe stub.\n');
  process.exit(1);
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
  const encoded = JSON.stringify({ tools: data?.tools ?? null, messages: data?.messages ?? null });
  return {
    model: typeof data?.model === 'string' ? data.model : null,
    hasTools: Array.isArray(data?.tools) && data.tools.length > 0,
    mentionsLookup: encoded.includes('lookup'),
    mentionsToolResult: encoded.includes('tool_result') || encoded.includes('"role":"tool"'),
  };
}

async function transport(body) {
  selectorCalls += 1;
  const response = await fetch(`${typesafeBase}/v1/systemone`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
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

const port = Number(process.env.JEV_HOOK_PORT || 0);
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  process.stdout.write(`hook 127.0.0.1:${address.port}\n`);
});
