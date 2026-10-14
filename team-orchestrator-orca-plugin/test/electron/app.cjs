// Separate Electron host fixture. Its CLI records launches; it never starts coding agents.
const { app, ipcMain, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const { readFileSync } = require('node:fs');
const assert = require('node:assert/strict');
app.setName('Orca');
const data = new Map(); const leases = new Map(); const pending = new Map();
let child; let nextId = 0; let enabled = true; let refreshes = 0;
const invoke = (commandId, args) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject }); child.send({ type: 'command', id, commandId, args });
});
ipcMain.handle('session:get', async () => ({ activeWorktreeId: 'repo::/remote/project' }));
ipcMain.handle('plugins:readPanelEntry', async (event) => {
  const sessionToken = 'panel-' + event.sender.id; leases.set(sessionToken, event.sender.id); return { sessionToken, html: '<div>fixture</div>' };
});
ipcMain.handle('plugins:panelAction', async (event, args) => {
  if (!enabled || leases.get(args.sessionToken) !== event.sender.id) return { ok: false, code: 'consent_required' };
  if (Object.keys(args.params || {}).length) return { ok: false, code: 'invalid_params', error: 'Stock readContext forbids params' };
  return { ok: true, value: { displayName: 'Remote', terminals: [] } };
});
ipcMain.handle('plugins:invokeCommand', async (_, args) => {
  assert.equal(args.pluginKey, 'herman925.team-orchestrator'); if (!enabled) throw Error('Consent revoked'); return invoke(args.commandId, args.args);
});
ipcMain.handle('plugins:refresh', async () => {
  refreshes++; enabled = false;
  await new Promise(resolve => setTimeout(resolve, 100)); enabled = true;
  return [];
});
ipcMain.handle('plugins:setEnabled', async (_, args) => { enabled = args.enabled; return []; });
ipcMain.handle('plugins:remove', async () => { enabled = false; return []; });
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false });
  const event = { sender: window.webContents };
  // The user's panel already exists when the worker starts. Keep that exact token.
  const entry = await ipcMain._invokeHandlers.get('plugins:readPanelEntry')(event, { pluginKey: 'herman925.team-orchestrator', panelId: 'team' });
  const watchdog = setTimeout(() => { console.error('Electron proof timed out'); child?.kill(); app.exit(1); }, 35000);
  child = fork(__dirname + '/out/main/plugin-host-entry.cjs', [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
  child.on('message', message => {
    if (message.type === 'host') {
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
    } else if (message.type === 'fatal') { console.error(message.error); app.exit(1); }
  });
  try {
    const ready = await new Promise((resolve, reject) => { child.on('message', m => { if (m.type === 'ready') resolve(m); }); child.once('error', reject); });
    assert.deepEqual(ready.commands.sort(), ['team.control', 'team.initialise']);
    const init = await invoke('team.control', { op: 'ping', nonce: 'initial' });
    assert.equal(init.ready, true); assert.equal(init.platform, process.platform);
    const rpc = async (op, params = {}) => {
      const result = await ipcMain._invokeHandlers.get('plugins:panelAction')(event, { sessionToken: entry.sessionToken, action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'panel-nonce', commandId: 'team.control', args: { op, params } } } });
      if (!result.ok) throw Error(result.error || result.code); return result.value;
    };
    const ping = await rpc('ping'); assert.equal(ping.nonce, 'panel-nonce'); assert.equal(ping.workerPid, child.pid);
    const context = await rpc('context'); assert.equal(context.displayName, 'Remote workspace'); assert.equal(context.selector, undefined);
    const handles = [];
    for (const name of ['Head', 'Worker-1', 'Worker-2', 'Worker-3']) {
      const requestId = 'squad-' + name;
      const params = { requestId, workspaceKey: context.workspaceKey, agent: 'codex', title: 'Squad/' + name, brief: 'You are ' + name + '. Exactly 4 members; no extra CEO.' };
      assert.equal((await rpc('start', params)).status, 'starting');
      let receipt;
      for (let i = 0; i < 100; i++) { receipt = await rpc('receipt', { requestId }); if (receipt?.status === 'created' || receipt?.status === 'unknown') break; await new Promise(r => setTimeout(r, 30)); }
      assert.equal(receipt.status, 'created'); assert.equal(receipt.title, params.title); assert.equal(receipt.briefAccepted, true); handles.push(receipt.handle);
      await rpc('start', params); // Receipt replay must never create a fifth process.
    }
    const calls = readFileSync(__dirname + '/cli-calls.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
    const creates = calls.filter(args => args[0] === 'terminal' && args[1] === 'create');
    assert.equal(creates.length, 4); assert.equal(new Set(handles).size, 4);
    assert.deepEqual(creates.map(args => args[args.indexOf('--title') + 1]), ['Squad/Head', 'Squad/Worker-1', 'Squad/Worker-2', 'Squad/Worker-3']);
    assert.ok(creates.every(args => args.includes('id:repo::/remote/project') && args[args.indexOf('--command') + 1].includes('codex')));
    assert.ok(calls.every(args => args[1] !== 'send'));
    await new Promise(r => setTimeout(r, 800));
    let inspectorOpen = true;
    try { await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(500) }); } catch { inspectorOpen = false; }
    assert.equal(inspectorOpen, false, 'temporary inspector must close');
    assert.equal(refreshes, 0, 'bootstrap must not invalidate host authority with a self-refresh');
    await ipcMain._invokeHandlers.get('plugins:setEnabled')(event, { pluginKey: 'herman925.team-orchestrator', enabled: false });
    assert.equal((await rpc('ping').catch(error => ({ error: error.message }))).error, 'consent_required');
    console.log('REAL_ELECTRON_WORKER_PASS: automatic injection, own worker nonce, desktop workspace, four named launch receipts, replay fencing, inspector cleanup and disable. CLI execution is a fixture.');
    clearTimeout(watchdog); child.kill(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); child.kill(); app.exit(1); }
});
