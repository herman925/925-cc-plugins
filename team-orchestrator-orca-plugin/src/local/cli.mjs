import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export function cliEnvironment(paths, base = process.env, platform = process.platform) {
  if (typeof paths?.userData !== 'string' || !paths.userData || paths.userData.includes('\0') || typeof paths.appData !== 'string' || !paths.appData || paths.appData.includes('\0')) throw new Error('The running Orca desktop did not provide its runtime data paths.');
  const env = { ...base, ELECTRON_RUN_AS_NODE: '1' };
  // Pin this desktop's profile; worker environment scrubbing removes APPDATA/XDG/dev overrides.
  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ORCA_USER_DATA_PATH' || (platform === 'win32' && key.toUpperCase() === 'APPDATA')) delete env[key];
  env.ORCA_USER_DATA_PATH = paths.userData;
  if (platform === 'win32') env.APPDATA = paths.appData;
  return env;
}
export async function locateCli(entry = process.argv[1], executable = process.execPath, paths) {
  if (entry) {
    const candidate = join(dirname(entry), '..', 'cli', 'index.js');
    try { await access(candidate); } catch { throw new Error('The installed Orca CLI entry was not found beside its plugin worker.'); }
    return { executable, prefix: [candidate], env: paths ? cliEnvironment(paths) : { ...process.env, ELECTRON_RUN_AS_NODE: '1' } };
  }
  throw new Error('The installed Orca CLI entry was not found beside its plugin worker.');
}
export function createCliRunner(command) {
  return async args => {
    let stdout;
    try { ({ stdout } = await execute(command.executable, [...command.prefix, ...args, '--json'], { env: command.env, timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false })); }
    catch (error) {
      try { const response = JSON.parse(error.stdout); if (response.ok === false && typeof response.error?.message === 'string') throw Object.assign(new Error(response.error.message), { parsed: true }); }
      catch (parsed) { if (parsed.parsed) throw parsed; }
      throw new Error(error.killed ? 'Local Orca CLI timed out; outcome is unknown.' : 'Local Orca CLI failed; outcome is unknown.');
    }
    let response;
    try { response = JSON.parse(stdout.trim()); } catch { throw new Error('Orca CLI returned invalid JSON.'); }
    if (args[0] === 'agent-context' && Array.isArray(response.commands)) return response;
    if (response.ok !== true) throw new Error(response.error?.message ?? 'Orca CLI rejected the operation.');
    return response.result;
  };
}
