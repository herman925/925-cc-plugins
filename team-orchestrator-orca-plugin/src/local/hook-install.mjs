// Installs and removes the store guard as a Claude Code PreToolUse hook in one project.
// Everything it adds is recorded so removal is exact: nothing is guessed and nothing else in the file is touched.
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, open, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORE } from './guard-identity.mjs';
import { wrapperScript } from './guard.mjs';

const SETTINGS = '.claude/settings.local.json';
const EXCLUDE = '.git/info/exclude';
const RECORD = `${STORE}/guard/install.json`;
// Row 58: only the tools that can reach the store are matched, so a Read or a Grep pays nothing.
// The pipe form is the format Claude Code settings and installed plugins use for a tool list.
export const MATCHER = 'Write|Edit|MultiEdit|Bash|PowerShell';
const guardDirectory = root => join(root, STORE, 'guard');
export const wrapperName = (platform = process.platform) => platform === 'win32' ? 'guard.cmd' : 'guard.sh';
// Claude Code runs a hook command through a shell. This machine uses bash, which eats the backslashes of a Windows
// path and fails with "command not found" (status 127). A quoted forward-slash path runs under bash, cmd and
// PowerShell alike, so it is the one form written into the settings file.
export const commandFor = (path, platform = process.platform) => `"${platform === 'win32' ? path.split('\\').join('/') : path}"`;
const hash = text => createHash('sha256').update(text).digest('hex');

const read = async path => { try { return await readFile(path, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function atomicWrite(path, text) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
const isOurs = (row, command) => (row?.hooks ?? []).some(hook => hook?.command === command);

export async function installHook(projectRoot, { source = dirname(fileURLToPath(import.meta.url)), platform = process.platform } = {}) {
  // A project with no team store is left untouched: a guard installed there would refuse work it never protected.
  if (!(await stat(join(projectRoot, STORE, 'team.sqlite')).catch(() => null))) {
    return { installed: false, reason: 'This project has no team store yet, so no hook was installed.' };
  }
  // Read and parse the settings file BEFORE anything is written, so a file this installer cannot read costs nothing.
  const settingsPath = join(projectRoot, SETTINGS), prior = await read(settingsPath);
  let settings;
  if (prior === null) settings = {};
  else {
    try { settings = JSON.parse(prior); }
    catch (error) { return { installed: false, reason: `The project settings file is not valid JSON, so nothing was installed (${error.message}).` }; }
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return { installed: false, reason: 'The project settings file does not hold a JSON object, so nothing was installed.' };
  }

  const directory = guardDirectory(projectRoot), wrapper = join(directory, wrapperName(platform));
  const command = commandFor(wrapper, platform);
  const entry = { matcher: MATCHER, hooks: [{ type: 'command', command }] };
  const list = Array.isArray(settings.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
  // Installing twice must not add a second entry the same command, which would run the guard twice per write.
  const alreadyInstalled = list.some(row => isOurs(row, command));
  // The undo target for this run: this file with our entry taken out, so removal puts back what this run saw.
  // An empty `hooks` object is dropped too, because it is something this installer added, not something it found.
  const stripped = (() => {
    const copy = JSON.parse(JSON.stringify(settings));
    if (copy.hooks && typeof copy.hooks === 'object') {
      const rows = Array.isArray(copy.hooks.PreToolUse) ? copy.hooks.PreToolUse.filter(row => !isOurs(row, command)) : [];
      if (rows.length === 0) delete copy.hooks.PreToolUse; else copy.hooks.PreToolUse = rows;
      if (Object.keys(copy.hooks).length === 0) delete copy.hooks;
    }
    return { value: copy, text: `${JSON.stringify(copy, null, 2)}\n` };
  })();
  // Merge: another product's PreToolUse entries, and every other event, stay exactly as they are.
  settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  if (!alreadyInstalled) settings.hooks.PreToolUse = [...list, entry];
  const written = `${JSON.stringify(settings, null, 2)}\n`;

  const excludePath = join(projectRoot, EXCLUDE), exclude = await read(excludePath);
  const addExclude = exclude !== null && !exclude.split(/\r?\n/).includes(SETTINGS);
  const priorRecord = await read(join(projectRoot, RECORD));

  // Every write registers its own undo, so a failure halfway through leaves the project as it was found.
  const undos = [];
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    undos.push(() => rmdir(directory).catch(() => {}));
    const guardCopy = join(directory, 'guard.mjs');
    await copyFile(join(source, 'guard.mjs'), guardCopy);
    undos.push(() => unlink(guardCopy).catch(() => {}));
    await atomicWrite(wrapper, wrapperScript(platform));
    undos.push(() => unlink(wrapper).catch(() => {}));

    // A file that already holds our entry is not rewritten, so a no-op install never reformats a person's file.
    const wroteSettings = !alreadyInstalled || prior === null;
    if (wroteSettings) {
      await mkdir(dirname(settingsPath), { recursive: true });
      await atomicWrite(settingsPath, written);
      undos.push(() => (prior === null ? unlink(settingsPath) : atomicWrite(settingsPath, prior)).catch(() => {}));
    }
    if (addExclude) {
      await atomicWrite(excludePath, exclude === '' || exclude.endsWith('\n') ? `${exclude}${SETTINGS}\n` : `${exclude}\n${SETTINGS}\n`);
      undos.push(() => atomicWrite(excludePath, exclude).catch(() => {}));
    }
    // `prior` is an undo record, not an archive: it is the state immediately before THIS run's write.
    // 1. A recorded prior that still describes this file, minus our entry, is kept as it is, so its original
    //    bytes and formatting survive a reinstall.
    // 2. Otherwise the undo target is this file, minus our entry, as this run saw it: an edit made between
    //    installs is never lost.
    // 3. An entry of ours with no record is the one case where the state before it is unknown, so nothing is
    //    restored and removal only strips the entry.
    const recordPath = join(projectRoot, RECORD);
    const sameContent = (text, value) => { try { return JSON.stringify(JSON.parse(text)) === JSON.stringify(value); } catch { return false; } };
    const previous = priorRecord === null ? null : JSON.parse(priorRecord);
    let recordPrior, verbatim;
    if (previous === null) { recordPrior = alreadyInstalled ? null : prior; verbatim = !alreadyInstalled; }
    else if (previous.verbatim === true && previous.prior !== null && sameContent(previous.prior, stripped.value)) { recordPrior = previous.prior; verbatim = true; }
    else { recordPrior = stripped.text; verbatim = true; }
    const record = {
      entry, prior: recordPrior, verbatim,
      // The hash of what is on disk after this run: the text we wrote, or the text we left untouched.
      writtenHash: hash(wroteSettings ? written : prior),
      addedExclude: previous?.addedExclude === true || addExclude,
      installedAt: previous?.installedAt ?? new Date().toISOString(),
    };
    // The record is the last write, so its undo is registered before it and runs first on a failure.
    undos.push(() => (priorRecord === null ? unlink(recordPath) : atomicWrite(recordPath, priorRecord)).catch(() => {}));
    await atomicWrite(recordPath, `${JSON.stringify(record, null, 2)}\n`);
  } catch (error) {
    for (const undo of undos.reverse()) await undo();
    throw error;
  }

  return { installed: true, alreadyInstalled, entry, prior: prior === null ? 'absent' : 'present', wrapper, addedExclude: addExclude };
}

export async function removeHook(projectRoot, { platform = process.platform } = {}) {
  const recordText = await read(join(projectRoot, RECORD));
  if (recordText === null) return { removed: false, reason: 'No install record was found, so nothing was removed.' };
  const record = JSON.parse(recordText);
  const command = record.entry?.hooks?.[0]?.command;
  const settingsPath = join(projectRoot, SETTINGS), current = await read(settingsPath);
  let formattingChanged = false, entryFound = false;

  if (current !== null) {
    entryFound = (Array.isArray(JSON.parse(current).hooks?.PreToolUse) ? JSON.parse(current).hooks.PreToolUse : []).some(row => isOurs(row, command));
    if (record.verbatim === true && hash(current) === record.writtenHash) {
      // Nobody touched the file since installation, so the exact prior text goes back: byte for byte, any formatting.
      if (record.prior === null) await unlink(settingsPath);
      else await atomicWrite(settingsPath, record.prior);
    } else {
      // Someone edited it since. Remove only our entry and say that the file was re-serialised.
      const settings = JSON.parse(current);
      const list = Array.isArray(settings.hooks?.PreToolUse) ? settings.hooks.PreToolUse : [];
      const kept = list.filter(row => !isOurs(row, command));
      formattingChanged = true;
      const empty = record.verbatim === true && record.prior === null && kept.length === 0 && Object.keys(settings).every(key => key === 'hooks') && Object.keys(settings.hooks).every(key => key === 'PreToolUse');
      if (empty) await unlink(settingsPath);
      else {
        if (kept.length === 0) delete settings.hooks.PreToolUse;
        else settings.hooks.PreToolUse = kept;
        await atomicWrite(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      }
    }
  }

  if (record.addedExclude) {
    // The line is taken back only when it is still the last one. A person who appended their own lines after
    // installation keeps ours as well: leaving an extra ignore line is safer than deleting one of theirs.
    const excludePath = join(projectRoot, EXCLUDE), exclude = await read(excludePath);
    if (exclude !== null) {
      const lines = exclude.split(/\r?\n/);
      const last = lines[lines.length - 1] === '' ? lines.length - 2 : lines.length - 1;
      if (lines[last] === SETTINGS) lines.splice(last, 1);
      await atomicWrite(excludePath, lines.join('\n'));
    }
  }

  for (const file of [RECORD, `${STORE}/guard/guard.mjs`, `${STORE}/guard/${wrapperName(platform)}`]) {
    await unlink(join(projectRoot, file)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  // The folder goes too, so "removed" leaves nothing behind. A non-empty folder stays, and that is reported.
  let directoryRemoved = true;
  await rmdir(join(projectRoot, STORE, 'guard')).catch(error => { if (!['ENOENT', 'ENOTEMPTY'].includes(error.code)) throw error; directoryRemoved = error.code === 'ENOENT'; });
  return { removed: true, entryFound, formattingChanged, directoryRemoved };
}
