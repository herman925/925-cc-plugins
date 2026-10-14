var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/local/adapter.mjs
var adapter_exports = {};
__export(adapter_exports, {
  installAdapter: () => installAdapter
});
module.exports = __toCommonJS(adapter_exports);
var SLOT = /* @__PURE__ */ Symbol.for("herman925.team-orchestrator.adapter");
var KEY = "herman925.team-orchestrator";
var CHANNEL = "workspace.readContext";
async function installAdapter(electron, { version, identity }) {
  const ipc = electron.ipcMain;
  const handlers = ipc?._invokeHandlers;
  if (!(handlers instanceof Map)) throw new Error("This Electron build has no compatible IPC handler registry.");
  const existing = globalThis[SLOT];
  if (existing?.identity === identity && existing.isCurrent()) {
    await existing.bindOpenPanels();
    return { ready: true, version, reused: true };
  }
  existing?.restore();
  const names = ["plugins:readPanelEntry", "plugins:panelAction", "plugins:invokeCommand"];
  const originals = new Map(names.map((name) => [name, handlers.get(name)]));
  if ([...originals.values()].some((handler) => typeof handler !== "function")) throw new Error("Orca plugin IPC handlers are not ready or compatible.");
  const leases = /* @__PURE__ */ new Map();
  const wrappers = /* @__PURE__ */ new Map();
  const wrap = (name, fn) => {
    wrappers.set(name, fn);
    ipc.removeHandler(name);
    ipc.handle(name, fn);
  };
  wrap(names[0], async (event, args) => {
    const entry = await originals.get(names[0])(event, args);
    if (args?.pluginKey === KEY && args.panelId === "team" && entry?.sessionToken) {
      for (const [token, owner] of leases) if (owner === event.sender.id) leases.delete(token);
      if (leases.size >= 128) leases.delete(leases.keys().next().value);
      leases.set(entry.sessionToken, event.sender.id);
    }
    return entry;
  });
  wrap(names[1], async (event, call) => {
    if (call?.action !== CHANNEL || !call.params?.teamWorker) return originals.get(names[1])(event, call);
    if (leases.get(call.sessionToken) !== event.sender.id) return { ok: false, code: "invalid_request", error: "This panel is not bound to Team Orchestrator." };
    const gate = await originals.get(names[1])(event, { ...call, params: {} });
    if (!gate.ok) return gate;
    try {
      const message = call.params.teamWorker;
      if (message.protocol !== 1 || typeof message.nonce !== "string" || !message.nonce || message.nonce.length > 128 || !["team.control", "team.initialise"].includes(message.commandId) || Buffer.byteLength(JSON.stringify(message)) > 6e4) return { ok: false, code: "invalid_params", error: "Invalid worker command envelope." };
      let workspaceId;
      if (["context", "start"].includes(message.args?.op)) {
        const session = handlers.get("session:get");
        if (typeof session !== "function") throw new Error("Orca has no compatible desktop workspace selection handler.");
        workspaceId = (await session(event))?.activeWorktreeId;
        if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Open the intended workspace first.");
      }
      const value = await originals.get(names[2])(event, { pluginKey: KEY, commandId: message.commandId, args: { ...message.args, workspaceId, nonce: message.nonce } });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, code: "action_failed", error: String(error.message ?? error).slice(0, 1500) };
    }
  });
  const restore = () => {
    for (const [name, wrapper] of wrappers) if (handlers.get(name) === wrapper) {
      ipc.removeHandler(name);
      ipc.handle(name, originals.get(name));
    }
    leases.clear();
    if (globalThis[SLOT]?.identity === identity) delete globalThis[SLOT];
  };
  for (const name of ["plugins:setEnabled", "plugins:remove"]) {
    const original = handlers.get(name);
    if (typeof original !== "function") continue;
    originals.set(name, original);
    wrap(name, async (event, args) => {
      const result = await original(event, args);
      if (args?.pluginKey === KEY && (name === "plugins:remove" || args.enabled === false)) restore();
      return result;
    });
  }
  const bindOpenPanels = async () => {
    for (const window of electron.BrowserWindow?.getAllWindows() ?? []) {
      if (window.webContents.isDestroyed()) continue;
      try {
        await wrappers.get(names[0])({ sender: window.webContents }, { pluginKey: KEY, panelId: "team" });
      } catch {
      }
    }
  };
  globalThis[SLOT] = { identity, restore, bindOpenPanels, isCurrent: () => [...wrappers].every(([name, handler]) => handlers.get(name) === handler) };
  await bindOpenPanels();
  return { ready: true, version, reused: false };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  installAdapter
});
