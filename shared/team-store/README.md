# Shared team-store contract and adapter

This is the **unreleased** contract foundation and store-adapter increment of [Shared team store: one schema, one lifecycle contract, two engines](https://github.com/herman925/925-cc-plugins/issues/154).
The adapter opens the shared schema, enforces write transactions and authority checks, and records durable operation receipts. Mod 0.5.43 packages it for an explicitly opted-in fresh-team API preview; the standalone package remains private. The Orca plugin is not integrated. Existing data is not moved and this API does not launch sessions. See [the typed API boundary](API-BOUNDARY.md), [schema 5](SCHEMA-5.md), and [update/testing instructions](RELEASE-SCHEMA-5.md).

`contract.mjs` contains the single DDL source, its companion rules, and the conditional SQL statements. Importing it requires no packages, accounts, or network. `pg` remains a **development dependency** for tests; the runtime treats it as an optional driver and loads it only for explicitly configured hosted storage.

The implemented adapter in `index.mjs`/`src/` loads the optional PostgreSQL driver only when a hosted store is configured. See [runtime API and guarantees](RUNTIME.md), the [exact refusal catalogue](REFUSALS.md), the [unimplemented migration plan](MIGRATION.md), and the [schema-4 design and boundaries](SCHEMA-4.md). Shared schema **5** retains schema 4 and adds controller approvals, current member bindings, task briefs, explicit attempt outcomes and separate head acceptance. Separate machine schema **1** is unchanged. Shared versions 1–4 are refused without implicit migration. Historical schema-4 acceptance does not establish acceptance of schema 5.

**Corrected #152 ownership:** every thread has a required team and may optionally name a task in that Run/team. Team-owned coordination no longer needs a fabricated task. Thread owner transfer remains undecided and has no API. Claude independently reproduced the schema-4 suite and added passing probes; see [historical independent verification](INDEPENDENT-ACCEPTANCE-SCHEMA-4.md). The new source-Mod fresh-team lifecycle, controller coexistence and approval retention after a graceful same-conversation Claude process restart now pass live scratch acceptance. A full Orca app restart remains untested. See [current validation and limits](VALIDATION-SCHEMA-5.md).

## What is specified and tested

| Invariant | Enforcement and evidence |
| --- | --- |
| Delivery state is outstanding, acknowledged, or fenced | `NOT NULL` and `CHECK`; unknown spelling and NULL are refused |
| One initial assignment per task; one successor per retry | Partial unique indexes, same-task predecessor FK, non-self check; independent initial-admission race still has one winner |
| One immutable message per delivery | Deferred mutual composite FKs and uniqueness require an exact pair at commit; database guards refuse update, replacement and deletion |
| Thread ownership and routing | Required team, optional task in the same Run/team, generated canonical message endpoints with a composite thread FK |
| One answer for an open thread | Conditional update on key, state, row generation, consumer generation, and lease; two connections race and one wins |
| A stale writer cannot use a superseded lease | Machine, per-holder token, lease generation, and expiry predicate |
| Competing holders cannot interleave a mutation and lease acquisition | Lock the lease row first and hold it through commit; tested using a competing connection with a bounded lock timeout |
| A gate references a real task | Enabled foreign keys; missing parent and parent deletion are refused |
| Atomicity and commit accounting | A failed second write rolls back the entire transaction; a successful `RETURNING` result is undone by rollback |
| Old consumer cannot acknowledge a batch after rebind | Transaction fences old outstanding deliveries and increments consumer generation; historical terminal rows remain |
| Identifier values compare identically | SQLite `BINARY` and PostgreSQL `"C"`; case-distinct keys coexist and a case-mismatched foreign key fails |

SQL identifiers use lower snake case. `ddlFor()` renders one common table source with explicit `BINARY`/`"C"` collation, equivalent immutable-message triggers, and equivalent deferred delivery/message FKs. PostgreSQL adds the forward FK after both tables exist; SQLite declares it inline. These small dialect fragments live in the same contract file; there are no independently maintained table schemas. SQLite connections must enable and verify foreign keys before transactions. Every text primary key explicitly says `NOT NULL`.

Not every rule is a constraint. `CHECK` restricts states; the existing conditional APIs prevent reopening, while arbitrary SQL could bypass that protocol. Message immutability additionally has database triggers. The adapter implements version refusal, the authority callback seam, safe-integer validation, transactions, database clocks, bounded retry and durable reconciliation. Lifecycle decisions are settled; their observers/transitions are not implemented. The schema is not a security boundary against arbitrary DDL or disabled constraints.

## Required write transaction

1. Read and validate `format` and `schema_version` **before any write**, including lease acquisition. Refuse unknown versions without resetting data or writing legacy team files. Install this DDL only into a verified empty store. A repeated install fails rather than silently masking a mismatched schema.
2. Acquire or renew the lease conditionally. Report the holder and expiry on a conflict. The holder token distinguishes separate clients even on the same machine. Every acquisition after expiry increments the lease generation; renewal preserves it.
3. Begin the mutation transaction. Execute `SQL.lockLease` first, before taking any entity locks. Zero rows means rollback and refusal. This portable conditional no-op update obtains a write lock; `SELECT ... FOR UPDATE` is not required.
4. Sample the database's UTC clock **after** acquiring that potentially blocking lock. Bind finite safe integers and a fresh `now_ms` to the mutation statement. An expiry equal to `now_ms` is expired. A clock sampled before a lock wait is not valid authority. The adapter supplies engine-specific clock reads; the contract tests inject deterministic times, and runtime tests also verify actual database clocks and PostgreSQL post-wait renewal refusal.
5. Execute conditional mutations. Roll back the whole transaction if a prerequisite returns zero rows or raises an error. Keep the lease row locked through commit so a new holder cannot interleave an acquisition with a mutation under PostgreSQL MVCC.
6. Publish success or perform an external effect only after a successful commit. A lost commit response is unknown and requires reconciliation, not automatic resend. Never hold the transaction across non-database external effects: agent calls, HTTP requests to other services, filesystem writes outside the database, or message sends. The transaction's own database protocol reads and writes are permitted.

Rebinding is one such transaction: fence the old generation's outstanding deliveries, then compare-and-set the Run consumer generation. Failure of the second step rolls back the fencing. A fenced delivery is permanently closed, not acknowledged. This foundation does not decide how its messages are redelivered.

## Deliberately unfinished decisions

The corrected [Team inbox](https://github.com/herman925/925-cc-plugins/issues/152) decisions are represented as layout and companion rules. Required pickup/answer minutes and replay interval have no invented default; task minutes must be explicitly positive or NULL for off. Question deadlines start at question delivery; task deadlines start at observed pickup. The columns do not implement an observer, scheduler, FIFO read/ack workflow, redelivery, settlement, gate application or client integration. Those are later authorized increments.

Roster/configuration layout and the separation of local observation from authoritative shared acknowledgement are implemented here. Schema migration, the plugin evidence-ledger mapping and real client authority integration remain unfinished. No real project's store is opened by these tests. Existing guards, user grants, protected managers, capacity waiting, and paused auto-close remain requirements.

Shared storage uses `<project>/.team-orchestrator/team.sqlite` by default or a person's opt-in PostgreSQL database. Machine observations use `~/.claude/team-orchestrator/<project UUID>/machine.sqlite`. The future migration must preserve the old `.claude/team-orchestrator/` and `.orca/team-orchestrator/` folders. Concurrent writes to copied, synchronized, or network-hosted SQLite files are unsupported; a lease row cannot arbitrate disconnected copies. The adapter refuses explicit UNC paths and storage-directory symlinks, but the client must supply a verified local filesystem: portable Node APIs do not identify every mounted/synchronized filesystem.

## Run the tests

From this directory, Node 22.13 or newer with `node:sqlite`:

```text
npm test
```

This needs no npm install and runs SQLite. PostgreSQL is explicitly shown as skipped unless configured. SQLite connections run on separate worker threads, so synchronous Node calls do not accidentally serialize the concurrency tests in the test runner.

For both engines, install the development dependency and use a disposable local PostgreSQL database. Tests accept only a loopback host and a database named `team_store_contract_test` or `team_store_contract_test_<suffix>`. Each case creates its own random schema and removes that schema on completion. Do not supply a real project's database.

```text
npm ci --ignore-scripts
docker compose up -d --wait
```

PowerShell:

```powershell
$env:TEAM_STORE_TEST_POSTGRES = 'postgres://contract_test:contract_test_only@127.0.0.1:55432/team_store_contract_test'
npm run test:postgres
docker compose down -v
```

POSIX shell:

```sh
TEAM_STORE_TEST_POSTGRES='postgres://contract_test:contract_test_only@127.0.0.1:55432/team_store_contract_test' npm run test:postgres
docker compose down -v
```

`test:postgres` fails if no PostgreSQL URL is configured; it cannot silently pass with SQLite alone. The Compose service binds only to loopback, uses disposable memory-backed storage, and its published password is for that scratch service only. A native local PostgreSQL instance can run the identical suite when Docker is unavailable.

## Primary references

- [SQLite foreign-key enforcement](https://www.sqlite.org/foreignkeys.html#fk_enable): enable per connection outside a transaction.
- [SQLite primary keys and constraints](https://www.sqlite.org/lang_createtable.html): explicitly make text primary keys non-null.
- [PostgreSQL transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html): conditional updates recheck after a competing writer; multi-row authority still needs a transaction and a common lock.
- [PostgreSQL collations](https://www.postgresql.org/docs/current/collation.html): deterministic identifier comparisons.

Tested engine versions and limits are recorded in `VALIDATION.md`.
