import {parseTeamTemplate} from '../src/templates.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
const scope = (id = 'repo::/one', host = 'local') => ({ workspaceId: id, executionHostId: host, kind: id.startsWith('folder:') ? 'folder' : 'git', displayName: 'Project', workspaceKey: createHash('sha256').update(JSON.stringify([id, host])).digest('hex') });
async function profile(t) {
 const path = await mkdtemp(join(tmpdir(), 'template-profile-')); let store = await openTeamStore({ userData: path });
 t.after(async () => { store.close(); await rm(path, { recursive: true, force: true }); });
 return { path, get store() { return store; }, async restart() { store.close(); store = await openTeamStore({ userData: path }); } };
}
test('export to another profile imports independent IDs, roles and reporting tree without sessions or history', async t => {
 const source = await profile(t), target = await profile(t);
 const created = source.store.createTeam({ requestId: 'source', expectedRevision: 0, form: DEFAULT_FORM }, scope());
 const team = created.teams[0], head = team.members[0];
 source.store.updateRole({ requestId: 'role', expectedRevision: 1, teamId: team.id, memberId: head.id, brief: 'Review before accepting', habits: 'Read results first', collaboration: 'Escalate blockers' });
 source.store.beginLaunch({ requestId: 'launch', expectedRevision: 2, teamId: team.id, mode: 'all' });
 const template = source.store.exportTemplate(team.id);
 assert.equal(template.format, 'orca-team-template'); assert.equal(template.version, 1);
 assert.equal(JSON.stringify(template).includes(team.id), false);
 assert.equal(Object.hasOwn(template.team,'launch'), false);
 assert.equal(template.team.configuration.launchMode,'on-demand');
 let imported = target.store.importTemplate({ requestId: 'import', expectedRevision: 0, template }, scope('folder:/another', 'ssh:remote'));
 assert.equal(imported.teams.length, 1); const copy = imported.teams[0];
 assert.notEqual(copy.id, team.id); assert.equal(copy.launch, undefined); assert.equal(copy.configVersion, 1);
 assert.equal(copy.scope.kind, 'folder'); assert.equal(copy.scope.executionHostId, 'ssh:remote');
 assert.notEqual(copy.members[0].id, head.id); assert.equal(copy.members[1].boss, copy.members[0].id);
 assert.equal(copy.members[0].brief, 'Review before accepting'); assert.equal(copy.members[0].habits, 'Read results first');
 assert.equal(copy.members[0].roleVersion, 1);
 await target.restart(); assert.deepEqual(target.store.readSnapshot(), imported);
 assert.deepEqual(target.store.exportTemplate(copy.id), template);
 assert.equal(source.store.readSnapshot().teams[0].launch.configVersion, 2);
});
test('template preview validates version, bounded structure and a single reporting tree before writes', async t => {
 const { parseTeamTemplate } = await import('../src/templates.mjs'); const f = await profile(t);
 const source = f.store.createTeam({ requestId: 'team', expectedRevision: 0, form: DEFAULT_FORM }, scope()).teams[0];
 const template = f.store.exportTemplate(source.id);
 const mutations = [
   value => { value.version = 99; },
   value => { value.team.members[1].boss = 'missing'; },
   value => { value.team.members[0].boss = value.team.members[1].ref; },
   value => { value.team.members[1].ref = value.team.members[0].ref; },
   value => { value.team.members[1].boss = null; },
   value => { value.team.members[1].level = 3; },
   value => { value.team.members[0].sessionId = 'authority-must-not-import'; },
   value => { value.team.login = 'credential-must-not-import'; },
   value => { value.team.configuration.models = ['default']; },
   value => { value.team.members[0].brief = 'x'.repeat(1501); }
 ];
 for (const change of mutations) {
   const invalid = structuredClone(template); change(invalid);
   assert.throws(() => parseTeamTemplate(invalid), /template|Template|Unsupported/);
   assert.throws(() => f.store.importTemplate({ requestId: 'bad', expectedRevision: 1, template: invalid }, scope()), /template|Template|Unsupported/);
   assert.equal(f.store.readSnapshot().teams.length, 1);
 }
 assert.throws(() => parseTeamTemplate('{broken'), /valid JSON/);
 const reversed = structuredClone(template); reversed.team.members.reverse();
 const normalized = parseTeamTemplate(reversed);
 assert.equal(normalized.team.members[0].boss, null);
});
test('template preferences preserve opaque model/effort IDs and override intent while dropping observed evidence', async t => {
 const { exportTeamTemplate } = await import('../src/templates.mjs'); const f = await profile(t);
 const original = f.store.createTeam({ requestId: 'one', expectedRevision: 0, form: DEFAULT_FORM }, scope()).teams[0];
 const observed = structuredClone(original);
 observed.sessionId = 'never-export-session'; observed.login = { token: 'never-export-credential' }; observed.works = [{ run: 'never-export-run' }];
 observed.members[0].effectiveModel = 'never-export-effective'; observed.members[0].capabilities = { secret: 'never-export-capability' };
 const template = exportTeamTemplate(observed);
 assert.equal(JSON.stringify(template).includes('never-export'), false);
 template.team.configuration.models[0] = 'provider/private:model-v7'; template.team.configuration.efforts[0] = 'balanced';
 Object.assign(template.team.members[0], { model: 'provider/private:model-v7', effort: 'balanced', preferenceOverride: false });
 Object.assign(template.team.members[1], { agent: 'claude', model: 'custom-provider/sonnet', effort: 'adaptive', preferenceOverride: true });
 const saved = f.store.importTemplate({ requestId: 'preferences', expectedRevision: 1, template }, scope());
 assert.equal(saved.teams[1].members[0].effort, 'balanced'); assert.equal(saved.teams[1].members[0].preferenceOverride, false);
 assert.equal(saved.teams[1].members[1].model, 'custom-provider/sonnet'); assert.equal(saved.teams[1].members[1].effort, 'adaptive');
 assert.equal(saved.teams[1].members[1].preferenceOverride, true);
 assert.deepEqual(f.store.exportTemplate(saved.teams[1].id), template);
});
test('import requires the reviewed template and confirmed native target, and replays after worker restart', async t => {
 const { createExecutor } = await import('../src/local/executor.mjs'); const f = await profile(t);
 const original = f.store.createTeam({ requestId: 'original', expectedRevision: 0, form: DEFAULT_FORM }, scope()).teams[0];
 const calls = []; const cli = async args => { calls.push(args); return { worktree: { id: args[3], hostId: 'ssh:target', displayName: 'Target folder' } }; };
 const executor = createExecutor({}, cli, { store: f.store });
 const exported = await executor.execute({ op: 'exportTemplate', params: { teamId: original.id } });
 const preview = await executor.execute({ op: 'previewTemplate', params: { template: exported.template } });
 assert.equal(preview.template.team.members.length, 4); assert.ok(preview.previewToken);
 const context = await executor.execute({ op: 'context', workspaceId: 'folder:/target' });
 const params = { requestId: 'copy', expectedRevision: 1, template: preview.template, previewToken: preview.previewToken, selectionToken: context.selectionToken };
 await assert.rejects(executor.execute({ op: 'importTemplate', params: { ...params, previewToken: 'not-reviewed' } }), /preview/i);
 const changed = structuredClone(params); changed.template.team.members[0].brief = 'Unreviewed change';
 await assert.rejects(executor.execute({ op: 'importTemplate', params: changed }), /preview/i);
 const saved = await executor.execute({ op: 'importTemplate', workspaceId: 'changed-focus', params });
 assert.equal(saved.value.teams.length, 2); assert.equal(saved.value.teams[1].scope.executionHostId, 'ssh:target');
 assert.equal(saved.value.teams[1].name, original.name); assert.equal(saved.value.teams[1].launch, undefined);
 assert.ok(calls.every(args => args[0] === 'worktree'));
 await f.restart(); const resumed = createExecutor({}, async () => { throw Error('host unavailable'); }, { store: f.store });
 assert.deepEqual(await resumed.execute({ op: 'importTemplate', params }), saved);
 assert.equal(f.store.readSnapshot().teams.length, 2);
});
test('failed import rolls back completely and its retry remains idempotent without replacing existing teams', async t => {
 const { DatabaseSync } = await import('node:sqlite'); const f = await profile(t);
 const original = f.store.createTeam({ requestId: 'team', expectedRevision: 0, form: DEFAULT_FORM }, scope());
 const template = f.store.exportTemplate(original.teams[0].id);
 const request = { requestId: 'copy-once', expectedRevision: 1, template };
 const db = new DatabaseSync(join(f.path, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'));
 db.exec("CREATE TRIGGER refuse_import BEFORE UPDATE ON snapshot BEGIN SELECT RAISE(ABORT, 'disk full fixture'); END");
 assert.throws(() => f.store.importTemplate(request, scope()), /disk full/); assert.deepEqual(f.store.readSnapshot(), original);
 db.exec('DROP TRIGGER refuse_import'); db.close();
 const copied = f.store.importTemplate(request, scope()); assert.equal(copied.teams.length, 2);
 assert.deepEqual(copied.teams[0], original.teams[0]); assert.notEqual(copied.teams[1].id, copied.teams[0].id);
 await f.restart(); assert.deepEqual(f.store.importTemplate(request, scope()), copied);
 assert.throws(() => f.store.importTemplate({ ...request, requestId: 'stale' }, scope()), /Another panel/);
 assert.equal(f.store.readSnapshot().teams.length, 2);
});
test('native panel bridge admits bounded full-roster templates but keeps ordinary operations and oversized input limited', async () => {
 const { installAdapter } = await import('../src/local/adapter.mjs');
 const { exportTeamTemplate, MAX_TEMPLATE_BYTES } = await import('../src/templates.mjs');
 const { planTeam, PRESETS } = await import('../src/team.mjs');
 const team = planTeam({ ...DEFAULT_FORM, ...PRESETS[2].form });
 team.members.forEach(member => Object.assign(member, { brief: 'r'.repeat(1500), habits: 'h'.repeat(1500), collaboration: 'c'.repeat(1500) }));
 const template = exportTeamTemplate(team); assert.ok(Buffer.byteLength(JSON.stringify(template)) > 60000);
 const handlers = new Map(); let calls = 0;
 const ipcMain = { _invokeHandlers: handlers, handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) };
 handlers.set('plugins:readPanelEntry', async () => ({ sessionToken: 'template-owner' }));
 handlers.set('plugins:panelAction', async () => ({ ok: true }));
 handlers.set('plugins:invokeCommand', async (_, args) => { calls++; return { operation: args.args.op }; });
 const mainFrame = {}; const event = { sender: { id: 8, mainFrame }, senderFrame: mainFrame };
 await installAdapter({ ipcMain }, { version: 'fixture', identity: 'template-boundary' });
 try {
   const call = (op, params) => handlers.get('plugins:panelAction')(event, { sessionToken: 'template-owner', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, commandId: 'team.control', nonce: 'template', args: { op, params } } } });
   assert.equal((await call('previewTemplate', { template })).value.operation, 'previewTemplate');
   assert.equal((await call('load', { template })).code, 'invalid_params');
   assert.equal((await call('previewTemplate', { template: 'x'.repeat(MAX_TEMPLATE_BYTES + 8192) })).code, 'invalid_params');
   assert.equal(calls, 1);
 } finally { globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore(); }
});

test('older v1 templates without preparation mode inherit on demand',async t=>{
 const source=await profile(t),team=source.store.createTeam({requestId:'legacy-mode',expectedRevision:0,form:DEFAULT_FORM},scope()).teams[0];
 const template=source.store.exportTemplate(team.id);delete template.team.configuration.launchMode;
 assert.equal(parseTeamTemplate(JSON.stringify(template)).team.configuration.launchMode,'on-demand');
});
