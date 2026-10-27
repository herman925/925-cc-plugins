// The producer for guard/identity.json. The guard refuses every store write until this file names the session.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { roleFilePath, roleText } from '../role-files.mjs';

export const STORE = '.orca/team-orchestrator';
export const IDENTITY = 'guard/identity.json';
// The guard compares store-relative paths, so the project prefix that roleFilePath() returns is dropped here.
export const storeRolePath = (team, member) => roleFilePath(team, member).replace(/^\.orca\/team-orchestrator\//, '');

// The head is the generated text alone, exactly as mergeRole() joins it to the marker and the notes.
export function identityEntry(team, member, sessionId) {
  return { sessionId, roleFile: storeRolePath(team, member), headHash: createHash('sha256').update(roleText(team, member)).digest('hex') };
}

// A full replacement, never a merge: a member missing from this pass loses its entry, because a stale session id
// is write access for a terminal that no longer exists.
export async function writeGuardIdentity(projectRoot, entries) {
  // Row 3: a project with no team store is left untouched. The identity file is a write into the repository,
  // and it belongs to a store that already exists, so it never creates the folder that holds it.
  try { await stat(join(projectRoot, STORE, 'team.sqlite')); }
  catch { return { written: false, reason: 'This project has no team store yet, so no guard identity was written.' }; }
  const directory = join(projectRoot, STORE, 'guard');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const sessions = {};
  for (const { sessionId, roleFile, headHash } of entries) sessions[sessionId] = { roleFile, headHash };
  const text = JSON.stringify({ schema: 1, sessions }, null, 2) + '\n';
  const path = join(directory, 'identity.json'), temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path);
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  return { written: true };
}
