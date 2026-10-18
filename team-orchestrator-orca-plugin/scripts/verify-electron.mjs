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
for (const [version, commit] of [['1.4.222', '9fdd90ffa7721e145f1353ad9fb9df2f70c31f43'], ['1.4.223', 'ff4a51c872e723d87ab141044814301ea5a78634'], ['1.4.229', '37c314bcc96063c42c468e564df2c34bac8ef8a1'], ['9.0.0', '0000000000000000000000000000000000000000']]) {
const root = await mkdtemp(join(tmpdir(), 'orca-electron-proof-'));
const project = fileURLToPath(new URL('../', import.meta.url));
try {
  await mkdir(join(root, 'out/main'), { recursive: true }); await mkdir(join(root, 'out/cli'));
  await mkdir(join(root, 'redirected-app-data')); await mkdir(join(root, 'redirected-runtime-profile'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'orca', productName: 'Orca', version, main: 'app.cjs' }));
  for (const [source, destination] of [['preload.cjs', 'preload.cjs'], ['app.cjs', 'app.cjs'], ['worker.cjs', 'out/main/plugin-host-entry.cjs'], ['cli.cjs', 'out/cli/index.js']]) await writeFile(join(root, destination), await readFile(join(project, 'test/electron', source)));
  // Explicit synthetic metadata: tests interface admission independently of the release number in this isolated fixture.
  await writeFile(join(root, 'orca-local-build.json'), JSON.stringify({ version, commit, buildId: `${version}-${commit}-arm64`, platform: 'darwin', architecture: 'arm64' }));
  await writeFile(join(root, 'index.html'), '<h1>Isolated IPC fixture</h1><iframe src="child.html"></iframe>');
  await writeFile(join(root, 'child.html'), '<h1>Subframe security probe</h1>');
  const linux = process.platform === 'linux';
  const command = linux ? 'xvfb-run' : binary;
  const args = [...(linux ? ['-a', binary, '--no-sandbox'] : []), root];
  const { stdout, stderr } = await promisify(execFile)(command, args, { env: { ...process.env, ORCA_TEST_PLUGIN: project }, timeout: 60000, maxBuffer: 1024 * 1024 });
  if (!stdout.includes('REAL_ELECTRON_WORKER_PASS')) throw new Error('Missing native proof result: ' + stderr);
  console.log(`Synthetic Orca ${version} metadata; genuine Electron runtime and IPC fixture:\n${stdout.trim()}`);
} finally { await rm(root, { recursive: true, force: true }); }

}
