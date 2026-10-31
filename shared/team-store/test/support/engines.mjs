import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ddlFor } from '../../contract.mjs';

export function postgresTestUrl() {
  const value = process.env.TEAM_STORE_TEST_POSTGRES;
  if (!value) return null;
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || !/^\/team_store_contract_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
    throw new Error('PostgreSQL contract tests require a loopback host and a dedicated team_store_contract_test database.');
  }
  return value;
}

async function sqliteConnection(path) {
  const worker = new Worker(new URL('./sqlite-worker.mjs', import.meta.url), { workerData: { path } });
  let serial = 0;
  const waiting = new Map();
  let readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  worker.on('message', message => {
    if (message.ready) return readyResolve();
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(Object.assign(new Error(message.error.message), message.error));
    else pending.resolve(message.result);
  });
  worker.on('error', error => {
    readyReject(error);
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
  });
  await ready;
  const call = (method, sql, params) => new Promise((resolve, reject) => {
    const id = ++serial;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, method, sql, params });
  });
  return {
    exec: sql => call('exec', sql),
    query: (sql, params) => call('query', sql, params),
    async close() { try { await call('close'); } finally { await worker.terminate(); } },
  };
}

// Protocol statements use named parameters. Only test adapters translate binding
// syntax; table definitions, predicates, and assertions stay identical.
function postgresBindings(sql, params = {}) {
  const names = [];
  const text = sql.replace(/:([a-z_]+)/g, (_, name) => {
    if (!Object.hasOwn(params, name)) throw new Error(`Missing SQL parameter: ${name}`);
    if (!names.includes(name)) names.push(name);
    return `$${names.indexOf(name) + 1}`;
  });
  return { text, values: names.map(name => params[name]) };
}

export async function fixture(t, engine) {
  const connections = [];
  let connect;
  if (engine === 'sqlite') {
    const directory = await mkdtemp(join(tmpdir(), 'team-store-contract-'));
    connect = () => sqliteConnection(join(directory, 'team.sqlite'));
    t.after(async () => {
      try { await Promise.all(connections.map(connection => connection.close())); }
      finally { await rm(directory, { recursive: true, force: true }); }
    });
  } else {
    const connectionString = postgresTestUrl();
    if (!connectionString) throw new Error('Set TEAM_STORE_TEST_POSTGRES to run PostgreSQL conformance tests.');
    const { Client } = await import('pg');
    const schema = `contract_${randomBytes(12).toString('hex')}`;
    const admin = new Client({ connectionString, connectionTimeoutMillis: 5000 });
    await admin.connect();
    try { await admin.query(`CREATE SCHEMA ${schema}`); }
    catch (error) { await admin.end(); throw error; }
    t.after(async () => {
      try {
        await Promise.all(connections.map(connection => connection.close()));
        // The name is generated above, never from configuration or user input.
        await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      } finally { await admin.end(); }
    });
    connect = async () => {
      const client = new Client({ connectionString, connectionTimeoutMillis: 5000 });
      await client.connect();
      try {
        await client.query(`SET search_path TO ${schema}; SET statement_timeout = '5s'; SET lock_timeout = '4s'`);
      } catch (error) { await client.end(); throw error; }
      return {
        exec: sql => client.query(sql).then(() => []),
        query: (sql, params) => client.query(postgresBindings(sql, params)).then(result => result.rows),
        close: () => client.end(),
      };
    };
  }
  const newConnection = async () => {
    const connection = await connect();
    connections.push(connection);
    return connection;
  };
  const db = await newConnection();
  await db.exec(ddlFor(engine));
  return { db, connect: newConnection };
}
