import { text, snapshot } from './validation.mjs';
import { refusal } from './errors.mjs';

// The caller's client attests identity, writer metadata, and permissions. There
// is deliberately no product role knowledge or default-allow policy here.
export function authorize(policy, caller, kind, scope, request, writer) {
  if (typeof policy !== 'function') throw refusal('STORE_AUTHORITY_REQUIRED', 'A synchronous client authorization policy is required.');
  text(caller?.principalId, 'caller.principalId');
  let decision;
  try { decision = policy(snapshot({ caller, kind, scope, request, ...(writer ? { writer } : {}) })); }
  catch (error) { throw refusal('STORE_AUTHORITY_DENIED', 'Client authorization policy refused this team store operation.', {}, error); }
  if (decision && typeof decision.then === 'function') {
    Promise.resolve(decision).catch(() => {});
    throw refusal('STORE_AUTHORITY_ASYNC', 'Client authorization policy must return a synchronous decision.');
  }
  if (decision !== true) throw refusal('STORE_AUTHORITY_DENIED', 'Client authorization policy refused this team store operation.');
}
