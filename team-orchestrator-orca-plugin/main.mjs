// src/local/bootstrap.mjs
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";

// src/local/inspector.mjs
async function connectInspector(url, timeoutMs = 4e3) {
  const address = new URL(url);
  if (address.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)) throw new Error("Inspector must be loopback-only.");
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Inspector connection timed out."));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Inspector connection failed."));
    }, { once: true });
  });
  let sequence = 0;
  const pending = /* @__PURE__ */ new Map();
  const fail = (error) => {
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(error);
    }
    pending.clear();
  };
  socket.addEventListener("close", () => fail(new Error("Inspector disconnected.")));
  socket.addEventListener("error", () => fail(new Error("Inspector transport failed.")));
  socket.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result);
  });
  return {
    async evaluate(expression) {
      const id = ++sequence;
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Inspector evaluation timed out."));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result?.value;
    },
    close() {
      fail(new Error("Inspector session closed."));
      socket.close();
    }
  };
}

// src/local/bootstrap.mjs
var execute = promisify(execFile);
var activateParent = (pid) => execute(process.execPath, ["-e", "process._debugProcess(Number(process.argv[1]))", String(pid)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 4e3, windowsHide: true });
var delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
var SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
var occupied = (port) => new Promise((resolve) => {
  const socket = createConnection({ host: "127.0.0.1", port });
  const finish = (value) => {
    socket.destroy();
    resolve(value);
  };
  socket.once("connect", () => finish(true));
  socket.once("error", () => finish(false));
  socket.setTimeout(700, () => finish(true));
});
function inspectorFuse(bytes) {
  let cursor = 0;
  let count = 0;
  for (; ; ) {
    const index = bytes.indexOf(SENTINEL, cursor);
    if (index < 0) break;
    const offset = index + SENTINEL.length;
    if (bytes[offset] !== 1 || bytes[offset + 1] < 4 || bytes[offset + 5] !== 49) return false;
    count++;
    cursor = offset + 6;
  }
  return count > 0;
}
function packageType(platform, executable, entry) {
  if (platform === "darwin") return executable.includes(".app/") ? "macOS app bundle" : "development";
  if (platform === "win32") return /app\.asar\.unpacked/i.test(entry) ? "Windows installed app" : "development";
  if (executable.includes("/.mount_") || executable.includes("/tmp/.mount")) return "Linux AppImage";
  return /app\.asar\.unpacked/.test(entry) ? "Linux installed app" : "development";
}
async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(700) });
    const items = await response.json();
    return Array.isArray(items) ? items.filter((item) => item.type === "node" && item.webSocketDebuggerUrl) : [];
  } catch {
    return [];
  }
}
async function bootstrap({ parentPid = process.ppid, executable = process.execPath, entry = process.argv[1] ?? "", port = 9229, activate: activate2 = activateParent, adapterPath = fileURLToPath(new URL("./runtime-adapter.cjs", import.meta.url)), version = "0.1.05" } = {}) {
  const report = { platform: process.platform, packageType: packageType(process.platform, executable, entry), parentPid, ready: false };
  let client;
  let owned = false;
  try {
    if (!Number.isInteger(parentPid) || parentPid < 2 || parentPid === process.pid) throw new Error("Invalid Orca parent process.");
    const binary = await readFile(executable);
    if (!inspectorFuse(binary)) throw new Error("This executable does not expose an enabled Electron inspector fuse. Nothing was injected.");
    let available = await targets(port);
    if (!available.length) {
      if (await occupied(port)) throw new Error("Loopback inspector port is occupied by an incompatible endpoint. Nothing was injected.");
      if (typeof process._debugProcess !== "function") throw new Error("This Node runtime cannot activate the parent inspector.");
      await activate2(parentPid);
      owned = true;
      for (let attempt = 0; attempt < 20 && !available.length; attempt++) {
        await delay(100);
        available = await targets(port);
      }
    }
    if (!available.length) throw new Error(`Orca did not expose its main-process inspector on loopback port ${port}; inspector activation was attempted but cleanup could not be verified.`);
    if (available.length !== 1) throw new Error("Inspector target is ambiguous; nothing was injected.");
    client = await connectInspector(available[0].webSocketDebuggerUrl);
    const identity = await client.evaluate("({pid:process.pid,electron:process.versions.electron})");
    if (identity?.pid !== parentPid || !identity.electron) {
      owned = false;
      throw new Error("Inspector belongs to another process; nothing was injected.");
    }
    const source = await readFile(adapterPath, "utf8");
    const digest = createHash("sha256").update(source).digest("hex");
    const expression = `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.execPath);const electron=req('electron');if(electron.app.getName().toLowerCase()!=='orca'||!/^1\\.4\\.\\d+$/.test(electron.app.getVersion()))throw Error('Unsupported Orca application/version');const m={exports:{}};new Function('require','module','exports',${JSON.stringify(source)})(req,m,m.exports);return {...await m.exports.installAdapter(electron,{version:${JSON.stringify(version)},identity:${JSON.stringify(digest)}}),appVersion:electron.app.getVersion()};})()`;
    Object.assign(report, await client.evaluate(expression));
    report.detail = "Local runtime adapter installed; panel-to-worker test is available.";
  } catch (error) {
    report.detail = error.message;
  } finally {
    if (client && owned) {
      try {
        await client.evaluate("setTimeout(()=>process.getBuiltinModule('inspector').close(),500);true");
      } catch {
      }
    }
    client?.close();
  }
  return report;
}

// src/local/cli.mjs
import { execFile as execFile2 } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify as promisify2 } from "node:util";
var execute2 = promisify2(execFile2);
async function locateCli(entry = process.argv[1], executable = process.execPath) {
  if (entry) {
    const candidate = join(dirname(entry), "..", "cli", "index.js");
    try {
      await access(candidate);
      return { executable, prefix: [candidate], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } };
    } catch {
    }
  }
  throw new Error("The installed Orca CLI entry was not found beside its plugin worker.");
}
function createCliRunner(command) {
  return async (args) => {
    let stdout;
    try {
      ({ stdout } = await execute2(command.executable, [...command.prefix, ...args, "--json"], { env: command.env, timeout: 9e4, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false }));
    } catch (error) {
      try {
        const response2 = JSON.parse(error.stdout);
        if (response2.ok === false && typeof response2.error?.message === "string") throw Object.assign(new Error(response2.error.message), { parsed: true });
      } catch (parsed) {
        if (parsed.parsed) throw parsed;
      }
      throw new Error(error.killed ? "Local Orca CLI timed out; outcome is unknown." : "Local Orca CLI failed; outcome is unknown.");
    }
    let response;
    try {
      response = JSON.parse(stdout.trim());
    } catch {
      throw new Error("Orca CLI returned invalid JSON.");
    }
    if (args[0] === "agent-context" && Array.isArray(response.commands)) return response;
    if (response.ok !== true) throw new Error(response.error?.message ?? "Orca CLI rejected the operation.");
    return response.result;
  };
}

// src/local/executor.mjs
import { createHash as createHash2 } from "node:crypto";

// src/local/startup-command.mjs
function startupCommand(params, platform = "posix") {
  if (params.agent === "claude" && params.effort === "xhigh") throw new Error("Claude Code does not accept xhigh effort. Choose high or a default.");
  const args = [params.agent];
  if (params.model) args.push("--model", params.model);
  if (params.effort) args.push(...params.agent === "codex" ? ["-c", `model_reasoning_effort=${params.effort}`] : ["--effort", params.effort]);
  args.push("--", params.brief.replace(/[\r\n]+/g, " "));
  if (args.some((value) => /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value))) throw new Error("Control characters are not allowed in a startup command.");
  if (platform === "powershell") return "& " + args.map((value) => "'" + value.replaceAll("'", "''") + "'").join(" ");
  return args.map((value) => "'" + value.replaceAll("'", `'"'"'`) + "'").join(" ");
}

// src/team.mjs
var PRESETS = [
  { label: "Squad", sketch: "\u25CF\u252C\u25CB\u25CB\u25CB", hint: "Head + 3 workers", form: { name: "Squad", structure: "team", levels: 2, fan: 3, groups: "" } },
  { label: "All-Purpose Team", sketch: "\u25A0\u252C\u25CF\u25CF", hint: "CEO + 2 heads, 4 workers each", form: { name: "All-Purpose-Team", structure: "organisation", levels: 3, fan: 4, groups: "Team 1, Team 2" } },
  { label: "Tech Team", sketch: "\u25A0\u252C\u25CF\u25CF\u25CF\u25CF", hint: "CEO + 4 heads, 4 workers each", form: { name: "Tech-Team", structure: "organisation", levels: 3, fan: 4, groups: "Dev Team, UI Team, Test Team, Security Team" } }
];
var DEFAULT_FORM = { ...PRESETS[0].form, purpose: "", agents: ["codex", "codex", "codex"], models: ["default", "default", "default"], efforts: ["default", "default", "default"] };
var SETTINGS = { chart: true, layout: "stacked" };
var GLYPHS = { ceo: "\u25A0", head: "\u25CF", lead: "\u25C7", worker: "\u25CB" };
function cleanName(value) {
  return value.trim().replace(/\s+/g, "-");
}
function nameValid(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
}
function planTeam(form) {
  const name = cleanName(form.name);
  if (!nameValid(name)) throw new Error("Use a team name of 1\u201364 letters, numbers, underscores or dashes, starting with a letter or number.");
  if (!["team", "organisation"].includes(form.structure)) throw new Error("Choose a team structure.");
  if (![1, 2, 3].includes(form.levels) || ![1, 2, 3, 4, 5].includes(form.fan)) throw new Error("Choose 1\u20133 levels and 1\u20135 reports per manager.");
  if (typeof form.purpose !== "string" || form.purpose.length > 500) throw new Error("Keep the team function under 500 characters.");
  for (const values of [form.models, form.efforts]) {
    if (!Array.isArray(values) || values.length !== 3 || values.some((value) => typeof value !== "string" || !value || value.length > 120)) throw new Error("Invalid model or effort selection.");
  }
  if (form.efforts.some((value) => !["default", "low", "medium", "high", "xhigh"].includes(value))) throw new Error("Invalid effort selection.");
  if (form.models.some((model, i) => model === "default" && form.efforts[i] !== "default")) throw new Error("Choose a model before overriding its effort.");
  const agents = form.agents ?? ["codex", "codex", "codex"];
  if (!Array.isArray(agents) || agents.length !== 3 || agents.some((agent) => !["codex", "claude"].includes(agent))) throw new Error("Choose Codex or Claude Code for each level.");
  const members = [];
  const add = (memberName, team, role, level, boss) => {
    const id = `member-${members.length + 1}`;
    const purpose = form.purpose.trim() || "the team goal";
    const brief = role === "worker" ? `Execute tasks from ${boss.name} and report back.` : `Own ${purpose}; plan, delegate to direct reports, review results and report to ${boss?.name || "the user"}.`;
    const member = { id, name: memberName, team, role, level, boss: boss?.id || null, model: form.models[level - 1], effort: form.efforts[level - 1], agent: agents[level - 1], state: "unassigned", brief };
    members.push(member);
    return member;
  };
  if (form.structure === "organisation") {
    const groups = form.groups.split(",").map(cleanName);
    if (!groups.length || groups.length > 8 || groups.some((group) => !nameValid(group))) throw new Error("Enter 1\u20138 team names separated by commas.");
    if (new Set(groups.map((group) => group.toLowerCase())).size !== groups.length) throw new Error("Team names must be unique.");
    if (groups.some((group) => group.toLowerCase() === name.toLowerCase())) throw new Error("Give the organisation and its teams different names.");
    const ceo = add("CEO", name, "ceo", 1, null);
    for (const group of groups) {
      const head = add(`${group}-Head`, group, "head", 2, ceo);
      for (let i = 1; i <= form.fan; i++) add(`${group}-Worker-${i}`, group, "worker", 3, head);
    }
  } else {
    let tier = [add("Head", name, "head", 1, null)];
    for (let level = 2; level <= form.levels; level++) {
      const next = [];
      tier.forEach((boss, index) => {
        for (let i = 1; i <= form.fan; i++) {
          const role = level === form.levels ? "worker" : "lead";
          const suffix = form.levels === 2 ? `${i}` : `${index + 1}-${i}`;
          next.push(add(`${role === "worker" ? "Worker" : "Lead"}-${suffix}`, name, role, level, boss));
        }
      });
      tier = next;
    }
  }
  return { name, purpose: form.purpose.trim(), structure: form.structure, members, configuration: { ...form, agents } };
}
function addTeam(state, team) {
  const incoming = new Set([team.name, ...team.members.map((member) => member.team)].map((name) => name.toLowerCase()));
  if (state.teams.some((existing) => [existing.name, ...existing.members.map((member) => member.team)].some((name) => incoming.has(name.toLowerCase())))) throw new Error("A team with this name already exists. Choose a different name; existing teams are never replaced.");
  return { ...state, teams: [...state.teams, team] };
}
function validateState(value) {
  if (value === null) return { version: 1, teams: [], settings: { ...SETTINGS } };
  if (!value || value.version !== 1 || !Array.isArray(value.teams) || value.teams.length > 100) throw new Error("Saved team data has an unsupported format. It has been left untouched.");
  const string = (s, max = 120) => typeof s === "string" && s.length > 0 && s.length <= max;
  let validated = { version: 1, teams: [], settings: { ...SETTINGS } };
  for (const team of value.teams) {
    if (!team || !nameValid(team.name) || typeof team.purpose !== "string" || team.purpose.length > 500 || !["team", "organisation"].includes(team.structure) || !Array.isArray(team.members) || !team.members.length || team.members.length > 49) throw new Error("Saved team data is invalid. It has been left untouched.");
    const ids = /* @__PURE__ */ new Set();
    const names = /* @__PURE__ */ new Set();
    for (const member of team.members) {
      if (!member || !string(member.id) || !string(member.name) || !nameValid(member.team) || !Object.hasOwn(GLYPHS, member.role) || ![1, 2, 3].includes(member.level) || !["codex", "claude"].includes(member.agent) || member.state !== "unassigned" || !string(member.model) || !["default", "low", "medium", "high", "xhigh"].includes(member.effort) || !string(member.brief, 1500) || ids.has(member.id) || names.has(member.name.toLowerCase())) throw new Error("Saved member data is invalid. It has been left untouched.");
      if (member.boss !== null && !ids.has(member.boss)) throw new Error("Saved reporting relationships are invalid. It has been left untouched.");
      if (member.boss === null && ids.size !== 0) throw new Error("Saved team has multiple roots. It has been left untouched.");
      if (member.boss === null && member.level !== 1 || member.boss !== null && team.members.find((boss) => boss.id === member.boss)?.level !== member.level - 1) throw new Error("Saved hierarchy levels are invalid. It has been left untouched.");
      ids.add(member.id);
      names.add(member.name.toLowerCase());
    }
    if (team.configuration) {
      const planned = planTeam(team.configuration);
      if (JSON.stringify(planned.members) !== JSON.stringify(team.members) || planned.name !== team.name || planned.purpose !== team.purpose || planned.structure !== team.structure) throw new Error("Saved launch configuration does not match its roster. It has been left untouched.");
    }
    if (team.launch) {
      const request = team.launch;
      if (!["sending", "accepted", "rejected", "unknown"].includes(request.status) || !["on-demand", "all"].includes(request.mode)) throw new Error("Saved launch request is invalid. It has been left untouched.");
      if (request.native === true) {
        if (!/^[a-f0-9]{64}$/.test(request.workspaceKey) || !request.members || typeof request.members !== "object" || Array.isArray(request.members)) throw new Error("Saved native launch is invalid. It has been left untouched.");
        for (const [id, receipt] of Object.entries(request.members)) {
          if (!ids.has(id) || !receipt || !["starting", "created", "unknown"].includes(receipt.status) || receipt.error !== void 0 && !string(receipt.error, 1500) || receipt.status === "created" && (!string(receipt.terminalId, 1024) || !string(receipt.title, 512) || typeof receipt.briefAccepted !== "boolean" || receipt.executionHostId !== null && !string(receipt.executionHostId, 256))) throw new Error("Saved launch receipt is invalid. It has been left untouched.");
        }
      } else if (!string(request.terminalId, 1024)) throw new Error("Saved launch request is invalid. It has been left untouched.");
    }
    validated = addTeam(validated, team);
  }
  if (value.settings && typeof value.settings.chart === "boolean" && ["stacked", "columns"].includes(value.settings.layout)) validated.settings = { chart: value.settings.chart, layout: value.settings.layout };
  return validated;
}

// src/local/executor.mjs
var hash = (value) => createHash2("sha256").update(value).digest("hex");
var KEY = "team-definitions-v1";
function createExecutor(host, cli) {
  const starts = /* @__PURE__ */ new Map();
  const jobs = /* @__PURE__ */ new Set();
  const get = async (key) => (await host.call("storage.get", { key }))?.value ?? null;
  const set = async (key, value) => host.call("storage.set", { key, value });
  async function workspaceRecord(workspaceId) {
    if (typeof workspaceId !== "string" || !workspaceId || workspaceId.length > 4096) throw new Error("No verified desktop workspace selection.");
    const selector = workspaceId.startsWith("folder:") ? workspaceId : `id:${workspaceId}`;
    const result = await cli(["worktree", "show", "--worktree", selector]);
    const workspace = result?.worktree;
    if (!workspace?.id) throw new Error("Open the intended workspace first; Orca returned no active workspace identity.");
    return workspace;
  }
  async function context(workspaceId) {
    const workspace = await workspaceRecord(workspaceId);
    return { displayName: workspace.displayName || workspace.branch || "Workspace", branch: workspace.branch || "", workspaceKey: hash(workspace.id), nativeAgentLaunch: true };
  }
  function validateLaunch(value) {
    if (!value || !/^[a-zA-Z0-9-]{1,120}$/.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.workspaceKey) || !["codex", "claude"].includes(value.agent) || typeof value.title !== "string" || !value.title || value.title.length > 160 || typeof value.brief !== "string" || !value.brief || value.brief.length > 16384) throw new Error("Invalid member launch request.");
    for (const field of ["model", "effort"]) if (value[field] !== void 0 && (typeof value[field] !== "string" || !value[field] || value[field].length > 120)) throw new Error("Invalid model or effort.");
    if (value.effort && (!value.model || !["low", "medium", "high", "xhigh"].includes(value.effort))) throw new Error("Effort requires a model and a supported level.");
  }
  async function start(params, workspaceId) {
    validateLaunch(params);
    const fingerprint = hash(JSON.stringify(params));
    const active = starts.get(params.requestId);
    if (active) {
      if (active.fingerprint !== fingerprint) throw new Error("Request identity conflicts with an existing launch.");
      return active.promise;
    }
    const promise = (async () => {
      const key = `launch:${params.requestId}`;
      const saved = await get(key);
      if (saved) {
        if (saved.fingerprint !== fingerprint) throw new Error("Request identity conflicts with an existing launch.");
        return { requestId: params.requestId, status: saved.status };
      }
      const workspace = await workspaceRecord(workspaceId);
      if (hash(workspace.id) !== params.workspaceKey) throw new Error("The active workspace changed. No new agent was launched.");
      const schema = await cli(["agent-context"]);
      const commands = schema.commands ?? [];
      const modern = commands.some((value) => value.command === "agent launch");
      if (!modern && !commands.some((value) => value.command === "terminal create")) throw new Error("The local Orca CLI has no agent or terminal launcher.");
      const windowsPath = /^[a-z]:[\\/]|^\\\\/i.test(workspace.path ?? workspace.git?.path ?? "");
      const powershell = windowsPath || process.platform === "win32" && !workspace.executionHostId?.startsWith("ssh:") && !(workspace.path ?? workspace.git?.path ?? "").startsWith("/");
      if (!modern && powershell && !commands.find((value) => value.command === "terminal create")?.flags?.includes("shell")) throw new Error("This Orca CLI cannot select the Windows shell safely.");
      const command = modern ? null : startupCommand(params, powershell ? "powershell" : "posix");
      await set(key, { fingerprint, status: "starting" });
      const job = run(key, fingerprint, params, workspaceId.startsWith("folder:") ? workspaceId : `id:${workspaceId}`, { command, powershell });
      jobs.add(job);
      job.finally(() => jobs.delete(job)).catch(() => {
      });
      return { requestId: params.requestId, status: "starting" };
    })();
    starts.set(params.requestId, { fingerprint, promise });
    try {
      return await promise;
    } catch (error) {
      starts.delete(params.requestId);
      throw error;
    }
  }
  async function run(key, fingerprint, params, selector, { command, powershell }) {
    let record = { fingerprint, status: "unknown" };
    try {
      let argv = ["agent", "launch", "--agent", params.agent, "--worktree", selector, "--prompt", params.brief];
      if (params.model) argv.push("--model", params.model);
      if (params.effort) argv.push("--effort", params.effort);
      if (command) argv = ["terminal", "create", "--worktree", selector, "--title", params.title, "--command", command, ...powershell ? ["--shell", "powershell.exe"] : []];
      const result = await cli(argv);
      const handle = command ? result?.terminal?.handle : result?.outcome?.handle;
      if (!handle) throw new Error("Orca returned no agent handle; inspect the workspace before retrying.");
      const warning = result.warning || result.terminal?.warning;
      record = { fingerprint, status: "naming", handle, title: params.title, briefAccepted: Boolean(command) || ["handed-to-terminal", "journaled"].includes(result.prompt?.outcome), ...result.outcome?.sessionId ? { sessionId: result.outcome?.sessionId } : {}, ...warning ? { warning } : {} };
      await set(key, record);
      await cli(["terminal", "rename", "--terminal", record.handle, "--title", params.title]);
      const shown = await cli(["terminal", "show", "--terminal", record.handle]);
      record.title = shown.terminal?.title || params.title;
      if (shown.terminal?.executionHostId) record.executionHostId = shown.terminal.executionHostId;
      if (!record.briefAccepted) record.warning = "Agent created, but Orca did not confirm role briefing delivery. Inspect its tab.";
    } catch (error) {
      if (record.handle) record.warning = error.message.slice(0, 1e3);
      else record.error = error.message.slice(0, 1e3);
    }
    if (record.handle) record.status = "created";
    await set(key, record);
  }
  return {
    async execute({ op, params = {}, workspaceId } = {}) {
      if (op === "context") return context(workspaceId);
      if (op === "load") {
        const state = validateState(await get(KEY));
        for (const team of state.teams) if (team.launch?.native) for (const member of team.members) {
          const receipt = await get(`launch:${team.id}-${member.id}`);
          if (receipt?.handle) team.launch.members[member.id] = { status: "created", terminalId: receipt.handle, title: receipt.title, briefAccepted: receipt.briefAccepted, executionHostId: receipt.executionHostId ?? null, ...receipt.status === "naming" ? { error: "Tab created; naming observation was interrupted. Inspect that tab." } : receipt.warning ? { error: receipt.warning } : {} };
        }
        return { value: validateState(state) };
      }
      if (op === "save") {
        await set(KEY, validateState(params.value));
        return { ok: true };
      }
      if (op === "start") return start(params, workspaceId);
      if (op === "receipt") {
        if (!/^[a-zA-Z0-9-]{1,120}$/.test(params.requestId)) throw new Error("Invalid request identity.");
        return get(`launch:${params.requestId}`);
      }
      throw new Error("Unknown team operation.");
    },
    async settle() {
      await Promise.allSettled([...jobs]);
    }
  };
}

// src/worker.mjs
function activate(orca) {
  let ready;
  let initialising = false;
  const executorPromise = locateCli().then((command) => createExecutor(orca.host, createCliRunner(command)));
  const initialise = () => {
    if (ready) return ready;
    initialising = true;
    ready = Promise.resolve().then(async () => {
      await orca.host.call("storage.get", { key: "team-definitions-v1" });
      const report = await bootstrap({ version: "0.1.05" });
      orca.log(report.detail);
      return report;
    }).catch((error) => {
      ready = null;
      if (/not enabled|current consent|no longer approved/i.test(error.message)) throw new Error("Orca denied the local worker permission check. Let any plugin refresh finish, then retry Initialise local adapter. If Orca marks Team Orchestrator as needing review, review and enable it in Settings > Plugins.");
      throw error;
    }).finally(() => {
      initialising = false;
    });
    return ready;
  };
  orca.commands.register("team.initialise", async () => {
    if (!initialising) ready = null;
    return initialise();
  });
  orca.commands.register("team.control", async (args) => {
    const report = await initialise();
    if (!report.ready) throw new Error(report.detail);
    if (!args || args.op === "ping") return { nonce: args?.nonce, ...report, workerPid: process.pid };
    return (await executorPromise).execute(args);
  });
  for (const event of ["worktree.created", "agent.status.changed"]) orca.events.on(event, () => initialise());
  initialise().catch((error) => orca.log(`Bootstrap failed: ${error.message}`));
  executorPromise.catch((error) => orca.log(`Executor unavailable: ${error.message}`));
}
export {
  activate as default
};
