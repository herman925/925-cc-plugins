import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
const execute = promisify(execFile);
export async function locateCli(entry = process.argv[1], executable = process.execPath) {
  if (entry) {
    const candidate = join(dirname(entry), '..', 'cli', 'index.js');
    try { await access(candidate); return { executable, prefix: [candidate], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }; } catch {}
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
