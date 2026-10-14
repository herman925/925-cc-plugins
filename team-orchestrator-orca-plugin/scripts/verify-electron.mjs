// Optional native QA; Electron is a test dependency supplied by the developer, never a product dependency.
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const binary = process.env.ELECTRON_TEST_BINARY;
if (!binary) throw new Error('Set ELECTRON_TEST_BINARY to a separate Electron test executable. Your running Orca is never used by this test.');
await access(binary);
const root = await mkdtemp(join(tmpdir(), 'orca-electron-proof-'));
const project = fileURLToPath(new URL('../', import.meta.url));
try {
  await mkdir(join(root, 'out/main'), { recursive: true }); await mkdir(join(root, 'out/cli'));
  await mkdir(join(root, 'redirected-app-data')); await mkdir(join(root, 'redirected-runtime-profile'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'orca', productName: 'Orca', version: '1.4.224', main: 'app.cjs' }));
  for (const [source, destination] of [['app.cjs', 'app.cjs'], ['worker.cjs', 'out/main/plugin-host-entry.cjs'], ['cli.cjs', 'out/cli/index.js']]) await writeFile(join(root, destination), await readFile(join(project, 'test/electron', source)));
  const linux = process.platform === 'linux';
  const command = linux ? 'xvfb-run' : binary;
  const args = [...(linux ? ['-a', binary, '--no-sandbox'] : []), root];
  const { stdout, stderr } = await promisify(execFile)(command, args, { env: { ...process.env, ORCA_TEST_PLUGIN: project }, timeout: 45000, maxBuffer: 1024 * 1024 });
  if (!stdout.includes('REAL_ELECTRON_WORKER_PASS')) throw new Error('Missing native proof result: ' + stderr);
  console.log(stdout.trim());
} finally { await rm(root, { recursive: true, force: true }); }
