// Product projection of pinned Orca observations; never accepts panel evidence.
export const AGENTS = ['codex', 'claude'];
export function sessionIssue(capabilities, { requireFresh = true } = {}) {
  if (capabilities?.session?.status === 'missing') return 'Open a Codex or Claude Code session in this project before launching a team, then refresh models.';
  if (capabilities?.session?.status !== 'ready' || capabilities.connection !== 'connected' || (requireFresh && Date.now() - capabilities.observedAt > 30000)) return 'Checking this project’s open Codex or Claude Code session. Refresh models if this check remains unavailable.';
  return '';
}
export function preferenceIssue(preference, capabilities, { requireCore = false, requireFresh = true } = {}) {
  const { agent, model, effort } = preference;
  if (!AGENTS.includes(agent) || [model, effort].some(value => typeof value !== 'string' || !value.trim() || value.length > 120)) return 'Choose a valid agent, model and effort.';
  if (model === 'default' && effort !== 'default') return 'Choose a model before overriding effort.';
  const entry = capabilities?.agents?.[agent];
  if (entry?.availability === 'unavailable') return `${agent} was not detected on this execution host. Check its installation in Orca.`;
  if (requireCore && (!capabilities?.launchSupported || capabilities.connection !== 'connected' || Date.now() - capabilities.observedAt > 300000)) return 'This execution host has not confirmed the required launch capabilities and connection. Refresh capabilities.';
  if (model === 'default') return '';
  if (!capabilities || (requireFresh && Date.now() - capabilities.observedAt > 300000)) return 'Model validation is unavailable or stale. Refresh host capabilities or choose Default.';
  if (entry?.catalogStatus !== 'known') return 'This host has not verified model and effort overrides. Choose Default to inherit Orca configuration, or refresh after the host can list models.';
  const listed = entry.models.find(row => row.id === model);
  if (!listed) return `Model “${model}” is not supported by the observed host catalog. Choose an available model or Default.`;
  if (effort !== 'default' && !listed.efforts.some(row => row.value === effort)) return `Effort “${effort}” is not supported for ${model}. Choose an advertised effort or Default.`;
  return '';
}
