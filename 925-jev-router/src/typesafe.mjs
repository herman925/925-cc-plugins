import { credentialFreeExcerpt } from './excerpt.mjs';

export const SYSTEM_ONE_PATH = '/v1/systemone';
export const JEV_DECIDE_MODEL = 'jev-latest';
export const CHOICE_QUESTION_ID = 'model';

const TRANSIENT_STATUSES = new Set([429, 529]);

export function classifyTransportFailure(error) {
  if (error && typeof error.transient === 'boolean') {
    return { transient: error.transient, status: Number.isInteger(error.status) ? error.status : null };
  }
  const status = Number.isInteger(error?.status) ? error.status : null;
  const transient = status == null || TRANSIENT_STATUSES.has(status) || (status >= 500 && status <= 599);
  return { transient, status };
}

export function buildSystemOneBody({ policy, taskText }) {
  const excerpt = credentialFreeExcerpt(taskText);
  const criteria = {};
  for (const alias of policy.candidates) criteria[alias] = alias;
  const state = { messages: [] };
  if (excerpt.trim()) state.messages.push({ role: 'user', text: excerpt });
  return {
    model: JEV_DECIDE_MODEL,
    state,
    questions: {
      [CHOICE_QUESTION_ID]: {
        type: 'choice',
        instructions: 'Choose the single best execute model. Criteria keys are the only allowed models.',
        criteria,
      },
    },
  };
}

export function parseChoice(response) {
  const answer = response?.answers?.[CHOICE_QUESTION_ID];
  const choice = answer?.choice;
  if (typeof choice !== 'string' || choice.length === 0) {
    return { ok: false, reason: 'missing-choice' };
  }
  return {
    ok: true,
    choice,
    confidence: typeof answer.confidence === 'number' ? answer.confidence : null,
  };
}
