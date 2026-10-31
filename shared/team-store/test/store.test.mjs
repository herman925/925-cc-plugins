import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { openTeamStore } from '../index.mjs';
import { createRuntimeStore } from '../src/store.mjs';
import { openBackend } from '../src/bootstrap.mjs';
import { SQL, SCHEMA_VERSION } from '../contract.mjs';
import { runtimeFixture, rawWrite } from './support/runtime-fixture.mjs';
import { seedLayout } from './support/seed-layout.mjs';
import { postgresTestUrl } from './support/engines.mjs';

const caller = { principalId: 'authenticated-test-user', authentication: 'client-owned-proof' };
const checkCode = expected => error => error.code === expected;
const run = runId => ({ type: 'createRun', runId, teamId: 'fixture-team' });
const request = (operationId, mutations) => ({ operationId, caller, mutations });
const transient = engine => Object.assign(new Error('injected transient database failure'), engine === 'sqlite' ? { code: 'ERR_SQLITE_ERROR', errcode: 5 } : { code: '40001' });

async function setup(t, engine, settings = {}, wrap) {
  let store;
  // Node after-hooks run in registration order: close open files before the
  // fixture removes its scratch directory (particularly important on Windows).
  t.after(() => store?.close());
  const f = await runtimeFixture(t, engine);
  const dependencies = wrap ? { openBackend: async options => {
    const result = await openBackend(options);
    return { ...result, db: wrap(result.db) };
  } } : undefined;
  store = await createRuntimeStore({ ...f.options, create: true, caller, authorize: () => true,
    machineId: 'machine-A', holderToken: 'token-A', retryDelayMs: 0, ...settings }, dependencies);
  const seeded = await f.raw();
  try { await seeded.begin(); await seedLayout(seeded); await seeded.commit(); } finally { await seeded.close(); }
  return { ...f, store, async rawRows(sql, params) {
    const db = await f.raw();
    try { return await db.query(sql, params); } finally { await db.close(); }
  } };
}

for (const engine of ['sqlite', 'postgres']) {
  describe(`${engine} production store`, { skip: engine === 'postgres' && !postgresTestUrl() }, () => {
    test('a fixed primitive batch commits and reopens through the public interface', async t => {
      const f = await setup(t, engine);
      const input = request('seed', [run('run'), { type: 'createTask', taskId: 'task', runId: 'run' },
        { type: 'openThread', threadId: 'thread', runId: 'run', teamId: 'fixture-team', taskId: 'task', endpointAMemberId: 'head', endpointBMemberId: 'worker' },
        { type: 'createDelivery', deliveryId: 'delivery', runId: 'run', consumerGeneration: 1, teamId: 'fixture-team', messageId: 'message-delivery', threadId: 'thread', senderMemberId: 'head', recipientMemberId: 'worker', body: 'Fixture content', messageKind: 'status' },
        { type: 'createGate', gateId: 'gate', taskId: 'task', question: 'Approve?' },
        { type: 'admitAssignment', assignmentId: 'assignment', taskId: 'task', memberId: 'worker', assignedByMemberId: 'head' }]);
      const result = await f.store.execute(input);
      assert.equal(result.result.length, 6);
      assert.ok(Number.isSafeInteger(result.result[5].admittedAtMs));
      const reopened = await openTeamStore({ ...f.options, machineId: 'different-machine', authorize: () => true });
      try {
        assert.equal((await reopened.read({ entity: 'assignment', id: 'assignment', caller })).member_id, 'worker');
        assert.deepEqual(await reopened.execute(input), result); // replay needs no competing lease acquisition
      } finally { await reopened.close(); }
    });

    test('canonical identity tolerates key order and changed submission metadata, never changed semantics', async t => {
      const f = await setup(t, engine);
      const input = { ...request('canonical', [run('run')]), metadata: { submittedAt: 'first' } };
      const original = await f.store.execute(input);
      assert.deepEqual(await f.store.execute({ caller, metadata: { submittedAt: 'later' },
        mutations: [{ runId: 'run', type: 'createRun', teamId: 'fixture-team' }], operationId: 'canonical' }), original);
      await assert.rejects(f.store.execute(request('canonical', [run('different')])), checkCode('STORE_IDEMPOTENCY_CONFLICT'));
      assert.equal((await f.rawRows('SELECT operation_id FROM operations')).length, 1);
      assert.equal((await f.rawRows('SELECT run_id FROM runs')).length, 1);
    });

    test('an in-flight same-operation retry on another holder rechecks the receipt after its lock wait', async t => {
      let release, entered, waiting, commits = 0;
      const gate = new Promise(resolve => { release = resolve; });
      const atCommit = new Promise(resolve => { entered = resolve; });
      const atWait = new Promise(resolve => { waiting = resolve; });
      const f = await setup(t, engine, {}, db => ({ ...db,
        commit: async () => { if (++commits === 2) { entered(); await gate; } return db.commit(); },
      }));
      const input = request('in-flight', [run('run')]);
      const first = f.store.execute(input);
      await atCommit;
      const other = await createRuntimeStore({ ...f.options, machineId: 'other-machine', holderToken: 'other-token', authorize: () => true }, {
        openBackend: async options => {
          const result = await openBackend(options), db = result.db;
          return { ...result, db: { ...db,
            begin: () => { if (engine === 'sqlite') waiting(); return db.begin(); },
            lockLeaseControl: () => { if (engine === 'postgres') waiting(); return db.lockLeaseControl(); },
          } };
        },
      });
      try {
        const pair = Promise.all([first, other.execute(input)]);
        await atWait;
        release();
        const [a, b] = await pair;
        assert.deepEqual(a, b);
        assert.equal((await f.rawRows('SELECT run_id FROM runs')).length, 1);
        assert.equal((await f.rawRows('SELECT operation_id FROM operations')).length, 1);
      } finally { release(); await other.close(); }
    });

    test('no policy, a negative policy, and an asynchronous policy fail before lease or mutation writes', async t => {
      const f = await runtimeFixture(t, engine);
      const initial = await openTeamStore({ ...f.options, create: true, caller, authorize: () => true, machineId: 'A' });
      await initial.close();
      for (const [policy, expected] of [[undefined, 'STORE_AUTHORITY_REQUIRED'], [() => false, 'STORE_AUTHORITY_DENIED'], [async () => true, 'STORE_AUTHORITY_ASYNC']]) {
        const store = await openTeamStore({ ...f.options, machineId: 'A', authorize: policy });
        try { await assert.rejects(store.execute(request('denied', [run('denied')])), checkCode(expected)); }
        finally { await store.close(); }
      }
      const raw = await f.raw();
      try {
        assert.equal(Number((await raw.query(SQL.readLease))[0].generation), 0);
        assert.deepEqual(await raw.query('SELECT operation_id FROM operations'), []);
      } finally { await raw.close(); }
      await assert.rejects(openTeamStore({ ...f.options, create: true, caller, machineId: 'A' }), checkCode('STORE_AUTHORITY_REQUIRED'));
    });

    test('authorization is rechecked on every retry', async t => {
      let decisions = 0, inject = true;
      const f = await setup(t, engine, { authorize: context => context.kind === 'createStore' || ++decisions === 1 }, db => ({ ...db,
        begin: async () => { if (inject) { inject = false; throw transient(engine); } return db.begin(); },
      }));
      await assert.rejects(f.store.execute(request('revoked', [run('run')])), checkCode('STORE_AUTHORITY_DENIED'));
      assert.equal(decisions, 2);
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
      assert.deepEqual(await f.rawRows('SELECT operation_id FROM operations'), []);
    });

    test('authorization is required again for a replay and a read', async t => {
      let allowed = true;
      const f = await setup(t, engine, { authorize: () => allowed });
      const input = request('authorized-first', [run('run')]);
      await f.store.execute(input);
      allowed = false;
      await assert.rejects(f.store.execute(input), checkCode('STORE_AUTHORITY_DENIED'));
      await assert.rejects(f.store.reconcile(input), checkCode('STORE_AUTHORITY_DENIED'));
      await assert.rejects(f.store.read({ entity: 'run', id: 'run', caller }), checkCode('STORE_AUTHORITY_DENIED'));
    });

    test('a live lease loudly refuses another machine and another token on the same machine', async t => {
      const f = await setup(t, engine);
      const lease = await f.store.execute({ operationId: 'claim', kind: 'acquireLease', caller, ttlMs: 30000 });
      for (const machineId of ['machine-B', 'machine-A']) {
        const other = await openTeamStore({ ...f.options, machineId, holderToken: 'different-token', authorize: () => true });
        try {
          await assert.rejects(other.execute(request(`refused-${machineId}`, [run(machineId)])), error => error.code === 'STORE_LEASE_HELD'
            && error.details.holderMachineId === 'machine-A' && error.details.expiresAtMs === lease.result.expiresAtMs);
        } finally { await other.close(); }
      }
    });

    test('renewal keeps its generation and expiry is exclusive; reacquisition increments it', async t => {
      let now = 10000;
      const f = await setup(t, engine, {}, db => ({ ...db, now: async () => now }));
      const first = await f.store.execute({ operationId: 'claim', kind: 'acquireLease', caller, ttlMs: 1000 });
      now = 10500;
      const renewed = await f.store.execute({ operationId: 'renew', kind: 'renewLease', caller, ttlMs: 1000 });
      assert.equal(renewed.result.generation, first.result.generation);
      assert.equal(renewed.result.expiresAtMs, 11500);
      now = 11500;
      await assert.rejects(f.store.execute({ operationId: 'too-late', kind: 'renewLease', caller, ttlMs: 1000 }), checkCode('STORE_LEASE_EXPIRED'));
      const next = await f.store.execute({ operationId: 'reacquire', kind: 'acquireLease', caller, ttlMs: 1000 });
      assert.equal(next.result.generation, first.result.generation + 1);
    });

    test('a failed prerequisite rolls back earlier mutations and leaves no receipt', async t => {
      const f = await setup(t, engine);
      await assert.rejects(f.store.execute(request('atomic', [run('provisional'), {
        type: 'answerThread', threadId: 'missing', runId: 'provisional', consumerGeneration: 1, expectedGeneration: 1, answer: 'no',
      }])), checkCode('STORE_CONFLICT'));
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
      assert.deepEqual(await f.rawRows(SQL.readOperation, { operation_id: 'atomic' }), []);
    });

    test('bounded whole-transaction retry rolls back partial work and reads fresh lease generations', async t => {
      let injected = false, changed = false, bootstrapCalls = 0, f;
      const dependency = async options => {
        bootstrapCalls++;
        const result = await openBackend(options), db = result.db;
        return { ...result, db: { ...db,
          query: async (sql, params) => {
            if (!injected && sql.startsWith('INSERT INTO tasks')) { injected = true; throw transient(engine); }
            return db.query(sql, params);
          },
          rollback: async () => {
            await db.rollback();
            if (!changed) {
              changed = true;
              await rawWrite(f, 'UPDATE store_lease SET generation = generation + 1');
            }
          },
        } };
      };
      f = await runtimeFixture(t, engine);
      const store = await createRuntimeStore({ ...f.options, create: true, caller, authorize: () => true,
        machineId: 'A', holderToken: 'A-token', retryDelayMs: 0 }, { openBackend: dependency });
      try {
        const seed = await f.raw();
        try { await seed.begin(); await seedLayout(seed); await seed.commit(); } finally { await seed.close(); }
        const result = await store.execute(request('retry', [run('run'), { type: 'createTask', taskId: 'task', runId: 'run' }]));
        assert.equal(result.result.length, 2);
        assert.equal(bootstrapCalls, 1);
        const raw = await f.raw();
        try {
          assert.equal(Number((await raw.query(SQL.readLease))[0].generation), 2);
          assert.equal((await raw.query('SELECT run_id FROM runs')).length, 1);
          assert.equal((await raw.query('SELECT operation_id FROM operations')).length, 1);
        } finally { await raw.close(); }
      } finally { await store.close(); }
    });

    test('retry exhaustion is bounded and does not leave a partial operation', async t => {
      let attempts = 0;
      const f = await setup(t, engine, { maxRetries: 1 }, db => ({ ...db, query: async (sql, params) => {
        if (sql.startsWith('INSERT INTO runs')) { attempts++; throw transient(engine); }
        return db.query(sql, params);
      } }));
      await assert.rejects(f.store.execute(request('exhausted', [run('run')])), error => error.code === 'STORE_RETRY_EXHAUSTED' && error.details.attempts === 2);
      assert.equal(attempts, 2);
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
      assert.deepEqual(await f.rawRows('SELECT operation_id FROM operations'), []);
    });

    test('a retryable COMMIT failure rolls back and retries the entire operation', async t => {
      let commits = 0, inserts = 0;
      const f = await setup(t, engine, {}, db => ({ ...db,
        query: async (sql, params) => { if (sql.startsWith('INSERT INTO runs')) inserts++; return db.query(sql, params); },
        commit: async () => { if (++commits === 2) throw transient(engine); return db.commit(); },
      }));
      const result = await f.store.execute(request('commit-retry', [run('run')]));
      assert.equal(result.result[0].runId, 'run');
      assert.equal(inserts, 2);
      assert.equal((await f.rawRows('SELECT run_id FROM runs')).length, 1);
      assert.equal((await f.rawRows('SELECT operation_id FROM operations')).length, 1);
    });

    test('uniqueness is a domain refusal and is never automatically retried', async t => {
      let attempts = 0;
      const f = await setup(t, engine, {}, db => ({ ...db, query: async (sql, params) => {
        if (sql.startsWith('INSERT INTO assignments')) attempts++;
        return db.query(sql, params);
      } }));
      await f.store.execute(request('seed', [run('run'), { type: 'createTask', taskId: 'task', runId: 'run' },
        { type: 'admitAssignment', assignmentId: 'A', taskId: 'task', memberId: 'worker-A', assignedByMemberId: 'head' }]));
      attempts = 0;
      await assert.rejects(f.store.execute(request('duplicate', [{ type: 'admitAssignment', assignmentId: 'B', taskId: 'task', memberId: 'worker-B', assignedByMemberId: 'head' }])), checkCode('STORE_CONSTRAINT_CONFLICT'));
      assert.equal(attempts, 1);
      assert.deepEqual(await f.rawRows(SQL.readOperation, { operation_id: 'duplicate' }), []);
    });

    test('a lost successful commit is unknown, then reconciles and replays after reconnect without a repeated effect', async t => {
      let commits = 0, inserts = 0;
      const f = await setup(t, engine, {}, db => ({ ...db,
        query: async (sql, params) => { if (sql.startsWith('INSERT INTO runs')) inserts++; return db.query(sql, params); },
        commit: async () => { await db.commit(); if (++commits === 2) throw Object.assign(new Error('lost commit response'), { code: 'ECONNRESET' }); },
      }));
      const input = request('lost-commit', [run('run')]);
      await assert.rejects(f.store.execute(input), checkCode('STORE_COMMIT_UNKNOWN'));
      assert.equal(inserts, 1);
      const reconciled = await f.store.reconcile(input);
      assert.equal(reconciled.operationId, input.operationId);
      assert.deepEqual(await f.store.execute(input), reconciled);
      assert.equal(inserts, 1);
    });

    test('an absent receipt is unknown, not proof to resend automatically', async t => {
      let commits = 0, inserts = 0;
      const f = await setup(t, engine, {}, db => ({ ...db,
        query: async (sql, params) => { if (sql.startsWith('INSERT INTO runs')) inserts++; return db.query(sql, params); },
        commit: async () => {
          if (++commits === 2) { await db.rollback(); throw Object.assign(new Error('connection lost before commit'), { code: 'ECONNRESET' }); }
          return db.commit();
        },
      }));
      const input = request('not-recorded', [run('run')]);
      await assert.rejects(f.store.execute(input), checkCode('STORE_COMMIT_UNKNOWN'));
      assert.deepEqual(await f.store.reconcile(input), { status: 'unknown', operationId: input.operationId });
      assert.equal(inserts, 1);
      const explicitRetry = await f.store.execute(input);
      assert.equal(explicitRetry.result[0].runId, 'run');
      assert.equal((await f.rawRows('SELECT run_id FROM runs')).length, 1);
    });

    test('the lease lock precedes the clock and an expired mutation leaves no effect', async t => {
      let controlLocked = false, mutationLocked = false;
      const f = await setup(t, engine, { ttlMs: 1000 }, db => ({ ...db,
        lockLeaseControl: async () => { const rows = await db.lockLeaseControl(); controlLocked = true; return rows; },
        query: async (sql, params) => { const rows = await db.query(sql, params); if (sql === SQL.lockLease) mutationLocked = true; return rows; },
        now: async () => { assert.ok(controlLocked); return mutationLocked ? 11000 : 10000; },
      }));
      await assert.rejects(f.store.execute(request('expired', [run('run')])), checkCode('STORE_LEASE_EXPIRED'));
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
      assert.deepEqual(await f.rawRows(SQL.readOperation, { operation_id: 'expired' }), []);
    });

    test('generation overflow is refused without wrapping or partially updating', async t => {
      const f = await setup(t, engine);
      await f.store.execute(request('seed', [run('run'), { type: 'createTask', taskId: 'task', runId: 'run' }, { type: 'openThread', threadId: 'thread', runId: 'run', teamId: 'fixture-team', taskId: 'task', endpointAMemberId: 'head', endpointBMemberId: 'worker' }]));
      await rawWrite(f, `UPDATE threads SET generation = ${Number.MAX_SAFE_INTEGER}`);
      await assert.rejects(f.store.execute(request('overflow', [{ type: 'answerThread', threadId: 'thread', runId: 'run',
        consumerGeneration: 1, expectedGeneration: Number.MAX_SAFE_INTEGER, answer: 'no wrap' }])), checkCode('STORE_INPUT_INVALID'));
      const [row] = await f.rawRows('SELECT generation, status FROM threads');
      assert.equal(Number(row.generation), Number.MAX_SAFE_INTEGER);
      assert.equal(row.status, 'open');
    });

    test('a backward database clock rolls back the transaction', async t => {
      let main = false, samples = 0;
      const f = await setup(t, engine, {}, db => ({ ...db,
        query: async (sql, params) => { const rows = await db.query(sql, params); if (sql === SQL.lockLease) main = true; return rows; },
        now: async () => main && ++samples > 1 ? 9999 : 10000,
      }));
      await assert.rejects(f.store.execute(request('clock', [run('run')])), checkCode('STORE_CLOCK_INVALID'));
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
    });

    test('a failed rollback quarantines the connection and never automatically retries', async t => {
      let rollbacks = 0;
      const f = await setup(t, engine, {}, db => ({ ...db,
        rollback: async () => { rollbacks++; await db.rollback(); throw new Error('lost rollback confirmation'); },
      }));
      const input = request('rollback-unknown', [run('provisional'), {
        type: 'answerThread', threadId: 'missing', runId: 'provisional', consumerGeneration: 1, expectedGeneration: 1, answer: 'no',
      }]);
      await assert.rejects(f.store.execute(input), checkCode('STORE_ROLLBACK_UNKNOWN'));
      assert.equal(rollbacks, 1);
      assert.deepEqual(await f.store.reconcile(input), { status: 'unknown', operationId: input.operationId });
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
    });

    test('an expired rebind rolls back fencing and leaves the old consumer active', async t => {
      let expire = false;
      const f = await setup(t, engine, { ttlMs: 1000 }, db => ({ ...db,
        query: async (sql, params) => { const rows = await db.query(sql, params); if (sql === SQL.fenceDeliveries) expire = true; return rows; },
        now: async () => expire ? 11000 : 10000,
      }));
      await f.store.execute(request('seed', [run('run'), { type: 'openThread', threadId: 'thread', runId: 'run', teamId: 'fixture-team', taskId: null, endpointAMemberId: 'head', endpointBMemberId: 'worker' }, { type: 'createDelivery', deliveryId: 'delivery', runId: 'run', consumerGeneration: 1, teamId: 'fixture-team', messageId: 'message-delivery', threadId: 'thread', senderMemberId: 'head', recipientMemberId: 'worker', body: 'Fixture content', messageKind: 'status' }]));
      await assert.rejects(f.store.execute(request('rebind', [{ type: 'rebindConsumer', runId: 'run', consumerGeneration: 1 }])), checkCode('STORE_LEASE_EXPIRED'));
      assert.equal((await f.rawRows('SELECT status FROM deliveries'))[0].status, 'outstanding');
      assert.equal(Number((await f.rawRows('SELECT consumer_generation FROM runs'))[0].consumer_generation), 1);
    });

    test('version one is refused rather than migrated implicitly to the receipt schema', async t => {
      const f = await setup(t, engine);
      await rawWrite(f, 'UPDATE store_metadata SET schema_version = 1');
      await assert.rejects(f.store.execute(request('old', [run('run')])), checkCode('STORE_VERSION_UNSUPPORTED'));
      assert.deepEqual(await f.rawRows('SELECT run_id FROM runs'), []);
    });

    test('an unsupported version is refused even by an already-open client and even on replay', async t => {
      const f = await setup(t, engine);
      const input = request('old-version', [run('run')]);
      await f.store.execute(input);
      await rawWrite(f, 'UPDATE store_metadata SET schema_version = 99');
      await assert.rejects(f.store.execute(input), checkCode('STORE_VERSION_UNSUPPORTED'));
      const [lease] = await f.rawRows(SQL.readLease);
      assert.equal(Number(lease.generation), 1);
      assert.ok(SCHEMA_VERSION < 99);
    });
  });
}

test('SQLite runtime retries a real competing writer lock without duplicating the operation', async t => {
  let attempts = 0, signalBusy;
  const observedBusy = new Promise(resolve => { signalBusy = resolve; });
  const f = await setup(t, 'sqlite', { authorize: context => { if (context.kind === 'mutate') attempts++; return true; } }, db => ({ ...db,
    begin: async () => {
      try { return await db.begin(); }
      catch (error) { if ((Number(error.errcode) & 255) === 5) signalBusy(); throw error; }
    },
  }));
  const blocker = await f.raw();
  try {
    await blocker.begin();
    const pending = f.store.execute(request('real-busy', [run('run')]));
    await observedBusy;
    await blocker.rollback();
    await pending;
    assert.ok(attempts >= 2);
    assert.equal((await f.rawRows('SELECT run_id FROM runs')).length, 1);
    assert.equal((await f.rawRows('SELECT operation_id FROM operations')).length, 1);
  } finally { await blocker.close(); }
});

test('PostgreSQL renewal samples its clock after a real row-lock wait and cannot revive an expired lease', { skip: !postgresTestUrl() }, async t => {
  const f = await setup(t, 'postgres');
  const lease = await f.store.execute({ operationId: 'short-lease', kind: 'acquireLease', ttlMs: 250, caller });
  const blocker = await f.raw();
  try {
    await blocker.begin();
    await blocker.query(`${SQL.readLease} FOR UPDATE`);
    const pending = f.store.execute({ operationId: 'late-renewal', kind: 'renewLease', ttlMs: 1000, caller });
    await blocker.query('SELECT pg_sleep(0.35)');
    await blocker.commit();
    await assert.rejects(pending, checkCode('STORE_LEASE_EXPIRED'));
    const [row] = await f.rawRows(SQL.readLease);
    assert.equal(Number(row.expires_at_ms), lease.result.expiresAtMs);
    assert.deepEqual(await f.rawRows(SQL.readOperation, { operation_id: 'late-renewal' }), []);
  } finally { await blocker.close(); }
});
