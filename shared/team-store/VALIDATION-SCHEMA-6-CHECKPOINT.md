# Schema 6 history, explicit upgrade, and native protocol checkpoint

Development branch: `feat/shared-team-runtime`, following `3762fac`. This is an unreleased increment. Schema 6 preserves per-attempt rejection/acceptance and assignment-return history; accepted tasks remain terminal. A retry creates a new linked attempt. The earlier decisions stay immutable under both engines.

The user has settled that only the recipient marks its message read; head inspection does not clear worker mail. The user has also settled automatic task resumption after all decision gates are answered, while the assignment remains valid. Gate application is the next increment, not established by this report.

## Automated verification

- SQLite plus real PostgreSQL: **258 passed, 0 failed, 0 skipped**, 40.41 seconds. Log: `C:/Users/Herman/AppData/Local/Temp/team-runtime-pg-4wJb34/suite.log`. Disposable PostgreSQL stopped after the run.
- Full Mod SDK suite: **429 passed, 0 failed**, 45 files, 36.66 seconds. Log: `C:/Users/Herman/AppData/Local/Temp/team-schema6-mod-tests.log`.
- Plugin validation passed with the existing directory metadata warnings. Log: `C:/Users/Herman/AppData/Local/Temp/team-schema6-validation.log`.
- Source/packaged parity verified 20 modules; whitespace check passed.

The first two-engine run exposed a test helper that had not expanded the new history-guard placeholder; the guard body was added to that conformance assertion and the full suite passed. The migration cases themselves passed on both runs and both engines.

Upgrade tests verify a complete schema-5 contract-data backup before DDL, preserved messages/approvals/receipts, imported unambiguous returns, refusal of unauthorized/live-writer/unsupported/ambiguous cases, refusal when data changes after backup, and recovery of a lost successful upgrade-commit reply without another backup or replay. Backup filesystem I/O runs outside database transactions. A second snapshot comparison under the shared lock refuses intervening writes. Normal opening still refuses older formats; it never upgrades automatically.

## Native check without model credit

Owned fixture: `C:/Users/Herman/orca/workspaces/925-cc-plugins/runtime-ui-20261101`, branch `herman925/runtime-ui-20261101` at the prior development checkpoint. Product snapshot and native test driver: `C:/Users/Herman/AppData/Local/Temp/team-runtime-native-20261101`. The driver invokes real registered tools from another native Mod; it does not substitute API results, mint approval tickets, or supply caller proof. This checks the native transport/API path, not model reasoning or a model-driven worker run.

Verified native results:

1. Existing schema 5 opened as UPDATE NEEDED. The actual Update workspace control was activated through native keyboard focus/Enter. The store became schema 6, a backup was written, the rejection stayed unchanged, and **zero controller approvals** existed after the update.
2. Management was allowed through the actual product control in each fixture conversation. Both approvals remained active at generation 1.
3. The worker's attempted self-binding before approval was refused with `API_CONTROLLER_REQUIRED`. The head was bound through product UI, the worker through the registered typed tool; both native bindings are generation 1.
4. The head used the actual Reassign task control on the rejected attempt. A new attempt and dispatch were recorded, preserving the predecessor.
5. The worker read and confirmed its inbox through the real native tool bridge. It retrieved its official role and brief before its explicit report.
6. The report left acceptance pending and the task open. Worker self-acceptance was refused with `API_HEAD_REQUIRED`, despite its separate controller approval.
7. The head read the worker_done message, confirmed that receipt, and accepted the task. Final database evidence: succeeded task, **two separate decision rows** (original rejected, new accepted), two acknowledged deliveries, and unchanged approval/binding generations.

Evidence includes `before-upgrade.json`, `after-upgrade.json`, `before-reassign.json`, `before-head-review.json`, `final-native-acceptance.json`, both `native-<conversation>.json` files, and UI focus/pane facts in the fixture debug logs. Backup project identity and its original rejection were read back. A right dock with **57 body columns** was observed. The driver requests pane keyboard focus because desktop keyboard automation could not obtain OS focus; this focus instrumentation does not establish default focus behavior. Product controls and callbacks remain the tested source.

The initial fixture seeder used forward-slash home paths. Before binding, those test-only homes were corrected to the OS realpath required by the native API; this setup correction is recorded in `fixture-home-canonicalized.json`. It is not a product change. The schema upgrade faithfully preserved the original values, as its before/backup/after snapshots show.

## Limits

No autonomous model flow is claimed. The dispatch remained outstanding through three wake reservations before the explicit recipient read probe; automatic peer delivery was not independently established while model credit was unavailable. This needs investigation and a live model run when available.

No whole-Orca restart, remote transport, Docker or Node 22.13 minimum acceptance is established. Fixtures and their test-owned machine receipts/backups remain for inspection. The real main-workspace store was never used. The launcher used fixture-scoped settings and source snapshots; no plugin install or configuration-changing command was requested. A global-profile hash baseline was not captured, so an unchanged global profile is not claimed.

Remaining work includes gate application, question/answer and task deadline behavior, hosted Mod configuration, legacy-file migration, capacity scheduling and Orca-plugin integration. Historical validation reports remain unchanged.
