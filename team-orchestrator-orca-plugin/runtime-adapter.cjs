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

// src/public-operations.mjs
var PUBLIC_OPERATIONS = Object.freeze(["saveStaffing", "requestReplacement", "scheduleOrganization", "cancelOrganization", "storageRecovery", "previewHistoryCleanup", "applyHistoryCleanup", "setAdmission", "stopMember", "recoverStop", "checkStop", "ping", "context", "load", "createTeam", "submitWork", "enqueueGoal", "decideWork", "startNextGoal", "answerQuestion", "wakeMember", "resolveRecoveryQuestion", "checkWake", "decideWake", "checkHandoff", "replaceMember", "checkWork", "reconnectWork", "retryObjective", "updateRole", "updateSettings", "launchSupervisor", "recoverLaunch", "openMember", "receipt", "capabilities", "updateAgentPreferences", "exportTemplate", "previewTemplate", "importTemplate"]);
var PUBLIC_BRIDGE_ALIASES = Object.freeze({ "workspace.readContext": "context", "storage.get": "load" });
var BROKERED_PUBLIC_OPERATIONS = Object.freeze(["saveStaffing", "stopMember", "recoverStop", "decideWork", "startNextGoal", "capabilities", "launchSupervisor", "recoverLaunch", "openMember", "replaceMember"]);

// src/local/native-runtime.mjs
var import_node_async_hooks = require("node:async_hooks");
var import_node_net = require("node:net");
var import_node_crypto = require("node:crypto");
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var METHODS = /* @__PURE__ */ new Set(["status.get", "settings.get", "preflight.detectAgents", "preflight.detectRemoteAgents", "agentSession.agents", "agentSession.createSupport", "agentSession.modelCatalog", "worktree.show", "ssh.getState", "terminal.show", "terminal.rename", "terminal.agentStatus", "terminal.wait", "terminal.send", "agentSession.history", "agentSession.restartResumable", "agentSession.restartContinue", "terminal.ensureAgentSession", "agentSession.send", "orchestration.sessionAddress", "orchestration.partyLocation", "orchestration.runShow", "orchestration.taskList", "orchestration.workerList", "orchestration.dispatchShow", "orchestration.workerShow", "orchestration.workerRead", "orchestration.workerStop", "terminal.stopExact", "agentSession.close"]);
function createNativeRpc({ userData, parentPid, consent, timeoutMs = 15e3, maxBytes = 2 * 1024 * 1024 }) {
  const context = new import_node_async_hooks.AsyncLocalStorage();
  const rpc = async (method, params, envelope = {}) => {
    if (!METHODS.has(method)) throw Error("Native method is not allowed for team work.");
    if (Object.keys(envelope).some((key) => !["orchestrationRequestId"].includes(key))) throw Error("Native caller overrides are not allowed.");
    await consent();
    let metadata, transport, profile;
    try {
      if (!(0, import_node_path.isAbsolute)(userData || "")) throw Error();
      profile = await (0, import_promises.realpath)(userData);
      const path = await (0, import_promises.realpath)((0, import_node_path.join)(profile, "orca-runtime.json")), rel = (0, import_node_path.relative)(profile, path);
      if (rel === ".." || rel.startsWith(`..${import_node_path.sep}`) || (0, import_node_path.isAbsolute)(rel)) throw Error();
      const content = await (0, import_promises.readFile)(path, "utf8");
      if (Buffer.byteLength(content) > 65536) throw Error();
      metadata = JSON.parse(content);
      transport = (metadata.transports ?? [metadata.transport]).find((item) => ["unix", "named-pipe"].includes(item?.kind));
      if (metadata.pid !== parentPid || typeof metadata.runtimeId !== "string" || !metadata.runtimeId || typeof metadata.authToken !== "string" || !metadata.authToken || !transport || typeof transport.endpoint !== "string" || (transport.kind === "unix" ? !(0, import_node_path.isAbsolute)(transport.endpoint) : !transport.endpoint.startsWith("\\\\.\\pipe\\"))) throw Error();
    } catch {
      throw Error("Verified Orca runtime metadata is unavailable or belongs to another process. Reconnect the plugin.");
    }
    const expectedRuntimeId = context.getStore();
    if (expectedRuntimeId && metadata.runtimeId !== expectedRuntimeId) throw Error("Native runtime epoch changed during observation; intent remains reserved.");
    const verifyMetadata = async () => {
      const current = JSON.parse(await (0, import_promises.readFile)((0, import_node_path.join)(profile, "orca-runtime.json"), "utf8"));
      if (current.runtimeId !== metadata.runtimeId || current.pid !== parentPid || current.authToken !== metadata.authToken) throw Error("Native runtime epoch changed before effect or observation settlement.");
    };
    await consent();
    return new Promise((resolve, reject) => {
      const id = (0, import_node_crypto.randomUUID)(), socket = (0, import_node_net.createConnection)(transport.endpoint);
      let buffer = "", finished = false, validating = false;
      const finish = (error, result) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        error ? reject(error) : resolve(result);
      };
      const timer = setTimeout(() => finish(Error("Native runtime timed out; any submitted objective remains unconfirmed.")), timeoutMs);
      socket.setEncoding("utf8");
      socket.on("connect", async () => {
        try {
          await consent();
          await verifyMetadata();
          if (!finished) socket.write(JSON.stringify({ id, authToken: metadata.authToken, method, ...params === void 0 ? {} : { params }, ...envelope, ...method.startsWith("orchestration.") ? { orchestrationContractVersion: 1 } : {} }) + "\n");
        } catch (error) {
          finish(error);
        }
      });
      socket.on("error", () => finish(Error("Native runtime connection failed; delivery is unconfirmed.")));
      socket.on("close", () => {
        if (!validating) finish(Error("Native runtime closed before a receipt; delivery is unconfirmed."));
      });
      const publicError = (value) => [metadata.authToken, transport.endpoint, profile, userData].reduce((message, secret) => secret ? message.split(secret).join("[private runtime data]") : message, String(value || "Native operation refused")).slice(0, 1500);
      socket.on("data", async (chunk) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > maxBytes) return finish(Error("Native runtime response exceeded its bounded limit."));
        for (let index; (index = buffer.indexOf("\n")) >= 0; ) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;
          let response;
          try {
            response = JSON.parse(line);
          } catch {
            return finish(Error("Native runtime returned malformed evidence."));
          }
          if (response?._keepalive === true) continue;
          if (response?.id !== id || response?._meta?.runtimeId !== metadata.runtimeId) return finish(Error("Native response identity or runtime changed; evidence is unverified."));
          if (response.ok !== true) return finish(Object.assign(Error(publicError(response.error?.message)), { code: response.error?.code, native: true }));
          validating = true;
          try {
            await verifyMetadata();
            finish(null, response.result);
          } catch (error) {
            finish(error);
          }
          return;
        }
      });
    });
  };
  rpc.withRuntime = (runtimeId, action) => {
    if (typeof runtimeId !== "string" || !runtimeId) throw Error("Expected native runtime identity is required.");
    const prior = context.getStore();
    if (prior && prior !== runtimeId) throw Error("Native runtime epoch changed inside observation.");
    return context.run(runtimeId, action);
  };
  return rpc;
}
var withNativeRuntime = (rpc, runtimeId, action) => rpc.withRuntime ? rpc.withRuntime(runtimeId, action) : action();

// src/local/terminal-identity.mjs
function terminalIdentity(terminal) {
  const { ptyId, incarnationId } = terminal ?? {};
  if (typeof ptyId !== "string" || !ptyId || typeof incarnationId !== "string" || !incarnationId) throw Error("Exact native terminal PTY and incarnation are unverified.");
  return { ptyId, incarnationId, processIncarnation: `${ptyId}:${incarnationId}` };
}

// src/capabilities.mjs
var AGENTS = ["codex", "claude"];

// src/local/capabilities.mjs
var text = (value, limit = 120) => typeof value === "string" && value.trim() && value.length <= limit ? value : null;
var bounded = (value) => Array.isArray(value) ? value.slice(0, 256) : [];
function models(value) {
  const seen = /* @__PURE__ */ new Set();
  return bounded(value).flatMap((row) => {
    if (!text(row?.id) || seen.has(row.id)) return [];
    seen.add(row.id);
    return [{ id: row.id, label: text(row.label) || row.id, isDefault: row.isDefault === true, efforts: bounded(row.efforts).flatMap((effort) => text(effort?.value) ? [{ value: effort.value, label: text(effort.label) || effort.value }] : []) }];
  });
}
async function discoverCapabilities(rpc, scope) {
  const read = async (method, params) => {
    try {
      return await rpc(method, params);
    } catch (error) {
      if (error.authority) throw error;
      return null;
    }
  };
  const status = await read("status.get");
  const settings = (await read("settings.get"))?.settings ?? {};
  let connection = "connected", targetId, before;
  if (scope.executionHostId !== "local") {
    const encoded = scope.executionHostId.slice(4);
    try {
      targetId = decodeURIComponent(encoded);
    } catch {
      throw Error("Invalid saved execution host identity.");
    }
    if (!scope.executionHostId.startsWith("ssh:") || !targetId || encoded.includes("|")) throw Error("Invalid saved execution host identity.");
    before = (await read("ssh.getState", { targetId }))?.state;
    if (before?.status !== "connected") connection = "unavailable";
  }
  const detected = connection === "connected" ? await read(targetId ? "preflight.detectRemoteAgents" : "preflight.detectAgents", targetId ? { connectionId: targetId } : void 0) : null;
  const registered = status?.capabilities?.includes("agent-session.structured.registered-agents.v1") ? await read("agentSession.agents", {}) : null;
  const result = { workspaceKey: scope.workspaceKey, executionHostId: scope.executionHostId, observedAt: Date.now(), runtimeId: text(status?.runtimeId, 256), connection, defaultAgent: AGENTS.includes(settings.defaultTuiAgent) ? settings.defaultTuiAgent : null, launchSupported: status?.capabilities?.includes("agent.launch.v2") === true && status?.capabilities?.includes("agent.launch.replay-required.v1") === true, agents: {} };
  for (const agent of AGENTS) {
    const support = connection === "connected" ? await read("agentSession.createSupport", { worktree: scope.workspaceId.startsWith("folder:") ? scope.workspaceId : `id:${scope.workspaceId}`, agent }) : null;
    const catalog = !targetId && connection === "connected" ? await read("agentSession.modelCatalog", { agent, worktree: scope.workspaceId.startsWith("folder:") ? scope.workspaceId : `id:${scope.workspaceId}` }) : null;
    const configured = {};
    for (const field of ["model", "effort"]) if (text(support?.seedOptions?.[field])) configured[field] = support.seedOptions[field];
    const customCommand = typeof settings.agentCmdOverrides?.[agent] === "string" && Boolean(settings.agentCmdOverrides[agent].trim());
    result.agents[agent] = {
      availability: !Array.isArray(detected) ? "unknown" : detected.includes(agent) ? "detected" : customCommand ? "unknown" : "unavailable",
      tuiPickerDisabled: Array.isArray(settings.disabledTuiAgents) && settings.disabledTuiAgents.includes(agent),
      customCommand,
      configured,
      configuredSource: "orca-saved-preference",
      effective: { model: null, effort: null, contextUsage: null },
      structuredSupported: typeof support?.supported === "boolean" ? support.supported : null,
      contextUsageSupported: registered?.agents?.find((row) => row.agent === agent)?.capabilities?.contextUsage === true,
      catalogStatus: ["probe", "live-session"].includes(catalog?.origin) && Array.isArray(catalog.models) ? "known" : "unknown",
      catalogSource: ["probe", "live-session"].includes(catalog?.origin) ? catalog.origin : null,
      fetchedAt: Number.isFinite(catalog?.fetchedAt) ? catalog.fetchedAt : null,
      models: models(catalog?.models),
      detail: targetId ? "Remote model catalog unavailable. Default inherits Orca; explicit overrides require host validation." : catalog?.listingInProgress ? "Orca is listing models. Refresh capabilities shortly." : catalog?.origin === "unknown" || !catalog ? "Model catalog unknown. Default inherits Orca configuration." : ""
    };
  }
  if (targetId) {
    const after = (await read("ssh.getState", { targetId }))?.state;
    if (after?.status !== "connected" || after?.providerEpoch !== before?.providerEpoch || after?.connectionGeneration !== before?.connectionGeneration) {
      result.connection = "unavailable";
      for (const entry of Object.values(result.agents)) entry.availability = "unknown";
    }
    result.hostGeneration = after?.connectionGeneration ?? null;
  }
  return result;
}

// src/local/native-broker.mjs
async function mediateOperation({ op, input, invoke, rpc, authority, admission }) {
  if (op === "saveStaffing") {
    await authority();
    const target = await invoke({ op: "_staffingTarget", params: input });
    if (!target.staffing && input.decision !== "reject") {
      const prepared2 = await invoke({ op: "_capabilityScope", params: { teamId: target.teamId } }), value = await discoverCapabilities(rpc, prepared2.scope);
      await authority();
      const observed2 = await invoke({ op: "_capabilityResult", params: { observationId: prepared2.observationId, value } });
      admission = { prepared: prepared2, observed: observed2 };
    }
    await authority();
    const saved2 = await invoke({ op: "_saveStaffing", params: input });
    if (saved2.staffing.launch) {
      try {
        const launched = await mediateOperation({ op: "launchSupervisor", input: saved2.staffing.launch, invoke, rpc, authority, admission });
        saved2.preparation = launched.value;
      } catch (error2) {
        saved2.preparation = { status: "pending", detail: String(error2.message).slice(0, 1200) };
      }
      await authority();
      saved2.value = (await invoke({ op: "load", params: {} })).value;
    }
    return { ok: true, value: saved2 };
  }
  if (op === "decideWork") {
    await authority();
    const result2 = await invoke({ op: "_decideWork", params: input });
    if (input.decision !== "accept" || !result2.decision.nextGoalId) return { ok: true, value: result2 };
    return mediateOperation({ op: "startNextGoal", input: { teamId: result2.teamId, goalId: result2.decision.nextGoalId }, invoke, rpc, authority });
  }
  if (op === "startNextGoal") {
    await authority();
    const plan = await invoke({ op: "_nextGoal", params: input });
    if (!plan.goalId) return { ok: true, value: { value: plan.value } };
    if (plan.launch) {
      const launched = await mediateOperation({ op: "launchSupervisor", input: plan.launch, invoke, rpc, authority });
      if (launched.value?.status !== "created") return { ok: true, value: { pending: true, detail: "Fresh launch outcome is unknown. Check saved launch evidence before continuing." } };
      const remaining = await invoke({ op: "_nextGoal", params: input });
      if (remaining.launch) return { ok: true, value: { pending: true, continue: true, goalId: plan.goalId } };
    }
    await authority();
    return { ok: true, value: await invoke({ op: "_startQueuedWork", params: { ...input, goalId: plan.goalId } }) };
  }
  if (op === "openMember") {
    const saved2 = await invoke({ op: "_memberBinding", params: input });
    if (saved2.kind === "structured") {
      const address = await rpc("orchestration.sessionAddress", { sessionId: saved2.sessionId });
      if (typeof address?.orcaSessionId !== "string") throw Error("Native session address is unavailable.");
      const located = (await rpc("orchestration.partyLocation", { address: address.orcaSessionId }))?.location;
      if (located?.kind !== "chat" || located.sessionId !== saved2.sessionId || located.worktreeId !== saved2.scope.workspaceId) throw Error("The saved structured session scope is no longer verified.");
      const opened = await rpc("agentSession.reveal", { sessionId: saved2.sessionId });
      if (opened?.ok !== true || opened.sessionId !== saved2.sessionId || opened.workspaceId !== saved2.scope.workspaceId || opened.agent !== saved2.nativeRequest.agent) throw Error("The native session could not be verified in its saved project.");
    } else {
      const shown = (await rpc("terminal.show", { terminal: saved2.handle }))?.terminal;
      if (shown?.handle !== saved2.handle || shown.worktreeId !== saved2.scope.workspaceId || shown.executionHostId && shown.executionHostId !== saved2.scope.executionHostId || saved2.paneKey && `${shown.tabId}:${shown.leafId}` !== saved2.paneKey) throw Error("The saved terminal identity is no longer verified.");
      await rpc("terminal.focus", { terminal: saved2.handle, navigation: "host" });
    }
    return { ok: true, value: { opened: true } };
  }
  let recovery;
  if (op !== "capabilities" && op !== "replaceMember") {
    recovery = await invoke({ op: "_launchLookup", params: { input, recover: op === "recoverLaunch" } });
    if (recovery?.receipt) return { ok: true, value: recovery.receipt };
    if (op === "recoverLaunch") throw Error("Saved launch operation was not found; checking cannot start a new session.");
  }
  const prepared = admission?.prepared ?? await invoke({ op: "_capabilityScope", params: op === "capabilities" ? input : { teamId: input.teamId } });
  let observed = admission?.observed;
  if (!observed) {
    const value = await discoverCapabilities(rpc, prepared.scope);
    await authority();
    observed = await invoke({ op: "_capabilityResult", params: { observationId: prepared.observationId, value } });
  }
  if (op === "capabilities") return { ok: true, value: observed };
  const launch = recovery ?? await invoke({ op: op === "replaceMember" ? "_wakeFreshPrepare" : "_launchPrepare", params: { input, observationId: prepared.observationId } });
  if (launch.receipt) return { ok: true, value: launch.receipt };
  let result, error;
  try {
    await invoke({ op: "_launchValidate", params: { phaseId: launch.phaseId, observationId: prepared.observationId } });
    const status = await rpc("status.get");
    if (status?.runtimeId !== observed.runtimeId || !["agent.launch.v2", "agent.launch.replay-required.v1", "agent.launch.prompt-carry.v1"].every((capability) => status?.capabilities?.includes(capability))) throw Error("Native launch capabilities changed before execution.");
    if (launch.operation.scope.executionHostId.startsWith("ssh:")) {
      const state = (await rpc("ssh.getState", { targetId: decodeURIComponent(launch.operation.scope.executionHostId.slice(4)) }))?.state;
      if (state?.status !== "connected" || observed.hostGeneration !== null && state.connectionGeneration !== observed.hostGeneration) throw Error("The saved execution host disconnected or changed generation.");
    }
    result = await rpc("agent.launchReplay", launch.operation.nativeRequest);
  } catch (failure) {
    error = `${failure.code ? `${failure.code}: ` : ""}${failure.message}`;
  }
  const settled = await invoke({ op: "_launchSettle", params: { phaseId: launch.phaseId, result, error } });
  if (!settled.operation) return { ok: true, value: settled.receipt };
  const saved = settled.operation;
  let warning = saved.warning, observation = saved.observation;
  try {
    if (saved.kind === "terminal") {
      const shown = (await rpc("terminal.show", { terminal: saved.handle }))?.terminal;
      if (shown?.handle !== saved.handle || shown.worktreeId !== saved.scope.workspaceId || saved.paneKey && `${shown.tabId}:${shown.leafId}` !== saved.paneKey) throw Error("Created terminal could not be corroborated in its saved project.");
      await rpc("terminal.rename", { terminal: saved.handle, title: saved.title });
      const status = (await rpc("terminal.agentStatus", { terminal: saved.handle }))?.agentStatus;
      if (status?.handle === saved.handle && status.isRunningAgent === true) observation = { state: ["working", "permission", "idle"].includes(status.status) ? status.status : "unknown", detail: "Native terminal agent observation; task readiness is separate.", ...shown.incarnationId ? { incarnationId: shown.incarnationId, ...shown.ptyId ? terminalIdentity(shown) : {} } : {} };
    } else {
      const history = await rpc("agentSession.history", { sessionId: saved.sessionId, direction: "tail", limit: 1 });
      if (history?.ok === true && history.page?.sessionId === saved.sessionId && Number.isSafeInteger(history.page.fence) && history.page.fence > 0) observation = { ...observation, ownerFence: history.page.fence };
      warning = [warning, "Native structured naming is unavailable; the plugin label is retained. Provider start/login observation is unknown."].filter(Boolean).join(" ");
    }
  } catch (failure) {
    warning = [warning, failure.message].filter(Boolean).join(" ").slice(0, 1200);
  }
  return { ok: true, value: await invoke({ op: "_launchFollowup", params: { phaseId: settled.phaseId, warning, observation } }) };
}

// src/templates.mjs
var MAX_TEMPLATE_BYTES = 1024 * 1024;

// src/local/adapter.mjs
var SLOT = /* @__PURE__ */ Symbol.for("herman925.team-orchestrator.adapter");
var KEY = "herman925.team-orchestrator";
var CHANNEL = "workspace.readContext";
async function installAdapter(electron, { version, identity, internalKey }) {
  const ipc = electron.ipcMain;
  const handlers = ipc?._invokeHandlers;
  if (!(handlers instanceof Map)) throw new Error("This Electron build has no compatible IPC handler registry.");
  const existing = globalThis[SLOT];
  if (existing?.identity === identity && existing.internalKey === internalKey && existing.isCurrent()) {
    return { ready: true, version, reused: true };
  }
  existing?.restore();
  const names = ["plugins:readPanelEntry", "plugins:panelAction", "plugins:invokeCommand"];
  const originals = new Map(names.map((name) => [name, handlers.get(name)]));
  if ([...originals.values()].some((handler) => typeof handler !== "function")) throw new Error("Orca plugin IPC handlers are not ready or compatible.");
  const isMainFrame = (event) => Boolean(event?.senderFrame && event.senderFrame === event.sender?.mainFrame && !event.sender?.isDestroyed?.());
  const leases = /* @__PURE__ */ new Map();
  const wrappers = /* @__PURE__ */ new Map();
  const wrap = (name, fn) => {
    wrappers.set(name, fn);
    ipc.removeHandler(name);
    ipc.handle(name, fn);
  };
  wrap(names[0], async (event, args) => {
    if (!isMainFrame(event)) throw new Error("Team Orchestrator requires a live main-frame IPC event.");
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
    if (!isMainFrame(event)) return { ok: false, code: "invalid_request", error: "Main-frame IPC is required." };
    if (leases.get(call.sessionToken) !== event.sender.id) {
      try {
        await wrappers.get(names[0])(event, { pluginKey: KEY, panelId: "team" });
      } catch {
      }
    }
    if (leases.get(call.sessionToken) !== event.sender.id) return { ok: false, code: "invalid_request", error: "This panel is not bound to Team Orchestrator." };
    const gate = await originals.get(names[1])(event, { ...call, params: {} });
    if (!gate.ok) return gate;
    try {
      const message = call.params.teamWorker;
      const envelopeLimit = ["previewTemplate", "importTemplate"].includes(message.args?.op) ? MAX_TEMPLATE_BYTES + 8192 : 6e4;
      if (message.protocol !== 1 || typeof message.nonce !== "string" || !message.nonce || message.nonce.length > 128 || !["team.control", "team.initialise"].includes(message.commandId) || Buffer.byteLength(JSON.stringify(message)) > envelopeLimit) return { ok: false, code: "invalid_params", error: "Invalid worker command envelope." };
      if (message.commandId === "team.control" && !PUBLIC_OPERATIONS.includes(message.args?.op)) return { ok: false, code: "invalid_params", error: "Unknown worker operation." };
      if (Object.keys(message.args ?? {}).some((key) => !["op", "params", "workspaceId"].includes(key))) throw Error("Invalid public worker arguments.");
      if (message.commandId === "team.control" && BROKERED_PUBLIC_OPERATIONS.includes(message.args?.op)) {
        if (!internalKey) throw Error("Native broker authority is unavailable; initialise the adapter again.");
        const invoke = (args) => originals.get(names[2])(event, { pluginKey: KEY, commandId: "team.control", args: { ...args, internalKey } });
        const runtime = handlers.get("runtime:call");
        if (typeof runtime !== "function") throw Error("The pinned runtime channel is unavailable.");
        const current = () => {
          if (!isMainFrame(event) || leases.get(call.sessionToken) !== event.sender.id || handlers.get("runtime:call") !== runtime || ![...wrappers].every(([name, handler]) => handlers.get(name) === handler)) throw Object.assign(Error("Native broker authority expired."), { code: "authority_expired", authority: true });
        };
        const authority = async () => {
          current();
          const gate2 = await originals.get(names[1])(event, { ...call, params: {} });
          if (!gate2.ok) throw Object.assign(Error(gate2.error || "Native broker authority was refused."), { code: gate2.code ?? "permission_denied", authority: true });
          current();
        };
        const rpc = async (method, params) => {
          await authority();
          const response = await runtime(event, { method, ...params === void 0 ? {} : { params } });
          if (!response?.ok) throw Object.assign(Error(response?.error?.message || "Native operation unavailable."), { code: response?.error?.code ?? "host_unavailable" });
          return response.result;
        };
        if (message.args.op === "stopMember" || message.args.op === "recoverStop") {
          const command = async (op, params) => {
            const response = await invoke({ op, params });
            if (response?.ok === false) throw Error(response.error?.message ?? response.error ?? "Stop command refused.");
            return response;
          };
          await authority();
          const saved = await command(message.args.op === "recoverStop" ? "_stopRecover" : "_stopPrepare", message.args.params);
          await authority();
          const plan = message.args.op === "recoverStop" ? saved.plan : await command("_stopValidate", { requestId: saved.requestId });
          if (plan) {
            const socketRpc = createNativeRpc({ userData: electron.app.getPath("userData"), parentPid: process.pid, consent: authority });
            let receipt, error;
            try {
              receipt = await withNativeRuntime(socketRpc, plan.runtimeId, async () => {
                if (plan.executionHostId?.startsWith("ssh:")) {
                  const state = (await socketRpc("ssh.getState", { targetId: decodeURIComponent(plan.executionHostId.slice(4)) }))?.state;
                  if (state?.status !== "connected" || state.connectionGeneration !== plan.hostGeneration) throw Error("Stop execution host changed before submission; reconcile the saved intent.");
                }
                if (plan.terminalIdentity) {
                  const expected = plan.terminalIdentity, shown = (await socketRpc("terminal.show", { terminal: expected.handle }))?.terminal;
                  if (shown?.handle !== expected.handle || shown.incarnationId !== expected.incarnationId || shown.ptyId !== expected.ptyId || `${shown.tabId}:${shown.leafId}` !== expected.paneKey || shown.worktreeId !== expected.workspaceId || shown.executionHostId !== plan.executionHostId) throw Error("Exact terminal identity changed before stop submission.");
                }
                const receipt2 = await socketRpc(plan.method, plan.params, plan.envelope);
                if (plan.executionHostId?.startsWith("ssh:")) {
                  const state = (await socketRpc("ssh.getState", { targetId: decodeURIComponent(plan.executionHostId.slice(4)) }))?.state;
                  if (state?.status !== "connected" || state.connectionGeneration !== plan.hostGeneration) throw Error("Stop execution host changed before receipt verification; reconcile the saved intent.");
                }
                return receipt2;
              });
            } catch (failure) {
              error = { message: failure.message, code: failure.code, native: failure.native === true };
            }
            await authority();
            await command("_stopSettle", { requestId: saved.requestId, receipt, error });
          }
          await authority();
          return { ok: true, value: await command("load", {}) };
        }
        return await mediateOperation({ op: message.args.op, input: message.args.params, invoke, rpc, authority });
      }
      let workspaceId;
      if (message.args?.op === "context" && !message.args?.params?.teamId) {
        const session = handlers.get("session:get");
        if (typeof session !== "function") throw new Error("Orca has no compatible desktop workspace selection handler.");
        workspaceId = (await session(event))?.activeWorktreeId;
        if (typeof workspaceId !== "string" || !workspaceId) throw new Error("Open the intended workspace first.");
      }
      const value = await originals.get(names[2])(event, { pluginKey: KEY, commandId: message.commandId, args: { ...message.args, workspaceId, nonce: message.nonce } });
      return { ok: true, value };
    } catch (error) {
      return { ok: false, code: error.code ?? "action_failed", error: String(error.message ?? error).slice(0, 1500) };
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
  globalThis[SLOT] = { identity, internalKey, restore, isCurrent: () => [...wrappers].every(([name, handler]) => handlers.get(name) === handler) };
  return { ready: true, version, reused: false };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  installAdapter
});
