import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { connectInspector } from './inspector.mjs';
const execute = promisify(execFile);
const activateParent = pid => execute(process.execPath, ['-e', 'process._debugProcess(Number(process.argv[1]))', String(pid)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 4000, windowsHide: true });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX');
const occupied = port => new Promise(resolve => {
  const socket = createConnection({ host: '127.0.0.1', port });
  const finish = value => { socket.destroy(); resolve(value); };
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
  socket.setTimeout(700, () => finish(true));
});
export function inspectorFuse(bytes) {
  let cursor = 0; let count = 0;
  for (;;) {
    const index = bytes.indexOf(SENTINEL, cursor);
    if (index < 0) break;
    const offset = index + SENTINEL.length;
    if (bytes[offset] !== 1 || bytes[offset + 1] < 4 || bytes[offset + 5] !== 49) return false;
    count++; cursor = offset + 6;
  }
  return count > 0;
}
export function packageType(platform, executable, entry) {
  if (platform === 'darwin') return executable.includes('.app/') ? 'macOS app bundle' : 'development';
  if (platform === 'win32') return /app\.asar\.unpacked/i.test(entry) ? 'Windows installed app' : 'development';
  if (executable.includes('/.mount_') || executable.includes('/tmp/.mount')) return 'Linux AppImage';
  return /app\.asar\.unpacked/.test(entry) ? 'Linux installed app' : 'development';
}
async function targets(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(700) });
    const items = await response.json();
    return Array.isArray(items) ? items.filter(item => item.type === 'node' && item.webSocketDebuggerUrl) : [];
  } catch { return []; }
}
export async function bootstrap({ parentPid = process.ppid, executable = process.execPath, entry = process.argv[1] ?? '', port = 9229, activate = activateParent, adapterPath = fileURLToPath(new URL('./runtime-adapter.cjs', import.meta.url)), version = '0.1.05' } = {}) {
  const report = { platform: process.platform, packageType: packageType(process.platform, executable, entry), parentPid, ready: false };
  let client; let owned = false;
  try {
    if (!Number.isInteger(parentPid) || parentPid < 2 || parentPid === process.pid) throw new Error('Invalid Orca parent process.');
    const binary = await readFile(executable);
    if (!inspectorFuse(binary)) throw new Error('This executable does not expose an enabled Electron inspector fuse. Nothing was injected.');
    let available = await targets(port);
    if (!available.length) {
      if (await occupied(port)) throw new Error('Loopback inspector port is occupied by an incompatible endpoint. Nothing was injected.');
      if (typeof process._debugProcess !== 'function') throw new Error('This Node runtime cannot activate the parent inspector.');
      await activate(parentPid); owned = true;
      for (let attempt = 0; attempt < 20 && !available.length; attempt++) { await delay(100); available = await targets(port); }
    }
    if (!available.length) throw new Error(`Orca did not expose its main-process inspector on loopback port ${port}; inspector activation was attempted but cleanup could not be verified.`);
    if (available.length !== 1) throw new Error('Inspector target is ambiguous; nothing was injected.');
    client = await connectInspector(available[0].webSocketDebuggerUrl);
    const identity = await client.evaluate('({pid:process.pid,electron:process.versions.electron})');
    if (identity?.pid !== parentPid || !identity.electron) { owned = false; throw new Error('Inspector belongs to another process; nothing was injected.'); }
    const source = await readFile(adapterPath, 'utf8');
    const digest = createHash('sha256').update(source).digest('hex');
    const expression = `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.execPath);const electron=req('electron');if(electron.app.getName().toLowerCase()!=='orca'||!/^1\\.4\\.\\d+$/.test(electron.app.getVersion()))throw Error('Unsupported Orca application/version');const m={exports:{}};new Function('require','module','exports',${JSON.stringify(source)})(req,m,m.exports);return {...await m.exports.installAdapter(electron,{version:${JSON.stringify(version)},identity:${JSON.stringify(digest)}}),appVersion:electron.app.getVersion()};})()`;
    Object.assign(report, await client.evaluate(expression));
    report.detail = 'Local runtime adapter installed; panel-to-worker test is available.';
  } catch (error) { report.detail = error.message; }
  finally {
    if (client && owned) {
      try { await client.evaluate("setTimeout(()=>process.getBuiltinModule('inspector').close(),500);true"); } catch {}
    }
    client?.close();
  }
  return report;
}
