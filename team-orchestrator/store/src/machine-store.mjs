import { createHash } from 'node:crypto';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { MACHINE_DATABASE } from '../contract.mjs';
import { openSqliteBackend, inspectSchema, MACHINE_SCHEMA } from './bootstrap.mjs';
import { authorize } from './authority.mjs';
import { normalizeWriter, checkWriter } from './writers.mjs';
import { text, integer, databaseInteger, nextInteger, snapshot } from './validation.mjs';
import { StoreError, refusal, isRetryable, isConstraint } from './errors.mjs';

const states = ['starting', 'working', 'idle', 'asking', 'offline', 'closed', 'failed', 'unknown'];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const readOperation = 'SELECT request_fingerprint,result FROM local_operations WHERE operation_id=:id';
const nullableText = (value, field) => value == null ? null : text(value, field, { allowEmpty: true });
const nullableInt = (value, field, min = 0) => value == null ? null : integer(value, field, { min });
const rowNumber = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
  /(?:generation|_ms|context_window_tokens)$/.test(key) && value != null ? databaseInteger(value, key) : value,
]));
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw refusal('STORE_INPUT_INVALID', 'Unexpected machine observation field or shape.');
};

function jsonValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return text(value, 'detail string', { allowEmpty: true });
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.fromEntries(Object.keys(value).sort().map(key => [text(key, 'detail key', { allowEmpty: true }), jsonValue(value[key])]));
  throw refusal('STORE_INPUT_INVALID', 'Observation detail must be finite JSON data.');
}

function normalize(request) {
  text(request?.operationId, 'operationId');
  const principalId = text(request.caller?.principalId, 'caller.principalId');
  if (!Array.isArray(request.mutations) || !request.mutations.length || request.mutations.length > 100) throw refusal('STORE_INPUT_INVALID', 'A machine request must contain between 1 and 100 observation mutations.');
  const mutations = request.mutations.map(input => {
    if (!['bindMember', 'recordObservation', 'recordLocalReceipt'].includes(input?.type)) throw refusal('STORE_MACHINE_OPERATION_UNSUPPORTED', `Machine storage cannot execute ${JSON.stringify(input?.type)}; only fixed local observation operations are supported.`);
    const common = ['type', 'memberId', 'sessionId', 'bindingGeneration'];
    const value = { type: input?.type, memberId: text(input?.memberId, 'memberId'), sessionId: text(input?.sessionId, 'sessionId'), bindingGeneration: integer(input?.bindingGeneration, 'bindingGeneration', { min: 1 }) };
    if (input.type === 'bindMember') {
      exact(input, [...common, 'expectedGeneration']);
      value.expectedGeneration = integer(input.expectedGeneration, 'expectedGeneration');
    } else if (input.type === 'recordObservation') {
      exact(input, [...common, 'expectedGeneration', 'state', 'rawState', 'turnStartMs', 'turnEndMs', 'contextUsedPercent', 'contextWindowTokens', 'model', 'effort', 'taskLabel']);
      value.expectedGeneration = integer(input.expectedGeneration, 'expectedGeneration', { min: 1 });
      const state = text(input.state, 'state');
      value.state = states.includes(state) ? state : 'unknown';
      if (!states.includes(state) && input.rawState != null && input.rawState !== state) throw refusal('STORE_INPUT_INVALID', 'rawState contradicts the supplied unknown observation state.');
      value.rawState = states.includes(state) ? nullableText(input.rawState, 'rawState') : state;
      const percent = input.contextUsedPercent;
      if (percent != null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100)) throw refusal('STORE_INPUT_INVALID', 'contextUsedPercent must be finite and between 0 and 100, or null.');
      Object.assign(value, { turnStartMs: nullableInt(input.turnStartMs, 'turnStartMs'), turnEndMs: nullableInt(input.turnEndMs, 'turnEndMs'),
        contextUsedPercent: percent ?? null, contextWindowTokens: nullableInt(input.contextWindowTokens, 'contextWindowTokens', 1),
        model: nullableText(input.model, 'model'), effort: nullableText(input.effort, 'effort'), taskLabel: nullableText(input.taskLabel, 'taskLabel') });
    } else if (input.type === 'recordLocalReceipt') {
      exact(input, [...common, 'receiptId', 'sharedDeliveryId', 'observationKind', 'detail']);
      value.receiptId = text(input.receiptId, 'receiptId');
      value.sharedDeliveryId = input.sharedDeliveryId == null ? null : text(input.sharedDeliveryId, 'sharedDeliveryId');
      if (!['read', 'acknowledged', 'liveness'].includes(input.observationKind)) throw refusal('STORE_INPUT_INVALID', 'observationKind must be read, acknowledged or liveness.');
      value.observationKind = input.observationKind; value.detail = jsonValue(input.detail);
    } else throw refusal('STORE_MACHINE_OPERATION_UNSUPPORTED', `Machine storage cannot execute ${JSON.stringify(input?.type)}; only fixed local observation operations are supported.`);
    return value;
  });
  const identity = { kind: 'machineMutate', principalId, mutations };
  return { operationId: request.operationId, caller: snapshot(request.caller), identity: snapshot(identity), fingerprint: createHash('sha256').update(JSON.stringify(canonical(identity))).digest('hex') };
}

async function machinePath(configRoot, key, create) {
  text(configRoot, 'machineConfigRoot');
  if (!isAbsolute(configRoot)) throw refusal('STORE_PATH_INVALID', 'Machine storage requires an absolute configuration root.');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(key)) throw refusal('STORE_PATH_INVALID', 'Machine projectKey must be one safe directory component.');
  let root;
  try { root = await realpath(configRoot); }
  catch (error) {
    if (error.code !== 'ENOENT' || !create) throw error;
    await mkdir(configRoot, { recursive: true, mode: 0o700 }); root = await realpath(configRoot);
  }
  if (/^\\\\(?:\?\\UNC\\|[^?])/i.test(root)) throw refusal('STORE_PATH_INVALID', 'Machine observations require local storage; a UNC path is not supported.');
  let directory = root;
  for (const component of ['team-orchestrator', key]) {
    directory = join(directory, component);
    let info;
    try { info = await lstat(directory); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (!create) throw refusal('STORE_NOT_FOUND', 'Machine store does not exist. Explicit creation is required.');
      await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      info = await lstat(directory);
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw refusal('STORE_PATH_INVALID', 'Machine storage components must be real directories, not symlinks.');
  }
  const path = join(directory, MACHINE_DATABASE);
  let info;
  try { info = await lstat(path); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) throw refusal('STORE_NOT_FOUND', 'Machine store does not exist. Explicit creation is required.');
    const file = await open(path, 'wx', 0o600).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await file?.close(); info = await lstat(path);
  }
  if (info.isSymbolicLink() || !info.isFile()) throw refusal('STORE_PATH_INVALID', 'Machine database must be a regular local file, not a symlink.');
  return path;
}

export async function createMachineRuntime(options = {}, dependencies = {}) {
  if (options.postgres !== undefined || Object.hasOwn(options, 'sharedStore')) throw refusal('STORE_MACHINE_OPERATION_UNSUPPORTED', 'Machine storage accepts neither a hosted database nor a shared-store object.');
  const projectId = text(options.projectId, 'projectId');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) throw refusal('STORE_IDENTITY_INVALID', 'Machine storage requires the shared project UUID, not a path-derived identity.');
  const identity = snapshot({ projectId, projectKey: text(options.projectKey ?? projectId, 'projectKey'), machineId: text(options.machineId, 'machineId') });
  const root = options.machineConfigRoot ?? join(homedir(), '.claude');
  const scope = snapshot({ engine: 'sqlite', store: 'machine', projectId, projectKey: identity.projectKey, machineId: identity.machineId, machineConfigRoot: root });
  const writer = normalizeWriter(options.writer, options.create === true);
  const maxRetries = integer(options.maxRetries ?? 2, 'maxRetries', { max: 10 });
  const retryDelayMs = integer(options.retryDelayMs ?? 10, 'retryDelayMs', { max: 1000 });
  if (options.create === true) authorize(options.authorize, options.caller, 'createMachineStore', scope, { create: true }, writer);
  const path = await machinePath(root, identity.projectKey, options.create === true);
  const boot = dependencies.openBackend ?? openSqliteBackend;
  const backendOptions = { path, create: options.create === true, busyTimeoutMs: options.busyTimeoutMs, definition: MACHINE_SCHEMA, identity };
  let { db } = await boot(backendOptions);
  let closed = false, dirty = false, tail = Promise.resolve();
  const enqueue = fn => {
    const result = tail.then(() => { if (closed) throw refusal('STORE_CLOSED', 'Machine store is closed.'); return fn(); });
    tail = result.catch(() => {}); return result;
  };
  const reconnect = async () => { if (dirty) { ({ db } = await boot({ ...backendOptions, create: false })); dirty = false; } };
  const abandon = async () => { dirty = true; await db.close().catch(() => {}); };
  const inspect = () => inspectSchema(db, MACHINE_SCHEMA, identity);
  const prior = async request => {
    const [row] = await db.query(readOperation, { id: request.operationId });
    if (!row) return null;
    if (row.request_fingerprint !== request.fingerprint) throw refusal('STORE_IDEMPOTENCY_CONFLICT', `Machine operation id ${JSON.stringify(request.operationId)} was already used with a different request.`);
    try {
      const value = JSON.parse(row.result);
      if (value.operationId !== request.operationId || value.kind !== 'machineMutate') throw new Error('Wrong receipt identity');
      return snapshot(value);
    } catch (error) { throw refusal('STORE_RECEIPT_INVALID', 'Stored machine operation receipt is invalid. It was not overwritten or retried.', {}, error); }
  };
  async function bound(input) {
    const [row] = await db.query('SELECT * FROM member_observations WHERE member_id=:id', { id: input.memberId });
    if (!row) throw refusal('STORE_LOCAL_BINDING_MISSING', `No local binding exists for member ${JSON.stringify(input.memberId)}.`);
    if (row.session_id !== input.sessionId || databaseInteger(row.binding_generation, 'binding_generation') !== input.bindingGeneration) {
      throw refusal('STORE_LOCAL_BINDING_STALE', `Local session or binding generation is stale for member ${JSON.stringify(input.memberId)}. No observation or acknowledgement was written.`);
    }
    return row;
  }
  async function apply(input, now) {
    if (input.type === 'bindMember') {
      const [old] = await db.query('SELECT * FROM member_observations WHERE member_id=:id', { id: input.memberId });
      const current = old ? databaseInteger(old.generation, 'observation generation', { min: 1 }) : 0;
      if (input.expectedGeneration !== current) throw refusal('STORE_LOCAL_GENERATION_CONFLICT', `Observation generation for member ${JSON.stringify(input.memberId)} changed (expected ${input.expectedGeneration}, current ${current}).`);
      if (old && input.bindingGeneration <= databaseInteger(old.binding_generation, 'binding_generation')) throw refusal('STORE_LOCAL_BINDING_STALE', `Rebinding member ${JSON.stringify(input.memberId)} requires a newer binding generation.`);
      const next = nextInteger(current, 'observation generation');
      const params = { id: input.memberId, session: input.sessionId, binding: input.bindingGeneration, now, next, expected: current };
      if (old) {
        const rows = await db.query(`UPDATE member_observations SET session_id=:session,binding_generation=:binding,state='unknown',raw_state=NULL,
          heartbeat_at_ms=0,turn_start_ms=NULL,turn_end_ms=NULL,context_used_percent=NULL,context_window_tokens=NULL,model=NULL,effort=NULL,task_label=NULL,
          observed_at_ms=:now,generation=:next WHERE member_id=:id AND generation=:expected RETURNING member_id`, params);
        if (!rows.length) throw refusal('STORE_LOCAL_GENERATION_CONFLICT', `Observation generation changed for member ${JSON.stringify(input.memberId)}.`);
      } else await db.query(`INSERT INTO member_observations (member_id,session_id,binding_generation,state,heartbeat_at_ms,observed_at_ms,generation)
        VALUES (:id,:session,:binding,'unknown',0,:now,:next)`, params);
      return { type: input.type, memberId: input.memberId, generation: next, bindingGeneration: input.bindingGeneration };
    }
    const old = await bound(input);
    if (input.type === 'recordObservation') {
      const current = databaseInteger(old.generation, 'observation generation', { min: 1 });
      if (current !== input.expectedGeneration) throw refusal('STORE_LOCAL_GENERATION_CONFLICT', `Observation generation for member ${JSON.stringify(input.memberId)} changed (expected ${input.expectedGeneration}, current ${current}).`);
      if (now < databaseInteger(old.heartbeat_at_ms, 'heartbeat_at_ms')) throw refusal('STORE_CLOCK_INVALID', `Local heartbeat clock regressed for member ${JSON.stringify(input.memberId)}.`);
      const next = nextInteger(current, 'observation generation');
      const rows = await db.query(`UPDATE member_observations SET state=:state,raw_state=:raw,heartbeat_at_ms=:now,turn_start_ms=:start,turn_end_ms=:end,
        context_used_percent=:percent,context_window_tokens=:window,model=:model,effort=:effort,task_label=:task,observed_at_ms=:now,generation=:next
        WHERE member_id=:id AND generation=:expected AND session_id=:session AND binding_generation=:binding RETURNING member_id`, {
        state: input.state, raw: input.rawState, now, start: input.turnStartMs, end: input.turnEndMs, percent: input.contextUsedPercent,
        window: input.contextWindowTokens, model: input.model, effort: input.effort, task: input.taskLabel, next, id: input.memberId,
        expected: current, session: input.sessionId, binding: input.bindingGeneration,
      });
      if (!rows.length) throw refusal('STORE_LOCAL_GENERATION_CONFLICT', `Observation generation changed for member ${JSON.stringify(input.memberId)}.`);
      return { type: input.type, memberId: input.memberId, generation: next, observedAtMs: now };
    }
    const [existing] = await db.query('SELECT receipt_id FROM local_observation_receipts WHERE receipt_id=:id', { id: input.receiptId });
    if (existing) throw refusal('STORE_LOCAL_RECEIPT_EXISTS', `Local observation receipt ${JSON.stringify(input.receiptId)} already exists and cannot be overwritten.`);
    await db.query(`INSERT INTO local_observation_receipts (receipt_id,member_id,session_id,binding_generation,shared_delivery_id,observation_kind,detail_json,observed_at_ms)
      VALUES (:id,:member,:session,:binding,:delivery,:kind,:detail,:now)`, {
      id: input.receiptId, member: input.memberId, session: input.sessionId, binding: input.bindingGeneration, delivery: input.sharedDeliveryId,
      kind: input.observationKind, detail: input.detail == null ? null : JSON.stringify(input.detail), now,
    });
    return { type: input.type, receiptId: input.receiptId, observedAtMs: now };
  }
  async function attempt(request) {
    await reconnect();
    authorize(options.authorize, request.caller, 'machineMutate', scope, request.identity, writer);
    await inspect();
    const saved = await prior(request);
    if (saved) return saved;
    await checkWriter(db, writer, { local: true });
    let begun = false, committing = false;
    try {
      await db.begin(); begun = true;
      await inspect();
      const saved = await prior(request);
      if (saved) { committing = true; await db.commit(); return saved; }
      await checkWriter(db, writer, { local: true });
      const results = []; let last = await db.now();
      for (const mutation of request.identity.mutations) {
        const now = await db.now();
        if (now < last) throw refusal('STORE_CLOCK_INVALID', 'Database clock moved backwards during the machine transaction.');
        results.push(await apply(mutation, now)); last = now;
      }
      await checkWriter(db, writer, { local: true, advance: true });
      const now = await db.now();
      if (now < last) throw refusal('STORE_CLOCK_INVALID', 'Database clock moved backwards during the machine transaction.');
      const result = { operationId: request.operationId, kind: 'machineMutate', result: results };
      await db.query('INSERT INTO local_operations (operation_id,request_fingerprint,result,committed_at_ms) VALUES (:id,:fingerprint,:result,:now)', {
        id: request.operationId, fingerprint: request.fingerprint, result: JSON.stringify(result), now,
      });
      committing = true; await db.commit(); return snapshot(result);
    } catch (error) {
      if (committing && !isRetryable('sqlite', error) && !isConstraint('sqlite', error)) {
        await abandon(); throw refusal('STORE_COMMIT_UNKNOWN', `Machine commit outcome is unknown for operation ${JSON.stringify(request.operationId)}. Reconcile using the same operation id.`, { operationId: request.operationId }, error);
      }
      if (begun) try { await db.rollback(); } catch (cause) {
        await abandon(); throw refusal('STORE_ROLLBACK_UNKNOWN', `Machine rollback could not be confirmed for operation ${JSON.stringify(request.operationId)}. Reconcile before retrying.`, {}, cause);
      }
      throw error;
    }
  }
  return Object.freeze({
    execute: async input => {
      const request = normalize(input);
      return enqueue(async () => {
        for (let tries = 0; ; tries++) try { return await attempt(request); } catch (error) {
          if (isRetryable('sqlite', error)) {
            if (tries >= maxRetries) throw refusal('STORE_RETRY_EXHAUSTED', `Machine transaction retry limit reached after ${tries + 1} attempts.`, { attempts: tries + 1 }, error);
            await delay(retryDelayMs); continue;
          }
          if (error instanceof StoreError) throw error;
          throw refusal('STORE_DATABASE_ERROR', 'Machine database operation failed. No success was published.', {}, error);
        }
      });
    },
    reconcile: async input => {
      const request = normalize(input);
      return enqueue(async () => { await reconnect(); authorize(options.authorize, request.caller, 'machineMutate', scope, request.identity, writer); await inspect();
        return await prior(request) ?? { status: 'unknown', operationId: request.operationId }; });
    },
    readMember: ({ memberId, caller }) => enqueue(async () => {
      text(memberId, 'memberId'); await reconnect(); authorize(options.authorize, caller, 'readMachine', scope, { memberId }, writer); await inspect();
      return snapshot(rowNumber((await db.query('SELECT * FROM member_observations WHERE member_id=:id', { id: memberId }))[0])) ?? null;
    }),
    readReceipt: ({ receiptId, caller }) => enqueue(async () => {
      text(receiptId, 'receiptId'); await reconnect(); authorize(options.authorize, caller, 'readMachine', scope, { receiptId }, writer); await inspect();
      return snapshot(rowNumber((await db.query('SELECT * FROM local_observation_receipts WHERE receipt_id=:id', { id: receiptId }))[0])) ?? null;
    }),
    getIdentity: ({ caller }) => enqueue(async () => { await reconnect(); authorize(options.authorize, caller, 'readMachine', scope, { identity: true }, writer); await inspect(); return identity; }),
    close: () => { const result = tail.then(async () => { if (!closed) { closed = true; await db.close(); } }); tail = result.catch(() => {}); return result; },
  });
}

export const openMachineStore = options => createMachineRuntime(options);
