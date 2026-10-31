import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FORMAT, SCHEMA_VERSION, SQL } from '../contract.mjs';
import { inspectSchema, installSchema, openBackend } from '../src/bootstrap.mjs';
import { integer, text, nextInteger, databaseInteger } from '../src/validation.mjs';
import { postgresTestUrl } from './support/engines.mjs';
import { seedLayout } from './support/seed-layout.mjs';
import { runtimeFixture, rawWrite } from './support/runtime-fixture.mjs';

const code = expected => error => error.code === expected;
const hash = value => createHash('sha256').update(value).digest('hex');

test('finite safe integers, nonempty UTF-8 identifiers, and overflow fail closed', () => {
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', 1n, null]) {
    assert.throws(() => integer(value, 'generation'), code('STORE_INPUT_INVALID'));
  }
  assert.throws(() => nextInteger(Number.MAX_SAFE_INTEGER, 'generation'), code('STORE_INPUT_INVALID'));
  assert.equal(nextInteger(0, 'generation'), 1);
  assert.equal(databaseInteger('9007199254740991', 'generation'), Number.MAX_SAFE_INTEGER);
  assert.throws(() => databaseInteger('9007199254740992', 'generation'), code('STORE_INPUT_INVALID'));
  for (const value of ['', 'a\0b', '\ud800', 3]) assert.throws(() => text(value, 'memberId'), code('STORE_INPUT_INVALID'));
  assert.equal(text('Worker-A', 'memberId'), 'Worker-A');
});

test('local SQLite works from an isolated source tree with no node_modules', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'team-store-no-dependencies-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageRoot = fileURLToPath(new URL('../', import.meta.url));
  await cp(join(packageRoot, 'src'), join(directory, 'src'), { recursive: true });
  await cp(join(packageRoot, 'contract.mjs'), join(directory, 'contract.mjs'));
  await cp(join(packageRoot, 'index.mjs'), join(directory, 'index.mjs'));
  await mkdir(join(directory, 'project'));
  await writeFile(join(directory, 'probe.mjs'), `
    import { openTeamStore, openMachineStore } from './index.mjs';
    import { fileURLToPath } from 'node:url';
    const caller = { principalId: 'isolated-client' };
    const store = await openTeamStore({ projectRoot: fileURLToPath(new URL('./project', import.meta.url)), create: true, writer: { client: 'team-orchestrator', version: '0.5.42' },
      machineId: 'isolated-machine', caller, authorize: () => true });
    await store.execute({ operationId: 'isolated-create-run', caller, mutations: [{ type: 'createTeam', teamId: 'isolated-team', name: 'Isolated', functionText: '', settings: { autoClose: false, idleMinutes: 10, reopen: 'resume', maxOpen: 8, launch: 'demand', batch: 3, autoScratch: false, assumptions: false, scratchDir: '.scratch', pickupWindowMinutes: 1, answerWindowMinutes: 2, taskWindowMinutes: null, replayIntervalMs: 1000, exemptMemberIds: [] } }, { type: 'createRun', runId: 'run', teamId: 'isolated-team' }] });
    const { projectId } = await store.getIdentity({ caller });
    await store.close();
    const machine = await openMachineStore({ machineConfigRoot: fileURLToPath(new URL('./config', import.meta.url)), projectId,
      create: true, writer: { client: 'team-orchestrator-orca', version: '0.1.24' }, machineId: 'isolated-machine', caller, authorize: () => true });
    await machine.execute({ operationId: 'isolated-bind', caller, mutations: [
      { type: 'bindMember', memberId: 'worker', sessionId: 'session', bindingGeneration: 1, expectedGeneration: 0 },
    ] });
    if ((await machine.readMember({ memberId: 'worker', caller })).state !== 'unknown') throw new Error('Wrong isolated observation');
    await machine.close();
    console.log('local-store-ready');
  `);
  const result = spawnSync(process.execPath, [join(directory, 'probe.mjs')], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /local-store-ready/);
});

test('PostgreSQL driver is requested only on the explicit hosted path and fails clearly if unavailable', async () => {
  let loads = 0;
  await assert.rejects(openBackend({ postgres: {
    connectionString: 'postgres://test@127.0.0.1:1/team_store_contract_test',
    loadDriver: async () => { loads++; throw new Error('missing dependency'); },
  } }), code('STORE_DRIVER_UNAVAILABLE'));
  assert.equal(loads, 1);
  await assert.rejects(openBackend({ postgres: {} }), code('STORE_INPUT_INVALID'));
});

for (const engine of ['sqlite', 'postgres']) {
  describe(`${engine} runtime bootstrap`, { skip: engine === 'postgres' && !postgresTestUrl() }, () => {
    test('an empty store needs explicit creation; install uses the shared schema and can reopen data', async t => {
      const f = await runtimeFixture(t, engine);
      await assert.rejects(openBackend(f.options), code(engine === 'sqlite' ? 'STORE_NOT_FOUND' : 'STORE_EMPTY'));
      const { db } = await openBackend({ ...f.options, create: true });
      assert.deepEqual(await inspectSchema(db), { empty: false, version: SCHEMA_VERSION });
      assert.equal((await db.query(SQL.readVersion))[0].format, FORMAT);
      await db.begin();
      await seedLayout(db);
      await db.exec("INSERT INTO runs (run_id,consumer_generation,team_id) VALUES ('preserved', 1, 'fixture-team')");
      await db.commit();
      await db.close();
      const reopened = await openBackend(f.options);
      try { assert.equal((await reopened.db.query('SELECT run_id FROM runs'))[0].run_id, 'preserved'); }
      finally { await reopened.db.close(); }
    });

    test('a repeated explicit schema installation refuses and preserves data', async t => {
      const f = await runtimeFixture(t, engine);
      const { db } = await openBackend({ ...f.options, create: true });
      try {
        await assert.rejects(installSchema(db), error => error.code === 'STORE_NOT_EMPTY' && error.message === 'Cannot install team store schema: database is not empty.');
        assert.equal((await db.query(SQL.readVersion))[0].format, FORMAT);
      } finally { await db.close(); }
    });

    test('unknown schema versions are refused before writes, without changing legacy files', async t => {
      const f = await runtimeFixture(t, engine);
      const initial = await openBackend({ ...f.options, create: true });
      await initial.db.close();
      await rawWrite(f, 'UPDATE store_metadata SET schema_version = 99');
      const legacy = join(f.root, '.claude', 'team-orchestrator');
      await mkdir(legacy, { recursive: true });
      await writeFile(join(legacy, 'roster.json'), '{"backup":"untouched"}\n');
      const before = engine === 'sqlite' ? hash(await readFile(f.path)) : null;
      await assert.rejects(openBackend({ ...f.options, create: true }), error => error.code === 'STORE_VERSION_UNSUPPORTED'
        && error.message === `Unsupported team store schema version: 99 (supported: ${SCHEMA_VERSION}). No writes were performed.`);
      if (engine === 'sqlite') assert.equal(hash(await readFile(f.path)), before);
      assert.equal(await readFile(join(legacy, 'roster.json'), 'utf8'), '{"backup":"untouched"}\n');
      const raw = await f.raw();
      try {
        assert.equal(Number((await raw.query(SQL.readVersion))[0].schema_version), 99);
        assert.equal(Number((await raw.query(SQL.readLease))[0].generation), 0);
      } finally { await raw.close(); }
      for (const previous of [1, 2, 3, 4]) {
        await rawWrite(f, `UPDATE store_metadata SET schema_version = ${previous}`);
        const previousBytes = engine === 'sqlite' ? hash(await readFile(f.path)) : null;
        await assert.rejects(openBackend({ ...f.options, create: true }), error => error.code === 'STORE_VERSION_UNSUPPORTED'
          && error.details.version === previous && error.details.supported === SCHEMA_VERSION);
        if (engine === 'sqlite') assert.equal(hash(await readFile(f.path)), previousBytes);
      }
    });

    test('foreign or incomplete stores are never initialized over existing data', async t => {
      const f = await runtimeFixture(t, engine);
      await rawWrite(f, "CREATE TABLE other_app (value TEXT); INSERT INTO other_app VALUES ('preserve')");
      await assert.rejects(openBackend({ ...f.options, create: true }), code('STORE_METADATA_MISSING'));
      const raw = await f.raw();
      try {
        assert.equal((await raw.query('SELECT value FROM other_app'))[0].value, 'preserve');
        assert.equal((await raw.objects()).some(row => row.name === 'store_metadata'), false);
      } finally { await raw.close(); }
    });

    test('a wrong format is refused and is not rewritten', async t => {
      const f = await runtimeFixture(t, engine);
      await rawWrite(f, "CREATE TABLE store_metadata (singleton INTEGER, format TEXT, schema_version BIGINT); INSERT INTO store_metadata VALUES (1, 'different-product', 1)");
      await assert.rejects(openBackend({ ...f.options, create: true }), code('STORE_FORMAT_UNSUPPORTED'));
      const raw = await f.raw();
      try { assert.equal((await raw.query(SQL.readVersion))[0].format, 'different-product'); }
      finally { await raw.close(); }
    });

    test('a supported metadata row cannot disguise missing contract tables', async t => {
      const f = await runtimeFixture(t, engine);
      await rawWrite(f, `CREATE TABLE store_metadata (singleton INTEGER, format TEXT, schema_version BIGINT); INSERT INTO store_metadata VALUES (1, '${FORMAT}', ${SCHEMA_VERSION})`);
      await assert.rejects(openBackend({ ...f.options, create: true }), code('STORE_SCHEMA_INCOMPLETE'));
    });

    test('the engine supplies an integer UTC clock without the application wall clock', async t => {
      const f = await runtimeFixture(t, engine);
      const { db } = await openBackend({ ...f.options, create: true });
      const original = Date.now;
      Date.now = () => { throw new Error('Application clock must not be used'); };
      try {
        const now = await db.now();
        assert.ok(Number.isSafeInteger(now) && now > 1700000000000);
      } finally { Date.now = original; await db.close(); }
    });

    test('a failed installation transaction leaves no partial schema', async t => {
      const f = await runtimeFixture(t, engine);
      const db = await f.raw();
      const wrapped = { ...db, exec: async sql => { await db.exec(sql); throw new Error('injected installation failure'); } };
      try {
        await assert.rejects(installSchema(wrapped), /injected installation failure/);
        assert.deepEqual(await db.objects(), []);
      } finally { await db.close(); }
    });

    test('a lost installation commit response is unknown and reopening does not repeat DDL', async t => {
      const f = await runtimeFixture(t, engine);
      const db = await f.raw();
      const wrapped = { ...db, commit: async () => { await db.commit(); throw new Error('lost install commit response'); } };
      try { await assert.rejects(installSchema(wrapped), code('STORE_COMMIT_UNKNOWN')); }
      finally { await db.close(); }
      const reopened = await openBackend(f.options);
      try { assert.equal((await inspectSchema(reopened.db)).version, SCHEMA_VERSION); }
      finally { await reopened.db.close(); }
    });
  });
}

test('SQLite enables foreign keys on runtime connections', async t => {
  const f = await runtimeFixture(t, 'sqlite');
  const { db } = await openBackend({ ...f.options, create: true });
  try {
    assert.equal((await db.query('PRAGMA foreign_keys'))[0].foreign_keys, 1);
    await assert.rejects(db.exec("INSERT INTO tasks (task_id,run_id) VALUES ('orphan', 'missing')"), /FOREIGN KEY/);
  } finally { await db.close(); }
});

test('PostgreSQL empty-store inspection includes user routines, not just tables', { skip: !postgresTestUrl() }, async t => {
  const f = await runtimeFixture(t, 'postgres');
  await rawWrite(f, 'CREATE FUNCTION public.keep_me() RETURNS integer LANGUAGE SQL AS $$ SELECT 1 $$');
  await assert.rejects(openBackend({ ...f.options, create: true }), code('STORE_METADATA_MISSING'));
});

test('SQLite refuses a project storage directory redirected outside the project', async t => {
  const f = await runtimeFixture(t, 'sqlite');
  const outside = await mkdtemp(join(tmpdir(), 'team-store-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(f.root, '.team-orchestrator'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(openBackend({ ...f.options, create: true }), code('STORE_PATH_INVALID'));
});

test('PostgreSQL refuses a database whose session default disables foreign-key enforcement', { skip: !postgresTestUrl() }, async t => {
  const f = await runtimeFixture(t, 'postgres');
  const { Client } = await import('pg');
  const url = new URL(f.options.postgres.connectionString);
  const database = url.pathname.slice(1);
  assert.match(database, /^team_store_contract_test_runtime_[a-f0-9]+$/);
  const admin = new Client({ connectionString: url.href });
  await admin.connect();
  try { await admin.query(`ALTER DATABASE ${database} SET session_replication_role = replica`); }
  finally { await admin.end(); }
  await assert.rejects(openBackend({ ...f.options, create: true }), code('STORE_CONSTRAINTS_UNAVAILABLE'));
});
