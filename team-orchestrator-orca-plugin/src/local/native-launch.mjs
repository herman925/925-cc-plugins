import { randomBytes } from 'node:crypto';
import { memberLaunch } from '../launch.mjs';
const text = (value, limit = 2048) => typeof value === 'string' && value.length > 0 && value.length <= limit;
export function launchInput(input) {
  if (!input || Object.keys(input).some(key => !['teamId', 'memberId', 'requestId', 'configVersion'].includes(key)) || !text(input.teamId, 120) || !text(input.memberId, 120) || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isInteger(input.configVersion)) throw Error('Invalid saved supervisor launch request.');
  return input;
}
export function nativeLaunchIntent(team, member, scope) {
  const description = memberLaunch(team, member, scope.workspaceKey);
  const sessionOptions = {};
  if (member.model !== 'default') sessionOptions.model = member.model;
  if (member.effort !== 'default') sessionOptions.effort = member.effort;
  return {
    operationId: `${Date.now()}-${randomBytes(16).toString('hex')}`, agent: member.agent,
    target: { kind: 'existing', worktree: scope.workspaceId.startsWith('folder:') ? scope.workspaceId : `id:${scope.workspaceId}` },
    prompt: { text: description.brief, delivery: 'submit' },
    ...(Object.keys(sessionOptions).length ? { sessionOptions } : {}),
    ...(member.agentArgs !== undefined ? { agentArgs: member.agentArgs } : {})
  };
}
export function launchReceipt(result, operation) {
  const outcome = result?.outcome, prompt = result?.prompt, mode = result?.receipt;
  if (!text(result?.worktreeId, 4096) || result.worktreeId !== operation.scope.workspaceId || !['terminal', 'structured'].includes(outcome?.kind) || !text(outcome.handle) || (outcome.kind === 'structured' && !text(outcome.sessionId)) || (outcome.paneKey !== undefined && !text(outcome.paneKey)) || (outcome.tabId !== undefined && !text(outcome.tabId)) || mode?.mode !== outcome.kind || !['terminal', 'structured'].includes(mode.preferred) || !text(mode.reason) || !text(mode.detail) || (prompt && (!['submit', 'draft'].includes(prompt.delivery) || !['journaled', 'handed-to-terminal', 'not-delivered', 'unconfirmed'].includes(prompt.outcome) || (prompt.outcome === 'journaled' && !text(prompt.messageId))))) throw Error('Native launch identity, scope or receipt is unverified. Inspect Orca before retrying.');
  return { status: 'created', handle: outcome.handle, kind: outcome.kind,
    ...(outcome.sessionId ? { sessionId: outcome.sessionId } : {}), ...(outcome.paneKey ? { paneKey: outcome.paneKey } : {}), ...(outcome.tabId ? { tabId: outcome.tabId } : {}),
    mode: { mode: mode.mode, preferred: mode.preferred, reason: mode.reason, detail: mode.detail },
    prompt: prompt ? { delivery: prompt.delivery, outcome: prompt.outcome, ...(prompt.messageId ? { messageId: prompt.messageId } : {}) } : null,
    briefAccepted: ['journaled', 'handed-to-terminal'].includes(prompt?.outcome),
    observation: { state: 'unknown', detail: 'Session created; provider start and login are not yet observed.' },
    ...(text(result.warning, 1500) ? { warning: result.warning } : {}) };
}
export function publicOperation(operation) {
  if (!operation) return null;
  const keys = ['requestId', 'memberId', 'teamId', 'status', 'title', 'handle', 'kind', 'sessionId', 'paneKey', 'tabId', 'mode', 'prompt', 'briefAccepted', 'observation', 'warning', 'error', 'executionHostId', 'configVersion', 'roleVersion', 'instanceGeneration', 'recovery'];
  return Object.fromEntries(keys.filter(key => operation[key] !== undefined).map(key => [key, operation[key]]));
}
