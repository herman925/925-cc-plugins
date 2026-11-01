# Shared runtime development checkpoint

Status: work in progress on `feat/shared-team-runtime`, based on published main `b6b7da6bbf52c962e21afce81fcef0f8d7d754c5`. Not a release or complete lifecycle acceptance. The user requested testing by Codex and then a stop; no test handoff was sent to Claude, whose provider credit is exhausted.

## Implemented in this checkpoint

- Admission atomically saves an assignment, task-owned thread, immutable dispatch message and delivery batch. Explicit worker outcomes queue separate head-directed messages. Head acceptance remains separate from worker outcome.
- Oldest outstanding recipient delivery is selected deterministically; newer mail stays hidden behind it. Read receipts are durable and reconcile the same operation id after a lost response. The implemented read operation acknowledges only the verified recipient's own message.
- Wake reservations are throttled, retain message and delivery identities and never count as read or pickup. The private bridge freshly verifies native target identity/incarnation before yielding a wake target. Mod tool/UI assignment and outcome actions and the existing background refresh invoke the pump. Unreachable targets remain queued.
- Pickup expiry is observed with the database clock, recorded once and returned to the admitting head. Old thread/delivery is fenced; resources remain open. The panel labels the return and removes its pickup action. Observer events do not fabricate messages attributed to the worker.
- The shared API supports a new linked attempt for a returned unpicked task. This retry command is not yet exposed in the Mod catalogue or panel.

Schema remains 5. Local SQLite is still the Mod's configured backend. The shared library also supports explicitly configured PostgreSQL; hosted configuration is not exposed in the Mod. There is no automatic database mirroring.

## Verification on the checkpoint

| Check | Result | Evidence |
|---|---|---|
| Full store suite, SQLite and native PostgreSQL | 232 passed, 0 failed, 0 skipped; 48.12 seconds | `C:/Users/Herman/AppData/Local/Temp/team-runtime-pg-uFJN53/suite.log` |
| Full Mod SDK suite | 421 passed, 0 failed, 44 files; 36.85 seconds | `C:/Users/Herman/AppData/Local/Temp/team-runtime-mod-final-tests.log` |
| Source module syntax | 17 modules checked, no failures | `node --check` on shared root/src modules |
| Packaged store parity | 17 modules verified | `node team-orchestrator/scripts/sync-shared-store.mjs --check` |
| Plugin validation | Passed with existing directory metadata warnings | `C:/Users/Herman/AppData/Local/Temp/team-runtime-validate.log` |
| Diff whitespace | Passed | `git diff --check` |

Tests cover admission/outcome queue atomicity, replay throttling and stable identity, FIFO advancement, loss-of-response reconciliation, own-recipient read restrictions, old consumer fencing, pickup expiry and historical retry, native transport refusal when no freshly verified target is returned, failed wake recovery, and the panel's expired-pickup state. Both engine suites use the same API cases.

Runtime and test file hashes are in `RUNTIME-CHECKPOINT-HASHES.json`. The temporary runner is `C:/Users/Herman/AppData/Local/Temp/team-runtime-two-engine.cjs`. Both disposable PostgreSQL instances created during this phase were stopped; retained fixture logs/data are under `team-runtime-pg-ttTgMU` and `team-runtime-pg-uFJN53` in that Temp folder. Tests did not use the repository's real `.team-orchestrator/` store. No installed plugin, global configuration, user database, migration or release was changed.

## Limits and remaining work

No native live multi-session worker acceptance was performed in this phase. SDK tests and database tests do not establish that acceptance, whole-Orca restart, cross-machine transport or recovery, Docker, or Node 22.13 minimum compatibility.

The broader requested runtime remains incomplete: inbox panel/automatic context ingestion and crash recovery, final head-versus-recipient acknowledgement policy (the user's multiple-choice answer is still pending), question/answer and task deadline scheduling, gate application, retry after a rejected outcome (schema 5 allows only one task acceptance), hosted Mod configuration, migration, capacity scheduling and Orca-plugin integration remain to be completed or specified. The existing Orca plugin must consume Orca's native engine, not introduce another engine. This checkpoint is not ready to merge or release as the completed runtime.
