(function (root) {
  var SCHEMA_VERSION = 1;
  var SENTINEL = 'jev-router';
  var WORKER_MODES = ['routed', 'per-session', 'per-turn'];
  var AGENT_MODES = ['routed', 'per-session', 'per-turn', 'fixed'];
  var ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
  var ALIAS_PATTERN = /^[A-Za-z0-9._:/-]{1,255}$/;
  var SECRET_KEY = /api[_-]?key|token|secret|password|credential|authorization|base[_-]?url|endpoint|provider[_-]?url|master[_-]?key|admin[_-]?key/i;
  var URL_VALUE = /[a-z][a-z0-9+.-]*:\/\//i;
  var SECRET_VALUE = /\b(?:sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|Bearer\s+\S+)/i;

  function error(code, message) {
    return { code: code, message: message };
  }

  function secretString(value) {
    return URL_VALUE.test(value) || SECRET_VALUE.test(value);
  }

  function checkAlias(value, where, errors) {
    if (typeof value !== 'string' || !ALIAS_PATTERN.test(value) || value.indexOf('..') !== -1 || value.charAt(0) === '/') {
      errors.push(error('policy_candidates', where + ' must be a model alias.'));
      return false;
    }
    if (secretString(value)) {
      errors.push(error('policy_secret', 'Credentials and provider URLs are not allowed in ' + where + '.'));
      return false;
    }
    if (value.toLowerCase().indexOf(SENTINEL) !== -1) {
      errors.push(error('policy_sentinel', 'Sentinel "' + SENTINEL + '" must not appear in ' + where + '.'));
      return false;
    }
    return true;
  }

  function parseAgents(text, errors) {
    if (typeof text !== 'string' || text.trim() === '') return undefined;
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (ignore) {
      errors.push(error('policy_agent', 'agents must be a JSON object.'));
      return undefined;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      errors.push(error('policy_agent', 'agents must be a JSON object.'));
      return undefined;
    }
    return parsed;
  }

  function lines(text) {
    return String(text || '').split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  }

  function validate(input) {
    var errors = [];
    var source = input || {};
    if (source.schema_version !== SCHEMA_VERSION) {
      errors.push(error('policy_schema', 'schema_version must be 1.'));
    }
    if (typeof source.project_id !== 'string' || !ID_PATTERN.test(source.project_id) || secretString(source.project_id)) {
      errors.push(error('policy_schema', 'project_id must be a short project identity with no credentials or URLs.'));
    }
    var candidates = lines(source.candidatesText);
    if (candidates.length === 0) errors.push(error('policy_candidates', 'candidates must be a non-empty list.'));
    var seen = {};
    candidates.forEach(function (alias) {
      if (!checkAlias(alias, 'candidates', errors)) return;
      if (seen[alias]) errors.push(error('policy_candidates', 'Duplicate candidate "' + alias + '".'));
      seen[alias] = true;
    });
    var fallback = typeof source.fallback === 'string' ? source.fallback.trim() : '';
    checkAlias(fallback, 'fallback', errors);
    if (fallback && !seen[fallback]) {
      errors.push(error('policy_fallback', 'fallback must be one of candidates.'));
    }
    if (WORKER_MODES.indexOf(source.default_worker_mode) === -1) {
      errors.push(error('policy_mode', 'default_worker_mode is not a supported worker mode.'));
    }
    var agents = parseAgents(source.agentsText, errors);
    var policyAgents = undefined;
    if (agents) {
      policyAgents = {};
      Object.keys(agents).forEach(function (agentId) {
        if (SECRET_KEY.test(agentId) || !ID_PATTERN.test(agentId)) {
          errors.push(error('policy_agent', 'Invalid agent id "' + agentId + '".'));
          return;
        }
        var override = agents[agentId];
        if (!override || typeof override !== 'object' || Array.isArray(override)) {
          errors.push(error('policy_agent', 'Agent "' + agentId + '" must be an object.'));
          return;
        }
        Object.keys(override).forEach(function (key) {
          if (SECRET_KEY.test(key) || (key !== 'mode' && key !== 'model')) {
            errors.push(error('policy_agent', 'Unknown agent field "' + key + '".'));
          }
        });
        if (override.mode !== undefined && AGENT_MODES.indexOf(override.mode) === -1) {
          errors.push(error('policy_mode', 'Agent "' + agentId + '" mode is not supported.'));
        }
        if (override.model !== undefined) {
          checkAlias(override.model, 'agents.' + agentId + '.model', errors);
          if (!seen[override.model]) errors.push(error('policy_agent', 'Agent "' + agentId + '" model must be one of candidates.'));
        }
        if (override.mode === 'fixed' && override.model === undefined) {
          errors.push(error('policy_agent', 'Agent "' + agentId + '" mode "fixed" requires a model.'));
        }
        if (override.mode === undefined && override.model === undefined) {
          errors.push(error('policy_agent', 'Agent "' + agentId + '" needs a mode or a model.'));
        }
        policyAgents[agentId] = {};
        if (override.mode !== undefined) policyAgents[agentId].mode = override.mode;
        if (override.model !== undefined) policyAgents[agentId].model = override.model;
      });
    }
    if (errors.length) return { ok: false, errors: errors };
    var policy = {
      schema_version: SCHEMA_VERSION,
      project_id: source.project_id,
      candidates: candidates,
      fallback: fallback,
      default_worker_mode: source.default_worker_mode
    };
    if (policyAgents) policy.agents = policyAgents;
    return { ok: true, policy: policy, errors: [] };
  }

  root.JevRouterDraft = { validate: validate, SCHEMA_VERSION: SCHEMA_VERSION, SENTINEL: SENTINEL };
})(globalThis);
