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
// An ordinary terminal handle is never a structured sessionId. Both inventories are
// native reads; no prompt, interrupt, provider turn or temporary conversation is needed.
async function projectSession(read, scope, worktree) {
  const inventory = await read('terminal.list', { worktree, limit: 100, requireFreshPtyLiveness: true });
  const terminals = bounded(inventory?.terminals).filter(row => row.worktreeId === scope.workspaceId && row.executionHostId === scope.executionHostId && row.connected === true && row.orphaned !== true && text(row.handle, 256) && text(row.incarnationId, 256) && AGENTS.includes(row.agentIdentity));
  let unverifiable = terminals.length > 4;
  for (const terminal of terminals.slice(0, 4)) {
    // The identity field can retain a launch preference after a CLI exits to its
    // shell. Confirm that an agent still runs; working/permission/idle all qualify.
    const running = (await read('terminal.agentStatus', { terminal: terminal.handle }))?.agentStatus;
    if (running?.handle === terminal.handle && running.isRunningAgent === true) return { status: 'ready', kind: 'terminal', agent: terminal.agentIdentity };
    if (running?.handle !== terminal.handle || running.isRunningAgent !== false) unverifiable = true;
  }
  const snapshot = await read('session.tabs.list', { worktree });
  if (snapshot?.worktree !== scope.workspaceId || !Array.isArray(snapshot.tabs)) return { status: 'unknown' };
  // SSH structured records cannot establish the remote host through this local surface.
  const chat = scope.executionHostId === 'local' && bounded(snapshot.tabs).find(row => row.type === 'agent-session' && AGENTS.includes(row.agent) && text(row.sessionId, 256));
  if (chat) return { status: 'ready', kind: 'structured', agent: chat.agent };
  return { status: unverifiable || snapshot.agentSessionsUnverifiable || !Array.isArray(inventory?.terminals) || inventory.truncated ? 'unknown' : 'missing' };
}
export async function discoverCapabilities(rpc, scope) {
  const errors = new Map();
  const read = async (method, params) => {
    try { return await rpc(method, params); }
    catch (error) {
      if (error.authority) throw error;
      errors.set(method, /^[a-z_]+$/.test(error.message) ? error.message : text(error.code) || 'host_unavailable');
      return null;
    }
  };
  const worktree = scope.workspaceId.startsWith('folder:') ? scope.workspaceId : `id:${scope.workspaceId}`;
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
  // A native local catalog probe already resolves and runs the configured CLI.
  // Avoid a second installation probe: cold discovery + first launch must fit
  // Orca's 30-call admission window. SSH still needs its own remote detection.
  const detected = targetId && connection === 'connected' ? await read('preflight.detectRemoteAgents', { connectionId: targetId }) : null;
  const session = connection === 'connected' ? await projectSession(read, scope, worktree) : { status: 'unknown' };
  let initialized = false;
  const result = { workspaceKey: scope.workspaceKey, executionHostId: scope.executionHostId, observedAt: Date.now(), runtimeId: text(status?.runtimeId, 256), connection, session, defaultAgent: AGENTS.includes(settings.defaultTuiAgent) ? settings.defaultTuiAgent : null, launchSupported: status?.capabilities?.includes('agent.launch.v2') === true && status?.capabilities?.includes('agent.launch.replay-required.v1') === true, agents: {} };
  for (const agent of AGENTS) {
    errors.delete('agentSession.modelCatalog');
    // Deliberately session-less: a NEW team needs the currently selected launch
    // account, which may differ from the account pinned by an already-open chat.
    let catalog = !targetId && connection === 'connected' && session.status === 'ready' ? await read('agentSession.modelCatalog', { agent, worktree }) : null;
    if (!catalog && errors.get('agentSession.modelCatalog') === 'structured_agent_session_unsupported' && !initialized && status?.capabilities?.includes('agent-session.structured.v1')) {
      initialized = true;
      // This published READ installs the host on a cold terminal-only desktop.
      // It never consumes, dismisses, resumes or sends to any restart offer.
      const host = await read('agentSession.restartResumable', {});
      if (host) { errors.delete('agentSession.modelCatalog'); catalog = await read('agentSession.modelCatalog', { agent, worktree }); }
    }
    const customCommand = typeof settings.agentCmdOverrides?.[agent] === 'string' && Boolean(settings.agentCmdOverrides[agent].trim());
    result.agents[agent] = {
      availability: !targetId ? catalog?.unavailable?.reason === 'cliMissing' ? 'unavailable' : ['probe', 'live-session'].includes(catalog?.origin) ? 'detected' : 'unknown' : !Array.isArray(detected) ? 'unknown' : detected.includes(agent) ? 'detected' : customCommand ? 'unknown' : 'unavailable',
      tuiPickerDisabled: Array.isArray(settings.disabledTuiAgents) && settings.disabledTuiAgents.includes(agent), customCommand,
      configured: {}, configuredSource: null, effective: { model: null, effort: null, contextUsage: null },
      structuredSupported: null,
      contextUsageSupported: null,
      catalogStatus: ['probe', 'live-session'].includes(catalog?.origin) && Array.isArray(catalog.models) ? 'known' : 'unknown',
      listingInProgress: catalog?.listingInProgress === true,
      catalogSource: ['probe', 'live-session'].includes(catalog?.origin) ? catalog.origin : null,
      catalogError: errors.get('agentSession.modelCatalog') ?? (!catalog ? errors.get('agentSession.restartResumable') : null) ?? null,
      fetchedAt: Number.isFinite(catalog?.fetchedAt) ? catalog.fetchedAt : null,
      models: models(catalog?.models),
      detail: targetId ? 'Remote model catalog unavailable. Default inherits Orca; explicit overrides require host validation.' : catalog?.listingInProgress ? 'Orca is listing models. Refresh capabilities shortly.' : catalog?.origin === 'unknown' || !catalog ? 'Model catalog unknown. Default inherits Orca configuration.' : ''
    };
  }
  const afterStatus = await read('status.get');
  if (!result.runtimeId || afterStatus?.runtimeId !== result.runtimeId) {
    result.connection = 'unavailable'; result.session = { status: 'unknown' };
    for (const entry of Object.values(result.agents)) {
      entry.availability = 'unknown'; entry.catalogStatus = 'unknown'; entry.models = [];
    }
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
