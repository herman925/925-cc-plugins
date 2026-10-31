import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fixture, postgresTestUrl } from './support/engines.mjs';
import { seedLayout, seedDelivery } from './support/seed-layout.mjs';
import { MESSAGE_KINDS, MESSAGE_IMMUTABLE, RULES } from '../contract.mjs';

const constraint = /constraint|duplicate|not.null|violat/i;
const immutable = error => error.message.includes(MESSAGE_IMMUTABLE);
async function transaction(db, action) {
  await db.exec('BEGIN');
  try { const value = await action(); await db.exec('COMMIT'); return value; }
  catch (error) { await db.exec('ROLLBACK').catch(() => {}); throw error; }
}
async function setup(t, engine) {
  const f = await fixture(t, engine), db = f.db;
  await seedLayout(db);
  await db.exec(`INSERT INTO runs (run_id,consumer_generation,team_id) VALUES ('run',1,'fixture-team');
    INSERT INTO tasks (task_id,run_id) VALUES ('task','run'),('other-task','run');
    INSERT INTO threads (thread_id,run_id,team_id,task_id,status,generation,endpoint_a_member_id,endpoint_b_member_id)
    VALUES ('thread','run','fixture-team','task','open',1,'head','worker'),
      ('team-thread','run','fixture-team',NULL,'open',1,'head','worker');`);
  return f;
}
const message = (db, { id = 'm', delivery = 'd', team = 'fixture-team', thread = 'thread', sender = 'head', recipient = 'worker', kind = 'question', body = 'Question\r\n世界 🐋' } = {}) =>
  db.query(`INSERT INTO messages (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
    VALUES (:id,:delivery,:team,:thread,:sender,:recipient,:body,:kind,1000)`, { id, delivery, team, thread, sender, recipient, body, kind });
const delivery = (db, { id = 'd', message = 'm', team = 'fixture-team' } = {}) => db.query(`INSERT INTO deliveries
  (delivery_id,run_id,consumer_generation,status,generation,team_id,message_id) VALUES (:id,'run',1,'outstanding',1,:team,:message)`, { id, message, team });
const assignment = (db, { id = 'a', task = 'task', previous = null, minutes = null } = {}) => db.query(`INSERT INTO assignments
  (assignment_id,task_id,member_id,admitted_at_ms,assigned_by_member_id,pickup_deadline_ms,previous_assignment_id,task_window_minutes)
  VALUES (:id,:task,'worker',1000,'head',2000,:previous,:minutes)`, { id, task, previous, minutes });

for (const engine of ['sqlite', 'postgres']) describe(`${engine} schema 4 lifecycle layout`, { skip: engine === 'postgres' && !postgresTestUrl() }, () => {
  test('deliveries is the sole batch-state table and messages have no delivery status', async t => {
    const { db } = await setup(t, engine);
    const tables = engine === 'sqlite' ? await db.query("SELECT name FROM sqlite_schema WHERE type='table'")
      : await db.query('SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema()');
    assert.ok(tables.some(t => t.name === 'messages')); assert.ok(tables.some(t => t.name === 'deliveries'));
    assert.ok(!tables.some(t => t.name === 'delivery_batches'));
    const columns = engine === 'sqlite' ? await db.query('PRAGMA table_info(messages)')
      : await db.query("SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='messages'");
    assert.ok(!columns.some(c => ['status', 'replay_count', 'last_replayed_at_ms'].includes(c.name)));
  });

  test('a delivery and its sole message are mutually required at commit', async t => {
    const { db } = await setup(t, engine);
    await assert.rejects(transaction(db, () => delivery(db)), constraint);
    await assert.rejects(transaction(db, () => message(db)), constraint);
    assert.deepEqual(await db.query('SELECT delivery_id FROM deliveries'), []);
    assert.deepEqual(await db.query('SELECT message_id FROM messages'), []);
    await transaction(db, async () => { await delivery(db); await message(db); });
    assert.equal((await db.query('SELECT message_id FROM messages'))[0].message_id, 'm');
  });

  test('membership cannot disagree, move between batches, or add a second message', async t => {
    const { db } = await setup(t, engine);
    await assert.rejects(transaction(db, async () => { await delivery(db); await message(db, { id: 'wrong' }); }), constraint);
    await transaction(db, async () => { await delivery(db); await message(db); });
    await assert.rejects(message(db, { id: 'second' }), error => immutable(error) || constraint.test(error.message));
    await assert.rejects(db.exec("UPDATE messages SET delivery_id='another'"), immutable);
    await assert.rejects(transaction(db, () => delivery(db, { id: 'second', message: 'm' })), constraint);
    assert.equal((await db.query('SELECT message_id FROM messages')).length, 1);
  });

  test('message identity, content, routing and membership reject UPDATE DELETE and replacement', async t => {
    const { db } = await setup(t, engine);
    await transaction(db, async () => { await delivery(db); await message(db); });
    const before = await db.query('SELECT * FROM messages');
    for (const change of ["message_id='changed'", "delivery_id='changed'", "team_id='changed'", "thread_id='changed'",
      "sender_member_id='worker'", "recipient_member_id='head'", "body='changed'", "kind='status'", 'created_at_ms=1001']) {
      await assert.rejects(db.exec(`UPDATE messages SET ${change}`), immutable);
    }
    await assert.rejects(db.exec('DELETE FROM messages'), immutable);
    if (engine === 'sqlite') {
      await assert.rejects(db.exec(`INSERT OR REPLACE INTO messages
        (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
        VALUES ('m','d','fixture-team','thread','head','worker','replacement','question',1000)`), immutable);
    } else {
      await assert.rejects(db.exec(`INSERT INTO messages
        (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
        VALUES ('m','d','fixture-team','thread','head','worker','replacement','question',1000)
        ON CONFLICT (message_id) DO UPDATE SET body=EXCLUDED.body`), immutable);
      await assert.rejects(db.exec('TRUNCATE messages CASCADE'), immutable);
    }
    assert.deepEqual(await db.query('SELECT * FROM messages'), before);
  });

  test('batch replay and acknowledgement and thread closure leave message bytes unchanged', async t => {
    const { db } = await setup(t, engine);
    await transaction(db, async () => { await delivery(db); await message(db); });
    const before = JSON.stringify(await db.query('SELECT * FROM messages'));
    await db.exec('UPDATE deliveries SET replay_count=1,last_replayed_at_ms=2000');
    assert.equal(JSON.stringify(await db.query('SELECT * FROM messages')), before);
    await db.exec("UPDATE deliveries SET status='acknowledged',generation=2");
    await db.exec("UPDATE threads SET status='fenced' WHERE thread_id='thread'");
    assert.equal(JSON.stringify(await db.query('SELECT * FROM messages')), before);
    assert.equal((await db.query('SELECT delivery_id FROM deliveries'))[0].delivery_id, 'd');
  });

  test('closed message kinds and canonical endpoint references apply in either direction', async t => {
    const { db } = await setup(t, engine);
    for (const [i, kind] of MESSAGE_KINDS.entries()) await transaction(db, async () => {
      await delivery(db, { id: `d${i}`, message: `m${i}` });
      await message(db, { id: `m${i}`, delivery: `d${i}`, kind, sender: 'worker', recipient: 'head' });
    });
    for (const changes of [{ kind: 'DONE' }, { kind: null }, { sender: 'missing' }, { sender: 'worker-A' }, { sender: 'worker' }, { thread: 'missing' }]) {
      await assert.rejects(transaction(db, async () => { await delivery(db); await message(db, changes); }), constraint);
    }
    assert.equal((await db.query('SELECT message_id FROM messages')).length, MESSAGE_KINDS.length);
  });

  test('thread ownership requires a team, optionally a task in its Run and team', async t => {
    const { db } = await setup(t, engine);
    const insert = (id, team, task, run = 'run') => db.query(`INSERT INTO threads
      (thread_id,run_id,team_id,task_id,status,generation,endpoint_a_member_id,endpoint_b_member_id)
      VALUES (:id,:run,:team,:task,'open',1,'head','worker')`, { id, team, task, run });
    await assert.rejects(insert('duplicate-team', 'fixture-team', null), constraint);
    await assert.rejects(insert('ownerless', null, null), constraint);
    await assert.rejects(insert('missing-task', 'fixture-team', 'missing'), constraint);
    await insert('another-task', 'fixture-team', 'other-task');
    await db.exec(`INSERT INTO teams VALUES ('two','Two','',1,'team-orchestrator','0.0.0');
      INSERT INTO runs VALUES ('two-run',1,'two'); INSERT INTO tasks (task_id,run_id) VALUES ('two-task','two-run');`);
    await assert.rejects(insert('wrong-team', 'two', null), constraint);
    await assert.rejects(insert('wrong-task-team', 'fixture-team', 'two-task'), constraint);
    await insert('two-team-thread', 'two', null, 'two-run');
    assert.equal((await db.query('SELECT thread_id FROM threads')).length, 4);
  });

  test('assignment retry history has one root and a same-task non-self predecessor without forks', async t => {
    const { db } = await setup(t, engine);
    await assignment(db);
    await assignment(db, { id: 'retry', previous: 'a' });
    await assignment(db, { id: 'retry-again', previous: 'retry' });
    for (const changes of [{ id: 'second-root' }, { id: 'fork', previous: 'a' }, { id: 'self', previous: 'self' },
      { id: 'missing', previous: 'absent' }, { id: 'cross-task', task: 'other-task', previous: 'retry-again' }]) await assert.rejects(assignment(db, changes), constraint);
    await db.exec("UPDATE threads SET assignment_id='a' WHERE thread_id='thread'");
    await assert.rejects(db.exec("UPDATE threads SET assignment_id='a' WHERE thread_id='team-thread'"), constraint);
    assert.equal((await db.query('SELECT assignment_id FROM assignments')).length, 3);
  });

  test('NULL task windows mean off without admitting an enabled deadline before pickup', async t => {
    const { db } = await setup(t, engine);
    await assignment(db);
    for (const sql of ['task_deadline_ms=1500', 'task_window_minutes=0', 'task_window_minutes=3,task_deadline_ms=1500',
      'task_window_minutes=3,pickup_observed_at_ms=1500', 'task_window_minutes=3,pickup_observed_at_ms=1500,task_deadline_ms=1499']) {
      await assert.rejects(db.exec(`UPDATE assignments SET ${sql}`), constraint);
    }
    await db.exec('UPDATE assignments SET task_window_minutes=3'); // enabled, not yet picked up
    await db.exec('UPDATE assignments SET pickup_observed_at_ms=1500,task_deadline_ms=1600');
    await db.exec('UPDATE assignments SET task_window_minutes=NULL,task_deadline_ms=NULL');
    const [row] = await db.query('SELECT task_window_minutes,task_deadline_ms,pickup_observed_at_ms FROM assignments');
    assert.equal(row.task_window_minutes, null); assert.equal(row.task_deadline_ms, null); assert.equal(Number(row.pickup_observed_at_ms), 1500);
  });

  test('question deadlines bind delivery time independently of task pickup', async t => {
    const { db } = await setup(t, engine);
    for (const sql of ['answer_deadline_ms=1500', 'question_delivered_at_ms=1200', 'question_delivered_at_ms=1200,answer_deadline_ms=1199']) {
      await assert.rejects(db.exec(`UPDATE threads SET ${sql} WHERE thread_id='team-thread'`), constraint);
    }
    await db.exec("UPDATE threads SET question_delivered_at_ms=1200,answer_deadline_ms=1500 WHERE thread_id='team-thread'");
    assert.deepEqual(await db.query('SELECT assignment_id FROM assignments'), []);
    assert.equal(Number((await db.query("SELECT answer_deadline_ms FROM threads WHERE thread_id='team-thread'"))[0].answer_deadline_ms), 1500);
  });

  test('window and replay settings have no invented required defaults', async t => {
    const { db } = await setup(t, engine);
    for (const field of ['answer_window_minutes', 'replay_interval_ms']) {
      await assert.rejects(db.exec(`UPDATE team_settings SET ${field}=NULL`), constraint);
      await assert.rejects(db.exec(`UPDATE team_settings SET ${field}=0`), constraint);
    }
    await assert.rejects(db.exec('UPDATE team_settings SET task_window_minutes=0'), constraint);
    await db.exec('UPDATE team_settings SET task_window_minutes=30');
    await db.exec('UPDATE team_settings SET task_window_minutes=NULL');
    await transaction(db, () => seedDelivery(db));
    await assert.rejects(db.exec('UPDATE deliveries SET replay_count=1'), constraint);
  });

  test('gate JSON remains opaque; client obligations and gate application are explicit', async t => {
    const { db } = await setup(t, engine);
    await db.query('INSERT INTO decision_gates (gate_id,task_id,question,options_json) VALUES (:id,:task,:question,:options)', { id: 'g', task: 'task', question: 'Choose', options: '{not parsed' });
    await db.exec("UPDATE decision_gates SET status='resolved',resolution_json='also opaque',resolved_at_ms=1000");
    assert.equal((await db.query('SELECT options_json FROM decision_gates'))[0].options_json, '{not parsed');
    assert.equal((await db.query("SELECT status FROM tasks WHERE task_id='task'"))[0].status, 'open');
    assert.match(RULES.gates, /client validates JSON syntax, at least two offered strings/);
    assert.match(RULES.gates, /resolution naming an offered option/);
  });

  test('new numeric columns cannot store fractional windows, counters or timestamps', async t => {
    const { db } = await setup(t, engine);
    await transaction(db, () => seedDelivery(db)); await assignment(db);
    const changes = [['team_settings', 'answer_window_minutes=1.5'], ['team_settings', 'task_window_minutes=1.5'],
      ['team_settings', 'replay_interval_ms=1.5'], ['assignments', 'task_window_minutes=1.5'],
      ['assignments', 'task_window_minutes=1,pickup_observed_at_ms=1500,task_deadline_ms=1500.5'],
      ['threads', 'question_delivered_at_ms=1200.5,answer_deadline_ms=1500'],
      ['deliveries', 'replay_count=1.5,last_replayed_at_ms=2000'], ['deliveries', 'replay_count=1,last_replayed_at_ms=2000.5']];
    if (engine === 'sqlite') {
      for (const [table, fields] of changes) await assert.rejects(db.exec(`UPDATE ${table} SET ${fields}`), constraint);
      await assert.rejects(transaction(db, async () => {
        await delivery(db, { id: 'fractional', message: 'fractional' });
        await db.exec(`INSERT INTO messages (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
          VALUES ('fractional','fractional','fixture-team','thread','head','worker','','status',1000.5)`);
      }), constraint);
    } else {
      // PostgreSQL BIGINT storage coerces numeric SQL literals before CHECK.
      // Public DTO validation rejects fractions before either engine is called.
      await db.exec('UPDATE team_settings SET answer_window_minutes=1.5');
      const [row] = await db.query('SELECT answer_window_minutes FROM team_settings');
      assert.equal(Number(row.answer_window_minutes), 2);
      const columns = await db.query(`SELECT data_type FROM information_schema.columns WHERE table_schema=current_schema()
        AND table_name='messages' AND column_name='created_at_ms'`);
      assert.equal(columns[0].data_type, 'bigint');
    }
  });

  test('an immutability refusal rolls back a newly created message-delivery pair', async t => {
    const { db } = await setup(t, engine);
    await transaction(db, () => seedDelivery(db));
    await assert.rejects(transaction(db, async () => { await seedDelivery(db, { id: 'uncommitted' }); await db.exec("UPDATE messages SET body='changed' WHERE message_id='message-delivery'"); }), immutable);
    assert.equal((await db.query('SELECT message_id FROM messages')).length, 1);
    assert.equal((await db.query('SELECT delivery_id FROM deliveries')).length, 1);
  });
});
