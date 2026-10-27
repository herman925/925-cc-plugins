// The team store guard: role-file writes, `apply_patch` paths, shell commands, and the wrapper in front of it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { rmTemp } from './temp.mjs';
import { ROLE_MARKER as PLUGIN_ROLE_MARKER, mergeRole, roleFilePath, roleText } from '../src/role-files.mjs';
import { ROLE_MARKER, decide, guardFilesPresent, patchPaths, wrapperScript, MISSING_GUARD } from '../src/local/guard.mjs';

const run = promisify(execFile);
const win = process.platform === 'win32';
const root = win ? 'C:\\work\\proj' : '/work/proj';
const store = rel => resolve(root, '.orca', 'team-orchestrator', ...rel.split('/'));
const storeRelative = path => path.replace('.orca/team-orchestrator/', '');
const identity = { sessions: { S1: { roleFile: 'team/roles/member.md', headHash: '' } } };
const readIdentity = () => identity;
const call = (tool, input, extra = {}) => decide({ tool_name: tool, tool_input: input, session_id: 'S1', cwd: root, ...extra }, { readIdentity, projectRoot: root });
const patch = text => call('apply_patch', { command: text });

test('the guard and the plugin agree on one role-file marker', () => {
  assert.equal(ROLE_MARKER, PLUGIN_ROLE_MARKER, 'the guard travels alone, so the two copies must stay identical');
});

test('a role file the plugin generated is accepted, and the same file with a changed head is refused', () => {
  const team = { id: '11111111-1111-1111-1111-111111111111', name: 'One', purpose: '', configVersion: 1,
    members: [{ id: '22222222-2222-2222-2222-222222222222', name: 'A', boss: 'user', role: 'Head', roleVersion: 1, brief: 'b', habits: '', collaboration: '' }] };
  const member = team.members[0];
  const generated = roleText(team, member);
  const file = mergeRole(undefined, generated);
  const path = resolve(root, roleFilePath(team, member));
  identity.sessions.S1.roleFile = storeRelative(roleFilePath(team, member));
  identity.sessions.S1.headHash = createHash('sha256').update(generated).digest('hex');

  const accepted = call('Write', { file_path: path, content: file });
  assert.equal(accepted.decision, 'pass', accepted.reason);

  const tampered = generated.replace('Role: Head', 'Role: Owner') + file.slice(generated.length);
  const refused = call('Write', { file_path: path, content: tampered });
  assert.equal(refused.decision, 'block');
  assert.match(refused.reason, /generated part of this role file was changed/);
});

test('an Update File header that names the store identity is blocked', () => {
  const answer = patch(`*** Begin Patch\n*** Update File: ${store('guard/identity.json')}\n@@\n-a\n+b\n*** End Patch`);
  assert.equal(answer.decision, 'block');
  assert.match(answer.reason, /identity file is not writable/);
});

test('an Add or Delete File header that names the store is blocked', () => {
  for (const verb of ['Add', 'Delete']) {
    const answer = patch(`*** Begin Patch\n*** ${verb} File: ${store('guard/identity.json')}\n*** End Patch`);
    assert.equal(answer.decision, 'block', `${verb} File must be judged`);
    assert.match(answer.reason, /identity file is not writable/);
  }
});

test('a relative patch path is resolved against the project root', () => {
  const { paths } = patchPaths('*** Begin Patch\n*** Update File: .orca/team-orchestrator/team.sqlite\n*** End Patch', root);
  const expected = resolve(root, '.orca/team-orchestrator/team.sqlite').split(sep).join('/');
  assert.equal(paths.length, 1);
  assert.equal(paths[0], win || process.platform === 'darwin' ? expected.toLowerCase() : expected);
});

test('a payload cwd in a subfolder cannot hide a store write', () => {
  const sub = resolve(root, 'src', 'deep');
  const answer = decide({ tool_name: 'Write', tool_input: { file_path: store('guard/identity.json'), content: 'x' }, session_id: 'nobody', cwd: sub },
    { readIdentity, projectRoot: root });
  assert.equal(answer.decision, 'block', 'the project root decides, not the payload cwd');
  assert.match(answer.reason, /identity file is not writable/);
});

test('a path differing only in case or separator is the same path', t => {
  if (!/^(win32|darwin)$/.test(process.platform)) return t.skip('this file system folds case only on Windows and macOS');
  const answer = patch('*** Begin Patch\n*** Update File: C:/WORK/PROJ/.ORCA/Team-Orchestrator/Guard/IDENTITY.JSON\n@@\n-a\n+b\n*** End Patch');
  assert.equal(answer.decision, 'block');
  assert.match(answer.reason, /identity file is not writable/);
});

test('a patch that touches several files is blocked when any one of them is the store', () => {
  const answer = patch(`*** Begin Patch\n*** Update File: ${resolve(root, 'src', 'a.js')}\n@@\n-a\n+b\n*** Add File: ${store('guard/identity.json')}\n+x\n*** End Patch`);
  assert.equal(answer.decision, 'block');
  assert.match(answer.reason, /identity file is not writable/);
});

test('a patch outside the store passes, and an envelope with no readable header is blocked', () => {
  assert.equal(patch('*** Begin Patch\n*** Update File: src/a.js\n@@\n-a\n+b\n*** End Patch').decision, 'pass');
  const headerless = patch('*** Begin Patch\n@@\n-a\n+b\n*** End Patch');
  assert.equal(headerless.decision, 'block');
  assert.match(headerless.reason, /could not read every path/);
});

test('header-like text inside a patch body is not a header', () => {
  const answer = patch(`*** Begin Patch\n*** Update File: src/a.js\n@@\n-*** Update File: ${store('guard/identity.json')}\n+*** Update File: src/b.js\n*** End Patch`);
  assert.equal(answer.decision, 'pass', 'only a column-0 header names a file');
});

test('a shell command that changes into the store and then writes is refused', () => {
  const answer = call('Bash', { command: 'cd .orca/team-orchestrator\nnode -e "x"' });
  assert.equal(answer.decision, 'block');
  assert.match(answer.reason, /not writable from a shell/);
});

test('a commit message that mentions the store is allowed', () => {
  const answer = call('Bash', { command: 'git commit -m "update team-orchestrator docs"' });
  assert.equal(answer.decision, 'pass', 'quoted text is data, not a path');
});

test('a search that names the store is refused, because rg can run a command with --pre', () => {
  const answer = call('Bash', { command: 'rg team-orchestrator src/' });
  assert.equal(answer.decision, 'block');
  assert.match(answer.reason, /not a plain read/);
});

test('an interpreter that carries the store path inside its argument is refused', () => {
  const answer = call('Bash', { command: 'node -e "require(\'node:fs\').rmSync(\'.orca/team-orchestrator\')"' });
  assert.equal(answer.decision, 'block', 'an interpreter is not a read, however its argument is quoted');
});

test('a quiet mention in a file argument is still a path', () => {
  assert.equal(call('Bash', { command: 'grep team-orchestrator README.md' }).decision, 'pass', 'grep only reads');
});
test('a plain read of the store passes', () => {
  assert.equal(call('Bash', { command: 'cat .orca/team-orchestrator/team.sqlite' }).decision, 'pass');
  assert.equal(call('Bash', { command: 'git status' }).decision, 'pass');
});

// The wrapper is installed inside the project, so every test builds it there and never relies on the caller's cwd.
const project = async (t, { storeFile, guard }) => {
  const dir = await mkdtemp(join(tmpdir(), 'guard-wrapper-'));
  t.after(() => rmTemp(dir));
  const guardDir = join(dir, '.orca', 'team-orchestrator', 'guard');
  await mkdir(guardDir, { recursive: true });
  if (storeFile) await writeFile(join(dir, '.orca', 'team-orchestrator', 'team.sqlite'), '');
  await writeFile(join(guardDir, 'guard.cmd'), wrapperScript('win32'));
  if (guard) await writeFile(join(guardDir, 'guard.mjs'), `process.stdout.write('guard-ran:' + process.argv[2]);\n`);
  return { dir, guardDir };
};

test('the wrapper prints nothing at all when the folder is not a team project', async t => {
  if (!win) return t.skip('the .cmd wrapper runs on Windows only');
  const { guardDir } = await project(t, { storeFile: false, guard: false });
  const { stdout } = await run('cmd.exe', ['/d', '/c', join(guardDir, 'guard.cmd')], { cwd: tmpdir() });
  assert.equal(stdout, '', 'the fast path must stay silent, with or without the guard script');
});

test('the wrapper finds the store and passes the project root, even when the caller cwd is elsewhere', async t => {
  if (!win) return t.skip('the .cmd wrapper runs on Windows only');
  const { dir, guardDir } = await project(t, { storeFile: true, guard: true });
  const { stdout } = await run('cmd.exe', ['/d', '/c', join(guardDir, 'guard.cmd')], { cwd: tmpdir() });
  const at = stdout.indexOf(':');
  const marker = stdout.slice(0, at), passed = stdout.slice(at + 1);
  assert.equal(marker, 'guard-ran', 'the wrapper must not depend on the caller cwd');
  assert.equal(resolve(passed), resolve(dir), 'the guard must be given the project root, not .orca and not the store');
});

test('the wrapper refuses store writes when the store exists but the guard script is missing', async t => {
  if (!win) return t.skip('the .cmd wrapper runs on Windows only');
  const { guardDir } = await project(t, { storeFile: true, guard: false });
  const { stdout } = await run('cmd.exe', ['/d', '/c', join(guardDir, 'guard.cmd')], { cwd: tmpdir() });
  const answer = JSON.parse(stdout.trim());
  assert.equal(answer.decision, 'block');
  assert.equal(answer.reason, MISSING_GUARD);
});

test('presence holds only when the wrapper and the script are both there', async t => {
  const { guardDir } = await project(t, { storeFile: true, guard: false });
  const alone = await guardFilesPresent(guardDir);
  assert.equal(alone.present, false, 'a wrapper with no script is the fail-open case, so presence must be false');
  assert.equal(alone.wrapper, join(guardDir, win ? 'guard.cmd' : 'guard.sh'));
  await writeFile(join(guardDir, 'guard.mjs'), ' ');
  assert.equal((await guardFilesPresent(guardDir)).present, true);
});
