import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openBackend } from '../src/bootstrap.mjs';
import { isRetryable, isConstraint } from '../src/errors.mjs';
import { seedLayout } from './support/seed-layout.mjs';
import { runtimeFixture, rawWrite } from './support/runtime-fixture.mjs';
import { postgresTestUrl } from './support/engines.mjs';

test('SQLite busy is retryable, a unique conflict is not, and retry after rollback can proceed', async t => {
  const f = await runtimeFixture(t, 'sqlite');
  const { db, connect } = await openBackend({ ...f.options, create: true });
  const other = await connect();
  try {
    await db.begin();
    await assert.rejects(other.begin(), error => isRetryable('sqlite', error));
    await db.rollback();
    await other.begin();
    await seedLayout(other);
    await other.exec("INSERT INTO runs (run_id,consumer_generation,team_id) VALUES ('run', 1, 'fixture-team')");
    await other.commit();
    await assert.rejects(other.exec("INSERT INTO runs (run_id,consumer_generation,team_id) VALUES ('run', 1, 'fixture-team')"), error => isConstraint('sqlite', error) && !isRetryable('sqlite', error));
  } finally { await db.close(); await other.close(); }
});

test('PostgreSQL unique violations are domain conflicts rather than transient retries', { skip: !postgresTestUrl() }, async t => {
  const f = await runtimeFixture(t, 'postgres');
  const { db } = await openBackend({ ...f.options, create: true });
  try {
    await db.begin();
    await seedLayout(db);
    await db.exec("INSERT INTO runs (run_id,consumer_generation,team_id) VALUES ('run', 1, 'fixture-team')");
    await db.commit();
    await db.begin();
    await assert.rejects(db.exec("INSERT INTO runs (run_id,consumer_generation,team_id) VALUES ('run', 1, 'fixture-team')"), error => error.code === '23505'
      && isConstraint('postgres', error) && !isRetryable('postgres', error));
    await db.rollback();
  } finally { await db.close(); }
});

test('PostgreSQL actual serializable update conflicts expose retryable 40001', { skip: !postgresTestUrl() }, async t => {
  const f = await runtimeFixture(t, 'postgres');
  await rawWrite(f, 'CREATE TABLE conflict_probe (id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO conflict_probe VALUES (1, 0)');
  const a = await f.raw(), b = await f.raw();
  try {
    await a.exec('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
    await b.exec('BEGIN ISOLATION LEVEL SERIALIZABLE READ WRITE');
    await a.query('SELECT value FROM conflict_probe WHERE id = 1');
    await b.query('SELECT value FROM conflict_probe WHERE id = 1');
    await a.exec('UPDATE conflict_probe SET value = 1 WHERE id = 1');
    await a.commit();
    await assert.rejects(b.exec('UPDATE conflict_probe SET value = 2 WHERE id = 1'), error => error.code === '40001' && isRetryable('postgres', error));
    await b.rollback();
    await b.begin();
    assert.equal((await b.query('SELECT value FROM conflict_probe WHERE id = 1'))[0].value, 1);
    await b.rollback();
  } finally { await a.close(); await b.close(); }
});

test('PostgreSQL actual deadlock exposes retryable 40P01 and releases the aborted writer', { skip: !postgresTestUrl() }, async t => {
  const f = await runtimeFixture(t, 'postgres');
  await rawWrite(f, 'CREATE TABLE deadlock_probe (id INTEGER PRIMARY KEY, value INTEGER); INSERT INTO deadlock_probe VALUES (1, 0), (2, 0)');
  const a = await f.raw(), b = await f.raw();
  try {
    await a.begin(); await b.begin();
    await a.exec('UPDATE deadlock_probe SET value = 1 WHERE id = 1');
    await b.exec('UPDATE deadlock_probe SET value = 2 WHERE id = 2');
    const results = await Promise.allSettled([
      a.exec('UPDATE deadlock_probe SET value = 1 WHERE id = 2'),
      b.exec('UPDATE deadlock_probe SET value = 2 WHERE id = 1'),
    ]);
    const losers = results.filter(result => result.status === 'rejected');
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, '40P01');
    assert.equal(isRetryable('postgres', losers[0].reason), true);
    await a.rollback(); await b.rollback();
  } finally { await a.close(); await b.close(); }
});
