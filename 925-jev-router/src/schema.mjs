import { PolicyError } from './errors.mjs';

export const SCHEMA_VERSION = 1;
export const SENTINEL_MODEL = 'jev-router';
export const WORKER_MODES = Object.freeze(['routed', 'per-session', 'per-turn']);
export const AGENT_MODES = Object.freeze(['routed', 'per-session', 'per-turn', 'fixed']);

const POLICY_KEYS = new Set([
  'schema_version',
  'project_id',
  'candidates',
  'fallback',
  'default_worker_mode',
  'agents',
]);
const AGENT_KEYS = new Set(['mode', 'model']);
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const ALIAS_PATTERN = /^[A-Za-z0-9._:/-]{1,255}$/;
const SECRET_KEY = /api[_-]?key|token|secret|password|credential|authorization|base[_-]?url|endpoint|provider[_-]?url|master[_-]?key|admin[_-]?key/i;
const URL_VALUE = /[a-z][a-z0-9+.-]*:\/\//i;
const SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+\S+)/i;

function fail(code, message) {
  throw new PolicyError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function rejectSecretKey(key) {
  if (SECRET_KEY.test(key)) {
    fail('policy_secret', `Field "${key}" is not allowed in the project policy file.`);
  }
}

function rejectSecretString(value, where) {
  if (typeof value !== 'string') return;
  if (URL_VALUE.test(value) || SECRET_VALUE.test(value)) {
    fail('policy_secret', `Credentials and provider URLs are not allowed in the project policy (${where}).`);
  }
}

function assertAlias(value, where) {
  if (typeof value !== 'string' || !ALIAS_PATTERN.test(value) || value.includes('..') || value.startsWith('/')) {
    fail('policy_candidates', `${where} must be a LiteLLM model alias (no URLs, spaces, or credentials).`);
  }
  rejectSecretString(value, where);
  if (value.toLowerCase().includes(SENTINEL_MODEL)) {
    fail('policy_sentinel', `Sentinel "${SENTINEL_MODEL}" must not appear in ${where}.`);
  }
}

export function validatePolicy(input) {
  if (!isPlainObject(input)) {
    fail('policy_schema', 'Project policy must be a JSON object.');
  }
  for (const key of Object.keys(input)) {
    rejectSecretKey(key);
    if (!POLICY_KEYS.has(key)) {
      fail('policy_schema', `Unknown policy field "${key}".`);
    }
  }
  if (input.schema_version !== SCHEMA_VERSION) {
    fail('policy_schema', `schema_version must be ${SCHEMA_VERSION}.`);
  }
  if (typeof input.project_id !== 'string' || !ID_PATTERN.test(input.project_id)) {
    fail('policy_schema', 'project_id must be a short project identity (letters, digits, ".", "_", ":", "-").');
  }
  rejectSecretString(input.project_id, 'project_id');
  if (!Array.isArray(input.candidates) || input.candidates.length === 0) {
    fail('policy_candidates', 'candidates must be a non-empty array of model aliases.');
  }
  const seen = new Set();
  for (const alias of input.candidates) {
    assertAlias(alias, 'candidates');
    if (seen.has(alias)) fail('policy_candidates', `Duplicate candidate "${alias}".`);
    seen.add(alias);
  }
  assertAlias(input.fallback, 'fallback');
  if (!seen.has(input.fallback)) {
    fail('policy_fallback', 'fallback must be one of candidates. A model_list entry is not approval.');
  }
  if (!WORKER_MODES.includes(input.default_worker_mode)) {
    fail('policy_mode', `default_worker_mode must be one of: ${WORKER_MODES.join(', ')}.`);
  }

  let agents;
  if (input.agents !== undefined) {
    if (!isPlainObject(input.agents)) fail('policy_agent', 'agents must be an object map.');
    agents = {};
    for (const [agentId, override] of Object.entries(input.agents)) {
      rejectSecretKey(agentId);
      if (!ID_PATTERN.test(agentId)) fail('policy_agent', `Invalid agent id "${agentId}".`);
      if (!isPlainObject(override)) fail('policy_agent', `Agent "${agentId}" must be an object.`);
      for (const key of Object.keys(override)) {
        rejectSecretKey(key);
        if (!AGENT_KEYS.has(key)) fail('policy_agent', `Unknown agent field "${key}" on "${agentId}".`);
      }
      const mode = override.mode;
      const model = override.model;
      if (mode === undefined && model === undefined) {
        fail('policy_agent', `Agent "${agentId}" needs a mode or a model.`);
      }
      if (mode !== undefined && !AGENT_MODES.includes(mode)) {
        fail('policy_mode', `Agent "${agentId}" mode must be one of: ${AGENT_MODES.join(', ')}.`);
      }
      if (model !== undefined) {
        assertAlias(model, `agents.${agentId}.model`);
        if (!seen.has(model)) {
          fail('policy_agent', `Agent "${agentId}" model must be one of candidates.`);
        }
      }
      if (mode === 'fixed' && model === undefined) {
        fail('policy_agent', `Agent "${agentId}" mode "fixed" requires a model in candidates.`);
      }
      agents[agentId] = model === undefined ? { mode } : (mode === undefined ? { model } : { mode, model });
    }
  }

  const policy = {
    schema_version: SCHEMA_VERSION,
    project_id: input.project_id,
    candidates: [...input.candidates],
    fallback: input.fallback,
    default_worker_mode: input.default_worker_mode,
  };
  if (agents) policy.agents = agents;
  return policy;
}
