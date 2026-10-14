const SLOT = Symbol.for('herman925.team-orchestrator.adapter');
const KEY = 'herman925.team-orchestrator';
const CHANNEL = 'workspace.readContext';
export function installAdapter(electron, { version, identity }) {
  const ipc = electron.ipcMain;
  const handlers = ipc?._invokeHandlers;
  if (!(handlers instanceof Map)) throw new Error('This Electron build has no compatible IPC handler registry.');
  const existing = globalThis[SLOT];
  if (existing?.identity === identity && existing.isCurrent()) return { ready: true, version, reused: true };
  existing?.restore();
  const names = ['plugins:readPanelEntry', 'plugins:panelAction', 'plugins:invokeCommand'];
  const originals = new Map(names.map(name => [name, handlers.get(name)]));
  if ([...originals.values()].some(handler => typeof handler !== 'function')) throw new Error('Orca plugin IPC handlers are not ready or compatible.');
  const leases = new Map();
  const wrappers = new Map();
  const wrap = (name, fn) => { wrappers.set(name, fn); ipc.removeHandler(name); ipc.handle(name, fn); };
  wrap(names[0], async (event, args) => {
    const entry = await originals.get(names[0])(event, args);
    if (args?.pluginKey === KEY && args.panelId === 'team' && entry?.sessionToken) {
      for (const [token, owner] of leases) if (owner === event.sender.id) leases.delete(token);
      if (leases.size >= 128) leases.delete(leases.keys().next().value);
      leases.set(entry.sessionToken, event.sender.id);
    }
    return entry;
  });
  wrap(names[1], async (event, call) => {
    if (call?.action !== CHANNEL || !call.params?.teamWorker) return originals.get(names[1])(event, call);
    if (leases.get(call.sessionToken) !== event.sender.id) return { ok: false, code: 'invalid_request', error: 'This panel is not bound to Team Orchestrator.' };
    // Reuse Orca's current session, consent, manifest, owner and rate checks on every invocation.
    const gate = await originals.get(names[1])(event, { ...call, params: {} });
    if (!gate.ok) return gate;
    try {
      const message = call.params.teamWorker;
      if (message.protocol !== 1 || typeof message.nonce !== 'string' || !message.nonce || message.nonce.length > 128 || !['team.control', 'team.initialise'].includes(message.commandId) || Buffer.byteLength(JSON.stringify(message)) > 60000) return { ok: false, code: 'invalid_params', error: 'Invalid worker command envelope.' };
      // CLI "active" means cwd; capture desktop selection without exposing its paths to HTML.
      let workspaceId;
      if (['context', 'start'].includes(message.args?.op)) {
        const session = handlers.get('session:get');
        if (typeof session !== 'function') throw new Error('Orca has no compatible desktop workspace selection handler.');
        workspaceId = (await session(event))?.activeWorktreeId;
        if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('Open the intended workspace first.');
      }
      const value = await originals.get(names[2])(event, { pluginKey: KEY, commandId: message.commandId, args: { ...message.args, workspaceId, nonce: message.nonce } });
      return { ok: true, value };
    } catch (error) { return { ok: false, code: 'action_failed', error: String(error.message ?? error).slice(0, 1500) }; }
  });
  const restore = () => {
    for (const [name, wrapper] of wrappers) if (handlers.get(name) === wrapper) { ipc.removeHandler(name); ipc.handle(name, originals.get(name)); }
    leases.clear();
    if (globalThis[SLOT]?.identity === identity) delete globalThis[SLOT];
  };
  for (const name of ['plugins:setEnabled', 'plugins:remove']) {
    const original = handlers.get(name);
    if (typeof original !== 'function') continue;
    originals.set(name, original);
    wrap(name, async (event, args) => {
      const result = await original(event, args);
      if (args?.pluginKey === KEY && (name === 'plugins:remove' || args.enabled === false)) restore();
      return result;
    });
  }
  globalThis[SLOT] = { identity, restore, isCurrent: () => [...wrappers].every(([name, handler]) => handlers.get(name) === handler) };
  // Rotate existing panel leases through Orca's normal refresh notification.
  const refresh = handlers.get('plugins:refresh');
  if (typeof refresh === 'function') setTimeout(() => Promise.resolve(refresh({})).catch(() => {}), 0);
  return { ready: true, version, reused: false };
}
