// Separate Electron host, genuine renderer IPC. No real Orca session/provider is used.
const { app, ipcMain, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
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
    await new Promise(resolve => setTimeout(resolve, 800));
    let inspectorOpen = true;
    try { await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(500) }); } catch { inspectorOpen = false; }
    assert.equal(inspectorOpen, false, 'temporary inspector must close');
    await ipc('plugins:setEnabled', { pluginKey: KEY, enabled: false });
    assert.notEqual(ipcMain._invokeHandlers.get('plugins:panelAction'), firstHandler);
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'consent_required');
    console.log('REAL_ELECTRON_WORKER_PASS: genuine main-frame IPC, lazy activation, nonce, exact fixture build, retry without duplicate wrappers, foreign command/token/subframe denial, live consent/admission gates, inspector cleanup and disable restoration. Fixture metadata mirrors the pinned build; this is not actual Orca/provider acceptance.');
    clearTimeout(watchdog); child.kill(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); child?.kill(); app.exit(1); }
});
