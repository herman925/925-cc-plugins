# Shared store adapter

Status: implemented and unreleased; neither shipped client uses it. Shared schema **4** and separate SQLite-only machine schema **1** have one source in `contract.mjs`. Unsupported versions, including shared versions 1–3, are refused without migration.

The corrected #152 layout is implemented: a thread always has a team and optionally a task, immutable messages pair one-to-one with deliveries, question and optional task windows are distinct. The inbox/transport/lifecycle behavior that consumes these records remains outside this slice. See `SCHEMA-4.md`.

## Public interface

Import `openTeamStore` and `StoreError` from `index.mjs`. Opening an existing store does not install anything. `create: true` explicitly permits installation into an empty database; creation requires the client's policy and authenticated caller context before any filesystem/schema creation.

```js
import { openTeamStore } from './index.mjs';

// authenticatedCaller and clientPolicy are supplied by the integrating client's
// verified identity/guard layer. This adapter does not implement that policy.
const store = await openTeamStore({
  projectRoot: process.cwd(),
  machineId: 'this-machine',
  create: true,
  caller: authenticatedCaller,
  authorize: clientPolicy,
  writer: { client: 'team-orchestrator', version: '0.5.42', protocol: 1 },
});
try {
  const request = {
    operationId: 'user-request-123:create-run',
    caller: authenticatedCaller,
    // team-123 must already have been explicitly configured through createTeam.
    mutations: [{ type: 'createRun', runId: 'run-123', teamId: 'team-123' }],
  };
  const result = await store.execute(request);
  // Success is published only after COMMIT. Repeating exactly this semantic
  // request with the same operationId replays the recorded result.
  const row = await store.read({ entity: 'run', id: 'run-123', caller: authenticatedCaller });
} finally {
  await store.close();
}
```

The stable operation ID belongs to the caller. Persist it with the originating user request; do not generate a new ID merely because a request timed out. It is not a timestamp.

For hosted storage replace `projectRoot` with `postgres: { connectionString: '<explicit postgres URL>' }`. The URL must explicitly name the host and project database. Credentials never appear in the policy's resource scope. The optional `postgres.loadDriver` function may resolve the integrating host's installed `pg` package; otherwise the adapter attempts `import('pg')` only on this configured path. Missing `pg` is a clear refusal, not fallback to another database. Local operation uses built-in Node modules only, verified from a copied source tree without `node_modules`.

## Authority boundary

`authorize({ caller, kind, scope, request, writer })` must return literal `true` synchronously. No policy, a false/throwing policy, missing caller identity, or an asynchronous result refuses the operation. The caller context must contain a nonempty `principalId`; authenticating it and attesting the actual writer binary remain the integrating client's responsibility. The store does not treat an arbitrary supplied principal ID or writer descriptor as proof of identity.

The policy is called before each attempt, including every transient retry, receipt replay, reconciliation and read. It runs outside database write transactions. Inputs are snapshots, and scope identifies the canonical local project root or the hosted database host/port/name. There is no role engine, Head knowledge, grant issuer or tool guard here. #141 must connect this seam to the real client identity and guard code.

Kinds are `createStore`, `mutate`, `acquireLease`, `renewLease`, and `read`. Reconciliation/replay reuses the original operation kind and semantic request, so it does not bypass revoked authority.

## Data operations

`execute({ operationId, caller, mutations, metadata? })` defaults to kind `mutate` and accepts 1–100 fixed database primitives:

| Type | Required values |
| --- | --- |
| `createRun` | `runId`, `teamId` |
| `createTask` | `taskId`, `runId` |
| `openThread` | `threadId`, `runId`, `teamId`, `endpointAMemberId`, `endpointBMemberId`; optional nullable `taskId`, `assignmentId` |
| `createDelivery` | `deliveryId`, `runId`, `consumerGeneration`, `teamId`, `messageId`, `threadId`, `senderMemberId`, `recipientMemberId`, `body`, `messageKind` |
| `createGate` | `gateId`, `taskId`, `question` |
| `admitAssignment` | `assignmentId`, `taskId`, `memberId`, `assignedByMemberId` |
| `answerThread` | `threadId`, `runId`, `consumerGeneration`, `expectedGeneration`, `answer` |
| `acknowledgeDelivery` | `deliveryId`, `runId`, `consumerGeneration`, `expectedGeneration` |
| `rebindConsumer` | `runId`, `consumerGeneration` |

These are fixed database persistence primitives. `createDelivery` now requires its full message values and inserts the sole immutable message in the same transaction; it cannot create an empty batch. Its name/return shape remain the existing primitive. This records a pair, **not actual delivery**: no wake/send, read/ack ownership decision, FIFO check, question timer or replay occurs. The database supplies creation time. `messageKind` is one of status, dispatch, worker_done, merge_ready, escalation, handoff, decision_gate, question, heartbeat. Old requests missing the required values refuse. Creating a gate does not apply its resolution. Creating a Run does not schedule workers. No raw SQL, arbitrary callback or transport is exposed by the public API.

Expected row/consumer generations are semantic concurrency conditions. A transient retry reads current lease state and validates those conditions again; it never silently substitutes a competitor's newer row generation for the caller's original expectation. A failed prerequisite or constraint rolls back every earlier mutation and the receipt together. A rebind fences old outstanding deliveries and increments the consumer generation atomically.

`read({ entity, id, caller })` supports `run`, `task`, `assignment`, `thread`, `delivery`, `message`, `gate`, `team`, `member`, `settings`, and `roleDocument`. It returns a frozen row or `null`; numeric counters/timestamps are checked and converted consistently across engines.

## Shared configuration and writer fences

`getIdentity({ caller })` reads the stable project UUID generated during explicit installation and its minimum writer protocol. It is independent of project path. `getTeamConfiguration({ teamId, caller })` reads a consistent snapshot of `team`, `settings`, `members`, `roleDocuments`, and `exemptMemberIds`; it contains no liveness observations.

Configuration mutations require `options.writer = { client, version, protocol: 1 }` and the same authorization/lease/receipt path as other shared mutations. The only installed families are `team-orchestrator` (Mod) and `team-orchestrator-orca` (plugin). Releases are strict numeric `major.minor.patch`, compared component by component within their own family. Unknown families, missing known fences, invalid releases, older releases/protocols, and unsupported adapter protocols refuse explicitly. The shared monotonic protocol floor and the family's release fence are checked under the lease and advance atomically with configuration data. Freshly rereading `config_version` never permits an older binary to overwrite newer-binary edits. Replaying a historical receipt is a read and does not claim current lease/writer authority.

| Configuration mutation | Required values in addition to `type`, `teamId` |
| --- | --- |
| `createTeam` | `name`, `functionText`, complete `settings` |
| `saveTeamSettings` | `expectedConfigVersion`, complete `settings` |
| `putMember` | `expectedConfigVersion`, `expectedGeneration` (0 for creation), complete `member` |
| `createRoleDocument` | `expectedConfigVersion`, `memberId`, `officialText`, `advisoryNotes` |
| `updateOfficialRole` | `expectedConfigVersion`, `memberId`, `expectedGeneration`, `officialText` |
| `updateAdvisoryNotes` | `expectedConfigVersion`, `memberId`, `expectedGeneration`, `advisoryNotes` |

Complete settings: booleans `autoClose`, `autoScratch`, `assumptions`; nonnegative integers `idleMinutes`, `maxOpen`; `reopen: 'resume' | 'fresh'`; `launch: 'demand' | 'all'`; positive integer `batch`; string `scratchDir`; explicit positive integers `pickupWindowMinutes`, `answerWindowMinutes`, `replayIntervalMs`; explicit `taskWindowMinutes` (positive integer or `null` for off); explicit array of unique existing `exemptMemberIds`. **There are no invented defaults for these windows or replay rate.** `batch` preserves the Mod's launch-session batching configuration; it does not set messages per delivery. Admission snapshots the pickup deadline and task-window minutes without observing pickup or starting a task deadline. Later settings changes do not rewrite historical admission records.

Complete member: `memberId`, globally unique `name`, nullable `bossMemberId`, `role`, positive integer `level`, `model`, `effort`, nullable `worktree`, nullable `registeredHome`, nullable `machineId`, nullable `location` (`local`, `remote`, `other-cli`), `membershipState` (`active`, `retired`), nullable `address`, `shortName`, `cli`, boolean `allowAgent`, `allowWrite`. A registered home has `contextKind` (`worktree`, `folder`, `unknown`), `executionHostId`, and `originalPath`; once recorded, routine roster writes cannot move it. No implicit member transfer, missing-parent creation or cyclic boss chain is permitted. Membership is separate from actual liveness.

Each configuration change increments the team's configuration version and stamps the attested writer family/release. Member row generations also advance. Official role text and advisory notes have independent content/generation fields; notes updates cannot change role text or permission flags. Approval policy remains external. Thread endpoints canonicalize by UTF-8 byte order before fingerprinting; one open task/pair or team-owned team/pair is enforced. An optional assignment reference must belong to the named task. Superseded threads cannot be answered. Task outcome and gate resolution fields remain layout only; no settlement, retry-admission workflow, owner transfer or gate-application API is implemented.

Message rows reject UPDATE/DELETE/replacement through dialect-specific database guards; PostgreSQL also rejects TRUNCATE. Bootstrap refuses missing guards. Deferred mutual membership FKs require exactly one matching message and delivery at commit, with the same team and identities. Generated canonical endpoint columns enforce that sender/recipient are the thread's two members in either direction. Replay markers (`replay_count`, `last_replayed_at_ms`) belong only to the delivery. Changing those markers, acknowledging a batch or closing a thread cannot change the immutable message. No replay operation is exposed by this slice.

Question window fields are `threads.question_delivered_at_ms` and `answer_deadline_ms`, both absent or both present with deadline at/after delivery. They stay NULL when a question is merely persisted: enqueue is not delivery. Assignment task-window minutes are nullable; off requires NULL deadline, enabled but not picked up has NULL deadline, and observed pickup with an enabled window requires a deadline at/after pickup. The later observer supplies those transitions. The initial-admission primitive remains the only admission API; retry lineage exists in DDL but retry eligibility/acyclic history and closure of the predecessor thread remain future lifecycle rules.

## Separate machine store

```js
import { openMachineStore } from './index.mjs';
const { projectId } = await store.getIdentity({ caller: authenticatedCaller });
const local = await openMachineStore({
  projectId, machineId: 'this-machine', create: true,
  caller: authenticatedCaller, authorize: clientPolicy,
  writer: { client: 'team-orchestrator-orca', version: '0.1.24', protocol: 1 },
});
try {
  await local.execute({ operationId: 'local-bind-123', caller: authenticatedCaller, mutations: [
    { type: 'bindMember', memberId: 'worker', sessionId: 'session', bindingGeneration: 1, expectedGeneration: 0 },
  ] });
} finally { await local.close(); }
```

Default path: `~/.claude/team-orchestrator/<project UUID>/machine.sqlite`. `machineConfigRoot` replaces `~/.claude`; `projectKey` defaults to UUID and may be one safe directory component. The header binds project UUID, directory key and machine identity; mismatches refuse before writes. Explicit installation creates its own format/version, independent protocol floor and fixed per-family fences. Local writes check and advance these fences in their own SQLite transaction. No shared database connection, shared-store object or PostgreSQL configuration is accepted. No shared lease is used for local observations.

`execute` accepts 1–100 local mutations with stable operation ID and caller, atomic local receipt/idempotency, bounded busy retries and uncertain-commit reconciliation. `reconcile(theSameRequest)` returns a saved result or unknown, just as the shared store does. Policy kinds are `createMachineStore`, `machineMutate`, `readMachine`. Reads: `getIdentity({ caller })`, `readMember({ memberId, caller })`, `readReceipt({ receiptId, caller })`.

All local mutations require `memberId`, `sessionId`, `bindingGeneration`:

| Type | Additional fields |
| --- | --- |
| `bindMember` | `expectedGeneration` (0 for first binding); rebinding must increase binding generation |
| `recordObservation` | `expectedGeneration`, `state`; optional nullable `rawState`, `turnStartMs`, `turnEndMs`, `contextUsedPercent` (0–100), `contextWindowTokens`, `model`, `effort`, `taskLabel` |
| `recordLocalReceipt` | `receiptId`, `observationKind` (`read`, `acknowledged`, `liveness`), optional `sharedDeliveryId` and finite JSON `detail` |

Known states: starting, working, idle, asking, offline, closed, failed, unknown. Other strings become unknown while preserving the exact raw state. Heartbeat/observation times come from SQLite, not caller input. A binding alone starts unknown with heartbeat 0. Rebinding clears current observations, retains historical receipts and rejects old session writes. Row generation controls observations; receipt recording verifies binding without fabricating heartbeat or a row update. A local receipt mentioning a shared delivery ID is **only a local observation**. It cannot acknowledge a shared delivery, answer a thread, grant authority, or establish pickup/understanding. These APIs have no shared transition operation.

## Lease and transaction order

The store creates a random per-instance holder token unless the client supplies `holderToken`. The token distinguishes two clients on the same machine; a live competing holder is refused with its recorded machine and expiry. A lease is exclusive store access, not authority or worker liveness.

`execute({ kind: 'acquireLease' | 'renewLease', operationId, caller, ttlMs? })` records an explicit lease operation in the same durable receipt system. Renewal preserves the generation, cannot shrink expiry, and cannot revive an expired lease. Reacquisition after expiry increments the generation. Replayed lease receipts describe the original operation's outcome, not a promise that the old binding is still live.

For a data batch the adapter first verifies version and authorization, acquires/renews its lease in a short control transaction, then begins the mutation transaction. The lease row is locked first, database time is sampled after the lock, the receipt is rechecked after serialization, mutations run with fresh clock/expiry checks, and the receipt is inserted before the single commit. Nothing is published as successful until that commit completes.

PostgreSQL lease control uses `SELECT ... FOR UPDATE` inside its engine adapter before sampling time; SQLite's `BEGIN IMMEDIATE` already obtains the writer lock. Ordinary mutation authority uses the shared `SQL.lockLease` exactly as specified. SQLite connections live on separate worker threads, so an SQLite busy wait does not freeze another connection's commit or the application's event loop. Every SQLite connection enables and verifies foreign keys; hosted sessions require origin constraint enforcement.

Clocks come from SQLite `unixepoch('subsec')` or PostgreSQL `clock_timestamp()`, never the caller's/application wall clock. A backward clock sample inside a batch is a refusal. All generations and epoch milliseconds must be finite safe integers; overflow is refused rather than wrapped. The receipt's timestamp is sampled before commit and becomes durable with that commit; it is not a measurement of the exact physical commit-completion instant.

Only database reads/writes are permitted inside the transaction. No agent call, message send, other-service HTTP request or filesystem write is invoked there. The new local store's `.gitignore` is written after schema installation commits; existing ignore files and all legacy files remain intact.

## Retry and durable reconciliation

SQLite busy/locked and PostgreSQL `40001`/`40P01` receive bounded whole-transaction retries after confirmed rollback. The authorization policy and schema version are rechecked, and lease generations are freshly read on each attempt. Default `maxRetries: 2` means at most three attempts. A uniqueness/foreign-key/state conflict is not a transient retry. A retryable COMMIT rejection is rolled back and retried; an unclassified/lost COMMIT response is **unknown**, not automatically retried. Failure to confirm rollback also quarantines the connection.

The canonical fingerprint includes operation kind, authenticated principal ID, ordered mutation content and every semantic value (including expected generations). It excludes key ordering, database-generated times, refreshed machine/lease bindings and explicitly nonsemantic submission `metadata`. Same ID/different identity is a refusal. Same ID/same identity returns the exact serialized result, including originally generated times, after current authority/version checks.

After `STORE_COMMIT_UNKNOWN` or `STORE_ROLLBACK_UNKNOWN`, call `store.reconcile(theSameRequest)`. A matching durable receipt returns the committed result. A missing receipt returns `{ status: 'unknown', operationId }`; absence alone cannot establish that a server-side transaction stopped. A caller-requested retry via `execute(theSameRequest)` serializes on the lease and rechecks the receipt before any mutation, so an in-flight committed attempt cannot be duplicated. Neither replay nor reconciliation proves that a separate downstream message/external effect was delivered; transport is outside this slice.

For a lost schema-installation commit, reopen and inspect: a supported installed schema can open, an empty store still requires explicit creation, and a repeated explicit install refuses nonempty storage. Unsupported versions are never repaired, downgraded or migrated automatically.

## Limits and defaults

- No Mod/plugin integration, complete inbox protocol, pickup observer, understanding claim, gate application, migration execution, scheduler, redelivery, cleanup or session control is included. See `MIGRATION.md` for the design-only import plan. Local receipts still do not establish a shared delivery transition; authoritative acknowledgement ownership remains unresolved.
- The supplied local root must be a verified local filesystem. UNC paths and redirected storage directories are refused. Mounted/synchronized filesystems and disconnected copies cannot all be identified or globally arbitrated by portable Node APIs; use opt-in PostgreSQL when sharing active state across hosts.
- A supported schema version and the required tables are checked, but the adapter is not a defense against a malicious arbitrary-SQL writer changing data/constraints behind its back. Policy and credentials must restrict such writers in the integrating client.
- Defaults: lease duration 30,000 ms; 2 retries with 10 ms delay; SQLite busy timeout 100 ms. Options permit a maximum of 10 retries, 1,000 ms retry delay, and 30,000 ms SQLite busy timeout. PostgreSQL connection timeout defaults to 5,000 ms and permits up to 60,000 ms.
- Native I/O/permission failures can occur before a store is open. Explicit refusal messages and their stable codes are listed in `REFUSALS.md`.
