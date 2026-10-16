import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
const scope = { workspaceId: 'folder:/private/project', executionHostId: 'local', kind: 'folder', displayName: 'Documents', workspaceKey: createHash('sha256').update(JSON.stringify(['folder:/private/project', 'local'])).digest('hex') };
async function fixture(t) {
 const profile = await mkdtemp(join(tmpdir(), 'team-store-'));
 let store = await openTeamStore({ userData: profile });
 t.after(async () => { store.close(); await rm(profile, { recursive: true, force: true }); });
 return { profile, get store() { return store; }, async restart() { store.close(); store = await openTeamStore({ userData: profile }); return store; } };
}
test('saved team and UUID roster survive worker restart without importing legacy data or launching agents', async t => {
 const f = await fixture(t);
 const result = f.store.createTeam({ requestId: 'create-one', expectedRevision: 0, form: DEFAULT_FORM }, scope);
 assert.equal(result.revision, 1); assert.equal(result.teams.length, 1);
 const team = result.teams[0];
 assert.equal(team.members.length, 4); assert.equal(team.scope.displayName, 'Documents');
 assert.equal(team.launch, undefined); assert.equal(team.configVersion, 1);
 assert.notEqual(team.members[0].id, 'member-1');
 assert.equal(team.members[1].boss, team.members[0].id);
 assert.equal(JSON.stringify(result).includes('/private/project'), false);
 await f.restart();
 assert.deepEqual(f.store.readSnapshot(), result);
 assert.equal(f.store.readScope(team.id).workspaceId, scope.workspaceId);
});
test('role edits create immutable versions and reject stale panels without losing another team of the same name', async t => {
 const f = await fixture(t);
 let state = f.store.createTeam({ requestId: 'one', expectedRevision: 0, form: DEFAULT_FORM }, scope);
 const team = state.teams[0], member = team.members[0];
 state = f.store.updateRole({ requestId: 'role-edit', expectedRevision: 1, teamId: team.id, memberId: member.id, brief: 'Review every result', habits: 'Summarize blockers first', collaboration: 'Ask the head before changing scope' });
 assert.equal(state.teams[0].members[0].roleVersion, 2);
 assert.equal(state.teams[0].configVersion, 2);
 assert.equal(f.store.readTeamVersion(team.id, 1).members[0].brief, member.brief);
 assert.equal(f.store.readRoleVersion(member.id, 1).brief, member.brief);
 assert.throws(() => f.store.updateRole({ requestId: 'stale', expectedRevision: 1, teamId: team.id, memberId: member.id, brief: 'Overwrite', habits: '', collaboration: '' }), /Another panel/);
 state = f.store.createTeam({ requestId: 'two', expectedRevision: 2, form: DEFAULT_FORM }, scope);
 assert.equal(state.teams.length, 2); assert.notEqual(state.teams[0].id, state.teams[1].id);
 assert.notEqual(state.teams[0].members[0].id, state.teams[1].members[0].id);
 assert.equal(state.teams[0].members[0].habits, 'Summarize blockers first');
 await f.restart(); assert.deepEqual(f.store.readSnapshot(), state);
});
test('request replay is idempotent and invalid role edits roll back without consuming their revision', async t => {
 const f = await fixture(t);
 const input = { requestId: 'one', expectedRevision: 0, form: DEFAULT_FORM };
 const state = f.store.createTeam(input, scope);
 assert.deepEqual(f.store.createTeam(input, scope), state);
 assert.throws(() => f.store.createTeam({ ...input, form: { ...DEFAULT_FORM, name: 'Other' } }, scope), /conflicts/);
 assert.throws(() => f.store.updateRole({ requestId: 'bad-role', expectedRevision: 1, teamId: state.teams[0].id, memberId: state.teams[0].members[0].id, brief: 'Updated', habits: 3, collaboration: '' }), /Role text/);
 assert.deepEqual(f.store.readSnapshot(), state);
 const updated = f.store.updateSettings({ requestId: 'settings', expectedRevision: 1, settings: { chart: false, layout: 'columns' } });
 assert.equal(updated.revision, 2); assert.equal(updated.settings.chart, false);
});
test('missing SQLite, corrupt files and unknown schema never reset or overwrite saved data', async t => {
 const f = await fixture(t);
 await assert.rejects(openTeamStore({ userData: f.profile, sqlite: async () => { throw Error('missing'); } }), /node:sqlite/);
 f.store.close();
 const path = join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite');
 const bytes = Buffer.from('not a database - keep this evidence'); await writeFile(path, bytes);
 await assert.rejects(openTeamStore({ userData: f.profile }), /Cannot open team storage/);
 assert.deepEqual(await readFile(path), bytes);
});
test('executor binds confirmed folder/SSH scope, ignores later focus, and never trusts a panel supplied scope', async t => {
 const { createExecutor } = await import('../src/local/executor.mjs');
 const f = await fixture(t); const selectors = [];
 const cli = async args => { selectors.push(args[3]); return { worktree: { id: args[3].startsWith('folder:') ? args[3] : args[3].slice(3), hostId: 'ssh:build', displayName: 'Remote folder', git: { path: '/srv/project' } } }; };
 const executor = createExecutor({ call: async () => { throw Error('Legacy storage must not be accessed'); } }, cli, { store: f.store });
 const context = await executor.execute({ op: 'context', workspaceId: 'folder:/srv/project' });
 assert.equal(context.kind, 'folder'); assert.equal(context.executionHostId, 'ssh:build');
 assert.ok(context.selectionToken); assert.equal(JSON.stringify(context).includes('/srv/project'), false);
 const state = (await executor.execute({ op: 'createTeam', workspaceId: 'other-focus', params: { form: DEFAULT_FORM, selectionToken: context.selectionToken, expectedRevision: 0, requestId: 'save', scope: { workspaceId: 'forged' } } })).value;
 assert.equal(state.teams[0].scope.executionHostId, 'ssh:build');
 assert.equal(f.store.readScope(state.teams[0].id).workspaceId, 'folder:/srv/project');
 assert.equal(selectors.at(-1), 'folder:/srv/project');
 await assert.rejects(executor.execute({ op: 'createTeam', params: { form: DEFAULT_FORM, selectionToken: 'forged', expectedRevision: 1, requestId: 'bad' } }), /Confirm/);
});

test('a symlinked plugin data directory cannot write outside the verified profile', async t => {
 const { symlink, readdir } = await import('node:fs/promises');
 const root = await mkdtemp(join(tmpdir(), 'team-path-'));
 t.after(() => rm(root, { recursive: true, force: true }));
 const profile = join(root, 'profile'), outside = join(root, 'outside');
 await mkdir(profile); await mkdir(outside); await symlink(outside, join(profile, 'plugins-data'));
 await assert.rejects(openTeamStore({ userData: profile }), /escapes/);
 assert.deepEqual(await readdir(outside), []);
});
test('an actual SQLite write failure rolls back team creation and permits a corrected retry', async t => {
 const { DatabaseSync } = await import('node:sqlite'); const f = await fixture(t);
 const fault = new DatabaseSync(join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));
 fault.exec("CREATE TRIGGER fail_save BEFORE UPDATE ON snapshot BEGIN SELECT RAISE(ABORT, 'disk full fixture'); END");
 const input = { requestId: 'failed-save', expectedRevision: 0, form: DEFAULT_FORM };
 assert.throws(() => f.store.createTeam(input, scope), /disk full/);
 assert.equal(f.store.readSnapshot().revision, 0); assert.equal(f.store.readSnapshot().teams.length, 0);
 fault.exec('DROP TRIGGER fail_save'); fault.close();
 assert.equal(f.store.createTeam(input, scope).teams.length, 1);
});
test('newer schema preserves all bytes and refuses opening rather than initializing empty data', async t => {
 const { DatabaseSync } = await import('node:sqlite'); const f = await fixture(t);
 f.store.close(); const path = join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite');
 const future = new DatabaseSync(path); future.exec('PRAGMA user_version=99'); future.close();
 const before = await readFile(path);
 await assert.rejects(openTeamStore({ userData: f.profile }), /Unsupported team database schema/);
 assert.deepEqual(await readFile(path), before);
});
test('completed creation can be recovered after worker restart without repeating scope admission or creating another team', async t => {
 const { createExecutor } = await import('../src/local/executor.mjs'); const f = await fixture(t);
 const cli = async () => ({ worktree: { id: 'folder:/private/project', hostId: 'local', displayName: 'Documents' } });
 const first = createExecutor({}, cli, { store: f.store });
 const selected = await first.execute({ op: 'context', workspaceId: scope.workspaceId });
 const request = { op: 'createTeam', params: { requestId: 'replay', expectedRevision: 0, form: DEFAULT_FORM, selectionToken: selected.selectionToken } };
 const saved = await first.execute(request); await f.restart();
 const resumed = createExecutor({}, async () => { throw Error('Host unavailable after restart'); }, { store: f.store });
 assert.deepEqual(await resumed.execute(request), saved);
 assert.equal(f.store.readSnapshot().teams.length, 1);
 await assert.rejects(resumed.execute({ ...request, params: { ...request.params, form: { ...DEFAULT_FORM, name: 'Different' } } }), /conflicts/);
});
test('nested roster corruption blocks loading and later mutations without replacing damaged evidence', async t => {
 const { DatabaseSync } = await import('node:sqlite'); const f = await fixture(t);
 const saved = f.store.createTeam({ requestId: 'team', expectedRevision: 0, form: DEFAULT_FORM }, scope);
 const corrupted = structuredClone(saved); corrupted.teams[0].members[1].boss = 'missing-member';
 const fault = new DatabaseSync(join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));
 fault.prepare('UPDATE snapshot SET json=?').run(JSON.stringify(corrupted));
 assert.throws(() => f.store.readSnapshot(), /reporting relationships/);
 assert.throws(() => f.store.updateSettings({ requestId: 'setting', expectedRevision: 1, settings: { chart: false, layout: 'columns' } }), /reporting relationships/);
 assert.equal(fault.prepare('SELECT json FROM snapshot').get().json, JSON.stringify(corrupted)); fault.close();
});
test('unavailable profile reports a recovery error without exposing internal filesystem paths', async () => {
 const privatePath = '/private/missing-orca-profile-for-test';
 await assert.rejects(openTeamStore({ userData: privatePath }), error => /profile/i.test(error.message) && !error.message.includes(privatePath));
});
test('replaying the same mutation does not depend on JSON property order', async t => {
 const f = await fixture(t);
 const saved = f.store.createTeam({ requestId: 'same', expectedRevision: 0, form: DEFAULT_FORM }, scope);
 assert.deepEqual(f.store.createTeam({ form: { ...DEFAULT_FORM }, expectedRevision: 0, requestId: 'same' }, scope), saved);
});
test('level preferences and individual overrides preserve mixed agents and provider-specific effort across restart', async t => {
 const f = await fixture(t);
 let state = f.store.createTeam({ requestId: 'prefs-team', expectedRevision: 0, form: DEFAULT_FORM }, scope);
 const team = state.teams[0];
 state = f.store.updateAgentPreferences({ requestId: 'level', expectedRevision: 1, teamId: team.id, level: 2, agent: 'claude', model: 'host-opus', effort: 'max' });
 assert.equal(state.teams[0].members[1].agent, 'claude');
 assert.equal(state.teams[0].members[2].effort, 'max');
 state = f.store.updateAgentPreferences({ requestId: 'individual', expectedRevision: 2, teamId: team.id, memberId: team.members[1].id, agent: 'codex', model: 'host-model', effort: 'ultra' });
 state = f.store.updateAgentPreferences({ requestId: 'level-again', expectedRevision: 3, teamId: team.id, level: 2, agent: 'claude', model: 'host-sonnet', effort: 'low' });
 assert.equal(state.teams[0].members[1].model, 'host-model');
 assert.equal(state.teams[0].members[2].model, 'host-sonnet');
 assert.equal(f.store.readTeamVersion(team.id, 1).members[1].model, 'default');
 await f.restart(); assert.deepEqual(f.store.readSnapshot(), state);
 state = f.store.updateAgentPreferences({ requestId: 'inherit', expectedRevision: 4, teamId: team.id, memberId: team.members[1].id, inherit: true });
 assert.equal(state.teams[0].members[1].model, 'host-sonnet');
 assert.equal(state.teams[0].members[1].preferenceOverride, false);
});
