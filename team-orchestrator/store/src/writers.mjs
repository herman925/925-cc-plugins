import { KNOWN_WRITER_FAMILIES, WRITER_PROTOCOL_VERSION, SQL } from '../contract.mjs';
import { text, integer, databaseInteger, nextInteger, snapshot } from './validation.mjs';
import { refusal } from './errors.mjs';

export function parseRelease(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw refusal('STORE_WRITER_VERSION_INVALID', `Writer version ${JSON.stringify(version)} must be numeric major.minor.patch.`);
  }
  return version.split('.').map((value, i) => integer(Number(value), `writer version component ${i}`));
}

export function normalizeWriter(value, required = true) {
  if (!value && !required) return null;
  if (!value) throw refusal('STORE_WRITER_REQUIRED', 'An attested writer family, release version and protocol are required for this write.');
  const client = text(value.client, 'writer.client');
  if (!KNOWN_WRITER_FAMILIES.includes(client)) {
    throw refusal('STORE_WRITER_FAMILY_UNKNOWN', `Unknown writer family ${JSON.stringify(client)}. Installed families: ${KNOWN_WRITER_FAMILIES.join(', ')}.`, { client });
  }
  const parts = parseRelease(value.version);
  const protocol = integer(value.protocol ?? WRITER_PROTOCOL_VERSION, 'writer.protocol', { min: 1 });
  if (protocol > WRITER_PROTOCOL_VERSION) {
    throw refusal('STORE_WRITER_PROTOCOL_UNSUPPORTED', `Writer protocol ${protocol} exceeds this adapter's supported protocol ${WRITER_PROTOCOL_VERSION}.`, { protocol });
  }
  return snapshot({ client, version: value.version, protocol, parts });
}

const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
};

// Read-only checks can run before lease acquisition; repeat under the lease or
// SQLite machine transaction before advancing a fence or changing any data.
export async function checkWriter(db, supplied, { local = false, advance = false } = {}) {
  const writer = normalizeWriter(supplied);
  const identityTable = local ? 'machine_identity' : 'project_identity';
  const [identity] = await db.query(`SELECT minimum_writer_protocol FROM ${identityTable} WHERE singleton = 1`);
  if (!identity) throw refusal('STORE_IDENTITY_INVALID', 'Store identity is missing; no writer floor was invented.');
  const floor = databaseInteger(identity.minimum_writer_protocol, 'writer protocol floor', { min: 1 });
  if (writer.protocol < floor) throw refusal('STORE_WRITER_PROTOCOL_OLD', `Writer protocol ${writer.protocol} is below the store's required protocol ${floor}. No configuration or observation was written.`, { required: floor, protocol: writer.protocol });
  const [fence] = await db.query(SQL.readWriterFence, { writer_client: writer.client });
  if (!fence) throw refusal('STORE_WRITER_FENCE_MISSING', `Writer fence for installed family ${JSON.stringify(writer.client)} is missing; no writer was registered.`, { client: writer.client });
  let stored;
  try {
    stored = parseRelease(fence.writer_version);
    if (stored.some((value, i) => value !== databaseInteger(fence[['version_major', 'version_minor', 'version_patch'][i]], 'writer fence version'))) throw new Error('Inconsistent writer fence');
  } catch (error) { throw refusal('STORE_WRITER_FENCE_INVALID', `Writer fence for ${JSON.stringify(writer.client)} has an invalid release version. No fence was repaired.`, { client: writer.client }, error); }
  const oldProtocol = databaseInteger(fence.writer_protocol, 'writer fence protocol', { min: 1 });
  if (compare(writer.parts, stored) < 0 || writer.protocol < oldProtocol) {
    throw refusal('STORE_WRITER_TOO_OLD', `Writer ${JSON.stringify(writer.client)} version ${writer.version} is older than the recorded ${fence.writer_version} (protocol ${oldProtocol}). A fresh configuration generation does not authorize this binary.`, { client: writer.client, version: writer.version, required: fence.writer_version });
  }
  if (advance && (compare(writer.parts, stored) > 0 || writer.protocol > oldProtocol)) {
    const oldGeneration = databaseInteger(fence.generation, 'writer fence generation', { min: 1 });
    nextInteger(oldGeneration, 'writer fence generation');
    const rows = await db.query(`UPDATE writer_fences SET version_major = :major, version_minor = :minor, version_patch = :patch,
      writer_version = :version, writer_protocol = :protocol, generation = generation + 1
      WHERE writer_client = :client AND generation = :generation RETURNING writer_client`, {
      major: writer.parts[0], minor: writer.parts[1], patch: writer.parts[2], version: writer.version,
      protocol: writer.protocol, client: writer.client, generation: oldGeneration,
    });
    if (!rows.length) throw refusal('STORE_WRITER_FENCE_CONFLICT', `Writer fence for ${JSON.stringify(writer.client)} changed; the transaction was rolled back.`);
  }
  if (advance && writer.protocol > floor) {
    const rows = await db.query(`UPDATE ${identityTable} SET minimum_writer_protocol = :protocol
      WHERE singleton = 1 AND minimum_writer_protocol = :floor RETURNING minimum_writer_protocol`, { protocol: writer.protocol, floor });
    if (!rows.length) throw refusal('STORE_WRITER_FENCE_CONFLICT', 'The writer protocol floor changed; the transaction was rolled back.');
  }
  return writer;
}

export async function reference(db, table, key, id) {
  const [row] = await db.query(`SELECT * FROM ${table} WHERE ${key} = :id`, { id });
  if (!row) throw refusal('STORE_REFERENCE_MISSING', `Unknown ${key} ${JSON.stringify(id)}. No referenced record was invented.`, { field: key, id });
  return row;
}
