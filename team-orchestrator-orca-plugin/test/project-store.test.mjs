// Phase 1 of #149: the team store lives with the project, not in the Orca profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { rmTemp } from './temp.mjs';
import { openTeamStore } from '../src/local/store.mjs';
import { createExecutor } from '../src/local/executor.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';

const profile = async t => {
  const root = await mkdtemp(join(tmpdir(), 'store-profile-'));
  t.after(() => rmTemp(root));
  return root;
};
const project = async t => {
  const root = await mkdtemp(join(tmpdir(), 'store-project-'));
  t.after(() => rmTemp(root));
  return root;
};
const scope = { workspaceId: 'folder:/work', executionHostId: 'local', kind: 'folder', displayName: 'Work', workspaceKey: createHash('sha256').update(JSON.stringify(['folder:/work', 'local'])).digest('hex') };

test('a project-owned store is created inside the project, not in the Orca profile', async t => {
  const userData = await profile(t);
  const root = await project(t);
  const store = await openTeamStore({ userData, projectRoot: root });
  store.createTeam({ requestId: 'one', expectedRevision: 0, form: DEFAULT_FORM }, scope);
  store.close();

  const files = await readdir(join(root, '.orca', 'team-orchestrator'));
  assert.ok(files.includes('team.sqlite'), `expected team.sqlite, saw ${files.join(', ')}`);
  // nothing about teams is left in the profile
  await assert.rejects(readdir(join(userData, 'plugins-data', 'herman925.team-orchestrator')), { code: 'ENOENT' });
});

test('the profile store keeps its own name and location when no project root is given', async t => {
  const userData = await profile(t);
  const store = await openTeamStore({ userData });
  store.createTeam({ requestId: 'one', expectedRevision: 0, form: DEFAULT_FORM }, scope);
  store.close();

  const files = await readdir(join(userData, 'plugins-data', 'herman925.team-orchestrator'));
  assert.ok(files.includes('team-orchestrator.sqlite'), `expected team-orchestrator.sqlite, saw ${files.join(', ')}`);
});

test('a project store refuses a project root that is not an absolute path', async t => {
  const userData = await profile(t);
  await assert.rejects(openTeamStore({ userData, projectRoot: 'relative/dir' }), /verified project folder/i);
});

test('a project store refuses a project root that does not exist', async t => {
  const userData = await profile(t);
  const missing = join(userData, 'not-here');
  await assert.rejects(openTeamStore({ userData, projectRoot: missing }));
});

test('two projects each get their own store', async t => {
  const userData = await profile(t);
  const a = await project(t);
  const b = await project(t);
  const one = await openTeamStore({ userData, projectRoot: a });
  one.createTeam({ requestId: 'a', expectedRevision: 0, form: DEFAULT_FORM }, scope);
  one.close();
  const two = await openTeamStore({ userData, projectRoot: b });
  const teamsB = two.readSnapshot().teams.length;
  two.close();
  const three = await openTeamStore({ userData, projectRoot: a });
  const teamsA = three.readSnapshot().teams.length;
  three.close();
  assert.equal(teamsB, 0, 'the second project must not see the first project\'s team');
  assert.equal(teamsA, 1, 'the first project keeps its own team');
});

test('a project root inside the Orca profile is refused', async t => {
  const userData = await profile(t);
  const nested = join(userData, 'a-project');
  await mkdir(nested, { recursive: true });
  await assert.rejects(openTeamStore({ userData, projectRoot: nested }), /must be separate folders/);
});

test('an Orca profile inside the project root is refused', async t => {
  const root = await project(t);
  const userData = join(root, 'a-profile');
  await mkdir(userData, { recursive: true });
  await assert.rejects(openTeamStore({ userData, projectRoot: root }), /must be separate folders/);
});

test('a project store that fails names the project folder, not the profile', async t => {
  const userData = await profile(t);
  const root = await project(t);
  // make the .orca parent a file, so creating the store cannot succeed
  await writeFile(join(root, '.orca'), 'not a folder');
  await assert.rejects(openTeamStore({ userData, projectRoot: root }), /verified project folder/);
});

test('the store proxy binds methods to the real store, so a method that uses this keeps working', async t => {
  const userData = await profile(t);
  const root = await project(t);
  const real = await openTeamStore({ userData, projectRoot: root });
  real.createTeam({ requestId: 'one', expectedRevision: 0, form: DEFAULT_FORM }, scope);

  // the proxy shape createExecutor uses
  const proxy = new Proxy({}, {
    get(_target, prop) {
      const value = Reflect.get(real, prop);
      return typeof value === 'function' ? value.bind(real) : value;
    },
  });

  // a bound function names itself "bound <name>": that is the observable proof the proxy binds rather than copies
  assert.equal(real.readSnapshot.name, 'readSnapshot');
  assert.equal(proxy.readSnapshot.name, 'bound readSnapshot');
  assert.deepEqual(proxy.readSnapshot.call(null), real.readSnapshot());

  // the three methods that use `this` inside store.mjs are reachable through the proxy
  for (const name of ['readOwningWork', 'prepareDispatch', 'assertAdmission']) {
    assert.equal(typeof proxy[name], 'function', `${name} must resolve through the proxy`);
    assert.equal(proxy[name].name, `bound ${name}`, `${name} must be bound, not copied`);
  }
  real.close();
});

test('one real op end to end: createTeam then load land in the project folder, and the profile is untouched', async t => {
  const userData = await profile(t);
  const root = await project(t);
  const workspace = { id: 'folder:/work', hostId: 'local', kind: 'folder', displayName: 'Work' };
  const cli = async args => {
    assert.deepEqual(args, ['worktree', 'show', '--worktree', 'folder:/work']);
    return { worktree: { ...workspace, path: root } };
  };
  const opened = [];
  const executor = createExecutor({ call: async () => {} }, cli, { openStore: async path => { opened.push(path); return openTeamStore({ userData, projectRoot: path }); }, userData });
  t.after(() => executor.stopWork());

  const selected = await executor.execute({ op: 'context', workspaceId: workspace.id });
  const created = await executor.execute({ op: 'createTeam', workspaceId: workspace.id, params: { form: DEFAULT_FORM, selectionToken: selected.selectionToken, requestId: 'one', expectedRevision: 0 } });
  const teams = (await executor.execute({ op: 'load', workspaceId: workspace.id })).value.teams;

  assert.deepEqual(opened, [root], 'the executor must open the project store exactly once, at the project folder');
  assert.equal(created.value.teams.length, 1);
  assert.equal(teams.length, 1, 'the team must be readable back through the same proxy');
  const files = await readdir(join(root, '.orca', 'team-orchestrator'));
  assert.ok(files.includes('team.sqlite'), `expected team.sqlite in the project, saw ${files.join(', ')}`);
  await assert.rejects(readdir(join(userData, 'plugins-data', 'herman925.team-orchestrator')), { code: 'ENOENT' });
});
