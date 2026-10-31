import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openMachineStore, openTeamStore } from '../index.mjs';
import { createMachineRuntime } from '../src/machine-store.mjs';
import { openSqliteBackend } from '../src/bootstrap.mjs';
import { connectSqlite } from '../src/engines.mjs';
import { seedLayout } from './support/seed-layout.mjs';

const caller = { principalId: 'local-test-client' };
const writer = { client: 'team-orchestrator', version: '0.5.42', protocol: 1 };
const plugin = { client: 'team-orchestrator-orca', version: '0.1.24', protocol: 1 };
const request = (operationId, ...mutations) => ({ operationId, caller, mutations });
const bind = (extra = {}) => ({ type: 'bindMember', memberId: 'worker', sessionId: 'session', bindingGeneration: 1, expectedGeneration: 0, ...extra });
const observe = (extra = {}) => ({ type: 'recordObservation', memberId: 'worker', sessionId: 'session', bindingGeneration: 1, expectedGeneration: 1, state: 'working', ...extra });
const receipt = (extra = {}) => ({ type: 'recordLocalReceipt', receiptId: 'receipt', memberId: 'worker', sessionId: 'session', bindingGeneration: 1, sharedDeliveryId: 'delivery', observationKind: 'acknowledged', detail: { local: true }, ...extra });
const code = expected => error => error.code === expected;

async function setup(t, extra = {}, wrap) {
  const stores = [];
  t.after(async () => { for (const store of stores.reverse()) await store.close(); });
  const root = await mkdtemp(join(tmpdir(), 'team-store-machine-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const options = { machineConfigRoot: root, projectId: randomUUID(), machineId: 'machine-A', writer, authorize: () => true, caller, retryDelayMs: 0, ...extra };
  const path = join(root, 'team-orchestrator', options.projectKey ?? options.projectId, 'machine.sqlite');
  const dependencies = wrap ? { openBackend: async options => { const result = await openSqliteBackend(options); return { ...result, db: wrap(result.db) }; } } : undefined;
  const store = await createMachineRuntime({ ...options, create: true }, dependencies); stores.push(store);
  const open = async changes => { const s = await openMachineStore({ ...options, ...changes }); stores.push(s); return s; };
  const raw = async (sql, params) => { const db = await connectSqlite({ path }); try { return await db.query(sql, params); } finally { await db.close(); } };
  return { store, open, raw, root, path, options };
}

describe('sqlite separate machine observations', () => {
  test('own format, version, UUID directory and machine binding are checked before writing', async t => {
    const f = await setup(t);
    const identity = await f.store.getIdentity({ caller });
    assert.equal(identity.projectKey, f.options.projectId); assert.equal(identity.machineId, 'machine-A');
    const [metadata] = await f.raw('SELECT * FROM store_metadata');
    assert.equal(metadata.format, 'team-orchestrator-machine'); assert.equal(Number(metadata.schema_version), 1);
    assert.equal((await f.raw("SELECT name FROM sqlite_schema WHERE type='table' AND name IN ('deliveries','tasks','store_lease','teams')")).length, 0);
    await f.store.close(); const before = await readFile(f.path);
    await assert.rejects(f.open({ machineId: 'machine-B' }), code('STORE_MACHINE_BINDING_MISMATCH'));
    await assert.rejects(f.open({ projectId: randomUUID(), projectKey: identity.projectKey }), code('STORE_MACHINE_BINDING_MISMATCH'));
    assert.deepEqual(await readFile(f.path), before);
  });

  test('unknown schema is refused without a reset or binding replacement', async t => {
    const f = await setup(t); await f.store.close();
    await f.raw('UPDATE store_metadata SET schema_version=99'); const before = await readFile(f.path);
    await assert.rejects(f.open({ create: true }), code('STORE_VERSION_UNSUPPORTED'));
    assert.deepEqual(await readFile(f.path), before);
  });

  test('unknown states preserve raw values; binding alone invents no liveness', async t => {
    const f = await setup(t); await f.store.execute(request('bind', bind()));
    let row = await f.store.readMember({ memberId: 'worker', caller });
    assert.equal(row.state, 'unknown'); assert.equal(row.heartbeat_at_ms, 0);
    await f.store.execute(request('observe', observe({ state: 'provider-new-state', turnStartMs: 1, turnEndMs: 2, contextUsedPercent: 12.5, contextWindowTokens: 100000, model: 'model', effort: 'high', taskLabel: 'task' })));
    row = await f.store.readMember({ memberId: 'worker', caller });
    assert.equal(row.state, 'unknown'); assert.equal(row.raw_state, 'provider-new-state'); assert.ok(row.heartbeat_at_ms > 0);
    assert.equal(row.context_used_percent, 12.5); assert.equal(row.context_window_tokens, 100000); assert.equal(row.turn_start_ms, 1); assert.equal(row.turn_end_ms, 2);
    assert.equal(row.generation, 2);
    await assert.rejects(f.store.execute(request('bad-percent', observe({ expectedGeneration: 2, contextUsedPercent: 101 }))), code('STORE_INPUT_INVALID'));
  });

  test('old sessions, binding generations and row generations cannot write after rebind', async t => {
    const f = await setup(t); await f.store.execute(request('bind', bind()));
    await f.store.execute(request('receipt', receipt()));
    await f.store.execute(request('rebind', bind({ sessionId: 'new-session', bindingGeneration: 2, expectedGeneration: 1 })));
    await assert.rejects(f.store.execute(request('stale-session', observe({ expectedGeneration: 2 }))), code('STORE_LOCAL_BINDING_STALE'));
    await assert.rejects(f.store.execute(request('stale-ack', receipt({ receiptId: 'second' }))), code('STORE_LOCAL_BINDING_STALE'));
    await assert.rejects(f.store.execute(request('stale-row', observe({ sessionId: 'new-session', bindingGeneration: 2 }))), code('STORE_LOCAL_GENERATION_CONFLICT'));
    const row = await f.store.readMember({ memberId: 'worker', caller }); assert.equal(row.state, 'unknown'); assert.equal(row.heartbeat_at_ms, 0);
    assert.equal((await f.store.readReceipt({ receiptId: 'receipt', caller })).session_id, 'session');
  });

  test('older machine binary freshly rereads newest observation generation still refused', async t => {
    const f = await setup(t); await f.store.execute(request('bind', bind()));
    const newer = await f.open({ writer: { ...writer, version: '0.5.43' } });
    await newer.execute(request('newer', observe()));
    const fresh = await f.store.readMember({ memberId: 'worker', caller });
    assert.equal(fresh.generation, 2);
    await assert.rejects(f.store.execute(request('old-fresh', observe({ expectedGeneration: fresh.generation }))), code('STORE_WRITER_TOO_OLD'));
    assert.equal((await f.store.readMember({ memberId: 'worker', caller })).generation, 2);
  });

  test('machine fences are independent by family, missing known rows and old protocols refuse', async t => {
    const f = await setup(t); await f.store.execute(request('bind', bind()));
    const other = await f.open({ writer: plugin }); await other.execute(request('plugin', observe()));
    assert.deepEqual((await f.raw('SELECT writer_version FROM writer_fences ORDER BY writer_client')).map(r => r.writer_version), ['0.5.42', '0.1.24']);
    await assert.rejects(f.open({ writer: { ...writer, client: 'new-family' } }), code('STORE_WRITER_FAMILY_UNKNOWN'));
    await f.raw("DELETE FROM writer_fences WHERE writer_client='team-orchestrator-orca'");
    await assert.rejects(other.execute(request('missing-fence', observe({ expectedGeneration: 2 }))), code('STORE_WRITER_FENCE_MISSING'));
    await f.raw('UPDATE machine_identity SET minimum_writer_protocol=2');
    await assert.rejects(f.store.execute(request('old-floor', observe({ expectedGeneration: 2 }))), code('STORE_WRITER_PROTOCOL_OLD'));
  });

  test('failed batches roll back observations, receipts and the new writer high-water release', async t => {
    const f = await setup(t); await f.store.execute(request('bind', bind()));
    const newer = await f.open({ writer: { ...writer, version: '9.0.0' } });
    await assert.rejects(newer.execute(request('batch', observe(), receipt(), observe({ expectedGeneration: 99 }))), code('STORE_LOCAL_GENERATION_CONFLICT'));
    assert.equal((await f.store.readMember({ memberId: 'worker', caller })).generation, 1);
    assert.equal(await f.store.readReceipt({ receiptId: 'receipt', caller }), null);
    assert.equal((await f.raw("SELECT writer_version FROM writer_fences WHERE writer_client='team-orchestrator'"))[0].writer_version, writer.version);
    assert.equal((await f.raw('SELECT operation_id FROM local_operations')).length, 1);
  });

  test('local receipt replay is idempotent, immutable and does not establish shared acknowledgement', async t => {
    const f = await setup(t);
    const shared = await openTeamStore({ projectRoot: f.root, create: true, machineId: 'machine-A', caller, authorize: () => true });
    try {
      const db = await connectSqlite({ path: join(f.root, '.team-orchestrator', 'team.sqlite') });
      try { await seedLayout(db); } finally { await db.close(); }
      await shared.execute(request('shared-seed', { type: 'createRun', runId: 'run', teamId: 'fixture-team' }, { type: 'openThread', threadId: 'thread', runId: 'run', teamId: 'fixture-team', taskId: null, endpointAMemberId: 'head', endpointBMemberId: 'worker' }, { type: 'createDelivery', deliveryId: 'delivery', runId: 'run', consumerGeneration: 1, teamId: 'fixture-team', messageId: 'message-delivery', threadId: 'thread', senderMemberId: 'head', recipientMemberId: 'worker', body: 'Fixture content', messageKind: 'status' }));
      const before = await shared.read({ entity: 'delivery', id: 'delivery', caller });
      const sharedPath = join(f.root, '.team-orchestrator', 'team.sqlite'), bytes = await readFile(sharedPath);
      await f.store.execute(request('bind', bind())); const ack = request('local-ack', receipt());
      const result = await f.store.execute(ack);
      assert.deepEqual(await f.store.execute({ ...ack, metadata: { later: true } }), result);
      await assert.rejects(f.store.execute(request('local-ack', receipt({ observationKind: 'read' }))), code('STORE_IDEMPOTENCY_CONFLICT'));
      await assert.rejects(f.store.execute(request('overwrite', receipt())), code('STORE_LOCAL_RECEIPT_EXISTS'));
      assert.deepEqual(await shared.read({ entity: 'delivery', id: 'delivery', caller }), before);
      assert.deepEqual(await readFile(sharedPath), bytes);
      assert.equal((await f.store.readMember({ memberId: 'worker', caller })).heartbeat_at_ms, 0);
      await assert.rejects(f.store.execute(request('shared-op', { type: 'acknowledgeDelivery', deliveryId: 'delivery' })), code('STORE_MACHINE_OPERATION_UNSUPPORTED'));
      await assert.rejects(f.open({ sharedStore: shared }), code('STORE_MACHINE_OPERATION_UNSUPPORTED'));
      await assert.rejects(f.open({ postgres: {} }), code('STORE_MACHINE_OPERATION_UNSUPPORTED'));
    } finally { await shared.close(); }
  });

  test('policy is mandatory, synchronous and checked again on read, replay and retry', async t => {
    let allowed = true;
    const f = await setup(t, { authorize: () => allowed }); const input = request('bind', bind());
    await f.store.execute(input); allowed = false;
    await assert.rejects(f.store.execute(input), code('STORE_AUTHORITY_DENIED'));
    await assert.rejects(f.store.reconcile(input), code('STORE_AUTHORITY_DENIED'));
    await assert.rejects(f.store.readMember({ memberId: 'worker', caller }), code('STORE_AUTHORITY_DENIED'));
    for (const [authorize, expected] of [[undefined, 'STORE_AUTHORITY_REQUIRED'], [async () => true, 'STORE_AUTHORITY_ASYNC']]) {
      const s = await f.open({ authorize }); await assert.rejects(s.execute(request('denied', bind())), code(expected));
    }
    let decisions = 0, inject = true;
    const other = await setup(t, { authorize: ctx => ctx.kind === 'createMachineStore' || ++decisions === 1 }, db => ({ ...db, begin: async () => {
      if (inject) { inject = false; throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); } return db.begin();
    } }));
    await assert.rejects(other.store.execute(input), code('STORE_AUTHORITY_DENIED')); assert.equal(decisions, 2);
  });

  test('busy transactions retry within a bound and do not publish partial state', async t => {
    let armed = false;
    const f = await setup(t, { maxRetries: 1 }, db => ({ ...db, begin: async () => { if (armed) throw Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' }); return db.begin(); } }));
    armed = true;
    await assert.rejects(f.store.execute(request('busy', bind())), e => e.code === 'STORE_RETRY_EXHAUSTED' && e.details.attempts === 2);
    assert.deepEqual(await f.raw('SELECT member_id FROM member_observations'), []);
  });

  test('lost commit responses reconcile same request and absent receipts remain unknown', async t => {
    let armed = false;
    const f = await setup(t, {}, db => ({ ...db, commit: async () => { await db.commit(); if (armed) { armed = false; throw new Error('lost response'); } } }));
    armed = true; const input = request('lost', bind());
    await assert.rejects(f.store.execute(input), code('STORE_COMMIT_UNKNOWN'));
    const result = await f.store.reconcile(input); assert.equal(result.operationId, 'lost');
    assert.deepEqual(await f.store.execute(input), result);
    assert.deepEqual(await f.store.reconcile(request('absent', bind({ memberId: 'other' }))), { status: 'unknown', operationId: 'absent' });
    assert.equal((await f.raw('SELECT operation_id FROM local_operations')).length, 1);
  });

  test('unsafe keys, non-UUID identities and junction directory aliases refuse', async t => {
    const f = await setup(t);
    await assert.rejects(f.open({ projectKey: '../escape' }), code('STORE_PATH_INVALID'));
    await assert.rejects(f.open({ projectId: 'path-hash' }), code('STORE_IDENTITY_INVALID'));
    const target = join(f.root, 'target'); await mkdir(target);
    const alias = join(f.root, 'team-orchestrator', 'alias'); await symlink(target, alias, 'junction');
    await assert.rejects(f.open({ projectKey: 'alias', create: true }), code('STORE_PATH_INVALID'));
  });
});
