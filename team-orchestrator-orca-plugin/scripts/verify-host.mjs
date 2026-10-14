// Verify the manifest and the storage patch against real, pinned Orca sources.
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
  await writeFile(entry, `export { parsePluginManifest } from './src/shared/plugins/plugin-manifest';\nexport { gatePluginHostCall } from './src/shared/plugins/plugin-capability-gate';\nexport { executePluginHostCall } from './src/main/plugins/plugin-host-methods';`);
  const outfile = join(root, `${name}.mjs`);
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'node', plugins: [{
    name: 'pinned-orca-source', setup(api) {
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
  assert.equal(before.parsePluginManifest(manifest).ok, true);
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
  console.log(`PASS: Orca ${revision}: manifest/version, panel storage patch, consent, scoped terminal delivery, text limit and mutation auditing.`);
} finally { await rm(root, { recursive: true, force: true }); }
