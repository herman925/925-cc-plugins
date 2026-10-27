// The team store guard, as installed into <project>/.orca/team-orchestrator/guard/.
// Self-contained on purpose: this file is copied into a project folder and runs from there with no plugin around it.
// ROLE_MARKER is duplicated from ../role-files.mjs, because this file travels alone; a test holds the two equal.
import { readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROLE_MARKER = '<!-- END OF GENERATED ROLE. Personal notes below this line are preserved. -->';
const STORE = '.orca/team-orchestrator';
const IDENTITY = 'guard/identity.json';
const SHELL = ['Bash', 'PowerShell'];
const EDIT = ['Write', 'Edit', 'MultiEdit'];
const PATCH = ['apply_patch'];
const READERS = /^(cat|type|get-content|gc|ls|dir|get-childitem|gci|grep|select-string|sls|jq)$/;
const HARMLESS = /\d?>>?\s*(&\d|\/dev\/null|\$null|nul)(?=$|[\s;|&)])/gi;
const SEPARATORS = /&&|\|\||[;|&\n\r]/;
const fold = platform => platform === 'win32' || platform === 'darwin';

// One spelling per path: absolute, forward slashes, folded where the file system folds.
export function canonical(target, from, platform = process.platform) {
  let full;
  try { full = resolve(from || '.', String(target)); }
  catch { return ''; }
  full = full.split(sep).join('/');
  return fold(platform) ? full.toLowerCase() : full;
}

const foldText = text => text.split('\\').join('/').toLowerCase();

// The store is found from the project root, never from the payload cwd: a member session can run in a subfolder.
export function inStore(target, projectRoot, platform = process.platform) {
  const store = canonical(STORE, projectRoot, platform), path = canonical(target, projectRoot, platform);
  if (!path) return { inside: false, rel: '' };
  const inside = path === store || path.startsWith(`${store}/`);
  return { inside, rel: inside ? path.slice(store.length + 1) : '' };
}

// `apply_patch` carries no file_path: the target sits in the envelope header, one line per file.
// A header is only a header at column 0; every body line of a patch starts with ' ', '+' or '-'.
export function patchPaths(text, projectRoot, platform = process.platform) {
  const paths = [];
  let began = false, headers = 0;
  for (const line of String(text ?? '').split(/\r?\n/)) {
    if (line === '*** Begin Patch') began = true;
    const header = /^\*\*\* (?:Update|Add|Delete) File: (.*)$/.exec(line);
    if (!header) continue;
    const target = header[1].trim();
    if (!target) return { paths, unreadable: true };
    const full = canonical(target, projectRoot, platform);
    if (!full) return { paths, unreadable: true };
    paths.push(full);
    headers++;
  }
  // a patch envelope with no readable header names no target this guard can judge
  if (began && headers === 0) return { paths, unreadable: true };
  return { paths, unreadable: false };
}

// A shell command may look at the store; it may not write it.
export function shellReason(command) {
  const c = String(command ?? '');
  if (/`|\$\(|\$\{|<\(|>\(/.test(c)) return 'it runs a substitution';
  const bare = c.replace(/'[^']*'|"[^"]*"/g, ' Q ').replace(HARMLESS, ' ');
  if (/['"]/.test(bare)) return 'its quoting is unbalanced';
  if (/>/.test(bare)) return 'it redirects output into a file';
  const parts = bare.replace(/<\s*\S+/g, ' ').split(SEPARATORS).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return 'it is empty';
  for (const part of parts) {
    const first = (part.split(/\s+/)[0] || '').toLowerCase();
    if (!READERS.test(first)) return `it runs "${first}", which is not a plain read`;
    if (first === 'jq' && /(^|\s)-[a-z]*i/i.test(part)) return 'it runs jq -i';
  }
  return '';
}

// A mention is not a path. Quoted text is data: a commit message that says "team-orchestrator" writes nothing.
// The command is judged when a bare word names the store folder, or when it runs an interpreter that could
// carry the path inside its own argument string. Reading the store stays allowed.
const INTERPRETERS = /^(node|nodejs|deno|bun|tsx|python|python3|py|perl|ruby|bash|sh|zsh|pwsh|powershell|cmd|wsl)$/;
const stripQuotes = command => String(command ?? '').replace(/'[^']*'|"[^"]*"/g, ' ');
function runsInterpreter(command) {
  const parts = stripQuotes(command).split(SEPARATORS).map(part => part.trim()).filter(Boolean);
  return parts.some(part => INTERPRETERS.test((part.split(/\s+/)[0] || '').toLowerCase()));
}
function namesStore(command, projectRoot, platform) {
  const raw = foldText(String(command ?? ''));
  const store = foldText(canonical(STORE, projectRoot, platform));
  if (!raw.includes('team-orchestrator') && !raw.includes(store)) return false;
  // an interpreter can hide the path in its own argument, so its quoting is not data
  if (runsInterpreter(command)) return true;
  const bare = foldText(stripQuotes(command));
  return new RegExp('[^\\s]*team-orchestrator[^\\s]*').test(bare) || bare.includes(store);
}

// Answers one tool call. `pass` lets the call run; `block` refuses it with a reason the model can read.
export function decide(payload, { readIdentity, projectRoot, platform = process.platform } = {}) {
  const block = reason => ({ decision: 'block', reason });
  const pass = { decision: 'pass' };
  if (!payload || typeof payload !== 'object' || typeof payload.tool_name !== 'string') {
    return block('The team store guard could not read this tool call, so the team store stays read-only.');
  }
  const tool = payload.tool_name, input = payload.tool_input || {};
  const root = projectRoot || (typeof payload.cwd === 'string' ? payload.cwd : '');

  if (SHELL.includes(tool)) {
    const command = String(input.command || '');
    if (!namesStore(command, root, platform)) return pass;
    const why = shellReason(command);
    return why ? block(`The team store is not writable from a shell (${why}); change it from the Team Orchestrator panel.`) : pass;
  }

  let targets;
  if (PATCH.includes(tool)) {
    const { paths, unreadable } = patchPaths(input.command, root, platform);
    if (unreadable) return block('The team store guard could not read every path in this patch, so the team store stays read-only.');
    targets = paths;
  } else if (EDIT.includes(tool)) {
    const one = input.file_path || input.notebook_path;
    if (typeof one !== 'string' || !one) return pass;
    targets = [one];
  } else return pass;

  const touched = [];
  for (const target of targets) {
    const { inside, rel } = inStore(target, root, platform);
    if (inside) touched.push(rel);
  }
  if (touched.length === 0) return pass;

  if (touched.includes(IDENTITY)) return block('The team store identity file is not writable.');
  const session = String(payload.session_id || '');
  let identity;
  try { identity = readIdentity(); }
  catch { return block('The team store guard cannot read the roster identity file, so no team store write is allowed.'); }
  // identity.roleFile is store-relative (e.g. <teamId>/roles/<memberId>.md), because that is what `rel` is
  const me = identity?.sessions?.[session];
  if (!session || !me) return block('This session is not on the team roster, so it may not write the team store.');
  const outside = touched.find(rel => rel !== me.roleFile);
  if (outside !== undefined) return block(`A member may write only its own role file (${me.roleFile}), not ${outside}.`);
  if (tool !== 'Write') return block('Only a full-file Write of your own role file is allowed, because a partial edit cannot be checked.');

  const proposed = String(input.content ?? '');
  const at = proposed.indexOf(ROLE_MARKER);
  if (at < 0) return block('The generated-section marker is missing from this role file, so the write is refused.');
  if (proposed.indexOf(ROLE_MARKER, at + ROLE_MARKER.length) >= 0) return block('The generated-section marker appears more than once, so the write is refused.');
  const head = createHash('sha256').update(proposed.slice(0, at)).digest('hex');
  if (head !== me.headHash) return block('The generated part of this role file was changed, so the write is refused.');
  return pass;
}

// The hook runs behind this wrapper so a project that is not a team project pays no node start.
// Every path comes from the wrapper's own folder, so the caller's cwd cannot change the answer:
// the wrapper sits in <project>/.orca/team-orchestrator/guard/, so `..` is the store and `../../..` the project.
// Fast path: no output at all, so the CLI reads silence as "no opinion".
// Missing script: the store exists but the guard cannot run, so the call is refused rather than allowed.
export const MISSING_GUARD = 'The team store guard script is missing, so team store writes are refused. Reinstall Team Orchestrator from Orca.';
export function wrapperScript(platform = process.platform) {
  const block = JSON.stringify({ decision: 'block', reason: MISSING_GUARD });
  if (platform === 'win32') {
    return [
      '@echo off',
      'if not exist "%~dp0..\\team.sqlite" exit /b 0',
      'if not exist "%~dp0guard.mjs" (',
      `  echo ${block}`,
      '  exit /b 0',
      ')',
      'node "%~dp0guard.mjs" "%~dp0..\\..\\.."',
      '',
    ].join('\r\n');
  }
  return [
    '#!/bin/sh',
    'here=$(dirname "$0")',
    '[ -f "$here/../team.sqlite" ] || exit 0',
    `[ -f "$here/guard.mjs" ] || { printf '%s' '${block}'; exit 0; }`,
    'exec node "$here/guard.mjs" "$here/../../.."',
    '',
  ].join('\n');
}

// Row 77: a config entry that points at a deleted script fails open, so presence means both files, not just the entry.
export async function guardFilesPresent(pluginRoot = dirname(fileURLToPath(import.meta.url)), platform = process.platform) {
  const wrapper = join(pluginRoot, platform === 'win32' ? 'guard.cmd' : 'guard.sh');
  try {
    await stat(wrapper);
    await stat(join(pluginRoot, 'guard.mjs'));
    return { present: true, wrapper };
  } catch { return { present: false, wrapper }; }
}

// Standalone entry, run by the wrapper above with the project root as its one argument.
async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let payload = null;
  try { payload = JSON.parse(raw); } catch { /* decide() refuses an unreadable payload */ }
  const root = process.argv[2] || process.cwd();
  const readIdentity = () => JSON.parse(readFileSync(join(root, STORE, IDENTITY), 'utf8'));
  const answer = decide(payload, { readIdentity, projectRoot: root });
  if (answer.decision === 'block') process.stdout.write(JSON.stringify(answer));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
