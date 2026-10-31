import { timingSafeEqual } from 'node:crypto';
import { PolicyError } from './errors.mjs';
import { createDraft, createMemoryGateway, policyHash } from './records.mjs';

const ROUTE = /^\/jev\/v1\/projects\/([^/]+)\/(applied|apply)$/;
const APPLIED_BY = 'mock-verifier';

function fail(status, error, message) {
  return { status, body: { error, message } };
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== 'object') return '';
  const found = Object.keys(headers).find(key => key.toLowerCase() === name);
  const value = found ? headers[found] : '';
  return typeof value === 'string' ? value : '';
}

function tokensEqual(presented, expected) {
  const left = Buffer.from(presented);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function authorized(headers, token) {
  const match = /^Bearer[ \t]+(\S+)\s*$/i.exec(headerValue(headers, 'authorization'));
  if (!match) return false;
  return tokensEqual(match[1], token);
}

function readBody(body) {
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      throw new PolicyError('apply_shape', 'Apply body is not valid JSON.');
    }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PolicyError('apply_shape', 'Apply body must be a JSON object.');
  }
  return body;
}

export function createMockControlPlane({ token, configuredAliases, now = () => '2026-10-31T03:00:00.000Z' } = {}) {
  if (typeof token !== 'string' || token.trim() === '' || token !== token.trim() || /\s/.test(token)) {
    throw new PolicyError('apply_shape', 'Mock verifier needs a single synthetic test token. This is not a gateway credential.');
  }
  if (!Array.isArray(configuredAliases) || configuredAliases.some(alias => typeof alias !== 'string')) {
    throw new PolicyError('apply_shape', 'configuredAliases must list gateway alias names for the existence check.');
  }
  const aliases = new Set(configuredAliases);
  const records = createMemoryGateway();

  function request({ method, path, headers, body } = {}) {
    if (!authorized(headers, token)) {
      return fail(401, 'unauthorized', 'Mock verifier rejected the caller.');
    }
    let decodedPath = path;
    try {
      decodedPath = decodeURIComponent(path ?? '');
    } catch {
      return fail(400, 'apply_shape', 'Request path is not valid.');
    }
    const match = ROUTE.exec(decodedPath);
    if (!match) return fail(404, 'not_found', 'No such mock control-plane route.');
    const projectId = match[1];
    const action = match[2];
    const verb = String(method ?? '').toUpperCase();

    if (action === 'applied' && verb === 'GET') {
      const record = records.read(projectId);
      if (!record) return fail(404, 'not_applied', 'No applied policy for this project.');
      return { status: 200, body: structuredClone(record) };
    }
    if (action === 'apply' && verb === 'POST') {
      try {
        const envelope = readBody(body);
        if (envelope.schema_version !== 1) {
          throw new PolicyError('policy_schema', 'schema_version must be 1.');
        }
        if (envelope.source !== undefined && envelope.source !== 'html-picker') {
          throw new PolicyError('apply_shape', 'source must be omitted or "html-picker".');
        }
        const draft = createDraft(envelope.policy);
        if (draft.project_id !== projectId) {
          throw new PolicyError('apply_shape', 'Path project_id does not match policy.project_id.');
        }
        if (envelope.policy_hash !== policyHash(draft.policy)) {
          throw new PolicyError('policy_hash_mismatch', 'policy_hash does not match policy.');
        }
        for (const alias of draft.policy.candidates) {
          if (!aliases.has(alias)) {
            throw new PolicyError('alias_unknown', `Configured gateway has no alias "${alias}". Existence is not approval.`);
          }
        }
        const applied = records.apply(draft, { appliedBy: APPLIED_BY, appliedAt: now() });
        return { status: 200, body: structuredClone(applied) };
      } catch (error) {
        if (error instanceof PolicyError) return fail(400, error.code, error.message);
        throw error;
      }
    }
    return fail(405, 'method_not_allowed', 'This mock route does not allow that method.');
  }

  return { request };
}
