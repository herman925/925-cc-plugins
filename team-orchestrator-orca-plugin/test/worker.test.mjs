import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

test('worker checks consent before injection and recovers from denied host call without caching rejection or writing startup status', async () => {
  const result = await build({ entryPoints: ['src/worker.mjs'], bundle: true, write: false, platform: 'node', format: 'esm', define: { __PLUGIN_DISPLAY_VERSION__: '"test"' }, plugins: [{ name: 'bootstrap-proof', setup(api) {
    api.onLoad({ filter: /local\/bootstrap\.mjs$/ }, () => ({ contents: 'export let injections = 0; export async function bootstrap() { injections++; return {ready:true, platform:"win32", detail:"injected", injections}; }', loader: 'js' }));
    api.onLoad({ filter: /local\/cli\.mjs$/ }, () => ({ contents: 'export async function locateCli() { return {}; } export function createCliRunner() { return async () => {}; }', loader: 'js' }));
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
  assert.equal(report.ready, true); assert.equal(report.injections, 1); assert.equal(report.nonce, 'after-review');
  assert.ok(calls.every(call => call.method === 'storage.get'));
  assert.equal((await commands.get('team.control')({ op: 'ping' })).injections, 1);
});
