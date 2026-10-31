import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { postgresTestUrl } from './engines.mjs';
import { connectSqlite, connectPostgres } from '../../src/engines.mjs';
import { PROJECT_DIRECTORY, PROJECT_DATABASE } from '../../contract.mjs';

export async function runtimeFixture(t, engine) {
  const root = await mkdtemp(join(tmpdir(), 'team-store-runtime-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  if (engine === 'sqlite') {
    const directory = join(root, PROJECT_DIRECTORY);
    const path = join(directory, PROJECT_DATABASE);
    return {
      root, path, options: { projectRoot: root },
      async raw() { await mkdir(directory, { recursive: true }); return connectSqlite({ path }); },
    };
  }
  const { Client } = await import('pg');
  const url = new URL(postgresTestUrl());
  const database = `team_store_contract_test_runtime_${randomBytes(8).toString('hex')}`;
  const admin = new Client({ connectionString: url.href });
  await admin.connect();
  try { await admin.query(`CREATE DATABASE ${database}`); }
  catch (error) { await admin.end(); throw error; }
  t.after(async () => {
    try { await admin.query(`DROP DATABASE ${database} WITH (FORCE)`); }
    finally { await admin.end(); }
  });
  url.pathname = `/${database}`;
  const postgres = { connectionString: url.href };
  return { root, options: { postgres }, raw: () => connectPostgres(postgres) };
}

export async function rawWrite(fixture, sql) {
  const db = await fixture.raw();
  try {
    await db.begin();
    await db.exec(sql);
    await db.commit();
  } catch (error) { await db.rollback().catch(() => {}); throw error; }
  finally { await db.close(); }
}
