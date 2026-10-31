import { PolicyError } from './errors.mjs';
import { validatePolicy } from './schema.mjs';

export function eligibleModels(policy, requested) {
  const validated = validatePolicy(policy);
  if (requested === undefined) return [...validated.candidates];
  if (!Array.isArray(requested)) {
    throw new PolicyError('no_eligible_model', 'Eligible set must be a list of project candidates.');
  }
  const allowed = [];
  for (const alias of requested) {
    if (!validated.candidates.includes(alias)) {
      throw new PolicyError('no_eligible_model', `Eligible model "${alias}" is not on the project approved list.`);
    }
    if (!allowed.includes(alias)) allowed.push(alias);
  }
  return allowed;
}

export function selectExecuteModel({ policy, eligible, choice, transportError, attempt = 0, calledDecide = false }) {
  const validated = validatePolicy(policy);
  const allowed = eligibleModels(validated, eligible);
  if (allowed.length === 0) {
    throw new PolicyError('no_eligible_model', 'No eligible model remains on the project approved list. Refusing to pick the first candidate or any model_list entry.');
  }
  const picked = typeof choice === 'string' ? choice : null;
  if (!transportError && picked && allowed.includes(picked)) {
    return { model: picked, reason: 'typesafe-choice', attempt, retry: false };
  }
  if (!calledDecide && !transportError && !picked) {
    if (allowed.length === 1) {
      return { model: allowed[0], reason: 'single-eligible', attempt, retry: false };
    }
    return { model: null, reason: 'needs-decide', attempt, retry: false };
  }
  if (transportError) {
    if (!transportError.transient) {
      throw new PolicyError('typesafe_non_transient', 'TypeSafe rejected the decision request. Not retrying.');
    }
    if (attempt < 1) {
      return { model: null, reason: 'typesafe-retry', attempt, retry: true };
    }
  }
  if (!allowed.includes(validated.fallback)) {
    throw new PolicyError('fallback_ineligible', 'Project fallback is not eligible. Refusing to execute.');
  }
  return {
    model: validated.fallback,
    reason: transportError ? 'fallback-after-retry' : 'fallback-invalid-choice',
    attempt,
    retry: false,
  };
}
