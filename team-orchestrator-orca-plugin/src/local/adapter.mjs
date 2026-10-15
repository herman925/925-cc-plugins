import {createNativeRpc,withNativeRuntime} from './native-runtime.mjs';
import { mediateOperation } from './native-broker.mjs';
import { MAX_TEMPLATE_BYTES } from '../templates.mjs';
const SLOT = Symbol.for('herman925.team-orchestrator.adapter');
const KEY = 'herman925.team-orchestrator';
const CHANNEL = 'workspace.readContext';
export async function installAdapter(electron, { version, identity, internalKey }) {
  const ipc = electron.ipcMain;
  const handlers = ipc?._invokeHandlers;
  if (!(handlers instanceof Map)) throw new Error('This Electron build has no compatible IPC handler registry.');
  const existing = globalThis[SLOT];
  if (existing?.identity === identity && existing.internalKey === internalKey && existing.isCurrent()) { return { ready: true, version, reused: true }; }
  existing?.restore();
  const names = ['plugins:readPanelEntry', 'plugins:panelAction', 'plugins:invokeCommand'];
  const originals = new Map(names.map(name => [name, handlers.get(name)]));
  if ([...originals.values()].some(handler => typeof handler !== 'function')) throw new Error('Orca plugin IPC handlers are not ready or compatible.');
  const isMainFrame = event => Boolean(event?.senderFrame && event.senderFrame === event.sender?.mainFrame && !event.sender?.isDestroyed?.());
  const leases = new Map();
  const wrappers = new Map();
  const wrap = (name, fn) => { wrappers.set(name, fn); ipc.removeHandler(name); ipc.handle(name, fn); };
  wrap(names[0], async (event, args) => {
    if (!isMainFrame(event)) throw new Error('Team Orchestrator requires a live main-frame IPC event.');
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
    if (!isMainFrame(event)) return { ok: false, code: 'invalid_request', error: 'Main-frame IPC is required.' };
    // Existing panels are rebound only using this actual IPC event; never manufacture a sender.
    if (leases.get(call.sessionToken) !== event.sender.id) {
      try { await wrappers.get(names[0])(event, { pluginKey: KEY, panelId: 'team' }); } catch {}
    }
    if (leases.get(call.sessionToken) !== event.sender.id) return { ok: false, code: 'invalid_request', error: 'This panel is not bound to Team Orchestrator.' };
    // Reuse Orca's current session, consent, manifest, owner and rate checks on every invocation.
    const gate = await originals.get(names[1])(event, { ...call, params: {} });
    if (!gate.ok) return gate;
    try {
      const message = call.params.teamWorker;
      const envelopeLimit = ['previewTemplate', 'importTemplate'].includes(message.args?.op) ? MAX_TEMPLATE_BYTES + 8192 : 60000;
      if (message.protocol !== 1 || typeof message.nonce !== 'string' || !message.nonce || message.nonce.length > 128 || !['team.control', 'team.initialise'].includes(message.commandId) || Buffer.byteLength(JSON.stringify(message)) > envelopeLimit) return { ok: false, code: 'invalid_params', error: 'Invalid worker command envelope.' };
      if (message.commandId === 'team.control' && !['setAdmission','stopMember','checkStop','ping', 'context', 'load', 'createTeam', 'submitWork', 'answerQuestion', 'checkWork', 'retryObjective', 'updateRole', 'updateSettings', 'launchSupervisor', 'recoverLaunch', 'openMember', 'receipt', 'capabilities', 'updateAgentPreferences', 'exportTemplate', 'previewTemplate', 'importTemplate'].includes(message.args?.op)) return { ok: false, code: 'invalid_params', error: 'Unknown worker operation.' };
      if (Object.keys(message.args ?? {}).some(key => !['op', 'params', 'workspaceId'].includes(key))) throw Error('Invalid public worker arguments.');
      if (message.commandId === 'team.control' && ['stopMember','capabilities', 'launchSupervisor', 'recoverLaunch', 'openMember'].includes(message.args?.op)) {
        if (!internalKey) throw Error('Native broker authority is unavailable; initialise the adapter again.');
        const invoke = args => originals.get(names[2])(event, { pluginKey: KEY, commandId: 'team.control', args: { ...args, internalKey } });
        const runtime = handlers.get('runtime:call');
        if (typeof runtime !== 'function') throw Error('The pinned runtime channel is unavailable.');
        const current = () => {
          if (!isMainFrame(event) || leases.get(call.sessionToken) !== event.sender.id || handlers.get('runtime:call') !== runtime || ![...wrappers].every(([name, handler]) => handlers.get(name) === handler)) throw Object.assign(Error('Native broker authority expired.'), { code: 'authority_expired', authority: true });
        };
        const authority = async () => {
          current();
          const gate = await originals.get(names[1])(event, { ...call, params: {} });
          if (!gate.ok) throw Object.assign(Error(gate.error || 'Native broker authority was refused.'), { code: gate.code ?? 'permission_denied', authority: true });
          current();
        };
        const rpc = async (method, params) => {
          await authority();
          const response = await runtime(event, { method, ...(params === undefined ? {} : { params }) });
          if (!response?.ok) throw Object.assign(Error(response?.error?.message || 'Native operation unavailable.'), { code: response?.error?.code ?? 'host_unavailable' });
          return response.result;
        };
        if(message.args.op==='stopMember'){
          const command=async(op,params)=>{const response=await invoke({op,params});if(response?.ok===false)throw Error(response.error?.message??response.error??'Stop command refused.');return response;};
          await authority();const saved=await command('_stopPrepare',message.args.params);
          await authority();const plan=await command('_stopValidate',{requestId:saved.requestId});
          if(plan){
            const socketRpc=createNativeRpc({userData:electron.app.getPath('userData'),parentPid:process.pid,consent:authority});
            let receipt,error;try{receipt=await withNativeRuntime(socketRpc,plan.runtimeId,()=>socketRpc(plan.method,plan.params,plan.envelope));}catch(failure){error={message:failure.message,code:failure.code,native:failure.native===true};}
            // Native effects may have happened. Durable submitted intent survives a revoked settle.
            await authority();await command('_stopSettle',{requestId:saved.requestId,receipt,error});
          }
          await authority();return {ok:true,value:await command('load',{})};
        }
        return await mediateOperation({ op: message.args.op, input: message.args.params, invoke, rpc, authority });
      }
      // CLI "active" means cwd; capture desktop selection without exposing its paths to HTML.
      let workspaceId;
      if (message.args?.op === 'context' && !message.args?.params?.teamId) {
        const session = handlers.get('session:get');
        if (typeof session !== 'function') throw new Error('Orca has no compatible desktop workspace selection handler.');
        workspaceId = (await session(event))?.activeWorktreeId;
        if (typeof workspaceId !== 'string' || !workspaceId) throw new Error('Open the intended workspace first.');
      }
      const value = await originals.get(names[2])(event, { pluginKey: KEY, commandId: message.commandId, args: { ...message.args, workspaceId, nonce: message.nonce } });
      return { ok: true, value };
    } catch (error) { return { ok: false, code: error.code ?? 'action_failed', error: String(error.message ?? error).slice(0, 1500) }; }
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
  globalThis[SLOT] = { identity, internalKey, restore, isCurrent: () => [...wrappers].every(([name, handler]) => handlers.get(name) === handler) };
  return { ready: true, version, reused: false };
}
