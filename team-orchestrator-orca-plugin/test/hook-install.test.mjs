// Installing and removing the store guard hook. Every test uses a throwaway project; no live settings file is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rmTemp } from './temp.mjs';
import { MATCHER, commandFor, installHook, removeHook, wrapperName } from '../src/local/hook-install.mjs';

const project = async (t, { store = true } = {}) => {
  const root = await mkdtemp(join(tmpdir(), 'hook-install-'));
  t.after(() => rmTemp(root));
  if (store) {
    await mkdir(join(root, '.orca', 'team-orchestrator'), { recursive: true });
    await writeFile(join(root, '.orca', 'team-orchestrator', 'team.sqlite'), '');
  }
  return root;
};
const settingsPath = root => join(root, '.claude', 'settings.local.json');

test('a project with no team store is left untouched', async t => {
  const root = await project(t, { store: false });
  const result = await installHook(root);
  assert.equal(result.installed, false);
  assert.match(result.reason, /no team store yet/);
  await assert.rejects(readFile(settingsPath(root)), { code: 'ENOENT' });
  await assert.rejects(readdir(join(root, '.orca')), { code: 'ENOENT' });
});

test('installation writes the wrapper and the guard, and merges its entry beside one it did not write', async t => {
  const root = await project(t);
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'their-command' }] };
  const before = `${JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { PreToolUse: [theirs] } }, null, 2)}\n`;
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), before);

  const result = await installHook(root);
  assert.equal(result.installed, true);
  assert.equal(result.prior, 'present');
  const files = await readdir(join(root, '.orca', 'team-orchestrator', 'guard'));
  assert.ok(files.includes('guard.mjs'), `expected guard.mjs, saw ${files.join(', ')}`);
  assert.ok(files.includes(wrapperName()), `expected the wrapper, saw ${files.join(', ')}`);

  const settings = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  assert.deepEqual(settings.hooks.PreToolUse[0], theirs, 'an entry this installer did not write is untouched');
  assert.equal(settings.hooks.PreToolUse.length, 2);
  assert.deepEqual(settings.hooks.PreToolUse[1], result.entry);
  assert.deepEqual(settings.permissions, { allow: ['Read'] });
  assert.equal(result.entry.hooks[0].command, commandFor(join(root, '.orca', 'team-orchestrator', 'guard', wrapperName())));
  assert.ok(result.entry.hooks[0].command.startsWith('"'), 'the command is quoted, because the hook runs through a shell');
  assert.ok(!result.entry.hooks[0].command.slice(1, -1).includes(String.fromCharCode(92)), 'a Windows path keeps no backslash, which bash eats');
});

test('removal leaves every other entry byte for byte, and restores a file that already existed', async t => {
  const root = await project(t);
  const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'their-command' }] };
  const before = `${JSON.stringify({ permissions: { allow: ['Read'] }, hooks: { PreToolUse: [theirs], PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'after' }] }] } }, null, 2)}\n`;
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), before);

  await installHook(root);
  const result = await removeHook(root);
  assert.equal(result.removed, true);
  assert.equal(await readFile(settingsPath(root), 'utf8'), before, 'the file must come back exactly as it was');
});

test('removal deletes the settings file it created and takes back only its own exclude line', async t => {
  const root = await project(t);
  await mkdir(join(root, '.git', 'info'), { recursive: true });
  const exclude = 'node_modules\n';
  await writeFile(join(root, '.git', 'info', 'exclude'), exclude);

  const installed = await installHook(root);
  assert.equal(installed.addedExclude, true);
  assert.equal(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8'), `${exclude}.claude/settings.local.json\n`);

  await removeHook(root);
  await assert.rejects(readFile(settingsPath(root)), { code: 'ENOENT' }, 'a file the installer created is removed again');
  assert.equal(await readFile(join(root, '.git', 'info', 'exclude'), 'utf8'), exclude);
  await assert.rejects(readFile(join(root, '.orca', 'team-orchestrator', 'guard', 'guard.mjs')), { code: 'ENOENT' });
});

test('removal does nothing when there is no install record', async t => {
  const root = await project(t);
  assert.deepEqual(await removeHook(root), { removed: false, reason: 'No install record was found, so nothing was removed.' });
});

test('the entry matches only the five tools that can reach the store, never every tool', async t => {
  const root = await project(t);
  const result = await installHook(root);
  assert.equal(result.entry.matcher, MATCHER);
  assert.equal(MATCHER, 'Write|Edit|MultiEdit|Bash|PowerShell');
  assert.ok(!result.entry.matcher.includes('*'), 'a wildcard makes every Read and Grep pay for the guard');
});

test('a settings file with unusual formatting comes back byte for byte', async t => {
  const root = await project(t);
  const prior = '{\n    "permissions": { "allow": ["Read"] },\n    "hooks": { "PreToolUse": [] }\n}';
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), prior);
  await installHook(root);
  const result = await removeHook(root);
  assert.equal(result.formattingChanged, false);
  assert.equal(await readFile(settingsPath(root), 'utf8'), prior, 'four-space indentation and no trailing newline must survive');
});

test('an edit made after installation is kept, and the removal says the file was rewritten', async t => {
  const root = await project(t);
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), '{}\n');
  await installHook(root);
  const settings = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  settings.permissions = { allow: ['Read'] };
  await writeFile(settingsPath(root), `${JSON.stringify(settings, null, 2)}\n`);
  const result = await removeHook(root);
  assert.equal(result.formattingChanged, true);
  const after = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  assert.deepEqual(after.permissions, { allow: ['Read'] }, 'an edit made after installation is not lost');
  assert.equal(after.hooks?.PreToolUse, undefined, 'our entry is gone');
});

test('a settings file that is not valid JSON leaves the project exactly as it was', async t => {
  const root = await project(t);
  await mkdir(join(root, '.claude'), { recursive: true });
  const broken = '{ "permissions": { "allow": ["Read"], }, }\n';
  await writeFile(settingsPath(root), broken);
  const result = await installHook(root);
  assert.equal(result.installed, false);
  assert.match(result.reason, /not valid JSON/);
  await assert.rejects(readdir(join(root, '.orca', 'team-orchestrator', 'guard')), { code: 'ENOENT' }, 'no guard may be left with no record beside it');
  assert.equal(await readFile(settingsPath(root), 'utf8'), broken, 'the unreadable file is not rewritten');
});

test('a failure halfway through installation undoes what it wrote', async t => {
  const root = await project(t);
  // `.claude` is a file, so the settings folder cannot be created after the guard files are copied.
  await writeFile(join(root, '.claude'), 'not a folder');
  await assert.rejects(installHook(root), /ENOTDIR|EEXIST|not a directory/i);
  await assert.rejects(readdir(join(root, '.orca', 'team-orchestrator', 'guard')), { code: 'ENOENT' }, 'a half-run install cleans up after itself');
});

test('installing twice keeps one entry and says it was already installed', async t => {
  const root = await project(t);
  const first = await installHook(root);
  const second = await installHook(root);
  assert.equal(first.alreadyInstalled, false);
  assert.equal(second.alreadyInstalled, true);
  const settings = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  assert.equal(settings.hooks.PreToolUse.length, 1, 'a second entry would run the guard twice per write');
});

test('an edit made between two installs survives removal', async t => {
  const root = await project(t);
  const original = '{\n    "permissions": { "allow": ["Read"] }\n}';
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), original);
  await installHook(root);
  const edited = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  edited.env = { THEIRS: '1' };
  const editedText = `${JSON.stringify(edited, null, 2)}\n`;
  await writeFile(settingsPath(root), editedText);
  await installHook(root);
  const result = await removeHook(root);
  assert.equal(result.formattingChanged, false);
  const after = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  assert.deepEqual(after, { permissions: { allow: ['Read'] }, env: { THEIRS: '1' } }, 'the edit made between installs must survive');
});

test('two installs with no edit between them restore the text from before the first install', async t => {
  const root = await project(t);
  const original = '{\n    "permissions": { "allow": ["Read"] }\n}';
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), original);
  await installHook(root);
  await installHook(root);
  const result = await removeHook(root);
  assert.equal(result.formattingChanged, false, 'a reinstall must not turn removal into a rewrite');
  assert.equal(await readFile(settingsPath(root), 'utf8'), original, 'nothing changed, so the original bytes come back');
});

test('an entry of ours with no record is stripped, and the file is never deleted', async t => {
  const root = await project(t);
  const wrapper = commandFor(join(root, '.orca', 'team-orchestrator', 'guard', process.platform === 'win32' ? 'guard.cmd' : 'guard.sh'));
  const prior = `${JSON.stringify({ hooks: { PreToolUse: [{ matcher: MATCHER, hooks: [{ type: 'command', command: wrapper }] }] } }, null, 2)}\n`;
  await mkdir(join(root, '.claude'), { recursive: true });
  await writeFile(settingsPath(root), prior);
  await installHook(root);
  const result = await removeHook(root);
  assert.equal(result.entryFound, true);
  const after = JSON.parse(await readFile(settingsPath(root), 'utf8'));
  assert.equal(after.hooks?.PreToolUse, undefined, 'the entry is gone');
  assert.equal(await readFile(settingsPath(root), 'utf8').then(() => true, () => false), true, 'the file is never deleted when its state before our entry was unknown');
});

test('removal says whether the settings file still held an entry of ours', async t => {
  const root = await project(t);
  await installHook(root);
  assert.equal((await removeHook(root)).entryFound, true);

  const again = await project(t);
  await installHook(again);
  const settings = JSON.parse(await readFile(settingsPath(again), 'utf8'));
  settings.hooks.PreToolUse = [];
  await writeFile(settingsPath(again), `${JSON.stringify(settings, null, 2)}\n`);
  const result = await removeHook(again);
  assert.equal(result.entryFound, false, 'the caller must not claim the hook was removed when it was already gone');
  assert.equal(result.removed, true);
});

test('removal takes the guard folder with it', async t => {
  const root = await project(t);
  await installHook(root);
  const result = await removeHook(root);
  assert.equal(result.directoryRemoved, true);
  await assert.rejects(readdir(join(root, '.orca', 'team-orchestrator', 'guard')), { code: 'ENOENT' }, 'an empty guard folder must not be left behind');
});
