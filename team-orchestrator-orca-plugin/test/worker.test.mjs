import { rmTemp } from './temp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
test('worker checks consent before injection and recovers from denied host call without caching rejection or writing startup status', async () => {
  const result = await build({ entryPoints: ['src/worker.mjs'], bundle: true, write: false, platform: 'node', format: 'esm', define: { __PLUGIN_DISPLAY_VERSION__: '"test"' }, plugins: [{ name: 'bootstrap-proof', setup(api) {
    api.onLoad({ filter: /local[\\/]bootstrap\.mjs$/ }, () => ({ contents: 'export let injections = 0; export async function bootstrap() { injections++; return {ready:true, platform:"win32", detail:"injected", cliPaths:{appData:"private-app-data",userData:"private-user-data"}, injections}; }', loader: 'js' }));
    api.onLoad({ filter: /local[\\/]cli\.mjs$/ }, () => ({ contents: 'export async function locateCli() { return {}; } export function createCliRunner() { return async () => {}; }', loader: 'js' }));
  } }] });
  const activate = (await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))).default;
  const commands = new Map(); const calls = []; const logs = []; let approved = false;
  const orca = { commands: { register: (id, fn) => commands.set(id, fn) }, events: { on() {} }, host: { async call(method, params) {
    calls.push({ method, params });
    if (!approved) throw Error('plugin is not enabled with current consent');
    return { value: null };
  } }, log: line => logs.push(line) };
  activate(orca);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(logs.some(line => line.includes('review and enable')));
  await assert.rejects(commands.get('team.control')({ op: 'ping' }), /permission check/);
  approved = true;
  const report = await commands.get('team.control')({ op: 'ping', nonce: 'after-review' });
  assert.equal(report.cliPaths, undefined);
  assert.equal(JSON.stringify(report).includes('private-user-data'), false);
  assert.equal((await commands.get('team.initialise')()).cliPaths, undefined);
  assert.equal(report.ready, true); assert.equal(report.injections, 1); assert.equal(report.nonce, 'after-review');
  assert.ok(calls.every(call => call.method === 'storage.get'));
  assert.equal((await commands.get('team.control')({ op: 'ping' })).injections, 2);
});
test('worker retains its SQLite service and confirmed selections across initialization retries', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { join } = await import('node:path'); const { tmpdir } = await import('node:os');
  const { DEFAULT_FORM } = await import('../src/team.mjs');
  const profile = await mkdtemp(join(tmpdir(), 'worker-store-'));
  t.after(() => rmTemp(profile));
  // the project folder is a separate root from the Orca profile: the store lives with the project
  const projectRoot = await mkdtemp(join(tmpdir(), 'worker-project-'));
  t.after(() => rmTemp(projectRoot));
  const built = await build({ entryPoints: ['src/worker.mjs'], bundle: true, write: false, platform: 'node', format: 'esm', define: { __PLUGIN_DISPLAY_VERSION__: '"test"' }, plugins: [{ name: 'host-boundary', setup(api) {
    api.onLoad({ filter: /local[\\/]bootstrap\.mjs$/ }, () => ({ contents: `export async function bootstrap() { return { ready:true, platform:'darwin', detail:'fixture', cliPaths:{appData:${JSON.stringify(profile)},userData:${JSON.stringify(profile)}} }; }`, loader: 'js' }));
    api.onLoad({ filter: /local[\\/]cli\.mjs$/ }, () => ({ contents: `export async function locateCli() { return {}; } export function createCliRunner() { return async () => ({worktree:{id:'folder:/fixture',hostId:'local',path:${JSON.stringify(projectRoot)},displayName:'Fixture'}}); }`, loader: 'js' }));
  } }] });
  const activate = (await import('data:text/javascript;base64,' + Buffer.from(built.outputFiles[0].text).toString('base64'))).default;
  const commands = new Map();
  activate({ commands: { register: (id, handler) => commands.set(id, handler) }, events: { on() {} }, log() {}, host: { call: async () => ({ value: null }) } });
  const control = commands.get('team.control');
  const selected = await control({ op: 'context', workspaceId: 'folder:/fixture' });
  const first = await control({ op: 'createTeam', params: { requestId: 'first', expectedRevision: 0, form: DEFAULT_FORM, selectionToken: selected.selectionToken } });
  await commands.get('team.initialise')();
  const second = await control({ op: 'createTeam', params: { requestId: 'second', expectedRevision: 1, form: DEFAULT_FORM, selectionToken: selected.selectionToken } });
  assert.equal(second.value.teams.length, 2);
  assert.equal(second.value.teams[0].id, first.value.teams[0].id);
  assert.deepEqual((await control({ op: 'load' })).value, second.value);
});
