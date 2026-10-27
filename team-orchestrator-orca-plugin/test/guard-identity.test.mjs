// The producer for guard/identity.json, and the round trip through the guard that reads it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { rmTemp } from './temp.mjs';
import { mergeRole, roleFilePath, roleText } from '../src/role-files.mjs';
import { decide, ROLE_MARKER } from '../src/local/guard.mjs';
import { identityEntry, storeRolePath, writeGuardIdentity } from '../src/local/guard-identity.mjs';

const team = { id: '11111111-1111-1111-1111-111111111111', name: 'One', purpose: '', configVersion: 1,
  members: [{ id: '22222222-2222-2222-2222-222222222222', name: 'A', boss: 'user', role: 'Head', roleVersion: 1, brief: 'b', habits: '', collaboration: '' }] };
const member = team.members[0];
const project = async t => {
  const root = await mkdtemp(join(tmpdir(), 'guard-identity-'));
  t.after(() => rmTemp(root));
  return root;
};
const openStore = async root => { await mkdir(join(root, '.orca', 'team-orchestrator'), { recursive: true }); await writeFile(join(root, '.orca', 'team-orchestrator', 'team.sqlite'), ''); };
const readIdentity = async root => JSON.parse(await readFile(join(root, '.orca', 'team-orchestrator', 'guard', 'identity.json'), 'utf8'));

test('an entry names the role file store-relative and hashes the generated text alone', () => {
  const entry = identityEntry(team, member, 'session-1');
  assert.equal(entry.roleFile, storeRolePath(team, member));
  assert.equal(entry.roleFile, roleFilePath(team, member).replace('.orca/team-orchestrator/', ''));
  assert.equal(entry.headHash, createHash('sha256').update(roleText(team, member)).digest('hex'));
});

test('a real generated role file passes through identity.json, a changed head is refused, and a replaced session is refused', async t => {
  const root = await project(t);
  await openStore(root);
  await writeGuardIdentity(root, [identityEntry(team, member, 'session-1')]);
  const written = await readIdentity(root);
  const call = (content, sessionId = 'session-1') => decide({ tool_name: 'Write', tool_input: { file_path: resolve(root, roleFilePath(team, member)), content }, session_id: sessionId }, { readIdentity: () => written, projectRoot: root });

  const file = mergeRole(undefined, roleText(team, member));
  assert.equal(call(file).decision, 'pass', 'the file the plugin writes must be accepted');

  const tampered = file.replace('Role: Head', 'Role: Owner');
  assert.equal(call(tampered).decision, 'block');

  const replaced = call(file, 'session-2');
  assert.equal(replaced.decision, 'block', 'a session id that is no longer on the roster must not write');
  assert.match(replaced.reason, /not on the team roster/);
});

test('a project with no team store is left untouched, and the caller is told why', async t => {
  const root = await project(t);
  const result = await writeGuardIdentity(root, [identityEntry(team, member, 'session-1')]);
  assert.equal(result.written, false);
  assert.match(result.reason, /no team store yet/);
  await assert.rejects(readFile(join(root, '.orca', 'team-orchestrator', 'guard', 'identity.json')), { code: 'ENOENT' });
  await assert.rejects(readdir(join(root, '.orca')), { code: 'ENOENT' }, 'the identity write must not create a folder in a project with no team');
});

test('the generated text is exactly the part before the marker, which the whole guard depends on', () => {
  const file = mergeRole(undefined, roleText(team, member));
  assert.equal(file.slice(0, file.indexOf(ROLE_MARKER)), roleText(team, member));
});

test('a member with no verified session loses its entry, because the file is replaced and never merged', async t => {
  const root = await project(t);
  await openStore(root);
  const other = { ...team, id: '33333333-3333-3333-3333-333333333333', members: [{ ...member, id: '44444444-4444-4444-4444-444444444444' }] };
  await writeGuardIdentity(root, [identityEntry(team, member, 'session-1'), identityEntry(other, other.members[0], 'session-2')]);
  assert.deepEqual(Object.keys((await readIdentity(root)).sessions).sort(), ['session-1', 'session-2']);
  await writeGuardIdentity(root, [identityEntry(team, member, 'session-1')]);
  assert.deepEqual(Object.keys((await readIdentity(root)).sessions), ['session-1'], 'the dropped member is removed, not left stale');
});
