import { rmTemp } from './temp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExecutor } from '../src/local/executor.mjs';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
async function fixture(t, workspace, repo) {
  const profile = await mkdtemp(join(tmpdir(), 'orca-scope-'));
  const store = await openTeamStore({ userData: profile });
  const cli = async args => {
    if (args[0] === 'worktree') {
      assert.deepEqual(args, ['worktree', 'show', '--worktree', workspace.id.startsWith('folder:') ? workspace.id : `id:${workspace.id}`]);
      return { worktree: { ...workspace, path: profile } };
    }
    assert.deepEqual(args, ['repo', 'show', '--repo', `id:${workspace.repoId}`]);
    return { repo };
  };
  const executor = createExecutor({ call: async () => {} }, cli, { store, userData: profile });
  t.after(async () => { executor.stopWork(); store.close(); await rmTemp(profile); });
  return { executor, context: () => executor.execute({ op: 'context', workspaceId: workspace.id }), store };
}
test('repo-backed non-Git folder is shown and saved as Folder with its exact composite identity', async t => {
  const f = await fixture(t, { id: 'repo-folder::/work', repoId: 'repo-folder', hostId: 'local' }, { id: 'repo-folder', kind: 'folder' });
  const selected = await f.context();
  assert.equal(selected.kind, 'folder');
  const { value } = await f.executor.execute({ op: 'createTeam', params: { form: DEFAULT_FORM, selectionToken: selected.selectionToken, requestId: 'create', expectedRevision: 0 } });
  assert.equal(value.teams[0].scope.kind, 'folder');
  assert.equal(f.store.readScope(value.teams[0].id).workspaceId, 'repo-folder::/work');
});
for (const [name, workspace, repo, kind] of [
  ['legacy synthetic folder', { id: 'folder:/work', hostId: 'local' }, undefined, 'folder'],
  ['composite Git', { id: 'git-repo::/work', repoId: 'git-repo', hostId: 'local' }, { id: 'git-repo', kind: 'git' }, 'git'],
  ['legacy repo with absent kind', { id: 'legacy-repo::/work', repoId: 'legacy-repo', hostId: 'local' }, { id: 'legacy-repo' }, 'git']
]) test(`${name} retains its native project kind`, async t => {
  const f = await fixture(t, workspace, repo);
  assert.equal((await f.context()).kind, kind);
});
for (const [name, workspace, repo, error] of [
  ['mismatching repository', { id: 'repo::/work', repoId: 'repo', hostId: 'local' }, { id: 'sibling', kind: 'folder' }, /repository identity/],
  ['missing repository', { id: 'repo::/work', repoId: 'repo', hostId: 'local' }, undefined, /repository identity/],
  ['missing repoId', { id: 'repo::/work', hostId: 'local' }, undefined, /repository identity/],
  ['unknown kind', { id: 'repo::/work', repoId: 'repo', hostId: 'local' }, { id: 'repo', kind: 'future' }, /repository kind/],
  ['null kind', { id: 'repo::/work', repoId: 'repo', hostId: 'local' }, { id: 'repo', kind: null }, /repository kind/]
]) test(`${name} refuses project selection`, async t => {
  const f = await fixture(t, workspace, repo);
  await assert.rejects(f.context(), error);
});
test('sibling folder instances and different execution hosts retain separate scope identities', async t => {
  const keys = [];
  for (const [id, hostId] of [['repo::/work', 'local'], ['repo::/work::workspace:11111111-2222-4333-8444-555555555555', 'local'], ['repo::/work', 'ssh:remote']]) {
    const f = await fixture(t, { id, repoId: 'repo', hostId }, { id: 'repo', kind: 'folder' });
    const selected = await f.context();
    assert.equal(selected.executionHostId, hostId);
    keys.push(selected.workspaceKey);
  }
  assert.equal(new Set(keys).size, 3);
});
