import { Worker } from 'node:worker_threads';
import { integer, text, databaseInteger } from './validation.mjs';
import { refusal } from './errors.mjs';
import { SQL } from '../contract.mjs';

function named(sql, params = {}) {
  const names = [...new Set([...sql.matchAll(/(?<!:):([a-z_]+)/g)].map(match => match[1]))];
  for (const name of names) if (!Object.hasOwn(params, name)) throw refusal('STORE_INPUT_INVALID', `Missing SQL parameter: ${name}.`);
  return { names, values: names.map(name => params[name]), params: Object.fromEntries(names.map(name => [name, params[name]])) };
}

export async function connectSqlite({ path, readOnly = false, busyTimeoutMs = 100 }) {
  integer(busyTimeoutMs, 'busyTimeoutMs', { max: 30000 });
  const worker = new Worker(new URL('./sqlite-worker.mjs', import.meta.url), { workerData: { path, readOnly, busyTimeoutMs } });
  let readyResolve, readyReject, serial = 0, stopped = false;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const pending = new Map();
  const fail = error => {
    stopped = true;
    readyReject(error);
    for (const item of pending.values()) item.reject(error);
    pending.clear();
  };
  worker.on('error', fail);
  worker.on('exit', () => fail(refusal('STORE_CONNECTION_CLOSED', 'Team store database connection closed.')));
  worker.on('message', message => {
    if (message.ready) return readyResolve();
    if (message.startupError) return fail(Object.assign(new Error(message.startupError.message), message.startupError));
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id);
    if (message.error) item.reject(Object.assign(new Error(message.error.message), message.error));
    else item.resolve(message.rows);
  });
  try { await ready; }
  catch (error) { await worker.terminate(); throw error; }
  const call = (method, sql, params) => {
    if (stopped) return Promise.reject(refusal('STORE_CONNECTION_CLOSED', 'Team store database connection closed.'));
    return new Promise((resolve, reject) => {
      const id = ++serial;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, method, sql, params });
    });
  };
  const db = {
    engine: 'sqlite',
    query: (sql, params) => call('query', sql, named(sql, params).params),
    exec: sql => call('exec', sql),
    begin: () => call('exec', 'BEGIN IMMEDIATE'),
    commit: () => call('exec', 'COMMIT'),
    rollback: () => call('exec', 'ROLLBACK'),
    objects: () => call('query', "SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name"),
    lockLeaseControl: () => db.query(SQL.readLease),
    async now() {
      const [row] = await call('query', "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER) AS now_ms");
      return databaseInteger(row.now_ms, 'database clock');
    },
    async close() {
      if (stopped) return;
      try { await call('close'); } finally { stopped = true; await worker.terminate(); }
    },
  };
  return db;
}

export async function connectPostgres({ connectionString, loadDriver = () => import('pg'), connectionTimeoutMs = 5000 }) {
  text(connectionString, 'PostgreSQL connectionString');
  let url;
  try { url = new URL(connectionString); } catch { throw refusal('STORE_INPUT_INVALID', 'PostgreSQL connectionString must be an explicit postgres URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
    throw refusal('STORE_INPUT_INVALID', 'PostgreSQL connectionString must name an explicit host and project database.');
  }
  integer(connectionTimeoutMs, 'connectionTimeoutMs', { min: 1, max: 60000 });
  let Client;
  try { ({ Client } = await loadDriver()); }
  catch (error) { throw refusal('STORE_DRIVER_UNAVAILABLE', 'Hosted team storage requires the optional pg driver. Local SQLite does not require it.', {}, error); }
  const client = new Client({ connectionString, connectionTimeoutMillis: connectionTimeoutMs });
  // Prevent an asynchronous socket error from becoming an unhandled EventEmitter error.
  let failure;
  client.on('error', error => { failure = error; });
  try {
    await client.connect();
    // Connection/session settings only: no persistent write before format/version validation.
    await client.query("SET default_transaction_read_only = on; SET search_path = public, pg_catalog");
    const replication = await client.query('SHOW session_replication_role');
    if (replication.rows[0]?.session_replication_role !== 'origin') {
      throw refusal('STORE_CONSTRAINTS_UNAVAILABLE', 'PostgreSQL team storage requires enabled origin constraint enforcement.');
    }
  } catch (error) {
    await client.end().catch(() => {});
    if (error.code === 'STORE_CONSTRAINTS_UNAVAILABLE') throw error;
    throw refusal('STORE_CONNECTION_FAILED', 'Cannot connect to the configured PostgreSQL team database.', {}, error);
  }
  const query = (sql, params) => {
    if (failure) return Promise.reject(failure);
    const bindings = named(sql, params);
    const translated = sql.replace(/(?<!:):([a-z_]+)/g, (_, name) => `$${bindings.names.indexOf(name) + 1}`);
    return client.query(translated, bindings.values).then(result => result.rows);
  };
  return {
    engine: 'postgres',
    query,
    exec: async sql => { if (failure) throw failure; await client.query(sql); },
    begin: () => client.query('BEGIN READ WRITE'),
    commit: () => client.query('COMMIT'),
    rollback: () => client.query('ROLLBACK'),
    // Lease acquisition must also sample time after a potentially blocking lock.
    // SQLite BEGIN IMMEDIATE already holds its writer lock; PostgreSQL needs this row lock.
    lockLeaseControl: () => query(`${SQL.readLease} FOR UPDATE`),
    async objects() {
      // Include user schemas, routines, types, and extensions as well as tables:
      // an existing non-table object does not make a database safe to initialize.
      const result = await client.query(`
        SELECT c.relname AS name FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%'
        UNION ALL SELECT nspname FROM pg_catalog.pg_namespace
          WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname NOT LIKE 'pg_toast%' AND nspname NOT LIKE 'pg_temp_%'
        UNION ALL SELECT p.proname FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
        UNION ALL SELECT t.typname FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%'
        UNION ALL SELECT extname FROM pg_catalog.pg_extension WHERE extname <> 'plpgsql'
      `);
      return result.rows;
    },
    async now() {
      const [row] = await query('SELECT floor(extract(epoch FROM clock_timestamp()) * 1000) AS now_ms');
      return databaseInteger(row.now_ms, 'database clock');
    },
    close: () => client.end(),
  };
}
