# Independent schema-4 acceptance — 2026-10-31

## Authority and scope

Herman-authorized handoff `msg_0b1f5ec3ec79`, read from terminal `term_59c2e656-534f-4758-b1d2-e8a66a371faf`.
Read `REPORT-TO-CEO.md` first, then `SCHEMA-4.md`, `VALIDATION.md`, current map #2 and consolidated #152.
Codex owns schema/code. This session owns independent testing, not DDL approval.
No Task/Dispatch preamble exists. No Task, Dispatch or `worker_done` was invented.

## Independent database results

| Check | Measured result | Artifact |
| --- | --- | --- |
| Full delivered suite, SQLite and real PostgreSQL | 192 passed, 0 failed, 0 skipped; 24.13 seconds | `both-engines.tap`, `both-engines.json` |
| SQLite-only delivered suite | 103 passed, 0 failed, 6 standalone PostgreSQL skips; 9.12 seconds | `sqlite-only.tap`, `sqlite-only.json` |
| Additional independent probes | 15 passed, 0 failed, 0 skipped; 5.48 seconds | `independent-probes.tap`, `independent-probes.test.mjs` |
| JavaScript syntax | 24 modules checked, 0 failures | `syntax-checks.json` |
| Generated SQL | Both renderings match `ddlFor()` after review-header and line-ending normalization | Inline verification output |
| Historical machine DDL | Byte-identical to captured schema 3 | Inline verification output |
| Existing SQL constants | 1 changed out of 13: `admitAssignment` | Inline verification output |
| Workspace status | Same four status entries as start; `git diff --check` reports no errors | `baseline-status.txt` |

Node v26.9.0; SQLite 3.53.4; PostgreSQL 18.6, MSVC x64.
PostgreSQL is a real native loopback server, not an emulator.

Full suite command:

```text
node --test --test-reporter=tap test/*.test.mjs
```

Runner sets `cwd` to the shared package without changing this session's registered home.
`TEAM_STORE_TEST_POSTGRES` points only to the independently owned loopback test database.

## Invariant inspection and independent probes

Inspected all 14 schema-4 layout cases per engine and four additional configuration cases per engine.
Verified the three required invariants: immutable messages; delivery-owned state; thread closure without message mutation.
Inspected actual deferred mutual composite FKs, generated canonical endpoints and immutability triggers.
The delivered tests exercise UPDATE, DELETE, replacement, PostgreSQL TRUNCATE, replay/ack/thread closure, retry lineage and windows.

Additional probes independently establish:

1. The nine message kinds match the settled vocabulary, not merely a copied production constant.
2. Message-first insertion also commits when its matching delivery follows in the transaction.
3. An orphan insertion fails at commit and leaves existing rows intact.
4. Crossed message/delivery identities fail and leave zero rows.
5. Mutual membership cannot cross teams.
6. Replacement through an existing delivery identity preserves exact content.
7. The public API refuses a same-team, different-Run message without partial message/delivery rows.
8. A stale consumer creates neither pair nor committed operation effect; the same operation ID can succeed with valid input.
9. Unicode, combining characters and CRLF bytes survive public persistence, answer, acknowledgement and idempotent replay.
10. Enqueue creates no observed-delivery time or answer deadline.
11. A second answer refuses after the first committed answer.

No product defect was confirmed by these checks.
Known boundaries remain boundaries, not test claims: no retry admission/acyclic-history operation; no replay eligibility/rate implementation; no delivery/pickup observer; no gate application; no client integration.
PostgreSQL BIGINT coerces fractional raw SQL literals; the public settings DTO rejects fractions on both engines. The delivered tests explicitly distinguish these layers.

## Engine ownership and runner faults

Created an independent cluster inside this evidence folder: `postgres-data`, port 50571, bound only to `127.0.0.1`.
Verified SQL `data_directory`, port, version and dedicated database. Verified `postmaster.pid` path/port before each stop.
Final stop succeeded; `postmaster.pid` is absent. Data and logs remain preserved.
Worker's stopped cluster and metadata were read only and never started, stopped or modified.

The first runner reported `pg_ctl ... ETIMEDOUT` after PostgreSQL printed `server started`.
SQL and pidfile checks established that startup succeeded; a Windows inherited output pipe held the synchronous launcher open.
Subsequent control commands used file-backed output handles. No duplicate server was launched.

The first independent-probe harness registered cleanup before closing stores.
It produced three SQLite `hookFailed` EBUSY cleanup errors and later timed out with workers left open.
Corrected only the scratch harness to register store-close before fixture cleanup, following the delivered suite's working pattern.
The second probe run finished with 15 passes, 0 failures, 0 skips.
Preserved the first output as `independent-probes-first-cleanup-failure.tap`.
The product source did not change for either runner fault.

## Evidence-layer boundary

Both shipped clients remain UNINTEGRATED with `shared/team-store`.
Searches found no foundation imports in the Mod or Orca plugin source.
Current-Mod live acceptance therefore cannot establish schema-4 messaging lifecycle acceptance.
The separate coordinator report is `LIVE-MOD-REPORT.md`.
I independently verified the primary transcripts, roster and status with `verify-live.cjs`; output is `live-independent-verification.json`.

| Current-Mod check | Independent result |
| --- | --- |
| Installed version | 0.5.42; actual scratch UI also reports 0.5.42 |
| Team | `S4LiveAcceptance`; three roster entries, correct boss links |
| Started members | Head `e0dd258b-0de7-40c7-a387-a3d2a440e793`; Worker1 `3ea53c00-493c-48f6-90db-30e1239ba7c1` |
| On-demand Worker2 | Pending; empty handle/sessionId; no launch or status file; no task sent |
| Head sends | Exactly 2 unique `team_message` tool IDs, both to Worker1 |
| Inbound task copies | S4-FIRST: 1; S4-SECOND: 1 |
| Worker replies | Exactly 2 unique `SendMessage` tool IDs |
| Head received answers | S4-FIRST: 1; S4-SECOND: 1 |
| Answer values | 18 whitespace-separated words; exact first line `Live Team Orchestrator acceptance fixture.` |
| Queue | No queue directory at final inspection; coordinator also monitored no creation during the run |
| Final status | Head idle; Worker1 idle |
| Cleanup | `reported-clean`, `verified: false`; receipt ID matches second Worker1 SendMessage |
| Fixture | Exact original 117 bytes; unchanged |
| Member edits | 0 Write/Edit calls in Head and Worker1 transcripts |
| Schema-4 store | No `.team-orchestrator/team.sqlite` in live project |

The coordinator's report overstates two evidence details. Use this independently checked supplement:

1. A successful Head role `Read` at 08:09:40Z precedes its first task send at 08:10:34Z. That order is directly proven, not report-only.
2. Worker1 first mistyped `live-project` as `live/project`; both initial reads failed. It recovered without changing code or guards.
3. Worker1 then issued a successful role Read and fixture Bash in the same parallel batch at 08:11:38Z. The role read completed before its reply, but strict role-before-fixture order is not proven. This is a worker execution caveat, not a schema defect.
4. No `starting` status snapshot was captured. The report's final phrase `starting-to-idle observable` must not imply an observed transition.
5. Worker2 is proven unstarted within this launch's roster/launch/status evidence. No global claim about every provider session is made.
6. Raw transcript rows include `api-request-blob` copies. Count primary assistant/user UUIDs and unique tool IDs, not serialized request copies.
7. Worker task labels truncate to the stored visible prefix. Do not describe the entire instruction as stored verbatim.

Current-Mod launch/delivery/correct-result checks passed with those evidence caveats. Schema-4 integrated lifecycle acceptance remains untested.

## Preservation and retained resources

Final verification: 58 recorded source/document files retain their SHA-256 values; Git status matches the start; `git diff --check` reports no errors.
These hashes were captured after the engine runs and before final live verification; they do not establish a pre-run hash baseline.
This session performed no repository writes.
Owned PostgreSQL is stopped; pidfile absent. Scratch project, data, reports and three fresh Claude sessions remain preserved.
The scratch coordinator also left one read-only monitor running. No existing provider session was resumed or modified.

## Limits

Node 22.13 minimum and Docker execution were not tested.
No transport, scheduler, observer, replay engine, gate application, migration, integration, commit, push or release.
Preserved uncommitted source and unrelated `docs/validation` files.
All added test scripts and reports remain outside the repository in this disposable evidence folder.
