import { AGENTS } from '../capabilities.mjs';
const text = (value, limit = 120) => typeof value === 'string' && value.trim() && value.length <= limit ? value : null;
const bounded = value => Array.isArray(value) ? value.slice(0, 256) : [];
function models(value) {
  const seen = new Set();
  return bounded(value).flatMap(row => {
    if (!text(row?.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    return [{ id: row.id, label: text(row.label) || row.id, isDefault: row.isDefault === true, efforts: bounded(row.efforts).flatMap(effort => text(effort?.value) ? [{ value: effort.value, label: text(effort.label) || effort.value }] : []) }];
  });
}
export async function discoverCapabilities(rpc, scope) {
  const read = async (method, params) => {
    try { return await rpc(method, params); }
    catch (error) { if (error.authority) throw error; return null; }
  };
  const status = await read('status.get');
  const settings = (await read('settings.get'))?.settings ?? {};
  let connection = 'connected', targetId, before;
  if (scope.executionHostId !== 'local') {
    const encoded = scope.executionHostId.slice(4);
    try { targetId = decodeURIComponent(encoded); } catch { throw Error('Invalid saved execution host identity.'); }
    if (!scope.executionHostId.startsWith('ssh:') || !targetId || encoded.includes('|')) throw Error('Invalid saved execution host identity.');
    before = (await read('ssh.getState', { targetId }))?.state;
    if (before?.status !== 'connected') connection = 'unavailable';
  }
  const detected = connection === 'connected' ? await read(targetId ? 'preflight.detectRemoteAgents' : 'preflight.detectAgents', targetId ? { connectionId: targetId } : undefined) : null;
  const registered = status?.capabilities?.includes('agent-session.structured.registered-agents.v1') ? await read('agentSession.agents', {}) : null;
  const result = { workspaceKey: scope.workspaceKey, executionHostId: scope.executionHostId, observedAt: Date.now(), runtimeId: text(status?.runtimeId, 256), connection, defaultAgent: AGENTS.includes(settings.defaultTuiAgent) ? settings.defaultTuiAgent : null, launchSupported: status?.capabilities?.includes('agent.launch.v2') === true && status?.capabilities?.includes('agent.launch.replay-required.v1') === true, agents: {} };
  for (const agent of AGENTS) {
    const support = connection === 'connected' ? await read('agentSession.createSupport', { worktree: scope.workspaceId.startsWith('folder:') ? scope.workspaceId : `id:${scope.workspaceId}`, agent }) : null;
    const catalog = !targetId && connection === 'connected' ? await read('agentSession.modelCatalog', { agent, worktree: scope.workspaceId.startsWith('folder:') ? scope.workspaceId : `id:${scope.workspaceId}` }) : null;
    const configured = {};
    for (const field of ['model', 'effort']) if (text(support?.seedOptions?.[field])) configured[field] = support.seedOptions[field];
    const customCommand = typeof settings.agentCmdOverrides?.[agent] === 'string' && Boolean(settings.agentCmdOverrides[agent].trim());
    result.agents[agent] = {
      availability: !Array.isArray(detected) ? 'unknown' : detected.includes(agent) ? 'detected' : customCommand ? 'unknown' : 'unavailable',
      tuiPickerDisabled: Array.isArray(settings.disabledTuiAgents) && settings.disabledTuiAgents.includes(agent), customCommand,
      configured, configuredSource: 'orca-saved-preference', effective: { model: null, effort: null, contextUsage: null },
      structuredSupported: typeof support?.supported === 'boolean' ? support.supported : null,
      contextUsageSupported: registered?.agents?.find(row => row.agent === agent)?.capabilities?.contextUsage === true,
      catalogStatus: ['probe', 'live-session'].includes(catalog?.origin) && Array.isArray(catalog.models) ? 'known' : 'unknown',
      listingInProgress: catalog?.listingInProgress === true,
      catalogSource: ['probe', 'live-session'].includes(catalog?.origin) ? catalog.origin : null,
      fetchedAt: Number.isFinite(catalog?.fetchedAt) ? catalog.fetchedAt : null,
      models: models(catalog?.models),
      detail: targetId ? 'Remote model catalog unavailable. Default inherits Orca; explicit overrides require host validation.' : catalog?.listingInProgress ? 'Orca is listing models. Refresh capabilities shortly.' : catalog?.origin === 'unknown' || !catalog ? 'Model catalog unknown. Default inherits Orca configuration.' : ''
    };
  }
  if (targetId) {
    const after = (await read('ssh.getState', { targetId }))?.state;
    if (after?.status !== 'connected' || after?.providerEpoch !== before?.providerEpoch || after?.connectionGeneration !== before?.connectionGeneration) {
      result.connection = 'unavailable';
      for (const entry of Object.values(result.agents)) entry.availability = 'unknown';
    }
    result.hostGeneration = after?.connectionGeneration ?? null;
  }
  return result;
}
