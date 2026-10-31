import { lstat, realpath, mkdir, open } from 'node:fs/promises';
import { isAbsolute, join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FORMAT, SCHEMA_VERSION, PROJECT_DIRECTORY, PROJECT_DATABASE, DDL, ddlFor, SQL,
  MACHINE_DDL, MACHINE_FORMAT, MACHINE_SCHEMA_VERSION, WRITER_PROTOCOL_VERSION } from '../contract.mjs';
import { connectSqlite, connectPostgres } from './engines.mjs';
import { databaseInteger, text } from './validation.mjs';
import { refusal, isRetryable, isConstraint } from './errors.mjs';

export const SHARED_SCHEMA = Object.freeze({ format: FORMAT, version: SCHEMA_VERSION, ddl: DDL, render: ddlFor, label: 'team store' });
export const MACHINE_SCHEMA = Object.freeze({ format: MACHINE_FORMAT, version: MACHINE_SCHEMA_VERSION, ddl: MACHINE_DDL,
  render: engine => { if (engine !== 'sqlite') throw refusal('STORE_INPUT_INVALID', 'Machine storage supports SQLite only.'); return MACHINE_DDL; }, label: 'machine store' });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function inspectSchema(db, definition = SHARED_SCHEMA, expectedIdentity) {
  let objects;
  try { objects = await db.objects(); }
  catch (error) { throw refusal('STORE_SCHEMA_UNREADABLE', 'Cannot inspect the team store schema. No schema was installed.', {}, error); }
  if (!objects.length) return { empty: true };
  if (!objects.some(row => row.name === 'store_metadata')) {
    throw refusal('STORE_METADATA_MISSING', 'Team store metadata is missing from a nonempty database. No schema was installed.');
  }
  let rows;
  try { rows = await db.query(SQL.readVersion); }
  catch (error) { throw refusal('STORE_SCHEMA_UNREADABLE', 'Cannot read team store metadata. No schema was installed.', {}, error); }
  if (rows.length !== 1 || rows[0].format !== definition.format) {
    throw refusal('STORE_FORMAT_UNSUPPORTED', 'Unsupported team store format. No writes were performed.');
  }
  let version;
  try { version = databaseInteger(rows[0].schema_version, 'schema_version', { min: 1 }); }
  catch { throw refusal('STORE_VERSION_UNSUPPORTED', 'Invalid team store schema version. No writes were performed.'); }
  if (version !== definition.version) {
    throw refusal('STORE_VERSION_UNSUPPORTED', `Unsupported ${definition.label} schema version: ${version} (supported: ${definition.version}). No writes were performed.`, { version, supported: definition.version });
  }
  const requiredTables = [...definition.ddl.matchAll(/CREATE TABLE ([a-z_]+)\s*\(/g)].map(match => match[1]);
  const missing = requiredTables.filter(name => !objects.some(row => row.name === name));
  if (missing.length) throw refusal('STORE_SCHEMA_INCOMPLETE', `Team store schema is incomplete: missing ${missing.join(', ')}. No schema was installed.`, { missing });
  if (definition === SHARED_SCHEMA) {
    const guards = db.engine === 'sqlite' ? objects : await db.query(`SELECT t.tgname AS name FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE c.relname='messages' AND n.nspname=current_schema() AND NOT t.tgisinternal`);
    const required = db.engine === 'sqlite' ? ['messages_immutable_update', 'messages_immutable_delete', 'messages_immutable_replace']
      : ['messages_immutable_update', 'messages_immutable_truncate'];
    const absent = required.filter(name => !guards.some(row => row.name === name));
    if (absent.length) throw refusal('STORE_SCHEMA_INCOMPLETE', `Message immutability guards are missing: ${absent.join(', ')}. No write was authorized.`, { missing: absent });
  }
  const [identity] = await db.query(definition === MACHINE_SCHEMA
    ? 'SELECT * FROM machine_identity WHERE singleton = 1' : SQL.readProjectIdentity);
  if (!identity || !uuid.test(identity.project_id)) throw refusal('STORE_IDENTITY_INVALID', `The ${definition.label} has no valid project UUID. No identity was invented.`);
  if (definition === MACHINE_SCHEMA && expectedIdentity) {
    for (const [column, expected] of [['project_id', expectedIdentity.projectId], ['project_key', expectedIdentity.projectKey], ['machine_id', expectedIdentity.machineId]]) {
      if (identity[column] !== expected) throw refusal('STORE_MACHINE_BINDING_MISMATCH', `Machine store ${column} is ${JSON.stringify(identity[column])}, not ${JSON.stringify(expected)}. No writes were performed.`, { column, actual: identity[column], expected });
    }
  }
  return { empty: false, version };
}

export async function installSchema(db, { definition = SHARED_SCHEMA, identity } = {}) {
  const projectId = identity?.projectId ?? randomUUID();
  await db.begin();
  let committing = false;
  try {
    // Recheck under the installation transaction: never rely on a pre-lock emptiness check.
    const objects = await db.objects();
    if (objects.length) throw refusal('STORE_NOT_EMPTY', 'Cannot install team store schema: database is not empty.');
    await db.exec(definition.render(db.engine));
    if (definition === MACHINE_SCHEMA) {
      if (!identity) throw refusal('STORE_INPUT_INVALID', 'Machine creation requires an explicit project and machine binding.');
      await db.query('INSERT INTO machine_identity (singleton, project_id, project_key, machine_id, minimum_writer_protocol) VALUES (1, :project, :key, :machine, :protocol)', {
        project: projectId, key: identity.projectKey, machine: identity.machineId, protocol: WRITER_PROTOCOL_VERSION,
      });
    } else await db.query('INSERT INTO project_identity (singleton, project_id, minimum_writer_protocol) VALUES (1, :project, :protocol)', {
      project: projectId, protocol: WRITER_PROTOCOL_VERSION,
    });
    committing = true;
    await db.commit();
  } catch (error) {
    await db.rollback().catch(() => {});
    if (committing && !isRetryable(db.engine, error) && !isConstraint(db.engine, error)) {
      throw refusal('STORE_COMMIT_UNKNOWN', 'Schema installation commit outcome is unknown. Reopen and inspect the schema before any repeat installation.', { phase: 'installation' }, error);
    }
    throw error;
  }
}

export async function writeStoreIgnore(path) {
  const ignore = await open(join(dirname(path), '.gitignore'), 'wx', 0o600).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (ignore) try { await ignore.writeFile('*\n!.gitignore\n', 'utf8'); } finally { await ignore.close(); }
}

export async function openSqliteBackend({ path, create = false, busyTimeoutMs, definition = SHARED_SCHEMA, identity }) {
  const readOnly = await connectSqlite({ path, readOnly: true, busyTimeoutMs });
  try { await inspectSchema(readOnly, definition, identity); } finally { await readOnly.close(); }
  const connect = () => connectSqlite({ path, busyTimeoutMs });
  const db = await connect();
  try {
    const initial = await inspectSchema(db, definition, identity);
    if (initial.empty) {
      if (!create) throw refusal('STORE_EMPTY', `${definition.label} is empty. Explicit creation is required.`);
      await installSchema(db, { definition, identity });
      await writeStoreIgnore(path);
    }
    await inspectSchema(db, definition, identity);
    return { db, connect };
  } catch (error) { await db.close(); throw error; }
}

async function localPath(projectRoot, create) {
  text(projectRoot, 'projectRoot');
  if (!isAbsolute(projectRoot)) throw refusal('STORE_PATH_INVALID', 'Team storage requires an absolute project root.');
  const root = await realpath(projectRoot);
  if (/^\\\\(?:\?\\UNC\\|[^?])/i.test(root)) {
    throw refusal('STORE_PATH_INVALID', 'SQLite team storage cannot use a UNC network path; configure PostgreSQL for shared-host storage.');
  }
  const directory = join(root, PROJECT_DIRECTORY);
  let info;
  try { info = await lstat(directory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) throw refusal('STORE_NOT_FOUND', 'Team store does not exist. Explicit creation is required.');
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    info = await lstat(directory);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) throw refusal('STORE_PATH_INVALID', 'Team storage directory must be a real directory inside the project root.');
  const path = join(directory, PROJECT_DATABASE);
  try {
    const file = await lstat(path);
    if (file.isSymbolicLink() || !file.isFile()) throw refusal('STORE_PATH_INVALID', 'Team database must be a regular file inside the project storage directory.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) throw refusal('STORE_NOT_FOUND', 'Team store does not exist. Explicit creation is required.');
    const file = await open(path, 'wx', 0o600).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await file?.close();
    const checked = await lstat(path);
    if (checked.isSymbolicLink() || !checked.isFile()) throw refusal('STORE_PATH_INVALID', 'Team database must be a regular file inside the project storage directory.');
  }
  return path;
}

// Internal connection bootstrap. The public store must authorize before create=true.
export async function openBackend(options) {
  const create = options.create === true;
  let db, connect, localDatabasePath;
  if (options.postgres !== undefined) {
    if (!options.postgres || typeof options.postgres !== 'object') throw refusal('STORE_INPUT_INVALID', 'Hosted storage requires explicit PostgreSQL configuration.');
    connect = () => connectPostgres(options.postgres);
    db = await connect();
  } else {
    const path = await localPath(options.projectRoot, create);
    localDatabasePath = path;
    return openSqliteBackend({ path, create, busyTimeoutMs: options.busyTimeoutMs });
  }
  try {
    const schema = await inspectSchema(db);
    if (schema.empty) {
      if (!create) throw refusal('STORE_EMPTY', 'Team store is empty. Explicit creation is required.');
      await installSchema(db);
      if (localDatabasePath) {
        // The DDL transaction has committed. This filesystem effect never runs
        // before version validation and never holds a database write lock.
        await writeStoreIgnore(localDatabasePath);
      }
    }
    await inspectSchema(db);
    return { db, connect };
  } catch (error) { await db.close(); throw error; }
}
