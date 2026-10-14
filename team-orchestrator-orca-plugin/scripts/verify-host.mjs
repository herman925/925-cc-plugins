// Verify both host patches against real, pinned Orca sources; inject only the native runtime delegate.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const revision = 'dc146c09e2b12c229cc38434b7b1d4d9c012fdc5';
const root = await mkdtemp(join(tmpdir(), 'orca-plugin-contract-'));
const project = fileURLToPath(new URL('../', import.meta.url));
const source = async path => {
  try { return await readFile(path, 'utf8'); } catch {}
  const ref = relative(root, path).replaceAll('\\', '/');
  const response = await fetch(`https://raw.githubusercontent.com/stablyai/orca/${revision}/${ref}`);
  if (!response.ok) throw new Error(`Cannot fetch ${ref}: ${response.status}`);
  const text = await response.text();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
  return text;
};
const bundle = async name => {
  const entry = join(root, 'contract.ts');
  await writeFile(entry, `export { parsePluginManifest } from './src/shared/plugins/plugin-manifest';\nexport { gatePluginHostCall } from './src/shared/plugins/plugin-capability-gate';\nexport { executePluginHostCall } from './src/main/plugins/plugin-host-methods';\nexport { bindPluginHostServices } from './src/main/plugins/plugin-host-service-bindings';`);
  const outfile = join(root, `${name}.mjs`);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', banner: { js: "import { fileURLToPath as contractFilePath } from 'node:url'; const __filename = contractFilePath(import.meta.url);" }, plugins: [{
    name: 'pinned-orca-source', setup(api) {
      api.onResolve({ filter: /safe-storage-availability$/ }, () => ({ path: 'safe-storage', namespace: 'contract-fake' }));
      api.onLoad({ filter: /.*/, namespace: 'contract-fake' }, () => ({ contents: 'export const guardedSafeStorage = { isEncryptionAvailable: () => false };', loader: 'js' }));
      api.onResolve({ filter: /^zod$/ }, () => ({ path: fileURLToPath(import.meta.resolve('zod')) }));
      api.onResolve({ filter: /^\./ }, args => {
        if (!args.importer.startsWith(root)) return;
        const path = resolve(dirname(args.importer), args.path);
        return { path: /\.[cm]?[jt]s$/.test(path) ? path : `${path}.ts` };
      });
      api.onLoad({ filter: /\.ts$/ }, async args => args.path.startsWith(root) ? { contents: await source(args.path), loader: 'ts' } : undefined);
    }
  }] });
  return import(`file://${outfile}`);
};
try {
  const before = await bundle('before');
  const manifest = JSON.parse(await readFile(join(project, 'orca-plugin.json'), 'utf8'));
  assert.equal(before.parsePluginManifest(manifest).ok, false); // terminal:create is a new, explicitly consented host capability.
  assert.equal(before.parsePluginManifest({ ...manifest, version: '0.1.01' }).ok, false);
  assert.equal(before.gatePluginHostCall({ viaPanel: true, grantedCapabilities: ['storage'] }, 'storage.get').granted, false);
  execFileSync('git', ['apply', '--check', join(project, 'patches/orca-panel-storage.patch')], { cwd: root });
  execFileSync('git', ['apply', join(project, 'patches/orca-panel-storage.patch')], { cwd: root });
  const after = await bundle('after');
  for (const method of ['storage.get', 'storage.set']) {
    assert.equal(after.gatePluginHostCall({ viaPanel: true, grantedCapabilities: ['storage'] }, method).granted, true);
    assert.equal(after.gatePluginHostCall({ viaPanel: true, grantedCapabilities: [] }, method).code, 'capability_denied');
  }
  assert.equal(after.gatePluginHostCall({ viaPanel: true, grantedCapabilities: ['storage'] }, 'storage.delete').code, 'panel_forbidden');
  assert.equal(after.gatePluginHostCall({ viaPanel: true, grantedCapabilities: ['secrets'] }, 'secrets.get').code, 'panel_forbidden');
  const data = new Map();
  const services = { storage: { get: (_, key) => data.get(key), set: (_, key, value) => { data.set(key, value); return { ok: true }; } } };
  const base = { pluginId: 'herman925.team-orchestrator', viaPanel: true, grantedCapabilities: ['storage'], services, audit: { record: async () => {} } };
  assert.equal((await after.executePluginHostCall({ ...base, method: 'storage.set', params: { key: 'teams', value: { version: 1 } } })).ok, true);
  assert.deepEqual((await after.executePluginHostCall({ ...base, method: 'storage.get', params: { key: 'teams' } })).value, { value: { version: 1 } });
  assert.equal((await after.executePluginHostCall({ ...base, method: 'storage.set', params: { key: '__proto__', value: 1 } })).code, 'invalid_params');
  assert.equal((await after.executePluginHostCall({ ...base, audit: undefined, method: 'storage.set', params: { key: 'teams', value: 2 } })).ok, false);
  const terminalBase = { ...base, grantedCapabilities: ['workspace:read', 'terminal:send'], services: { resolveActiveWorktreeContext: async () => ({ worktreeId: 'workspace', branch: 'main', displayName: 'Demo' }), listWorktreeTerminals: async () => [{ id: 'coordinator' }], sendTerminalText: async () => ({ accepted: true }) } };
  assert.equal((await before.executePluginHostCall({ ...terminalBase, method: 'terminal.sendText', params: { terminalId: 'coordinator', text: 'Launch the configured team', enter: true } })).value.accepted, true);
  assert.equal((await before.executePluginHostCall({ ...terminalBase, method: 'terminal.sendText', params: { terminalId: 'foreign', text: 'Launch', enter: true } })).ok, false);
  assert.equal((await before.executePluginHostCall({ ...terminalBase, grantedCapabilities: ['workspace:read'], method: 'terminal.sendText', params: { terminalId: 'coordinator', text: 'Launch', enter: true } })).code, 'capability_denied');
  assert.equal((await before.executePluginHostCall({ ...terminalBase, method: 'terminal.sendText', params: { terminalId: 'coordinator', text: 'x'.repeat(4097), enter: true } })).code, 'invalid_params');
  execFileSync('git', ['apply', '--check', join(project, 'patches/orca-native-agent-launch.patch')], { cwd: root });
  execFileSync('git', ['apply', join(project, 'patches/orca-native-agent-launch.patch')], { cwd: root });
  const native = await bundle('native');
  assert.equal(native.parsePluginManifest(manifest).ok, true);
  assert.equal(native.parsePluginManifest({ ...manifest, version: '0.1.02' }).ok, false);
  const creates = [];
  let currentWorkspace = 'workspace';
  let carry = true;
  let failCreate = false;
  const delegate = {
    resolveActiveWorktreeContext: async () => ({ worktreeId: currentWorkspace, path: '/server/workspace', branch: 'main', displayName: 'Server workspace' }),
    listTerminals: async () => ({ terminals: [{ handle: 'codex', title: 'Investigate Orca plugin orchestras', agentIdentity: 'codex' }, { handle: 'claude', title: 'Codex CLI update', agentIdentity: 'claude' }] }),
    createTerminal: async (selector, options) => {
      creates.push({ selector, options });
      if (failCreate) throw new Error('unknown spawn outcome');
      options.onStartupPromptCarry(carry);
      return { handle: `new-${creates.length}`, title: options.title, executionHostId: 'ssh:server' };
    },
    sendTerminal: async () => { throw new Error('Existing agent must never receive a launch request'); },
    dispatchPluginNotification: async () => ({ delivered: true })
  };
  const nativeServices = native.bindPluginHostServices({ delegate, pluginsDataDir: join(root, 'plugin-data'), subscribeEvents: () => [] });
  const subject = { ...base, services: nativeServices, grantedCapabilities: ['storage', 'workspace:read', 'terminal:create'] };
  const readContext = await native.executePluginHostCall({ ...subject, method: 'workspace.readContext', params: {} });
  const context = readContext.value;
  assert.equal(context.nativeAgentLaunch, true);
  assert.equal(context.terminals[1].title, 'Codex CLI update');
  assert.equal(context.terminals[1].agentIdentity, 'claude');
  assert.equal(context.worktreeId, undefined);
  assert.equal(context.path, undefined);
  const params = { requestId: 'native-request-1', workspaceKey: context.workspaceKey, title: 'Squad/Head', agent: 'codex', model: 'gpt-6.1-sol', effort: 'high', brief: 'Your role is Head.\nThe roster has exactly four members.' };
  const launch = overrides => native.executePluginHostCall({ ...subject, method: 'terminal.createAgent', params, ...overrides });
  assert.equal((await launch({ grantedCapabilities: ['storage', 'workspace:read'] })).code, 'capability_denied');
  assert.equal((await launch({ audit: undefined })).ok, false);
  assert.equal((await launch({ params: { ...params, agent: 'bash' } })).code, 'invalid_params');
  currentWorkspace = 'different-workspace';
  assert.equal((await launch()).ok, false);
  assert.equal(creates.length, 0);
  currentWorkspace = 'workspace';
  const first = await launch();
  assert.equal(first.ok, true);
  assert.equal(first.value.briefAccepted, true);
  assert.equal(first.value.title, 'Squad/Head');
  assert.equal(first.value.executionHostId, 'ssh:server');
  assert.equal(creates[0].selector, 'id:workspace');
  assert.equal(creates[0].options.startupAgent, 'codex');
  assert.deepEqual(creates[0].options.launchPreferences, { model: 'gpt-6.1-sol', effort: 'high' });
  assert.equal(creates[0].options.command, undefined);
  assert.equal(creates[0].options.startupPrompt.includes('\n'), false);
  assert.deepEqual((await launch()).value, first.value);
  assert.equal(creates.length, 1);
  assert.equal((await launch({ params: { ...params, agent: 'claude' } })).ok, false);
  failCreate = true;
  const uncertain = { ...params, requestId: 'uncertain-request' };
  assert.equal((await launch({ params: uncertain })).ok, false);
  assert.equal((await launch({ params: uncertain })).ok, false);
  assert.equal(creates.length, 2);
  failCreate = false; carry = false;
  const unbriefed = await launch({ params: { ...params, requestId: 'unbriefed-request' } });
  assert.equal(unbriefed.ok, true);
  assert.equal(unbriefed.value.briefAccepted, false);
  assert.match(unbriefed.value.warning, /did not carry/);
  carry = true;
  const simultaneous = await Promise.all([launch({ params: { ...params, requestId: 'concurrent-request' } }), launch({ params: { ...params, requestId: 'concurrent-request' } })]);
  assert.equal(simultaneous.filter(result => result.ok).length, 1);
  assert.equal(creates.length, 4);
  console.log(`PASS: Orca ${revision}: storage and native-launch patches, consent, tab names/CLI identities, workspace fencing, typed host-side create, startup briefing receipts and durable duplicate prevention. No SSH CLI is invoked. OS secret encryption is stubbed; native runtime spawning is injected.`);
} finally { await rm(root, { recursive: true, force: true }); }
