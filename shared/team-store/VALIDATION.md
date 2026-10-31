# Contract validation — 2026-10-31

The earlier sections are historical runs. The schema-4 results at the end supersede their implementation-status limits. The shipped Mod, Orca plugin, installed copies and real team data were not changed or exercised by these foundation tests.

## Engine conformance

Windows x64, Node v26.9.0:

| Engine | Version | Result |
| --- | --- | --- |
| SQLite through `node:sqlite` | 3.53.4 | All 18 engine cases passed |
| PostgreSQL, disposable native local cluster | 18.6, MSVC x64 build | The same 18 engine cases passed |
| Shared source/collation check | Both renderings | Passed |

Combined command: `npm run test:postgres` with `TEAM_STORE_TEST_POSTGRES` pointing at a dedicated loopback `team_store_contract_test` database. **37 tests passed, 0 failed, 0 skipped**, two suites, 4.29 seconds in the final engine run.

The PostgreSQL binaries came from `@embedded-postgres/windows-x64@18.6.0-beta.19`, installed into a temporary directory rather than into this package. The engine itself reported PostgreSQL 18.6. The native cluster bound only to `127.0.0.1`, used an automatically allocated port, and held disposable test data. `pg` is pinned as a development dependency in this package's lockfile.

Concurrency checks use independent connections. SQLite runs each connection on a separate worker thread; PostgreSQL uses separate backend connections. Assignment, lease-acquisition, and thread-answer races each produced one winner. A competing lease acquisition hit a real lock timeout while a mutation held the lease row, then succeeded after commit.

The default SQLite-only suite also passed before PostgreSQL was configured. `npm run test:postgres` **without** the URL was separately checked and exited 1 with an explicit configuration message, so a required two-engine run cannot silently degrade to SQLite-only coverage.

## Container configuration

`docker compose config --quiet` passed. Docker's configured `desktop-linux` daemon was unavailable (`dockerDesktopLinuxEngine` pipe missing), so the Compose container itself was **not run**. The native PostgreSQL run above verifies database behavior; it does not verify the image, container startup, or container networking.

## Remaining validation

These are database-contract tests in scratch storage, not live agent acceptance. There is no runtime adapter, schema migration, machine-local receipt schema, complete inbox protocol, or client integration in this increment. Deadline handling, database clock sampling after a lock wait, version refusal by an actual client, error retry/reconciliation, and the unanswered lifecycle decisions listed in the README must be tested when those components are implemented. SQL constraints do not replace those client rules.

## Schema-2 store adapter run

The CEO approved an additive `operations` receipt table, `SQL.readOperation`, schema version 2, canonical identity/reconciliation rules, and the clarification that non-database external effects are forbidden inside write transactions. Existing tables and conditional statements were preserved. `CONTRACT-CHANGES.patch` records the exact scoped changes to the two previously reserved files.

Final command, with the dedicated loopback test database configured:

```text
node --test --test-reporter=tap test/*.test.mjs
```

**118 passed, 0 failed, 0 skipped**, six suites, **12.93 seconds**. Full output: `RUNTIME-TESTS.tap`.

| Coverage | SQLite 3.53.4 | PostgreSQL 18.6 |
| --- | --- | --- |
| Contract conformance | 21 | 21 |
| Runtime bootstrap | 9 | 9 |
| Public store behavior and transaction faults | 22 | 22 |
| Engine/path/configuration-specific checks | 5 | 7 |
| Total per engine path | **57** | **59** |

Two additional general checks cover safe input values and the one-source DDL rendering. The SQLite-specific total includes the copied-source public API test with no `node_modules`; PostgreSQL-specific checks include the optional-driver refusal. All database-dependent PostgreSQL cases used the real native engine, not an emulator. The disposable server was stopped after the run; test data and downloaded binaries remain in the OS temporary directory for inspection.

The original 18 conformance cases per engine remain, with three receipt cases added per engine: conflicting identity refusal/replay, receipt-and-mutation rollback, and committed-receipt preservation after a later rollback. Runtime tests additionally exercise authority denial/asynchronous-policy refusal/revocation, explicit initialization, unknown versions including version 1, clock ordering/expiry/backward time, lease exclusivity and renewal, generation overflow, transaction rollback, bounded retries, idempotent canonical identity, and both recorded and absent outcomes after injected commit-response loss.

Engine-specific tests generated actual SQLite busy errors, PostgreSQL uniqueness/40001/40P01 errors, and a real PostgreSQL row-lock wait that crossed lease expiry and correctly refused renewal. The public SQLite adapter also retried a real competing writer without duplicating a receipt. Shared runtime fault tests cover a retryable COMMIT rejection and a failed rollback confirmation.

A final regression was first reproduced as two failing cases, one per engine: a retry from a new holder waited for an in-flight commit and then incorrectly returned a lease conflict despite the completed receipt. The adapter now rechecks the receipt after the lease-control lock and before ownership refusal; the same two cases pass and return one committed result with one stored effect.

`node --check` and whitespace/diff checks were also run. The package declares Node 22.13+; execution in this session used Node v26.9.0. Container configuration remains syntactically validated but not launched because the Docker daemon is unavailable.

The adapter implements only the contract's fixed persistence primitives, not the full lifecycle. Authentication/role rules remain the client's callback responsibility; the client must also supply a verified local filesystem. A lease cannot arbitrate disconnected/synchronized database copies. Migration is design-only (`MIGRATION.md`); no automatic schema-1 upgrade, roster/configuration layout, machine receipt schema, transport, scheduler, session launch/cleanup, or Mod/Orca integration is claimed. No versioned release, commit, or push was made.

## Schema-3 configuration and separate machine schema-1 run

CEO approval `msg_85906a57ec57` authorized the shared layout, independent machine store, fixed Mod/plugin writer families and new required references. The exact change from the captured schema-2 contract/conformance files is `SCHEMA-3-CHANGES.patch`. The captured sources are in `review-baseline/` (historical text only). A programmatic comparison of every prior `SQL` value found exactly one changed statement: the approved new bindings in `admitAssignment`. All other prior statements remain byte-identical. Existing assertions remain with explicit new-shape fixture seeds/column lists; five direct layout cases were added per engine.

Final command with a dedicated native PostgreSQL loopback database:

```text
node --test --test-reporter=tap test/*.test.mjs
```

**156 passed, 0 failed, 0 skipped**, nine suites, **19.69 seconds**. Full output: `SCHEMA-3-TESTS.tap`. Versions: Node v26.9.0, SQLite 3.53.4, native PostgreSQL 18.6. The declared Node 22.13 minimum has not been execution-tested. Docker execution remains unavailable.

| Coverage | SQLite | PostgreSQL |
| --- | --- | --- |
| Contract conformance | 26 | 26 |
| Runtime bootstrap | 9 | 9 |
| Existing shared runtime/transaction faults | 22 | 22 |
| Engine/path/configuration-specific checks | 5 | 7 |
| New shared configuration cases | 8 | 8 |
| Separate machine-store cases (SQLite only by design) | 12 | N/A |
| Total engine paths | **82** | **72** |

Two additional general checks cover safe input values and the shared DDL rendering. The isolated copied-source case now creates both shared and machine stores without any `node_modules` or npm runtime dependency. Bootstrap checks refuse shared versions 1, 2 and 99 without file reset.

Counting clarification from CEO review: the 72 PostgreSQL-path checks include one hosted-driver refusal check that needs no PostgreSQL server. The SQLite-only run therefore reports **85 passes**: 82 SQLite-path checks + 2 general checks + that driver check; six standalone live-PostgreSQL tests are marked skipped, and the nested PostgreSQL suites are skipped as suites. Enabling PostgreSQL adds 71 live-engine cases, giving the recorded **156** combined passes. These counts describe different groupings of the same suite.

Named downgrade regressions:

- `older binary freshly rereads newest config generation still refused` — both shared engines.
- `older machine binary freshly rereads newest observation generation still refused` — SQLite machine store.

Other new evidence covers numeric per-family release ordering, missing fixed fences, unsupported/old protocol refusal, atomic fence/configuration rollback, explicit pickup minutes, global member names/boss cycles, immutable registered homes, independent official/advisory generations, named missing references, canonical endpoint replay, superseded answer refusal, task-outcome NULL constraints, future pickup deadlines and consistent gate resolution fields.

Machine tests verify project/machine header binding before writes, unknown format versions without reset, raw unknown state preservation, database heartbeat/context/turn observations, stale bindings/generations, rebind resets, historical receipt preservation, independent local writer fences, atomic batches, bounded busy retries, authority revocation on retry/read/replay, uncertain commit reconciliation and unsafe directory/junction refusal. A local acknowledgement test records its receipt while proving the actual shared delivery row and shared database bytes remain unchanged.

The first schema-3 full run exposed two PostgreSQL fixture errors (raw scratch modifications outside `BEGIN READ WRITE`); the fixture now uses explicit transactions. Final reruns include the copied-source machine probe and prior-version checks. Syntax checks passed for all 23 JavaScript modules; tracked/untracked-source whitespace checks passed. `REFUSALS.md` contains 121 exact message templates covering 60 codes.

Limits: no migration execution, message/batch layout, pickup/understanding transition, gate application, settlement/timeout worker, answer deadline, transport, scheduler or real client integration. Task-bound threads remain a prominent provisional #152 assumption. Only writer protocol 1 is supported; higher protocol floors refuse rather than simulating support. The client must attest actual binary identity and permissions. No commit, push or release was made.

CEO checkpoint `msg_487b4a1fe08b`: independently reran SQLite-only (85 pass, 0 fail, 6 standalone skips), accepted this slice, and accepted the combined run provisionally from its current TAP evidence without independently rerunning PostgreSQL. Implementation must stop here until the remaining #152 decisions and a new bounded assignment. All edits remain uncommitted. The worker's disposable native PostgreSQL server was stopped after review; downloaded binaries, scratch data and test artifacts remain for inspection.

## Schema-4 corrected lifecycle layout

Authority: corrected handover `msg_ad39206ff32e` and Herman's instruction to work on it. The handover removes the prior DDL/conformance ownership gate. The earlier task-required and pickup-started-answer-window instructions were superseded; the consolidated S1–S8 decisions govern the layout. See `SCHEMA-4.md` for the design, unresolved behavior and exact scope.

Final combined command, with the dedicated loopback native PostgreSQL test database:

```text
node --test --test-reporter=tap test/*.test.mjs
```

**192 passed, 0 failed, 0 skipped**, 11 suites, **33.92 seconds**. Full output: `SCHEMA-4-TESTS.tap`. Node v26.9.0, SQLite 3.53.4, real PostgreSQL 18.6. No emulator or real team data was used. Docker and the declared Node 22.13 minimum remain untested.

Final SQLite-only output: `SCHEMA-4-SQLITE-TESTS.tap`, **103 passed, 0 failed, 6 standalone PostgreSQL skips**. The nested PostgreSQL suites are also explicitly skipped as suites.

| Coverage | SQLite path | PostgreSQL/hosted path |
| --- | --- | --- |
| Existing contract conformance | 26 | 26 |
| New schema-4 layout conformance | 14 | 14 |
| Bootstrap | 9 | 9 |
| Shared transaction/runtime behavior | 22 | 22 |
| Configuration/writer/role cases | 12 | 12 |
| Engine/path/driver checks | 5 | 7 |
| Separate machine cases | 12 | N/A |
| Total | **100** | **90** |

Two general checks bring the combined total to 192. One of the hosted-path checks (optional-driver refusal) runs without a server, so SQLite-only totals 100 local + 2 general + 1 driver = 103, with 89 live-PostgreSQL cases added when configured.

New evidence covers exact one-to-one message/delivery membership at commit, rejection of either orphan/mismatched identities, immutable message UPDATE/DELETE/replacement and PostgreSQL TRUNCATE refusal, unchanged message bytes after delivery replay/acknowledgement and thread closure, closed message kinds, generated canonical endpoint foreign keys, team-owned/task-owned thread constraints, same-task retry lineage/root/successor uniqueness, question-versus-pickup timing, explicit task-window off state, integral numeric storage, opaque gate content and explicit client option obligations, and transaction rollback after an immutability refusal.

Four additional configuration cases per engine exercise required windows/rate, complete immutable-pair persistence with no transport/timer side effects, task-window admission snapshots without pickup/deadline invention, and missing database guards refusing before lease/data writes. Previous-version checks now explicitly include schema 3. Both public local APIs still pass the copied-source/no-node_modules probe. Shared lease, writer fences, retry/reconciliation and machine-binding regressions all remain green.

The first run passed 190 cases. Final review identified SQLite BIGINT affinity as insufficient to forbid fractional storage, so integral checks and one additional case per engine were added before the final 192-case run. PostgreSQL coercion of raw SQL numeric literals is documented; public DTO validation refuses fractional inputs on both engines. No minimum-version or Docker claim was added.

`SCHEMA-4-CHANGES.patch` compares actual captured schema-3 contract/conformance sources and includes the new conformance file. `SCHEMA-4-SQLITE.sql` and `SCHEMA-4-POSTGRES.sql` are generated review renderings. A programmatic comparison confirms machine DDL is byte-identical to schema 3, and the only existing SQL constant changed is `admitAssignment` to bind the task-window snapshot. `SCHEMA-4-REFUSALS.md` records 12 new/changed exact message templates; the complete catalogue contains 132 templates and 67 codes.

Final syntax checks passed for all 24 JavaScript modules; source/document/SQL whitespace and tracked diff checks passed. Generated SQL review files trim blank-line indentation; the runtime consumes only `ddlFor()` from the contract source. The worker's own scratch PostgreSQL server was verified and stopped after the final runs; data/binaries and test evidence remain preserved in temporary storage.

At the pre-handoff checkpoint, no Claude acceptance handoff or live team acceptance had occurred; Herman had asked for notification first. He subsequently supplied Claude's new tab and explicitly authorized delivery. Message `msg_0b1f5ec3ec79` was queued to `term_59c2e656-534f-4758-b1d2-e8a66a371faf`, its complete body verified by mailbox peek, and the attention prompt returned `turn_started`. See `HANDOFF-TO-CLAUDE.md` and saved receipts. Claude's independent results are still pending. No old provider session was resumed or replacement tester launched by Codex. Neither client imports this foundation, so an existing-Mod live run cannot establish schema-4 lifecycle acceptance without separately authorized integration. No migration, observer, scheduler, transport/redelivery, gate application, client integration, commit, push or release was performed.

## Independent schema-4 verification received

Claude's completed report arrived as `msg_1c8b554f5a83` and was read in full. A byte-for-byte copy of its primary report is preserved in `INDEPENDENT-ACCEPTANCE-SCHEMA-4.md`; the original evidence remains under `C:/Users/Herman/AppData/Local/Temp/schema4-ceo-acceptance-PPnfit/`.

Independently reproduced: 192 passes on SQLite/real PostgreSQL, zero failures/skips; SQLite-only 103 passes with 6 standalone PostgreSQL skips; 15 additional independent probes pass; 24 syntax checks pass. No product defect was confirmed. The tester's own PostgreSQL cluster was stopped without modifying the worker's cluster. The source stayed unchanged during independent testing.

The separate current-Mod live run completed two distinct tasks, each delivered once with correct answers. It did not use the shared schema-4 store. No starting snapshot was captured, and Worker1's successful role read and fixture read ran in the same parallel batch, so strict role-before-fixture ordering is unproven. Those caveats remain; this is not integrated schema-4 lifecycle acceptance. Node 22.13 minimum and Docker execution remain untested. Three scratch sessions and one monitor were retained by the tester for inspection; Codex has not closed them.

This independent report supersedes the earlier pending-results checkpoint. API-boundary design and integration are a new work slice; see `API-BOUNDARY.md` for its current decision interview. The production helper and integration are not implemented yet.
