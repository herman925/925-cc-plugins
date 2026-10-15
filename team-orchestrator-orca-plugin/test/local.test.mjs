import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectorFuse, packageType } from '../src/local/bootstrap.mjs';
import { installAdapter } from '../src/local/adapter.mjs';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
import { memberLaunch } from '../src/launch.mjs';
import { createExecutor } from '../src/local/executor.mjs';
import { startupCommand } from '../src/local/startup-command.mjs';
import { createCliRunner, locateCli, cliEnvironment } from '../src/local/cli.mjs';
import { createWorkerBridge } from '../src/worker-bridge.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
test('inspector fuse refuses disabled, absent, truncated and mixed architecture executables', () => {
  const sentinel = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
  const yes = Buffer.concat([sentinel, Buffer.from([1, 4, 49, 49, 49, 49])]);
  const no = Buffer.concat([sentinel, Buffer.from([1, 4, 49, 49, 49, 48])]);
  assert.equal(inspectorFuse(yes), true);
  for (const bytes of [Buffer.alloc(5), no, yes.subarray(0, -1), Buffer.concat([yes, no])]) assert.equal(inspectorFuse(bytes), false);
  assert.equal(packageType('darwin', '/Applications/Orca.app/Contents/MacOS/Orca', ''), 'macOS app bundle');
  assert.equal(packageType('win32', 'C:\\Orca.exe', 'C:\\app.asar.unpacked\\out\\main\\entry.js'), 'Windows installed app');
  assert.equal(packageType('linux', '/tmp/.mount_Orca/Orca', ''), 'Linux AppImage');
});
test('adapter binds only its panel, preserves consent/owner gates, captures desktop selection and restores handlers', async () => {
  globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore();
  const handlers = new Map(); const commands = []; let enabled = true;
  const ipcMain = { _invokeHandlers: handlers, handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
  handlers.set('plugins:readPanelEntry', async () => ({ sessionToken: 'token' }));
  handlers.set('plugins:panelAction', async (_, call) => enabled ? { ok: true, value: call.params } : { ok: false, code: 'consent_required' });
  handlers.set('plugins:invokeCommand', async (_, args) => { commands.push(args); return { nonce: args.args.nonce }; });
  handlers.set('plugins:setEnabled', async (_, args) => { enabled = args.enabled; });
  handlers.set('session:get', async () => ({ activeWorktreeId: 'repo::/server/project' }));
  const mainFrame = {}; const original = handlers.get('plugins:panelAction'); const event = { sender: { id: 7, mainFrame }, senderFrame: mainFrame };
  const options = { version: 'test', identity: 'test-digest' };
  assert.equal((await installAdapter({ ipcMain }, options)).ready, true);
  assert.equal((await installAdapter({ ipcMain }, options)).reused, true);
  const action = (sender = event, commandId = 'team.control', op = 'context') => handlers.get('plugins:panelAction')(sender, { sessionToken: 'token', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, commandId, nonce: 'nonce', args: { op, workspaceId: 'forged' } } } });
  assert.equal((await action({ ...event, senderFrame: {} })).ok, false);
  await handlers.get('plugins:readPanelEntry')(event, { pluginKey: 'foreign.plugin', panelId: 'team' });
  assert.equal((await action({ ...event, senderFrame: {} })).ok, false);
  await handlers.get('plugins:readPanelEntry')(event, { pluginKey: 'herman925.team-orchestrator', panelId: 'team' });
  assert.equal((await action()).value.nonce, 'nonce');
  assert.equal(commands[0].args.workspaceId, 'repo::/server/project');
  assert.equal(commands[0].pluginKey, 'herman925.team-orchestrator');
  assert.equal((await action({ sender: { id: 8 } })).ok, false);
  assert.equal((await action(event, 'foreign.command')).ok, false);
  assert.equal((await action(event, 'team.control', 'arbitrary.runtime')).ok, false);
  assert.equal((await action({ ...event, senderFrame: {} })).ok, false);
  enabled = false; assert.equal((await action()).code, 'consent_required');
  assert.equal(commands.length, 1);
  await handlers.get('plugins:setEnabled')(event, { pluginKey: 'herman925.team-orchestrator', enabled: false });
  assert.equal(handlers.get('plugins:panelAction'), original);
});
test('POSIX startup quoting keeps hostile text in one inert prompt argument and detects Windows quoting', () => {
  const brief = 'quote \' " `danger` $(touch /tmp/should-never-exist) ; $HOME';
  const command = startupCommand({ agent: 'codex', model: 'test', brief });
  const replaced = command.replace(/^'codex'/, "printf '%s\\n'");
  const output = execFileSync('/bin/sh', ['-c', replaced], { encoding: 'utf8' });
  assert.equal(output.trim().split('\n').at(-1), brief);
  assert.match(startupCommand({ agent: 'claude', brief: "a'b" }, 'powershell'), /^& 'claude' '--' 'a''b'$/);
  assert.throws(() => startupCommand({ agent: 'claude', effort: 'xhigh', brief: 'b' }), /xhigh/);
});
test('CLI locates its installed entry and keeps newline prompt argv without shell execution; nonzero JSON errors remain readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-cli-test-'));
  try {
    await mkdir(join(root, 'out/main'), { recursive: true }); await mkdir(join(root, 'out/cli'));
    await writeFile(join(root, 'out/cli/index.js'), `const args=process.argv.slice(2);if(args[0]==='fail'){console.log(JSON.stringify({ok:false,error:{message:'permission denied'}}));process.exit(1)}console.log(JSON.stringify({ok:true,result:args}));`);
    const run = createCliRunner(await locateCli(join(root, 'out/main/plugin-host-entry.js'), process.execPath));
    assert.deepEqual(await run(['prompt', 'two\nlines $(nothing)']), ['prompt', 'two\nlines $(nothing)', '--json']);
    await assert.rejects(run(['fail']), /permission denied/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('worker bridge verifies nonce and sends one supervisor operation without retrying uncertain transport', async () => {
  const calls = [];
  const bridge = createWorkerBridge(async (_, { teamWorker: message }) => {
    calls.push(message.args.op);
    if (message.args.op === 'ping') return { nonce: message.nonce, ready: true, platform: 'darwin', workerPid: 7 };
    throw Error('unknown transport');
  }, { nonce: () => 'nonce', spacingMs: 0 });
  await bridge.connect();
  await assert.rejects(bridge.call('launchSupervisor', { requestId: 'id' }), /unknown transport/);
  assert.deepEqual(calls, ['ping', 'launchSupervisor']);
  const bad = createWorkerBridge(async () => ({ ready: true, platform: 'linux', workerPid: 7 }), { nonce: () => 'nonce', spacingMs: 0 });
  await assert.rejects(bad.connect(), /not verified/);
});

test('adapter binds an already open panel without triggering the refresh that revokes worker calls', async () => {
  globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore();
  let refreshes = 0; let invocations = 0;
  const handlers = new Map();
  const ipcMain = { _invokeHandlers: handlers, handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
  const mainFrame = {}; const sender = { id: 55, mainFrame, isDestroyed: () => false };
  handlers.set('plugins:readPanelEntry', async (event, args) => {
    assert.equal(event.senderFrame, mainFrame); assert.equal(event.sender, sender); assert.equal(args.pluginKey, 'herman925.team-orchestrator');
    return { sessionToken: 'already-open-token' };
  });
  handlers.set('plugins:panelAction', async (_, args) => { assert.deepEqual(args.params, {}); return { ok: true }; });
  handlers.set('plugins:invokeCommand', async (_, args) => { invocations++; return { nonce: args.args.nonce }; });
  handlers.set('plugins:refresh', async () => { refreshes++; throw Error('plugin is not enabled with current consent'); });
  const electron = { ipcMain, BrowserWindow: { getAllWindows: () => [{ webContents: sender }] } };
  await installAdapter(electron, { version: 'test', identity: 'open-panel-regression' });
  const result = await handlers.get('plugins:panelAction')({ sender, senderFrame: mainFrame }, { sessionToken: 'already-open-token', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'existing-panel', commandId: 'team.control', args: { op: 'ping' } } } });
  assert.equal(result.value.nonce, 'existing-panel'); assert.equal(invocations, 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(refreshes, 0);
  globalThis[Symbol.for('herman925.team-orchestrator.adapter')].restore();
});

test('Windows CLI environment restores actual redirected data paths without guessing a USERPROFILE directory', () => {
  const scrubbed = { USERPROFILE: 'C:\\Users\\Herman', PATH: 'agent-path', ELECTRON_RUN_AS_NODE: '1' };
  const paths = { appData: 'D:\\Redirected\\Roaming', userData: 'E:\\Orca Profiles\\active' };
  const env = cliEnvironment(paths, scrubbed, 'win32');
  assert.equal(env.APPDATA, paths.appData); assert.equal(env.ORCA_USER_DATA_PATH, paths.userData);
  assert.equal(scrubbed.APPDATA, undefined); assert.equal(scrubbed.ORCA_USER_DATA_PATH, undefined);
  assert.equal(env.PATH, scrubbed.PATH);
  const mixedCase = cliEnvironment(paths, { ...scrubbed, AppData: 'wrong', orca_user_data_path: 'another-instance' }, 'win32');
  assert.equal(mixedCase.AppData, undefined); assert.equal(mixedCase.orca_user_data_path, undefined);
  assert.equal(mixedCase.APPDATA, paths.appData);
  assert.throws(() => cliEnvironment({ userData: '', appData: 'x' }, scrubbed, 'win32'), /runtime data paths/);
  assert.throws(() => cliEnvironment({ userData: 'x', appData: 'bad\0path' }, scrubbed, 'win32'), /runtime data paths/);
  assert.equal(cliEnvironment(paths, { XDG_CONFIG_HOME: '/custom-config' }, 'linux').ORCA_USER_DATA_PATH, paths.userData);
});

test('child CLI resolves the exact desktop runtime profile when worker APPDATA is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-env-regression-'));
  try {
    await mkdir(join(root, 'out/main'), { recursive: true }); await mkdir(join(root, 'out/cli'));
    await writeFile(join(root, 'out/cli/index.js'), `const profile=process.env.ORCA_USER_DATA_PATH;if(!profile){console.log(JSON.stringify({ok:false,error:{message:'APPDATA is not set, so the Orca runtime metadata path cannot be resolved.'}}));process.exit(1)}console.log(JSON.stringify({ok:true,result:{profile}}));`);
    const paths = { appData: join(root, 'redirected-roaming'), userData: join(root, 'separate-profile') };
    const command = await locateCli(join(root, 'out/main/plugin-host-entry.js'), process.execPath, paths);
    delete command.env.APPDATA;
    assert.equal((await createCliRunner(command)(['worktree', 'show'])).profile, paths.userData);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bootstrap resolves macOS framework fuses and reports missing/disabled files before debugger activation', async () => {
  const { bootstrap } = await import('../src/local/bootstrap.mjs');
  const root = await mkdtemp(join(tmpdir(), 'orca-fuse-'));
  try {
    const executable = join(root, 'Orca.app/Contents/MacOS/Orca');
    const framework = join(root, 'Orca.app/Contents/Frameworks/Electron Framework.framework/Electron Framework');
    await mkdir(join(root, 'Orca.app/Contents/MacOS'), { recursive: true });
    await writeFile(executable, 'launcher');
    const options = { executable, platform: 'darwin', parentPid: 98765, activate: async () => { throw Error('activation reached'); } };
    assert.equal((await bootstrap(options)).code, 'fuse_file_missing');
    await mkdir(join(root, 'Orca.app/Contents/Frameworks/Electron Framework.framework'), { recursive: true });
    await writeFile(framework, Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 4, 49, 49, 49, 48])]));
    assert.equal((await bootstrap(options)).code, 'fuse_disabled');
    assert.equal((await bootstrap({ ...options, executable: join(root, 'Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper') })).code, 'fuse_disabled');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('runtime contract admits only the pinned build and capabilities, explicitly refuses unverified Windows', async () => {
  const { validateRuntime } = await import('../src/local/runtime-contract.mjs');
  const observed = { appName: 'Orca', appVersion: '1.4.222', platform: 'darwin', arch: 'arm64', electron: '43.7.5', node: '24.21.0', sqlite: true, build: { buildId: '1.4.222-9fdd90ffa7721e145f1353ad9fb9df2f70c31f43-arm64', version: '1.4.222', commit: '9fdd90ffa7721e145f1353ad9fb9df2f70c31f43', platform: 'darwin', architecture: 'arm64' } };
  assert.equal(validateRuntime(observed).verification, 'pinned-contract');
  assert.throws(() => validateRuntime({ ...observed, appVersion: '1.4.223' }), /Unsupported.*build/);
  assert.throws(() => validateRuntime({ ...observed, platform: 'win32' }), /Windows.*unverified/);
  assert.throws(() => validateRuntime({ ...observed, sqlite: false }), /SQLite/);
  assert.throws(() => validateRuntime({ ...observed, build: null }), /build/);
});

test('connection reports worker activation separately from an unavailable adapter and retries its own initialisation command', async () => {
  const calls = [];
  const bridge = createWorkerBridge(async (_, { teamWorker: message }) => {
    calls.push(message.commandId);
    if (message.commandId === 'team.initialise') return { ready: false };
    return { nonce: message.nonce, ready: false, workerPid: 123, platform: 'darwin', code: 'unsupported_build', detail: 'Unsupported Orca build.' };
  }, { nonce: () => 'n', spacingMs: 0 });
  await assert.rejects(bridge.connect({ retry: true }), error => error.report?.workerPid === 123 && error.message === 'Unsupported Orca build.');
  assert.deepEqual(calls, ['team.initialise', 'team.control']);
});

test('bootstrap refuses an occupied non-inspector port without activating any process', async () => {
  const { bootstrap } = await import('../src/local/bootstrap.mjs');
  const { createServer } = await import('node:http');
  const server = createServer((_, response) => { response.end('not an inspector'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const root = await mkdtemp(join(tmpdir(), 'orca-port-'));
  try {
    const executable = join(root, 'Orca.exe');
    await writeFile(executable, Buffer.concat([Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'), Buffer.from([1, 4, 49, 49, 49, 49])]));
    let activated = false;
    const report = await bootstrap({ platform: 'win32', executable, parentPid: 98765, port: server.address().port, activate: async () => { activated = true; } });
    assert.equal(report.code, 'port_conflict'); assert.equal(activated, false);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); }
});

test('public worker aliases remain available while private broker operations are refused at both panel boundaries',async()=>{
 const seen=[],bridge=createWorkerBridge(async(_, {teamWorker:m})=>{seen.push(m.args);return m.args.op==='ping'?{nonce:m.nonce,ready:true,platform:'darwin',workerPid:7}:m.args;},{nonce:()=> 'allowlist-test',spacingMs:0});
 await bridge.connect();assert.equal((await bridge.call('workspace.readContext',{teamId:'team'})).op,'context');assert.deepEqual(await bridge.call('storage.get',{ignored:true}),{op:'load',params:{}});assert.equal((await bridge.call('receipt',{requestId:'saved'})).op,'receipt');
 for(const op of ['_stopPrepare','_stopValidate','_stopSettle','_launchPrepare','_launchSettle','_nativePlan','constructor','toString'])await assert.rejects(bridge.call(op,{}),/Unknown worker operation/);
 assert.equal(seen.length,4);
 globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore();const handlers=new Map(),mainFrame={},sender={id:81,mainFrame,isDestroyed:()=>false};let invoked=0;
 handlers.set('plugins:readPanelEntry',async()=>({sessionToken:'allowlist-panel'}));handlers.set('plugins:panelAction',async()=>({ok:true}));handlers.set('plugins:invokeCommand',async()=>{invoked++;return {};});
 await installAdapter({ipcMain:{_invokeHandlers:handlers,handle:(name,fn)=>handlers.set(name,fn),removeHandler:name=>handlers.delete(name)}},{version:'test',identity:'allowlist-test',internalKey:'private-test-key'});
 try{
  for(const op of ['_stopPrepare','_stopValidate','_stopSettle','_launchPrepare','_launchSettle','_nativePlan','constructor','toString']){
   const result=await handlers.get('plugins:panelAction')({sender,senderFrame:mainFrame},{sessionToken:'allowlist-panel',action:'workspace.readContext',params:{teamWorker:{protocol:1,nonce:'public-test',commandId:'team.control',args:{op,params:{}}}}});assert.equal(result.code,'invalid_params');
  }
  assert.equal(invoked,0);
 }finally{globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore();}
});
