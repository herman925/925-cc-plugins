import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { validateRuntime } from './runtime-contract.mjs';
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
const failure = (code, message) => Object.assign(new Error(message), { code });
export async function bootstrap({ platform = process.platform, parentPid = process.ppid, executable = process.execPath, entry = process.argv[1] ?? '', port = 9229, activate = activateParent, adapterPath = fileURLToPath(new URL('./runtime-adapter.cjs', import.meta.url)), version = '0.1.09', internalKey } = {}) {
  const report = { platform, packageType: packageType(platform, executable, entry), parentPid, ready: false };
  let client; let owned = false;
  try {
    if (!Number.isInteger(parentPid) || parentPid < 2 || parentPid === process.pid) throw failure('invalid_parent_pid', 'Invalid Orca parent process.');
    let binary;
    try {
      const path = platform === 'darwin' && executable.includes('.app/Contents/')
        ? join(executable.slice(0, executable.indexOf('.app/Contents/') + '.app/Contents/'.length), 'Frameworks/Electron Framework.framework/Electron Framework') : executable;
      binary = await readFile(await realpath(path));
    } catch { throw failure('fuse_file_missing', 'Cannot locate/read the Electron fuse binary in this application package. No injection attempted.'); }
    if (!inspectorFuse(binary)) throw failure('fuse_disabled', 'Electron inspector fuse is disabled, absent or malformed. This build cannot use the compatibility layer.');
    let available = await targets(port);
    if (!available.length) {
      if (await occupied(port)) throw failure('port_conflict', 'Loopback inspector port is occupied by an incompatible endpoint. Nothing was injected.');
      if (typeof process._debugProcess !== 'function') throw failure('node_capability_missing', 'This Node runtime cannot activate the parent inspector.');
      await activate(parentPid); owned = true;
      for (let attempt = 0; attempt < 20 && !available.length; attempt++) { await delay(100); available = await targets(port); }
    }
    if (!available.length) throw new Error(`Orca did not expose its main-process inspector on loopback port ${port}; inspector activation was attempted but cleanup could not be verified.`);
    if (available.length !== 1) throw new Error('Inspector target is ambiguous; nothing was injected.');
    client = await connectInspector(available[0].webSocketDebuggerUrl);
    const identity = await client.evaluate('({pid:process.pid,electron:process.versions.electron})');
    if (identity?.pid !== parentPid || !identity.electron) { owned = false; throw failure('parent_pid_mismatch', 'Inspector belongs to another process; nothing was injected.'); }
    const runtime = await client.evaluate(`(()=>{if(typeof process.getBuiltinModule!=='function')throw Error('Node getBuiltinModule is unavailable');const req=process.getBuiltinModule('module').createRequire(process.execPath);const {app}=req('electron');const fs=req('node:fs');const path=req('node:path');let build=null;try{build=JSON.parse(fs.readFileSync(path.join(app.isPackaged?process.resourcesPath:app.getAppPath(),'orca-local-build.json'),'utf8'))}catch{};let sqlite=false;try{sqlite=typeof req('node:sqlite').DatabaseSync==='function'}catch{};return {appName:app.getName(),appVersion:app.getVersion(),platform:process.platform,arch:process.arch,electron:process.versions.electron,node:process.versions.node,sqlite,build,cliPaths:{appData:app.getPath('appData'),userData:app.getPath('userData')}}})()`);
    Object.assign(report, validateRuntime(runtime), { appVersion: runtime.appVersion });
    if (!runtime.cliPaths?.appData || !runtime.cliPaths?.userData) throw failure('profile_missing', 'Orca did not resolve its actual runtime profile.');
    const source = await readFile(adapterPath, 'utf8');
    const digest = createHash('sha256').update(source).digest('hex');
    const expression = `(async()=>{const req=process.getBuiltinModule('module').createRequire(process.execPath);const electron=req('electron');const m={exports:{}};new Function('require','module','exports',${JSON.stringify(source)})(req,m,m.exports);return await m.exports.installAdapter(electron,{version:${JSON.stringify(version)},identity:${JSON.stringify(digest)},internalKey:${JSON.stringify(internalKey)}});})()`;
    Object.assign(report, await client.evaluate(expression), { cliPaths: runtime.cliPaths });
    report.detail = 'Local runtime adapter installed; panel-to-worker test is available.';
  } catch (error) { report.code = error.code ?? 'initialisation_failed'; report.detail = error.message; }
  finally {
    if (client && owned) {
      try { await client.evaluate("setTimeout(()=>process.getBuiltinModule('inspector').close(),500);true"); } catch {}
    }
    client?.close();
  }
  return report;
}
