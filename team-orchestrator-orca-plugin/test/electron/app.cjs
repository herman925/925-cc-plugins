// Separate Electron host, genuine renderer IPC. No real Orca session/provider is used.
const { app, ipcMain, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
app.setName('Orca');
app.setPath('appData', __dirname + '/redirected-app-data');
app.setPath('userData', __dirname + '/redirected-runtime-profile');
const KEY = 'herman925.team-orchestrator';
const data = new Map(); const leases = new Map(); const pending = new Map();
let child; let nextId = 0; let enabled = true; let admitted = true; let start;
const mainFrame = event => assert.equal(event.senderFrame, event.sender.mainFrame, 'must preserve genuine main-frame IPC');
function startWorker() {
  return start ??= new Promise((resolve, reject) => {
    child = fork(__dirname + '/out/main/plugin-host-entry.cjs', [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.once('error', reject);
    child.on('message', message => {
      if (message.type === 'ready') { assert.deepEqual(message.commands.sort(), ['team.control', 'team.initialise']); resolve(); }
      else if (message.type === 'host') {
        try {
          if (!enabled) throw Error('plugin is not enabled with current consent');
          const { key, value } = message.params;
          let result;
          if (message.method === 'storage.get') result = { value: data.get(key) ?? null };
          else if (message.method === 'storage.set') { data.set(key, value); result = { ok: true }; }
          else throw Error('Unknown host method');
          child.send({ type: 'hostResult', id: message.id, value: result });
        } catch (error) { child.send({ type: 'hostResult', id: message.id, error: error.message }); }
      } else if (message.type === 'result') {
        const request = pending.get(message.id); pending.delete(message.id);
        if (message.error) request?.reject(Error(message.error)); else request?.resolve(message.value);
      } else if (message.type === 'fatal') reject(Error(message.error));
    });
  });
}
const runtimeReads = [], launched = new Map();
function savedOperation(nativeId) {
  const db = new DatabaseSync(join(app.getPath('userData'), 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'), { readOnly: true });
  try { const row = db.prepare("SELECT json FROM receipts WHERE id LIKE 'operation:%' AND json_extract(json,'$.nativeRequest.operationId')=?").get(nativeId); return row && JSON.parse(row.json); } finally { db.close(); }
}
ipcMain.handle('runtime:call', async (event, { method, params }) => {
  mainFrame(event); runtimeReads.push({ method, params });
  let result;
  if (method === 'status.get') result = { runtimeId: 'fixture-runtime', capabilities: ['agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1', 'agent-session.structured.registered-agents.v1'] };
  else if (method === 'settings.get') result = { settings: { agentDefaultEnv: { codex: { SECRET: 'must-not-leak' } } } };
  else if (method === 'ssh.getState') result = { state: { status: 'connected', connectionGeneration: 1 } };
  else if (method === 'preflight.detectRemoteAgents') result = ['codex', 'claude'];
  else if (method === 'agentSession.agents') result = { agents: [] };
  else if (method === 'agentSession.createSupport') result = { supported: false, reason: 'remote' };
  else if (method === 'agent.launchReplay') {
    const operation = savedOperation(params.operationId);
    assert.equal(operation.status, 'unknown', 'intent must commit before native launch');
    assert.equal(operation.roleVersion > 0, true); assert.equal(Object.hasOwn(params, 'agentArgs'), false);
    if (launched.has(params.operationId)) result = launched.get(params.operationId);
    else {
      const n = launched.size + 1, kind = n === 1 ? 'terminal' : 'structured';
      result = { worktreeId: 'repo::/remote/project', outcome: kind === 'terminal' ? { kind, handle: 'fixture-terminal', paneKey: 'fixture-tab:fixture-leaf' } : { kind, handle: 'fixture-chat', sessionId: 'codex:fixture-chat', tabId: 'chat-tab' }, receipt: { mode: kind, preferred: kind, reason: 'user_default', detail: 'Fixture native choice' }, prompt: { delivery: 'submit', outcome: kind === 'terminal' ? 'handed-to-terminal' : 'journaled', ...(kind === 'structured' ? { messageId: 'fixture-message' } : {}) } };
      launched.set(params.operationId, result);
    }
    const { nativeLaunchFingerprint } = await import(process.env.ORCA_TEST_PLUGIN + '/src/local/native-launch-ledger.mjs');
    const db = new DatabaseSync(join(app.getPath('userData'), 'agent-session-journal.db'));
    db.exec('PRAGMA user_version=4; CREATE TABLE IF NOT EXISTS agent_session_operations (operation_key TEXT PRIMARY KEY,row_json TEXT NOT NULL)');
    db.prepare('INSERT OR REPLACE INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${params.operationId}`, JSON.stringify({ callerKey: 'trusted-local:desktop', operationId: params.operationId, fingerprint: nativeLaunchFingerprint(params), operationTimestamp: Number(params.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 86400000, outcome: { status: 'succeeded', sessionId: result.outcome.sessionId ?? '', launch: result } })); db.close();
  } else if (method === 'terminal.show') result = { terminal: { handle: 'fixture-terminal', worktreeId: 'repo::/remote/project', executionHostId: 'ssh:fixture', tabId: 'fixture-tab', leafId: 'fixture-leaf' } };
  else if (method === 'terminal.rename') { const nativeId = [...launched.keys()][0]; assert.equal(savedOperation(nativeId).status, 'created', 'identity commit must precede rename'); result = { rename: { handle: params.terminal, tabId: 'fixture-tab', title: params.title } }; }
  else if (method === 'terminal.agentStatus') result = { agentStatus: { handle: params.terminal, isRunningAgent: true, status: 'permission' } };
  else if (method === 'terminal.focus') result = { focus: { handle: params.terminal } };
  else if (method === 'orchestration.sessionAddress') result = { orcaSessionId: 'orca_session_id:fixture-chat' };
  else if (method === 'orchestration.partyLocation') result = { location: { kind: 'chat', sessionId: 'codex:fixture-chat', worktreeId: 'repo::/remote/project' } };
  else if (method === 'agentSession.reveal') result = { ok: true, sessionId: params.sessionId, workspaceId: 'repo::/remote/project', agent: 'codex', readable: true };
  else throw Error('Unexpected runtime read ' + method);
  return { id: 'desktop-ipc', ok: true, result };
});
ipcMain.handle('session:get', async event => { mainFrame(event); return { activeWorktreeId: 'repo::/remote/project' }; });
ipcMain.handle('plugins:readPanelEntry', async (event, args) => {
  mainFrame(event); assert.equal(args.pluginKey, KEY); assert.equal(args.panelId, 'team');
  if (!enabled) throw Error('Consent required');
  const sessionToken = 'panel-' + event.sender.id; leases.set(sessionToken, event.sender.id); return { sessionToken };
});
ipcMain.handle('plugins:panelAction', async (event, args) => {
  mainFrame(event);
  if (!enabled || leases.get(args.sessionToken) !== event.sender.id) return { ok: false, code: 'consent_required' };
  if (!admitted) return { ok: false, code: 'rate_limited' };
  if (Object.keys(args.params || {}).length) return { ok: false, code: 'invalid_params' };
  return { ok: true, value: { displayName: 'Remote', terminals: [] } };
});
ipcMain.handle('plugins:invokeCommand', async (event, args) => {
  mainFrame(event); assert.equal(args.pluginKey, KEY);
  if (!enabled) throw Error('Consent revoked');
  if (!['team.control', 'team.initialise'].includes(args.commandId)) throw Error('Undeclared command');
  await startWorker();
  return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); child.send({ type: 'command', id, commandId: args.commandId, args: args.args }); });
});
ipcMain.handle('plugins:setEnabled', async (event, args) => { mainFrame(event); enabled = args.enabled; return []; });
ipcMain.handle('plugins:remove', async event => { mainFrame(event); enabled = false; return []; });
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { preload: __dirname + '/preload.cjs', contextIsolation: true, sandbox: false, nodeIntegrationInSubFrames: true } });
  await window.loadFile(__dirname + '/index.html');
  const ipc = (channel, args, frame = window.webContents.mainFrame) => frame.executeJavaScript(`window.fixture.invoke(${JSON.stringify(channel)},${JSON.stringify(args)})`);
  const watchdog = setTimeout(() => { console.error('Electron proof timed out'); child?.kill(); app.exit(1); }, 40000);
  try {
    const entry = await ipc('plugins:readPanelEntry', { pluginKey: KEY, panelId: 'team' });
    assert.equal(child, undefined, 'panel load must not imply worker activation');
    const envelope = (commandId = 'team.control', op = 'ping', sessionToken = entry.sessionToken) => ({ sessionToken, action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'panel-nonce', commandId, args: { op } } } });
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'invalid_params');
    const init = await ipc('plugins:invokeCommand', { pluginKey: KEY, commandId: 'team.initialise' });
    assert.equal(init.ready, true, JSON.stringify(init)); assert.equal(init.cliPaths, undefined);
    const firstHandler = ipcMain._invokeHandlers.get('plugins:panelAction');
    const ping = await ipc('plugins:panelAction', envelope());
    assert.equal(ping.value.nonce, 'panel-nonce'); assert.equal(ping.value.workerPid, child.pid);
    assert.equal(ping.value.cliPaths, undefined); assert.equal(ping.value.liveProviderVerified, false);
    const control = async (op, params) => {
      const request = envelope('team.control', op); request.params.teamWorker.args.params = params;
      const result = await ipc('plugins:panelAction', request);
      assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
    };
    const selection = await control('context', {});
    assert.equal(selection.executionHostId, 'ssh:fixture'); assert.equal(selection.kind, 'git');
    const form = { name: 'Saved-Team', structure: 'team', levels: 2, fan: 3, groups: '', purpose: '', agents: ['codex','codex','codex'], models: ['default','default','default'], efforts: ['default','default','default'] };
    const create = { requestId: 'electron-create', expectedRevision: 0, selectionToken: selection.selectionToken, form };
    const saved = (await control('createTeam', create)).value;
    assert.equal(saved.teams.length, 1); assert.equal(saved.teams[0].launch, undefined);
    assert.equal(JSON.stringify(saved).includes('/remote/project'), false);
    assert.equal(readFileSync(__dirname + '/cli-calls.jsonl','utf8').trim().split('\n').map(JSON.parse).every(args => args[0] === 'worktree'), true, 'save must not launch');
    let edited = (await control('updateRole', { requestId: 'electron-role', expectedRevision: 1, teamId: saved.teams[0].id, memberId: saved.teams[0].members[0].id, brief: 'Review evidence', habits: 'Read results first', collaboration: 'Escalate blockers' })).value;
    assert.equal(edited.teams[0].members[0].roleVersion, 2);
    const capabilities = await control('capabilities', { teamId: saved.teams[0].id });
    assert.equal(capabilities.executionHostId, 'ssh:fixture');
    assert.equal(capabilities.agents.codex.availability, 'detected');
    assert.equal(capabilities.agents.codex.catalogStatus, 'unknown');
    assert.equal(JSON.stringify(capabilities).includes('must-not-leak'), false);
    assert.equal(runtimeReads.find(row => row.method === 'preflight.detectRemoteAgents').params.connectionId, 'fixture');
    assert.equal(runtimeReads.some(row => row.method === 'agentSession.modelCatalog'), false);
    assert.equal((await ipc('plugins:panelAction', envelope('team.control', '_capabilityResult'))).code, 'invalid_params');
    await assert.rejects(ipc('plugins:invokeCommand', { pluginKey: KEY, commandId: 'team.control', args: { op: '_capabilityResult', internalKey: 'forged', params: {} } }), /authority/);

    const exported = await control('exportTemplate', { teamId: saved.teams[0].id });
    assert.equal(JSON.stringify(exported.template).includes(saved.teams[0].id), false);
    const preview = await control('previewTemplate', { template: exported.template });
    const importRequest = { requestId: 'electron-import', expectedRevision: edited.revision, template: preview.template, previewToken: preview.previewToken, selectionToken: selection.selectionToken };
    edited = (await control('importTemplate', importRequest)).value;
    assert.equal(edited.teams.length, 2); assert.notEqual(edited.teams[0].id, edited.teams[1].id);
    assert.equal(edited.teams[1].members[0].brief, 'Review evidence');
    assert.equal(edited.teams[1].members[0].roleVersion, 1); assert.equal(edited.teams[1].launch, undefined);
    const imported = edited;
    const launchInputs = edited.teams.map((team, index) => ({ requestId: `electron-launch-${index}`, teamId: team.id, memberId: team.members[0].id, configVersion: team.configVersion }));
    const first = await control('launchSupervisor', launchInputs[0]);
    assert.equal(first.kind, 'terminal'); assert.equal(first.observation.state, 'permission');
    const second = await control('launchSupervisor', launchInputs[1]);
    assert.equal(second.kind, 'structured'); assert.equal(second.prompt.outcome, 'journaled'); assert.equal(second.observation.state, 'unknown');
    for (const input of launchInputs) { const { configVersion, ...binding } = input; assert.equal((await control('openMember', binding)).opened, true); }
    assert.equal(launched.size, 2);
    assert.equal((await control('launchSupervisor', launchInputs[0])).handle, first.handle); assert.equal(launched.size, 2);
    assert.equal(runtimeReads.filter(row => row.method === 'terminal.rename').length, 1, 'structured rename must not use terminal methods');
    edited = (await control('load', {})).value;

    assert.equal((await ipc('plugins:panelAction', envelope('foreign.command'))).code, 'invalid_params');
    assert.equal((await ipc('plugins:panelAction', envelope('team.control', 'arbitrary.runtime'))).code, 'invalid_params');
    assert.equal((await ipc('plugins:panelAction', envelope('team.control', 'ping', 'foreign-token'))).code, 'invalid_request');
    const subframe = window.webContents.mainFrame.frames[0];
    assert.equal((await ipc('plugins:panelAction', envelope(), subframe)).code, 'invalid_request');
    admitted = false;
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'rate_limited'); admitted = true;
    enabled = false;
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'consent_required'); enabled = true;
    await new Promise(resolve => setTimeout(resolve, 800));
    const retry = await ipc('plugins:panelAction', envelope('team.initialise'));
    assert.equal(retry.value.reused, true); assert.equal(ipcMain._invokeHandlers.get('plugins:panelAction'), firstHandler);
    assert.deepEqual((await control('load', {})).value, edited);
    // Recycle only this isolated fixture worker: real SQLite persists, old KV is untouched.
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    start = undefined;
    assert.deepEqual((await control('load', {})).value, edited);
    assert.deepEqual((await control('createTeam', create)).value, saved, 'recover completed save after worker restart');
    assert.deepEqual((await control('importTemplate', importRequest)).value, imported, 'recover completed import after worker restart');
    assert.deepEqual((await control('load', {})).value, edited, 'replay never overwrites the latest snapshot');
    assert.equal((await control('launchSupervisor', launchInputs[0])).handle, first.handle);
    assert.equal(launched.size, 2, 'worker restart cannot relaunch a bound member');
    assert.equal(data.size, 0, 'new format must not write legacy KV');
    await new Promise(resolve => setTimeout(resolve, 800));
    let inspectorOpen = true;
    try { await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(500) }); } catch { inspectorOpen = false; }
    assert.equal(inspectorOpen, false, 'temporary inspector must close');
    await ipc('plugins:setEnabled', { pluginKey: KEY, enabled: false });
    assert.notEqual(ipcMain._invokeHandlers.get('plugins:panelAction'), firstHandler);
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'consent_required');
    console.log('REAL_ELECTRON_WORKER_PASS: genuine main-frame native launch/structured reveal/terminal focus, durable intent-before-effect and identity-before-naming, exactly two supervisor sessions, authenticated runtime capability reads, SQLite save/role/template-copy/restart/replay with confirmed SSH scope, lazy activation, nonce, exact fixture build, retry without duplicate wrappers, foreign command/token/subframe denial, live consent/admission gates, inspector cleanup and disable restoration. Fixture metadata mirrors the pinned build; this is not actual Orca/provider acceptance.');
    clearTimeout(watchdog); child.kill(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); child?.kill(); app.exit(1); }
});
