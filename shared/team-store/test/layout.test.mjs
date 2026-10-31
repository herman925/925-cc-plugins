import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openTeamStore } from '../index.mjs';
import { runtimeFixture } from './support/runtime-fixture.mjs';
import { postgresTestUrl } from './support/engines.mjs';

export const caller = { principalId: 'configuration-test-client' };
export const mod = { client: 'team-orchestrator', version: '0.5.42', protocol: 1 };
export const plugin = { client: 'team-orchestrator-orca', version: '0.1.24', protocol: 1 };
export const settings = { autoClose: true, idleMinutes: 10, reopen: 'resume', maxOpen: 4, launch: 'demand', batch: 2,
  autoScratch: true, assumptions: false, scratchDir: 'scratch', pickupWindowMinutes: 3, answerWindowMinutes: 5, taskWindowMinutes: null, replayIntervalMs: 1000, exemptMemberIds: [] };
export const member = (id, extra = {}) => ({ memberId: id, name: id, bossMemberId: null, role: 'worker', level: 1,
  model: 'model', effort: 'high', worktree: null, registeredHome: null, machineId: null, location: null,
  membershipState: 'active', address: null, shortName: null, cli: null, allowAgent: false, allowWrite: false, ...extra });
export const request = (operationId, ...mutations) => ({ operationId, caller, mutations });
const code = expected => error => error.code === expected;

async function setup(t, engine) {
  const stores = [];
  t.after(async () => { for (const s of stores.reverse()) await s.close(); });
  const f = await runtimeFixture(t, engine);
  const options = { ...f.options, caller, authorize: () => true, machineId: 'machine', holderToken: 'same-holder', retryDelayMs: 0 };
  const open = async writer => { const s = await openTeamStore({ ...options, writer }); stores.push(s); return s; };
  const store = await openTeamStore({ ...options, create: true, writer: mod }); stores.push(store);
  const raw = async (sql, params) => {
    const db = await f.raw();
    try { await db.begin(); const rows = await db.query(sql, params); await db.commit(); return rows; }
    catch (error) { await db.rollback().catch(() => {}); throw error; }
    finally { await db.close(); }
  };
  const config = () => store.getTeamConfiguration({ teamId: 'team', caller });
  await store.execute(request('team', { type: 'createTeam', teamId: 'team', name: 'Team', functionText: 'Tests', settings }));
  return { ...f, store, open, raw, config, options };
}

for (const engine of ['sqlite', 'postgres']) describe(`${engine} schema 3 configuration`, { skip: engine === 'postgres' && !postgresTestUrl() }, () => {
  test('older binary freshly rereads newest config generation still refused', async t => {
    const f = await setup(t, engine), newer = await f.open({ ...mod, version: '0.5.43' });
    await newer.execute(request('newer', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings: { ...settings, pickupWindowMinutes: 5 } }));
    const fresh = await f.config();
    assert.equal(fresh.team.config_version, 2);
    await assert.rejects(f.store.execute(request('old-but-fresh', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: fresh.team.config_version, settings })), code('STORE_WRITER_TOO_OLD'));
    assert.equal((await f.config()).settings.pickup_window_minutes, 5);
    assert.equal((await f.raw('SELECT operation_id FROM operations')).length, 2);
  });

  test('writer release fences are numeric and independent for Mod and plugin', async t => {
    const f = await setup(t, engine), other = await f.open(plugin);
    await other.execute(request('plugin', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings }));
    const major = await f.open({ ...mod, version: '0.10.0' });
    await major.execute(request('numeric', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 2, settings }));
    const rows = await f.raw('SELECT writer_client,writer_version FROM writer_fences ORDER BY writer_client');
    assert.deepEqual(rows.map(r => r.writer_version), ['0.10.0', '0.1.24']);
    await other.execute(request('plugin-again', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 3, settings }));
    for (const version of ['1.0', '01.0.0', '1.0.0-beta', '1.0.0+meta']) await assert.rejects(f.open({ ...mod, version }), code('STORE_WRITER_VERSION_INVALID'));
    await assert.rejects(f.open({ ...mod, client: 'arbitrary' }), code('STORE_WRITER_FAMILY_UNKNOWN'));
    await assert.rejects(f.open({ ...mod, protocol: 2 }), code('STORE_WRITER_PROTOCOL_UNSUPPORTED'));
  });

  test('missing known writer fences and raised protocol floors refuse explicitly', async t => {
    const f = await setup(t, engine);
    await f.raw("DELETE FROM writer_fences WHERE writer_client='team-orchestrator-orca'");
    const other = await f.open(plugin);
    await assert.rejects(other.execute(request('missing-fence', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings })), code('STORE_WRITER_FENCE_MISSING'));
    await f.raw('UPDATE project_identity SET minimum_writer_protocol=2');
    await assert.rejects(f.store.execute(request('old-protocol', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings })), code('STORE_WRITER_PROTOCOL_OLD'));
    await assert.rejects(f.config(), code('STORE_WRITER_PROTOCOL_OLD'));
    assert.equal((await f.raw("SELECT writer_version FROM writer_fences WHERE writer_client='team-orchestrator'"))[0].writer_version, mod.version);
  });

  test('configuration CAS, references and writer fence advance roll back atomically', async t => {
    const f = await setup(t, engine), newer = await f.open({ ...mod, version: '9.0.0' });
    await assert.rejects(newer.execute(request('missing-exemption', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1,
      settings: { ...settings, exemptMemberIds: ['absent'] } })), e => e.code === 'STORE_REFERENCE_MISSING' && e.message.includes('absent'));
    await assert.rejects(newer.execute(request('stale-config', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 9, settings })), code('STORE_CONFIG_CONFLICT'));
    assert.equal((await f.config()).team.config_version, 1);
    assert.equal((await f.raw("SELECT writer_version FROM writer_fences WHERE writer_client='team-orchestrator'"))[0].writer_version, mod.version);
    assert.equal((await f.raw('SELECT operation_id FROM operations')).length, 1);
  });

  test('pickup minutes are explicit positive integers and all settings round trip', async t => {
    const f = await setup(t, engine);
    const { pickupWindowMinutes, ...missing } = settings;
    for (const [value, expected] of [[missing, 'STORE_PICKUP_WINDOW_REQUIRED'], [{ ...settings, pickupWindowMinutes: 0 }, 'STORE_INPUT_INVALID'], [{ ...settings, pickupWindowMinutes: 1.5 }, 'STORE_INPUT_INVALID']]) {
      await assert.rejects(f.store.execute(request(`bad-${expected}-${value.pickupWindowMinutes}`, { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings: value })), code(expected));
    }
    const cfg = await f.config();
    assert.equal(cfg.settings.pickup_window_minutes, 3); assert.equal(cfg.settings.batch_size, 2);
    assert.equal(Number(cfg.settings.auto_close), 1); assert.equal(cfg.settings.scratch_dir, 'scratch');
    assert.deepEqual(cfg.members, []); assert.deepEqual(cfg.roleDocuments, []);
    const id = await f.store.getIdentity({ caller });
    assert.match(id.projectId, /^[0-9a-f-]{36}$/); assert.equal((await f.store.getIdentity({ caller })).projectId, id.projectId);
  });

  test('global names, boss references and cycles refuse with member identities', async t => {
    const f = await setup(t, engine);
    const put = (id, version, extra = {}, expectedGeneration = 0) => ({ type: 'putMember', teamId: 'team', expectedConfigVersion: version, expectedGeneration, member: member(id, extra) });
    await f.store.execute(request('head', put('head', 1)));
    await f.store.execute(request('worker', put('worker', 2, { bossMemberId: 'head' })));
    await assert.rejects(f.store.execute(request('cycle', put('head', 3, { bossMemberId: 'worker' }, 1))), code('STORE_HIERARCHY_CYCLE'));
    await assert.rejects(f.store.execute(request('boss', put('third', 3, { bossMemberId: 'missing-boss' }))), e => e.code === 'STORE_REFERENCE_MISSING' && e.message.includes('missing-boss'));
    await f.store.execute(request('team-two', { type: 'createTeam', teamId: 'two', name: 'Two', functionText: '', settings }));
    await assert.rejects(f.store.execute(request('name', { ...put('third', 1, { name: 'worker' }), teamId: 'two' })), code('STORE_MEMBER_NAME_EXISTS'));
    assert.equal((await f.config()).members.length, 2);
  });

  test('registered home is immutable and advisory notes cannot change official role or permissions', async t => {
    const f = await setup(t, engine);
    const home = { contextKind: 'worktree', executionHostId: 'host', originalPath: 'C:/original' };
    const m = member('head', { role: 'head', registeredHome: home, allowWrite: true });
    await f.store.execute(request('member', { type: 'putMember', teamId: 'team', expectedConfigVersion: 1, expectedGeneration: 0, member: m }));
    await assert.rejects(f.store.execute(request('move', { type: 'putMember', teamId: 'team', expectedConfigVersion: 2, expectedGeneration: 1, member: { ...m, registeredHome: { ...home, originalPath: 'D:/new' } } })), code('STORE_HOME_IMMUTABLE'));
    await f.store.execute(request('role', { type: 'createRoleDocument', teamId: 'team', expectedConfigVersion: 2, memberId: 'head', officialText: 'Official', advisoryNotes: '' }));
    await f.store.execute(request('notes', { type: 'updateAdvisoryNotes', teamId: 'team', expectedConfigVersion: 3, memberId: 'head', expectedGeneration: 1, advisoryNotes: 'Suggestions' }));
    let cfg = await f.config(), doc = cfg.roleDocuments[0];
    assert.equal(doc.official_text, 'Official'); assert.equal(doc.official_generation, 1); assert.equal(doc.notes_generation, 2);
    assert.equal(cfg.members[0].role, 'head'); assert.equal(Number(cfg.members[0].allow_write), 1);
    await f.store.execute(request('official', { type: 'updateOfficialRole', teamId: 'team', expectedConfigVersion: 4, memberId: 'head', expectedGeneration: 1, officialText: 'Revised' }));
    doc = (await f.config()).roleDocuments[0]; assert.equal(doc.advisory_notes, 'Suggestions'); assert.equal(doc.notes_generation, 2); assert.equal(doc.official_generation, 2);
    await assert.rejects(f.store.execute(request('role-missing', { type: 'createRoleDocument', teamId: 'team', expectedConfigVersion: 5, memberId: 'missing', officialText: '', advisoryNotes: '' })), code('STORE_REFERENCE_MISSING'));
  });

  test('new required references never fabricate defaults; admission snapshots pickup and endpoints canonicalize', async t => {
    const f = await setup(t, engine);
    for (const mutation of [{ type: 'createRun', runId: 'old' }, { type: 'openThread', threadId: 'old', runId: 'old' }, { type: 'admitAssignment', assignmentId: 'old', taskId: 'old', memberId: 'old' }]) {
      await assert.rejects(f.store.execute(request(`old-${mutation.type}`, mutation)), code('STORE_INPUT_INVALID'));
    }
    await assert.rejects(f.store.execute(request('missing-team', { type: 'createRun', runId: 'r', teamId: 'missing' })), code('STORE_REFERENCE_MISSING'));
    await f.store.execute(request('roster', ...['head', 'worker'].map((id, i) => ({ type: 'putMember', teamId: 'team', expectedConfigVersion: i + 1, expectedGeneration: 0, member: member(id) }))));
    const result = await f.store.execute(request('admit', { type: 'createRun', runId: 'r', teamId: 'team' }, { type: 'createTask', taskId: 't', runId: 'r' },
      { type: 'admitAssignment', assignmentId: 'a', taskId: 't', memberId: 'worker', assignedByMemberId: 'head' }));
    assert.equal(result.result[2].pickupDeadlineMs - result.result[2].admittedAtMs, 180000);
    const thread = { type: 'openThread', threadId: 'thread', runId: 'r', teamId: 'team', taskId: 't', endpointAMemberId: 'worker', endpointBMemberId: 'head' };
    const first = await f.store.execute(request('thread', thread));
    assert.deepEqual(await f.store.execute(request('thread', { ...thread, endpointAMemberId: 'head', endpointBMemberId: 'worker' })), first);
    await assert.rejects(f.store.execute(request('duplicate', { ...thread, threadId: 'other' })), code('STORE_THREAD_EXISTS'));
    await f.raw("UPDATE threads SET status='superseded' WHERE thread_id='thread'");
    await assert.rejects(f.store.execute(request('answer-closed', { type: 'answerThread', threadId: 'thread', runId: 'r', consumerGeneration: 1, expectedGeneration: 1, answer: 'answer' })), code('STORE_CONFLICT'));
  });

  test('schema 4 requires explicit answer, task-off and replay settings', async t => {
    const f = await setup(t, engine);
    for (const [field, expected] of [['answerWindowMinutes', 'STORE_ANSWER_WINDOW_REQUIRED'], ['taskWindowMinutes', 'STORE_TASK_WINDOW_REQUIRED'], ['replayIntervalMs', 'STORE_REPLAY_INTERVAL_REQUIRED']]) {
      const value = { ...settings }; delete value[field];
      await assert.rejects(f.store.execute(request(`missing-${field}`, { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings: value })), code(expected));
    }
    for (const field of ['answerWindowMinutes', 'taskWindowMinutes', 'replayIntervalMs']) for (const invalid of [0, 1.5]) {
      await assert.rejects(f.store.execute(request(`bad-${field}-${invalid}`, {
        type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 1, settings: { ...settings, [field]: invalid },
      })), code('STORE_INPUT_INVALID'));
    }
    const cfg = await f.config(); assert.equal(cfg.settings.task_window_minutes, null);
    assert.equal(cfg.settings.answer_window_minutes, 5); assert.equal(cfg.settings.replay_interval_ms, 1000);
  });

  test('schema 4 team-owned threads persist a complete immutable pair without delivery side effects', async t => {
    const f = await setup(t, engine);
    await f.store.execute(request('roster', ...['head', 'worker'].map((id, i) => ({ type: 'putMember', teamId: 'team', expectedConfigVersion: i + 1, expectedGeneration: 0, member: member(id) }))));
    await f.store.execute(request('thread', { type: 'createRun', runId: 'r', teamId: 'team' },
      { type: 'openThread', threadId: 'coordination', runId: 'r', teamId: 'team', taskId: null, endpointAMemberId: 'head', endpointBMemberId: 'worker' }));
    const mutation = { type: 'createDelivery', deliveryId: 'd', runId: 'r', consumerGeneration: 1, teamId: 'team', messageId: 'm',
      threadId: 'coordination', senderMemberId: 'head', recipientMemberId: 'worker', body: 'Question\r\n世界 🐋', messageKind: 'question' };
    const first = await f.store.execute(request('pair', mutation));
    assert.deepEqual(await f.store.execute(request('pair', mutation)), first);
    const msg = await f.store.read({ entity: 'message', id: 'm', caller });
    assert.equal(msg.body, mutation.body); assert.ok(msg.created_at_ms > 0); assert.equal(msg.status, undefined);
    const thread = await f.store.read({ entity: 'thread', id: 'coordination', caller });
    assert.equal(thread.task_id, null); assert.equal(thread.question_delivered_at_ms, null); assert.equal(thread.answer_deadline_ms, null);
    assert.equal((await f.store.read({ entity: 'delivery', id: 'd', caller })).replay_count, 0);
    await assert.rejects(f.store.execute(request('bad-kind', { ...mutation, deliveryId: 'bad-d', messageId: 'bad-m', messageKind: 'done' })), code('STORE_MESSAGE_KIND_INVALID'));
    await assert.rejects(f.store.execute(request('bad-ref', { ...mutation, deliveryId: 'bad-d', messageId: 'bad-m', recipientMemberId: 'missing' })), code('STORE_REFERENCE_MISSING'));
    await assert.rejects(f.store.execute(request('duplicate', { ...mutation, deliveryId: 'bad-d' })), code('STORE_MESSAGE_EXISTS'));
    assert.equal((await f.raw('SELECT delivery_id FROM deliveries')).length, 1);
    assert.equal((await f.raw('SELECT message_id FROM messages')).length, 1);
  });

  test('schema 4 snapshots optional task minutes without observing pickup or starting a deadline', async t => {
    const f = await setup(t, engine);
    await f.store.execute(request('roster', ...['head', 'worker'].map((id, i) => ({ type: 'putMember', teamId: 'team', expectedConfigVersion: i + 1, expectedGeneration: 0, member: member(id) }))));
    await f.store.execute(request('enabled', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 3, settings: { ...settings, taskWindowMinutes: 30 } }));
    await f.store.execute(request('admit', { type: 'createRun', runId: 'r', teamId: 'team' }, { type: 'createTask', taskId: 't', runId: 'r' },
      { type: 'admitAssignment', assignmentId: 'a', taskId: 't', memberId: 'worker', assignedByMemberId: 'head' }));
    const row = await f.store.read({ entity: 'assignment', id: 'a', caller });
    assert.equal(row.task_window_minutes, 30); assert.equal(row.task_deadline_ms, null); assert.equal(row.pickup_observed_at_ms, null);
    await f.store.execute(request('off', { type: 'saveTeamSettings', teamId: 'team', expectedConfigVersion: 4, settings }));
    assert.equal((await f.store.read({ entity: 'assignment', id: 'a', caller })).task_window_minutes, 30);
  });

  test('schema 4 missing message immutability guards refuse before lease or data writes', async t => {
    const f = await setup(t, engine);
    const before = await f.raw('SELECT * FROM store_lease');
    await f.raw(engine === 'sqlite' ? 'DROP TRIGGER messages_immutable_update' : 'DROP TRIGGER messages_immutable_update ON messages');
    await assert.rejects(f.store.execute(request('missing-guard', { type: 'createRun', runId: 'r', teamId: 'team' })), error => error.code === 'STORE_SCHEMA_INCOMPLETE' && error.message.includes('messages_immutable_update'));
    assert.deepEqual(await f.raw('SELECT * FROM store_lease'), before);
    assert.deepEqual(await f.raw('SELECT run_id FROM runs'), []);
  });
});
