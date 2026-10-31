import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { SQL, WRITER_PROTOCOL_VERSION, MESSAGE_KINDS } from '../contract.mjs';
import { authorize } from './authority.mjs';
import { normalizeWriter, checkWriter, reference } from './writers.mjs';
import { isConfigurationType, normalizeConfigurationMutation, applyConfigurationMutation, byteOrder } from './configuration.mjs';
import { openBackend, inspectSchema } from './bootstrap.mjs';
import { text, integer, databaseInteger, nextInteger, snapshot } from './validation.mjs';
import { StoreError, refusal, isRetryable, isConstraint } from './errors.mjs';
import { normalizeApiCommand, normalizeActor, applyApiCommand, assertApiCaller, apiResult } from './api-domain.mjs';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const generation = value => databaseInteger(value, 'generation', { min: 1 });
const conflict = () => refusal('STORE_CONFLICT', 'Team store mutation lost its expected state or generation. The transaction was rolled back.');
const readRow = row => row && Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
  /(?:generation|_at_ms|_deadline_ms|_window_minutes|replay_interval_ms|replay_count|config_version|minimum_writer_protocol|level|idle_minutes|max_open|batch_size)$/.test(key) && value !== null
    ? databaseInteger(value, key) : value,
]));
const definitions = {
  createRun: ['runId', 'teamId'], createTask: ['taskId', 'runId'], openThread: ['threadId', 'runId', 'teamId', 'taskId', 'assignmentId', 'endpointAMemberId', 'endpointBMemberId'],
  createDelivery: ['deliveryId', 'runId', 'consumerGeneration', 'teamId', 'messageId', 'threadId', 'senderMemberId', 'recipientMemberId', 'body', 'messageKind'], createGate: ['gateId', 'taskId', 'question'],
  admitAssignment: ['assignmentId', 'taskId', 'memberId', 'assignedByMemberId'],
  answerThread: ['threadId', 'runId', 'consumerGeneration', 'expectedGeneration', 'answer'],
  acknowledgeDelivery: ['deliveryId', 'runId', 'consumerGeneration', 'expectedGeneration'],
  rebindConsumer: ['runId', 'consumerGeneration'],
};

function normalized(request) {
  if (!request || typeof request !== 'object') throw refusal('STORE_INPUT_INVALID', 'A team store request is required.');
  const operationId = text(request.operationId, 'operationId');
  const principalId = text(request.caller?.principalId, 'caller.principalId');
  const kind = request.kind ?? 'mutate';
  if (!['mutate', 'acquireLease', 'renewLease', 'api'].includes(kind)) throw refusal('STORE_INPUT_INVALID', 'Unsupported team store operation kind.');
  let identity;
  if (kind === 'mutate') {
    if (!Array.isArray(request.mutations) || !request.mutations.length || request.mutations.length > 100) {
      throw refusal('STORE_INPUT_INVALID', 'A mutation request must contain between 1 and 100 mutations.');
    }
    const mutations = request.mutations.map(mutation => {
      if (isConfigurationType(mutation?.type)) return normalizeConfigurationMutation(mutation);
      const keys = definitions[mutation?.type];
      if (!keys || !Object.hasOwn(definitions, mutation.type)) throw refusal('STORE_INPUT_INVALID', 'Unsupported team store mutation type.');
      if (Object.keys(mutation).some(key => key !== 'type' && !keys.includes(key))) throw refusal('STORE_INPUT_INVALID', 'Unexpected team store mutation field.');
      const result = Object.fromEntries([['type', mutation.type], ...keys.map(key => [key,
        mutation.type === 'openThread' && ['taskId', 'assignmentId'].includes(key) && mutation[key] == null ? null
          : /Generation$/.test(key) ? integer(mutation[key], key, { min: 1 }) : text(mutation[key], key, { allowEmpty: ['answer', 'body'].includes(key) }),
      ])]);
      if (result.type === 'openThread') [result.endpointAMemberId, result.endpointBMemberId] = byteOrder([result.endpointAMemberId, result.endpointBMemberId]);
      if (result.type === 'createDelivery' && !MESSAGE_KINDS.includes(result.messageKind)) throw refusal('STORE_MESSAGE_KIND_INVALID', `Message kind ${JSON.stringify(result.messageKind)} is unsupported. Allowed kinds: ${MESSAGE_KINDS.join(', ')}.`);
      return result;
    });
    identity = { kind, principalId, mutations };
  } else if (kind === 'api') identity = { kind, principalId, command: normalizeApiCommand(request.command, {privileged: true}), target: request.target ? normalizeActor(request.target) : null };
  else identity = { kind, principalId, ttlMs: integer(request.ttlMs ?? 30000, 'ttlMs', { min: 1 }) };
  return { operationId, kind, identity: snapshot(identity), fingerprint: digest(identity), caller: snapshot(request.caller) };
}

function leaseRow(row) {
  if (!row) throw refusal('STORE_SCHEMA_INCOMPLETE', 'Team store lease row is missing.');
  return {
    machineId: row.holder_machine_id, holderToken: row.holder_token,
    generation: databaseInteger(row.generation, 'lease generation'),
    expiresAtMs: databaseInteger(row.expires_at_ms, 'lease expiry'),
  };
}

// Internal factory has one test seam for real-engine fault injection. The public
// entry point below always uses the real bootstrap and exposes no SQL/callback executor.
export async function createRuntimeStore(options = {}, dependencies = {}) {
  const machineId = text(options.machineId, 'machineId');
  const writer = normalizeWriter(options.writer, false);
  const holderToken = text(options.holderToken ?? randomUUID(), 'holderToken');
  const maxRetries = integer(options.maxRetries ?? 2, 'maxRetries', { max: 10 });
  const retryDelayMs = integer(options.retryDelayMs ?? 10, 'retryDelayMs', { max: 1000 });
  const ttlMs = integer(options.ttlMs ?? 30000, 'ttlMs', { min: 1 });
  let resource;
  if (options.postgres === undefined) {
    text(options.projectRoot, 'projectRoot');
    if (!isAbsolute(options.projectRoot)) throw refusal('STORE_PATH_INVALID', 'Team storage requires an absolute project root.');
    resource = { engine: 'sqlite', projectRoot: await realpath(options.projectRoot) };
  } else {
    let url;
    try { url = new URL(options.postgres?.connectionString); }
    catch { throw refusal('STORE_INPUT_INVALID', 'PostgreSQL connectionString must be an explicit postgres URL.'); }
    resource = { engine: 'postgres', host: url.hostname, port: url.port || '5432', database: url.pathname.slice(1) };
  }
  const scope = snapshot(resource);
  if (options.create === true) authorize(options.authorize, options.caller, 'createStore', scope, { create: true }, writer);
  const bootstrap = dependencies.openBackend ?? openBackend;
  let { db } = await bootstrap(options);
  let closed = false, dirty = false, tail = Promise.resolve();
  const enqueue = fn => {
    const result = tail.then(() => {
      if (closed) throw refusal('STORE_CLOSED', 'Team store is closed.');
      return fn();
    });
    tail = result.catch(() => {});
    return result;
  };
  const reconnect = async () => {
    if (!dirty) return;
    ({ db } = await bootstrap({ ...options, create: false }));
    dirty = false;
  };
  const abandon = async () => { dirty = true; await db.close().catch(() => {}); };
  const transaction = async (operationId, phase, fn) => {
    let begun = false, committing = false;
    try {
      await db.begin(); begun = true;
      await inspectSchema(db); // before lockLease's first database write
      const result = await fn();
      committing = true;
      await db.commit();
      return result;
    } catch (error) {
      if (committing && !isRetryable(db.engine, error) && !isConstraint(db.engine, error)) {
        await abandon();
        throw refusal('STORE_COMMIT_UNKNOWN', `Commit outcome is unknown for operation ${JSON.stringify(operationId)}. Reconcile using the same operation id; do not repeat external effects.`, { operationId, phase }, error);
      }
      if (begun) {
        try { await db.rollback(); }
        catch (rollbackError) {
          await abandon();
          throw refusal('STORE_ROLLBACK_UNKNOWN', `Rollback could not be confirmed for operation ${JSON.stringify(operationId)}. Reconcile before retrying.`, { operationId, phase }, rollbackError);
        }
      }
      throw error;
    }
  };
  const prior = async request => {
    const [row] = await db.query(SQL.readOperation, { operation_id: request.operationId });
    if (!row) return null;
    if (row.request_fingerprint !== request.fingerprint) throw refusal('STORE_IDEMPOTENCY_CONFLICT', `Operation id ${JSON.stringify(request.operationId)} was already used with a different request.`, { operationId: request.operationId });
    try {
      const result = JSON.parse(row.result);
      if (result.operationId !== request.operationId || result.kind !== request.kind) throw new Error('Receipt identity mismatch');
      return snapshot(result);
    } catch (error) { throw refusal('STORE_RECEIPT_INVALID', 'Stored operation receipt is invalid. It was not overwritten or retried.', { operationId: request.operationId }, error); }
  };
  const save = async (request, value, now) => {
    const result = { operationId: request.operationId, kind: request.kind, result: value };
    await db.query(`INSERT INTO operations (operation_id, request_fingerprint, result, committed_at_ms)
      VALUES (:operation_id, :fingerprint, :result, :now_ms)`, {
      operation_id: request.operationId, fingerprint: request.fingerprint, result: JSON.stringify(result), now_ms: now,
    });
    return snapshot(result);
  };
  const held = lease => refusal('STORE_LEASE_HELD', `Team store is held by ${JSON.stringify(lease.machineId)} until ${lease.expiresAtMs}; this writer was refused.`, { holderMachineId: lease.machineId, expiresAtMs: lease.expiresAtMs });
  const control = async (mode, duration) => {
    // Called only inside a transaction. SQLite's BEGIN IMMEDIATE and PG's FOR
    // UPDATE acquire the control lock before the database clock is sampled.
    const lease = leaseRow((await db.lockLeaseControl())[0]);
    const now = await db.now();
    const ours = lease.machineId === machineId && lease.holderToken === holderToken;
    const live = lease.expiresAtMs > now;
    if (live && !ours) throw held(lease);
    if (mode === 'renewLease' && (!ours || !live)) throw refusal('STORE_LEASE_EXPIRED', 'Team store lease expired or belongs to another holder. Reacquire before renewing.');
    const expires = integer(now + duration, 'lease expiry', { min: 1 });
    if (ours && live) {
      if (expires <= lease.expiresAtMs) return lease;
      const rows = await db.query(SQL.renewLease, { machine_id: machineId, holder_token: holderToken, lease_generation: lease.generation, now_ms: now, expires_at_ms: expires });
      if (!rows.length) throw conflict();
      return { ...lease, expiresAtMs: expires };
    }
    nextInteger(lease.generation, 'lease generation');
    const rows = await db.query(SQL.acquireLease, { machine_id: machineId, holder_token: holderToken, expected_generation: lease.generation, now_ms: now, expires_at_ms: expires });
    if (!rows.length) throw conflict();
    return { machineId, holderToken, generation: generation(rows[0].generation), expiresAtMs: expires };
  };

  async function mutate(mutation, params, now, clock) {
    if (isConfigurationType(mutation.type)) return applyConfigurationMutation(db, mutation, writer);
    const p = { ...params, now_ms: now };
    const requireRows = async (sql, values) => {
      const rows = await db.query(sql, values);
      if (!rows.length) throw conflict();
      return rows;
    };
    const counter = async (table, key, id, column) => {
      const [row] = await db.query(`SELECT ${column} AS generation FROM ${table} WHERE ${key} = :id`, { id });
      if (!row) throw conflict();
      nextInteger(generation(row.generation), column);
    };
    switch (mutation.type) {
      case 'createRun':
        await reference(db, 'teams', 'team_id', mutation.teamId);
        await db.query('INSERT INTO runs (run_id, consumer_generation, team_id) VALUES (:id, 1, :team)', { id: mutation.runId, team: mutation.teamId });
        return { type: mutation.type, runId: mutation.runId, consumerGeneration: 1 };
      case 'createTask':
        await db.query('INSERT INTO tasks (task_id, run_id) VALUES (:id, :run)', { id: mutation.taskId, run: mutation.runId });
        return { type: mutation.type, taskId: mutation.taskId };
      case 'openThread': {
        await reference(db, 'teams', 'team_id', mutation.teamId);
        const run = await reference(db, 'runs', 'run_id', mutation.runId);
        if (run.team_id !== mutation.teamId) throw refusal('STORE_REFERENCE_SCOPE', `Run ${JSON.stringify(mutation.runId)} does not belong to team ${JSON.stringify(mutation.teamId)}.`);
        if (mutation.taskId !== null) {
          const task = await reference(db, 'tasks', 'task_id', mutation.taskId);
          if (task.run_id !== mutation.runId) throw refusal('STORE_REFERENCE_SCOPE', `Task ${JSON.stringify(mutation.taskId)} does not belong to Run ${JSON.stringify(mutation.runId)}.`);
        }
        if (mutation.assignmentId !== null) {
          const assignment = await reference(db, 'assignments', 'assignment_id', mutation.assignmentId);
          if (mutation.taskId === null || assignment.task_id !== mutation.taskId) throw refusal('STORE_REFERENCE_SCOPE', `Assignment ${JSON.stringify(mutation.assignmentId)} does not belong to thread task ${JSON.stringify(mutation.taskId)}.`);
        }
        for (const id of [mutation.endpointAMemberId, mutation.endpointBMemberId]) await reference(db, 'members', 'member_id', id);
        const [a, b] = byteOrder([mutation.endpointAMemberId, mutation.endpointBMemberId]);
        if (a === b) throw refusal('STORE_THREAD_ENDPOINTS_INVALID', 'A thread requires two distinct endpoint member IDs.');
        const [existing] = await db.query("SELECT thread_id FROM threads WHERE team_id=:team AND (task_id=:task OR (task_id IS NULL AND :task IS NULL)) AND endpoint_a_member_id=:a AND endpoint_b_member_id=:b AND status='open'", { team: mutation.teamId, task: mutation.taskId, a, b });
        if (existing) throw refusal('STORE_THREAD_EXISTS', `Open thread ${JSON.stringify(existing.thread_id)} already connects those endpoints for team ${JSON.stringify(mutation.teamId)} / task ${JSON.stringify(mutation.taskId)}.`);
        await db.query("INSERT INTO threads (thread_id,run_id,status,generation,answer,task_id,endpoint_a_member_id,endpoint_b_member_id,team_id,assignment_id) VALUES (:id,:run,'open',1,NULL,:task,:a,:b,:team,:assignment)", { id: mutation.threadId, run: mutation.runId, task: mutation.taskId, a, b, team: mutation.teamId, assignment: mutation.assignmentId });
        return { type: mutation.type, threadId: mutation.threadId, generation: 1 };
      }
      case 'createDelivery': {
        await reference(db, 'teams', 'team_id', mutation.teamId);
        const run = await reference(db, 'runs', 'run_id', mutation.runId);
        const thread = await reference(db, 'threads', 'thread_id', mutation.threadId);
        for (const id of [mutation.senderMemberId, mutation.recipientMemberId]) await reference(db, 'members', 'member_id', id);
        if (run.team_id !== mutation.teamId || thread.team_id !== mutation.teamId || thread.run_id !== mutation.runId) throw refusal('STORE_REFERENCE_SCOPE', `Message ${JSON.stringify(mutation.messageId)} Run, thread and team must agree.`);
        const [a, b] = byteOrder([mutation.senderMemberId, mutation.recipientMemberId]);
        if (a === b || a !== thread.endpoint_a_member_id || b !== thread.endpoint_b_member_id) throw refusal('STORE_MESSAGE_ENDPOINTS_INVALID', `Message ${JSON.stringify(mutation.messageId)} sender/recipient must match the two endpoints of thread ${JSON.stringify(mutation.threadId)}.`);
        const [duplicate] = await db.query('SELECT message_id FROM messages WHERE message_id=:id OR delivery_id=:delivery', { id: mutation.messageId, delivery: mutation.deliveryId });
        if (duplicate) throw refusal('STORE_MESSAGE_EXISTS', `Message ${JSON.stringify(duplicate.message_id)} already owns that message or delivery identity; immutable content cannot be replaced.`);
        await requireRows(`INSERT INTO deliveries (delivery_id,run_id,consumer_generation,status,generation,team_id,message_id)
          SELECT :id,run_id,consumer_generation,'outstanding',1,:team,:message FROM runs
          WHERE run_id=:run AND consumer_generation=:consumer RETURNING delivery_id`, {
          id: mutation.deliveryId, run: mutation.runId, consumer: mutation.consumerGeneration, team: mutation.teamId, message: mutation.messageId,
        });
        await db.query(`INSERT INTO messages (message_id,delivery_id,team_id,thread_id,sender_member_id,recipient_member_id,body,kind,created_at_ms)
          VALUES (:message,:delivery,:team,:thread,:sender,:recipient,:body,:kind,:now)`, {
          message: mutation.messageId, delivery: mutation.deliveryId, team: mutation.teamId, thread: mutation.threadId,
          sender: mutation.senderMemberId, recipient: mutation.recipientMemberId, body: mutation.body, kind: mutation.messageKind, now,
        });
        return { type: mutation.type, deliveryId: mutation.deliveryId, generation: 1 };
      }
      case 'createGate':
        await db.query('INSERT INTO decision_gates (gate_id, task_id, question) VALUES (:id, :task, :question)', { id: mutation.gateId, task: mutation.taskId, question: mutation.question });
        return { type: mutation.type, gateId: mutation.gateId };
      case 'admitAssignment': {
        await reference(db, 'tasks', 'task_id', mutation.taskId);
        await reference(db, 'members', 'member_id', mutation.memberId);
        await reference(db, 'members', 'member_id', mutation.assignedByMemberId);
        const [setting] = await db.query('SELECT s.pickup_window_minutes,s.task_window_minutes,r.team_id FROM tasks t JOIN runs r ON r.run_id=t.run_id LEFT JOIN team_settings s ON s.team_id=r.team_id WHERE t.task_id=:task', { task: mutation.taskId });
        if (!setting || setting.pickup_window_minutes == null) throw refusal('STORE_PICKUP_WINDOW_REQUIRED', `Task ${JSON.stringify(mutation.taskId)} has no explicitly configured team pickup window.`);
        const window = databaseInteger(setting.pickup_window_minutes, 'pickup_window_minutes', { min: 1 });
        const deadline = integer(now + window * 60000, 'pickupDeadlineMs', { min: 1 });
        await requireRows(SQL.admitAssignment, { ...p, assignment_id: mutation.assignmentId, task_id: mutation.taskId, member_id: mutation.memberId,
          assigned_by_member_id: mutation.assignedByMemberId, pickup_deadline_ms: deadline,
          task_window_minutes: setting.task_window_minutes === null ? null : databaseInteger(setting.task_window_minutes, 'task_window_minutes', { min: 1 }) });
        return { type: mutation.type, assignmentId: mutation.assignmentId, admittedAtMs: now, pickupDeadlineMs: deadline };
      }
      case 'answerThread': {
        await counter('threads', 'thread_id', mutation.threadId, 'generation');
        const rows = await requireRows(SQL.answerThread, { ...p, thread_id: mutation.threadId, run_id: mutation.runId,
          consumer_generation: mutation.consumerGeneration, expected_generation: mutation.expectedGeneration, answer: mutation.answer });
        return { type: mutation.type, threadId: mutation.threadId, generation: generation(rows[0].generation) };
      }
      case 'acknowledgeDelivery': {
        await counter('deliveries', 'delivery_id', mutation.deliveryId, 'generation');
        const rows = await requireRows(SQL.acknowledgeDelivery, { ...p, delivery_id: mutation.deliveryId, run_id: mutation.runId,
          consumer_generation: mutation.consumerGeneration, expected_generation: mutation.expectedGeneration });
        return { type: mutation.type, deliveryId: mutation.deliveryId, generation: generation(rows[0].generation) };
      }
      case 'rebindConsumer': {
        await counter('runs', 'run_id', mutation.runId, 'consumer_generation');
        const common = { ...p, run_id: mutation.runId, consumer_generation: mutation.consumerGeneration };
        // Zero old outstanding batches is legitimate; the rebind is the required CAS.
        const fenced = await db.query(SQL.fenceDeliveries, common);
        const fresh = await clock();
        const rows = await requireRows(SQL.rebindConsumer, { ...common, now_ms: fresh });
        return { type: mutation.type, runId: mutation.runId, consumerGeneration: generation(rows[0].consumer_generation), fencedDeliveryIds: fenced.map(row => row.delivery_id).sort() };
      }
    }
  }

  const attempt = async request => {
    await reconnect();
    authorize(options.authorize, request.caller, request.kind, scope, request.identity, writer);
    await inspectSchema(db);
    const recorded = request.kind === 'api' ? null : await prior(request);
    if (recorded) return recorded;
    const configurationWrite = request.kind === 'api' || (request.kind === 'mutate' && request.identity.mutations.some(m => isConfigurationType(m.type)));
    if (configurationWrite) await checkWriter(db, writer);
    if (!['mutate','api'].includes(request.kind)) return transaction(request.operationId, 'lease', async () => {
      await db.lockLeaseControl();
      const recorded = await prior(request);
      if (recorded) return recorded;
      const lease = await control(request.kind, request.identity.ttlMs);
      return save(request, { generation: lease.generation, holderMachineId: lease.machineId, expiresAtMs: lease.expiresAtMs }, await db.now());
    });
    const preparation = await transaction(request.operationId, 'lease', async () => {
      await db.lockLeaseControl();
      if (request.kind === 'api') await assertApiCaller(db, request.identity.command, normalizeActor(request.caller.actor));
      // A lost original COMMIT may settle while this retry waits for the lease
      // row. Reconcile before treating the already-completed request as a new
      // competing writer, even if this retry has a new machine/holder token.
      const recorded = await prior(request);
      if (recorded) return { recorded };
      if (configurationWrite) await checkWriter(db, writer);
      return { lease: await control('acquireLease', ttlMs) };
    });
    if (preparation.recorded) return preparation.recorded;
    const { lease } = preparation;
    return transaction(request.operationId, 'mutation', async () => {
      const bindings = { machine_id: machineId, holder_token: holderToken, lease_generation: lease.generation };
      const rows = await db.query(SQL.lockLease, bindings);
      if (!rows.length) throw conflict();
      let lastClock = await db.now();
      const expiry = databaseInteger(rows[0].expires_at_ms, 'lease expiry');
      if (lastClock >= expiry) throw refusal('STORE_LEASE_EXPIRED', 'Team store lease expired during the mutation. The transaction was rolled back.');
      const clock = async () => {
        const now = await db.now();
        if (now < lastClock) throw refusal('STORE_CLOCK_INVALID', 'Database clock moved backwards during the write transaction.');
        if (now >= expiry) throw refusal('STORE_LEASE_EXPIRED', 'Team store lease expired during the mutation. The transaction was rolled back.');
        lastClock = now;
        return now;
      };
      if (request.kind === 'api') await assertApiCaller(db, request.identity.command, normalizeActor(request.caller.actor));
      const recorded = await prior(request); // after serialization with any in-flight previous attempt
      if (recorded) return recorded;
      if (configurationWrite) await checkWriter(db, writer);
      if (request.kind === 'api') {
        const result = apiResult(await applyApiCommand(db, request.identity.command, normalizeActor(request.caller.actor), writer, await clock(), request.identity.target));
        const receipt = await save(request, result, await clock());
        if (options.releaseAfterApi === true) await db.query('UPDATE store_lease SET holder_machine_id=NULL,holder_token=NULL,expires_at_ms=0 WHERE singleton=1 AND holder_machine_id=:machine AND holder_token=:token AND generation=:generation', {machine:machineId,token:holderToken,generation:lease.generation});
        return receipt;
      }
      const result = [];
      for (const mutation of request.identity.mutations) {
        const now = await clock();
        result.push(await mutate(mutation, bindings, now, clock));
      }
      const now = await clock();
      return save(request, result, now);
    });
  };

  return Object.freeze({
    execute: async request => {
      const normalizedRequest = normalized(request);
      return enqueue(async () => {
        for (let tries = 0; ; tries++) {
          try { return await attempt(normalizedRequest); }
          catch (error) {
            if (isRetryable(db.engine, error)) {
              if (tries >= maxRetries) throw refusal('STORE_RETRY_EXHAUSTED', `Team store transaction retry limit reached after ${tries + 1} attempts.`, { attempts: tries + 1 }, error);
              await delay(retryDelayMs);
              continue;
            }
            if (isConstraint(db.engine, error)) throw refusal('STORE_CONSTRAINT_CONFLICT', 'Team store constraint refused the operation. No partial mutation was committed.', {}, error);
            if (error instanceof StoreError) throw error;
            throw refusal('STORE_DATABASE_ERROR', 'Team store database operation failed. No success was published.', {}, error);
          }
        }
      });
    },
    reconcile: async request => {
      const normalizedRequest = normalized(request);
      return enqueue(async () => {
        await reconnect();
        authorize(options.authorize, normalizedRequest.caller, normalizedRequest.kind, scope, normalizedRequest.identity, writer);
        await inspectSchema(db);
        if (normalizedRequest.kind === 'api') {
          return transaction(normalizedRequest.operationId,'reconcile',async()=>{
            await db.lockLeaseControl();
            await assertApiCaller(db,normalizedRequest.identity.command,normalizeActor(normalizedRequest.caller.actor));
            return await prior(normalizedRequest) ?? {status:'unknown',operationId:normalizedRequest.operationId};
          });
        }
        return await prior(normalizedRequest) ?? { status: 'unknown', operationId: normalizedRequest.operationId };
      });
    },
    read: ({ entity, id, caller }) => enqueue(async () => {
      const reads = {
        run: ['runs', 'run_id'], task: ['tasks', 'task_id'], assignment: ['assignments', 'assignment_id'],
        team: ['teams', 'team_id'], member: ['members', 'member_id'], settings: ['team_settings', 'team_id'], roleDocument: ['role_documents', 'member_id'],
        thread: ['threads', 'thread_id'], delivery: ['deliveries', 'delivery_id'], message: ['messages', 'message_id'], gate: ['decision_gates', 'gate_id'],
      };
      if (!Object.hasOwn(reads, entity)) throw refusal('STORE_INPUT_INVALID', 'Unsupported team store read entity.');
      text(id, 'id');
      await reconnect();
      authorize(options.authorize, caller, 'read', scope, { entity, id }, writer);
      await inspectSchema(db);
      const [table, key] = reads[entity];
      const [row] = await db.query(`SELECT * FROM ${table} WHERE ${key} = :id`, { id });
      if (!row) return null;
      return snapshot(readRow(row));
    }),
    getIdentity: ({ caller }) => enqueue(async () => {
      await reconnect();
      authorize(options.authorize, caller, 'read', scope, { entity: 'projectIdentity' }, writer);
      await inspectSchema(db);
      const [row] = await db.query(SQL.readProjectIdentity);
      return snapshot({ projectId: row.project_id, minimumWriterProtocol: databaseInteger(row.minimum_writer_protocol, 'minimum_writer_protocol', { min: 1 }) });
    }),
    getTeamConfiguration: ({ teamId, caller }) => enqueue(async () => {
      text(teamId, 'teamId');
      await reconnect();
      authorize(options.authorize, caller, 'read', scope, { entity: 'teamConfiguration', teamId }, writer);
      await inspectSchema(db);
      await db.exec(db.engine === 'postgres' ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      try {
        await inspectSchema(db);
        const [identity] = await db.query(SQL.readProjectIdentity);
        if (databaseInteger(identity.minimum_writer_protocol, 'minimum_writer_protocol', { min: 1 }) > WRITER_PROTOCOL_VERSION) {
          throw refusal('STORE_WRITER_PROTOCOL_OLD', `This adapter cannot read configuration requiring writer protocol ${identity.minimum_writer_protocol}; supported protocol is ${WRITER_PROTOCOL_VERSION}.`);
        }
        const team = await reference(db, 'teams', 'team_id', teamId);
        const settings = await reference(db, 'team_settings', 'team_id', teamId);
        const members = await db.query('SELECT * FROM members WHERE team_id=:id ORDER BY member_id', { id: teamId });
        const documents = await db.query('SELECT d.* FROM role_documents d JOIN members m ON m.member_id=d.member_id WHERE m.team_id=:id ORDER BY d.member_id', { id: teamId });
        const exemptions = await db.query('SELECT member_id FROM settings_exemptions WHERE team_id=:id ORDER BY member_id', { id: teamId });
        await db.commit();
        return snapshot({ team: readRow(team), settings: readRow(settings), members: members.map(readRow),
          roleDocuments: documents.map(readRow), exemptMemberIds: exemptions.map(row => row.member_id) });
      } catch (error) {
        await db.rollback().catch(() => {});
        if (error instanceof StoreError) throw error;
        await abandon();
        throw refusal('STORE_READ_FAILED', `Cannot read a consistent configuration for team ${JSON.stringify(teamId)}.`, { teamId }, error);
      }
    }),
    close: () => {
      const result = tail.then(async () => { if (!closed) {
        closed = true;
        try {
          if (options.releaseAfterApi === true && !dirty) await transaction('api-close','release',async()=>{
            await db.lockLeaseControl();
            await db.query('UPDATE store_lease SET holder_machine_id=NULL,holder_token=NULL,expires_at_ms=0 WHERE singleton=1 AND holder_machine_id=:machine AND holder_token=:token',{machine:machineId,token:holderToken});
          });
        } finally { await db.close(); }
      } });
      tail = result.catch(() => {});
      return result;
    },
  });
}

export const openTeamStore = options => createRuntimeStore(options);
