/**
 * Speaks newline-delimited JSON to the Auth B adapter.
 * The handler is createMockControlPlane. This process does not mint a key.
 */
import { createInterface } from 'node:readline';
import { createMockControlPlane, policyHash } from '../../src/index.mjs';

let control = null;
let token = '';

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const lines = createInterface({ input: process.stdin, terminal: false });
lines.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    send({ ok: false, error: 'invalid-json' });
    return;
  }
  if (msg.op === 'init') {
    token = msg.token;
    control = createMockControlPlane({
      token,
      configuredAliases: msg.aliases,
    });
    send({ ok: true });
    return;
  }
  if (!control) {
    send({ ok: false, error: 'not-initialized' });
    return;
  }
  const headers = { authorization: `Bearer ${token}` };
  if (msg.op === 'apply') {
    try {
      const result = control.request({
        method: 'POST',
        path: msg.path,
        headers,
        body: {
          schema_version: 1,
          policy: msg.policy,
          policy_hash: policyHash(msg.policy),
          source: 'html-picker',
        },
      });
      send({ ok: true, status: result.status, body: result.body });
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : 'apply_shape';
      const message = error && typeof error.message === 'string' ? error.message : 'Apply body is not valid.';
      send({ ok: true, status: 400, body: { error: code, message } });
    }
    return;
  }
  if (msg.op === 'read') {
    const result = control.request({
      method: 'GET',
      path: msg.path,
      headers,
    });
    send({ ok: true, status: result.status, body: result.body });
    return;
  }
  send({ ok: false, error: 'unknown-op' });
});
