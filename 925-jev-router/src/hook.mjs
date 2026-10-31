import path from 'node:path';
import fs from 'node:fs';
import { PolicyError } from './errors.mjs';
import { SENTINEL_MODEL, validatePolicy } from './schema.mjs';
import { taskTextFromRequest } from './excerpt.mjs';
import { buildSystemOneBody, classifyTransportFailure, parseChoice } from './typesafe.mjs';
import { selectExecuteModel } from './fail-open.mjs';

export const CONFIG_DIR = '.925-jev-router';
export const CONFIG_FILE = 'config.json';

export function projectConfigPath(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    throw new PolicyError('project_root_required', 'An explicit project root is required to find .925-jev-router/. Server cwd is not consulted.');
  }
  return path.join(path.resolve(projectRoot), CONFIG_DIR, CONFIG_FILE);
}

export function loadProjectPolicy(projectRoot, { readFileSync = fs.readFileSync } = {}) {
  const filePath = projectConfigPath(projectRoot);
  let raw;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new PolicyError('policy_missing', `Missing project policy at ${CONFIG_DIR}/${CONFIG_FILE}.`);
    }
    throw error;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new PolicyError('policy_invalid_json', `Project policy at ${CONFIG_DIR}/${CONFIG_FILE} is not valid JSON.`);
  }
  return validatePolicy(parsed);
}

function agentOverride(policy, agentId) {
  if (agentId == null) return null;
  const agents = policy.agents ?? {};
  if (!Object.hasOwn(agents, agentId)) return null;
  return agents[agentId];
}

export async function planPreCall(data, context = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new PolicyError('policy_schema', 'Pre-call data must be an object.');
  }
  if (data.model !== SENTINEL_MODEL) {
    if (typeof data.model !== 'string' || data.model.length === 0) {
      throw new PolicyError('routing_skipped', 'Request has no model. Refusing to guess.');
    }
    return {
      data: { ...data },
      decision: { reason: 'leader-bypass', model: data.model, jev: false, attempt: 0 },
    };
  }

  const policy = context.policy ? validatePolicy(context.policy) : loadProjectPolicy(context.projectRoot, context);
  const eligible = context.eligible;
  const override = agentOverride(policy, context.agent);
  if (override?.mode === 'fixed') {
    const decision = selectExecuteModel({
      policy,
      eligible,
      choice: override.model,
      calledDecide: true,
      attempt: 0,
    });
    if (decision.reason !== 'typesafe-choice') {
      throw new PolicyError('agent_model_ineligible', 'Fixed agent model is not eligible on the project approved list.');
    }
    return {
      data: { ...data, model: decision.model },
      decision: { reason: 'agent-fixed', model: decision.model, jev: false, attempt: 0 },
    };
  }

  const preview = selectExecuteModel({ policy, eligible, calledDecide: false, attempt: 0 });
  if (!preview.retry && preview.reason === 'single-eligible') {
    return {
      data: { ...data, model: preview.model },
      decision: { ...preview, jev: false },
    };
  }

  if (typeof context.transport !== 'function') {
    throw new PolicyError('transport_missing', 'No TypeSafe transport is configured. M1 does not call api.typesafe.ai.');
  }

  const body = buildSystemOneBody({
    policy,
    taskText: taskTextFromRequest(data),
    eligible,
  });
  let attempt = 0;
  let choice = null;
  let transportError = null;
  for (;;) {
    try {
      const response = await context.transport(body, { attempt });
      const parsed = parseChoice(response);
      choice = parsed.ok ? parsed.choice : null;
      transportError = null;
      break;
    } catch (error) {
      transportError = classifyTransportFailure(error);
      const decision = selectExecuteModel({
        policy,
        eligible,
        transportError,
        attempt,
        calledDecide: true,
      });
      if (decision.retry) {
        attempt += 1;
        continue;
      }
      return {
        data: { ...data, model: decision.model },
        decision: { ...decision, jev: true },
        requestBody: body,
      };
    }
  }

  const decision = selectExecuteModel({
    policy,
    eligible,
    choice,
    transportError,
    attempt,
    calledDecide: true,
  });
  if (!decision.model || decision.model === SENTINEL_MODEL) {
    throw new PolicyError('routing_skipped', 'Sentinel routing did not select an execute model.');
  }
  return {
    data: { ...data, model: decision.model },
    decision: { ...decision, jev: true },
    requestBody: body,
  };
}

export async function asyncPreCallHook(data, context) {
  const planned = await planPreCall(data, context);
  return planned.data;
}
