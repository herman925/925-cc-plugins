// Validate the shipped manifest, panel envelope and worker storage against unmodified Orca sources.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliEnvironment } from '../src/local/cli.mjs';
import { installAdapter } from '../src/local/adapter.mjs';
import { build } from 'esbuild';
const revision = '9fdd90ffa7721e145f1353ad9fb9df2f70c31f43';
const root = await realpath(await mkdtemp(join(tmpdir(), 'orca-plugin-contract-')));
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
  await writeFile(entry, `export { PreflightDetectRemoteAgents } from './src/shared/rpc-contract/preflight-params';\nexport { ModelCatalogParams, CreateSupportParams } from './src/shared/rpc-contract/structured-agent-session-params';\nexport { getDefaultUserDataPath } from './src/cli/runtime/metadata';\nexport { buildPluginWorkerEnv } from './src/main/plugins/plugin-worker-env';\nexport { parsePluginManifest } from './src/shared/plugins/plugin-manifest';\nexport { gatePluginHostCall } from './src/shared/plugins/plugin-capability-gate';\nexport { executePluginHostCall } from './src/main/plugins/plugin-host-methods';\nexport { bindPluginHostServices } from './src/main/plugins/plugin-host-service-bindings';\nexport { fingerprintPluginConsent } from './src/shared/plugins/plugin-consent-fingerprint';\nexport { PluginPanelSessions } from './src/main/plugins/plugin-panel-sessions';\nexport { panelActionRequestSchema } from './src/shared/plugins/plugin-panel-bridge';`);
  const outfile = join(root, `${name}.mjs`);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', banner: { js: "import { fileURLToPath as contractFilePath } from 'node:url'; const __filename = contractFilePath(import.meta.url);" }, plugins: [{
    name: 'pinned-orca-source', setup(api) {
      api.onResolve({ filter: /^electron$/ }, () => ({ path: 'safe-storage', namespace: 'contract-fake' }));
      api.onResolve({ filter: /safe-storage-availability$/ }, () => ({ path: 'safe-storage', namespace: 'contract-fake' }));
      api.onLoad({ filter: /.*/, namespace: 'contract-fake' }, () => ({ contents: 'export const guardedSafeStorage = { isEncryptionAvailable: () => false }; export const safeStorage = guardedSafeStorage;', loader: 'js' }));
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
  const scrubbed = before.buildPluginWorkerEnv({ USERPROFILE: 'C:\\Users\\Herman', APPDATA: 'D:\\Redirected\\Roaming', ORCA_USER_DATA_PATH: 'E:\\custom-profile', DESKTOP_SECRET: 'must-not-copy' }, 'win32');
  assert.equal(scrubbed.APPDATA, undefined);
  assert.equal(scrubbed.ORCA_USER_DATA_PATH, undefined);
  assert.equal(scrubbed.DESKTOP_SECRET, undefined);
  const cliEnv = cliEnvironment({ appData: 'D:\\Redirected\\Roaming', userData: 'E:\\custom-profile' }, scrubbed, 'win32');
  assert.equal(cliEnv.APPDATA, 'D:\\Redirected\\Roaming');
  assert.equal(cliEnv.DESKTOP_SECRET, undefined);
  const previousAppData = process.env.APPDATA;
  const previousProfile = process.env.ORCA_USER_DATA_PATH;
  try {
    delete process.env.APPDATA; delete process.env.ORCA_USER_DATA_PATH;
    assert.throws(() => before.getDefaultUserDataPath('win32', 'C:\\Users\\Herman'), /APPDATA is not set/);
    process.env.ORCA_USER_DATA_PATH = cliEnv.ORCA_USER_DATA_PATH;
    assert.equal(before.getDefaultUserDataPath('win32', 'C:\\Users\\Herman'), 'E:\\custom-profile');
  } finally {
    if (previousAppData === undefined) delete process.env.APPDATA; else process.env.APPDATA = previousAppData;
    if (previousProfile === undefined) delete process.env.ORCA_USER_DATA_PATH; else process.env.ORCA_USER_DATA_PATH = previousProfile;
  }
  assert.equal(before.PreflightDetectRemoteAgents.safeParse({ connectionId: 'fixture' }).success, true);
  assert.equal(before.CreateSupportParams.safeParse({ worktree: 'folder:/fixture', agent: 'codex' }).success, true);
  assert.equal(before.ModelCatalogParams.safeParse({ worktree: 'folder:/fixture', agent: 'claude' }).success, true);
  assert.equal(before.ModelCatalogParams.safeParse({ agent: 'claude', executionHost: 'made-up' }).success, false);
  const manifest = JSON.parse(await readFile(join(project, 'orca-plugin.json'), 'utf8'));
  assert.equal(before.parsePluginManifest(manifest).ok, true);
  assert.equal(before.parsePluginManifest({ ...manifest, version: '0.1.04' }).ok, false);
  assert.equal(manifest.main, 'main.mjs');
  assert.notEqual(before.fingerprintPluginConsent(manifest), before.fingerprintPluginConsent({ ...manifest, main: undefined }));
  assert.equal(before.gatePluginHostCall({ viaPanel: true, grantedCapabilities: ['storage'] }, 'storage.get').granted, false);
  assert.equal(before.gatePluginHostCall({ viaPanel: false, grantedCapabilities: ['storage'] }, 'storage.get').granted, true);
  const envelope = { type: 'orca-panel-action', requestId: 'panel-1', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'roundtrip', commandId: 'team.control', args: { op: 'ping' } } } };
  assert.equal(before.panelActionRequestSchema.safeParse(envelope).success, true);
  const data = new Map();
  const services = {
    storage: { get: (_, key) => data.get(key), set: (_, key, value) => { data.set(key, value); return { ok: true }; } },
    resolveActiveWorktreeContext: async () => ({ worktreeId: 'repo::/remote/project', branch: 'main', displayName: 'Remote workspace' }),
    listWorktreeTerminals: async () => []
  };
  const base = { pluginId: 'herman925.team-orchestrator', grantedCapabilities: ['storage', 'workspace:read'], services, audit: { record: async () => {} } };
  const worker = input => before.executePluginHostCall({ ...base, viaPanel: false, ...input });
  assert.equal((await worker({ method: 'storage.set', params: { key: 'launch:request-1', value: { status: 'starting' } } })).ok, true);
  assert.deepEqual((await worker({ method: 'storage.get', params: { key: 'launch:request-1' } })).value, { value: { status: 'starting' } });
  assert.equal((await worker({ method: 'storage.set', params: { key: '__proto__', value: 1 } })).code, 'invalid_params');
  assert.equal((await worker({ method: 'storage.set', params: { key: 'teams', value: 1 }, audit: undefined })).ok, false);
  assert.equal((await before.executePluginHostCall({ ...base, viaPanel: true, method: 'workspace.readContext', params: envelope.params })).code, 'invalid_params');
  let enabled = true; let invoked = 0;
  const handlers = new Map();
  const ipcMain = { _invokeHandlers: handlers, handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
  handlers.set('plugins:readPanelEntry', async () => ({ sessionToken: 'approved-token' }));
  handlers.set('plugins:panelAction', async (_, args) => before.executePluginHostCall({ ...base, grantedCapabilities: enabled ? base.grantedCapabilities : null, viaPanel: true, method: args.action, params: args.params }));
  handlers.set('plugins:invokeCommand', async (_, args) => { invoked++; assert.equal(args.pluginKey, base.pluginId); return { nonce: args.args.nonce }; });
  const sessions = new before.PluginPanelSessions();
  const binding = { pluginKey: base.pluginId, panelId: 'team', rootDir: project, manifestRevision: 'current' };
  const existingToken = sessions.issue('renderer:20', binding);
  assert.equal(sessions.issue('renderer:20', binding), existingToken);
  assert.equal(sessions.resolve('renderer:21', existingToken), null);
  const installed = await installAdapter({ ipcMain }, { version: 'contract', identity: 'contract' });
  assert.equal(installed.ready, true);
  const mainFrame = {}; const event = { sender: { id: 20, mainFrame }, senderFrame: mainFrame };
  await handlers.get('plugins:readPanelEntry')(event, { pluginKey: base.pluginId, panelId: 'team' });
  const call = { sessionToken: 'approved-token', action: envelope.action, params: envelope.params };
  assert.equal((await handlers.get('plugins:panelAction')(event, call)).value.nonce, 'roundtrip');
  enabled = false;
  assert.equal((await handlers.get('plugins:panelAction')(event, call)).ok, false);
  assert.equal(invoked, 1);
  globalThis[Symbol.for('herman925.team-orchestrator.adapter')].restore();
  console.log(`PASS: unmodified Orca ${revision}: stock manifest, trusted-worker consent change, panel transport envelope, original workspace gate, pinned capability read schemas, worker storage/audit, revoked authority, scrubbed Windows environment and explicit desktop runtime profile. No source patch applied.`);
} finally { await rm(root, { recursive: true, force: true }); }
