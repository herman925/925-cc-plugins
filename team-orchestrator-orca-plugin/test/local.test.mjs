import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectorFuse, packageType } from '../src/local/bootstrap.mjs';
import { installAdapter } from '../src/local/adapter.mjs';
import { createExecutor } from '../src/local/executor.mjs';
import { startupCommand } from '../src/local/startup-command.mjs';
import { createCliRunner, locateCli } from '../src/local/cli.mjs';
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
  const original = handlers.get('plugins:panelAction'); const event = { sender: { id: 7 } };
  const options = { version: 'test', identity: 'test-digest' };
  assert.equal(installAdapter({ ipcMain }, options).ready, true);
  assert.equal(installAdapter({ ipcMain }, options).reused, true);
  const action = (sender = event, commandId = 'team.control') => handlers.get('plugins:panelAction')(sender, { sessionToken: 'token', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, commandId, nonce: 'nonce', args: { op: 'context', workspaceId: 'forged' } } } });
  assert.equal((await action()).ok, false);
  await handlers.get('plugins:readPanelEntry')(event, { pluginKey: 'foreign.plugin', panelId: 'team' });
  assert.equal((await action()).ok, false);
  await handlers.get('plugins:readPanelEntry')(event, { pluginKey: 'herman925.team-orchestrator', panelId: 'team' });
  assert.equal((await action()).value.nonce, 'nonce');
  assert.equal(commands[0].args.workspaceId, 'repo::/server/project');
  assert.equal(commands[0].pluginKey, 'herman925.team-orchestrator');
  assert.equal((await action({ sender: { id: 8 } })).ok, false);
  assert.equal((await action(event, 'foreign.command')).ok, false);
  enabled = false; assert.equal((await action()).code, 'consent_required');
  assert.equal(commands.length, 1);
  await handlers.get('plugins:setEnabled')(event, { pluginKey: 'herman925.team-orchestrator', enabled: false });
  assert.equal(handlers.get('plugins:panelAction'), original);
});
function executorFixture({ modern = true, failure, workspaceId = 'repo::/server/project' } = {}) {
  const data = new Map(); const calls = []; let creates = 0;
  const host = { call: async (method, { key, value }) => { if (method === 'storage.get') return { value: data.get(key) }; data.set(key, structuredClone(value)); return { ok: true }; } };
  const cli = async args => {
    calls.push(args);
    if (args[0] === 'worktree') return { worktree: { id: workspaceId, displayName: 'Server', path: '/server/project' } };
    if (args[0] === 'agent-context') return { commands: [{ command: modern ? 'agent launch' : 'terminal create', flags: ['shell'] }] };
    if (args[1] === 'launch' || args[1] === 'create') { creates++; if (failure === 'create') throw new Error('transport unknown'); return modern ? { outcome: { handle: 'child-1' }, prompt: { outcome: 'handed-to-terminal' } } : { terminal: { handle: 'child-1' } }; }
    if (args[1] === 'rename' && failure === 'rename') throw new Error('rename failed');
    if (args[1] === 'show') return { terminal: { title: 'Squad/Head', executionHostId: 'ssh:server' } };
    return {};
  };
  const executor = createExecutor(host, cli);
  const params = { requestId: 'team-head-1', workspaceKey: digest(workspaceId), agent: 'codex', title: 'Squad/Head', model: 'gpt-6.1-sol', effort: 'high', brief: 'Head role\nWorkers: W1 W2 W3' };
  return { executor, data, calls, params, workspaceId, count: () => creates };
}
test('executor journals before background launch, preserves real handles, fences workspace and replays without duplication', async () => {
  const f = executorFixture();
  const request = { op: 'start', params: f.params, workspaceId: f.workspaceId };
  const results = await Promise.all([f.executor.execute(request), f.executor.execute(request)]);
  assert.ok(results.every(row => row.status === 'starting'));
  await f.executor.settle();
  const receipt = await f.executor.execute({ op: 'receipt', params: { requestId: f.params.requestId } });
  assert.equal(receipt.handle, 'child-1'); assert.equal(receipt.briefAccepted, true); assert.equal(receipt.executionHostId, 'ssh:server');
  assert.equal(f.calls[0][3], 'id:repo::/server/project');
  await f.executor.execute(request); assert.equal(f.count(), 1);
  await assert.rejects(f.executor.execute({ ...request, params: { ...f.params, agent: 'claude' } }), /conflicts/);
  await assert.rejects(f.executor.execute({ ...request, params: { ...f.params, requestId: 'another', workspaceKey: 'a'.repeat(64) } }), /workspace changed/);
  assert.equal(f.count(), 1);
  const restarted = createExecutor({ call: async (_, { key }) => ({ value: f.data.get(key) }) }, async () => { throw Error('must not spawn'); });
  assert.equal((await restarted.execute(request)).status, 'created');
});
for (const failure of ['create', 'rename']) test(`executor retains ${failure} failure evidence and never repeats the spawn`, async () => {
  const f = executorFixture({ failure }); const request = { op: 'start', params: f.params, workspaceId: f.workspaceId };
  await f.executor.execute(request); await f.executor.settle();
  const receipt = f.data.get('launch:' + f.params.requestId);
  assert.equal(receipt.status, failure === 'create' ? 'unknown' : 'created');
  assert.match(receipt.warning || receipt.error, new RegExp(failure === 'create' ? 'transport' : 'rename'));
  await f.executor.execute(request); assert.equal(f.count(), 1);
});
test('legacy CLI creates a named agent carrying its initial prompt, with no send to existing terminals', async () => {
  const f = executorFixture({ modern: false });
  await f.executor.execute({ op: 'start', params: f.params, workspaceId: f.workspaceId }); await f.executor.settle();
  const call = f.calls.find(args => args[1] === 'create');
  assert.equal(call[5], 'Squad/Head'); assert.match(call[7], /codex.*model_reasoning_effort=high.*Head role Workers/);
  assert.ok(f.calls.every(args => args[1] !== 'send'));
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
test('worker bridge requires echoed nonce, polls persisted receipt, and never retries unknown transport delivery', async () => {
  let calls = []; const raw = async (_, { teamWorker: message }) => {
    calls.push(message.args.op);
    if (message.args.op === 'ping') return { nonce: message.nonce, ready: true, platform: 'darwin', workerPid: 7 };
    if (message.args.op === 'start') return { status: 'starting' };
    return { status: 'created', handle: 'actual-handle' };
  };
  const bridge = createWorkerBridge(raw, { nonce: () => 'nonce', spacingMs: 0, pollMs: 0 });
  await assert.rejects(bridge.call('storage.get', {}), /connection/);
  await bridge.connect(); assert.equal((await bridge.call('terminal.createAgent', { requestId: 'id' })).handle, 'actual-handle');
  assert.deepEqual(calls, ['ping', 'start', 'receipt']);
  const bad = createWorkerBridge(async () => ({ ready: true, platform: 'linux', workerPid: 7 }), { nonce: () => 'nonce', spacingMs: 0 });
  await assert.rejects(bad.connect(), /not verified/);
  let mutations = 0;
  const lost = createWorkerBridge(async (_, { teamWorker: m }) => { if (m.args.op === 'ping') return { nonce: m.nonce, ready: true, platform: 'linux', workerPid: 7 }; mutations++; throw Error('unknown transport'); }, { nonce: () => 'n', spacingMs: 0 });
  await lost.connect(); await assert.rejects(lost.call('terminal.createAgent', { requestId: 'id' }), /unknown transport/); assert.equal(mutations, 1);
});
