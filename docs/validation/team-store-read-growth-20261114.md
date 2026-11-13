# Team-store read growth — 2026-11-14

Release: **Mod 0.5.63 / Codex 0.1.13 / schema 11 / writer protocol 2**, 86 matching runtime files. [Storage design](../TEAM-STORE-STORAGE-DESIGN.md) defines pure queries, durable effects, resource limits and the separate production-repair boundary.

## Observed defect

A user-reported file was **1,188,454,400 bytes**, schema 9, with **zero free pages**. It held three members, 29 tasks and 94 messages. Its **21,622 operation rows** contained **1,174,824,089 bytes of result JSON**. **2,226 full team snapshots accounted for 1,160,593,567 bytes**; the largest result was 783,093 bytes, mostly task briefs/evidence. Every inspection through the generic execute path acquired the writer lease, serialized its complete result and saved another permanent receipt. The same code would duplicate payloads on PostgreSQL.

No message, instruction, evidence or secret content is included in this report. Database/journal files were copied to a disposable local directory after confirming unchanged source size/mtime. SQLite recovery, aggregate queries and the size experiment used those copies. The original database and its 8,720-byte rollback journal were not changed.

## Fix and verification

| Check | Result | Evidence |
| --- | --- | --- |
| Final full suite, Node 22.13.0, SQLite + actual disposable PostgreSQL | **724 passed, 0 failed, 0 cancelled, 0 skipped** | [TAP](team-store-read-growth-20261114/common-final.tap) |
| Mod candidate, actual Claude Code 2.1.323 | **473 passed, 1 timing failure**, 48 files | [Candidate log](team-store-read-growth-20261114/mod-final.log) |
| Clean published main, same native Mod runner | **473 passed, same timing failure**, 48 files | [Baseline log](team-store-read-growth-20261114/mod-clean-main.log) |
| Identical crypto test/vendor source, isolated clean-main fixture | **16 passed, 0 failed** | [Isolated log](team-store-read-growth-20261114/crypto-isolated-main.log) |
| Syntax and packaging | **85 modules passed; 86 files match both packages** | Normal Node syntax checker and `sync-shared-store.mjs --check` |

The timing failure is the unchanged Argon2 bundle-unlock assertion of less than six seconds: candidate 7.33 s, clean-main 6.44 s. Crypto source, vendor code and benchmark threshold were not changed. An earlier candidate run also hit this timing assertion. The report does not claim an all-green Mod suite. GitHub has no configured checks on this repository's PRs; local evidence is retained with [SHA256 values](team-store-read-growth-20261114/hashes.json).

The first full common run had five failures: two older-writer tests expected even pure reads to be fenced, two meeting tests expected historical inspection replay rather than a fresh authorized view, and the setup helper still reported the preceding package version. The tests now explicitly prove old **effects** remain fenced and fresh controller-only views disclose no former private meeting/task summaries; direct private meeting access is still refused. The helper version matches its package. The final 724-test run supersedes that run.

Regressions exercise real behavior on both engines:

- **200 repeated inspections** create no receipt, acquire no lease, and change no SQLite pages/data version. Before the fix, operation rows increased from 7 to 207: [reproduction](team-store-read-growth-20261114/growth-before.tap).
- **20 settled-team observer passes** create no durable rows. Before eligibility gating, rows rose from 6 to 46: [reproduction](team-store-read-growth-20261114/idle-before.tap).
- Database read-only transactions reject an actual attempted update and restore the write path afterward.
- Repeated/reconciled queries resample current authority; mutation and acknowledged-inbox receipts still recover lost replies exactly.
- Input over 1 MiB is refused before an effect. A result over 1 MiB rolls pickup back, leaving its generation, pickup state and receipt unchanged.
- Automatic identity context omits briefs/evidence/role documents; empty inbox polling uses a small notification query. Full details remain explicit queries.
- Observer tests retain deadline transitions, delivery retries and uncertain-effect reconciliation even after eligibility changes.

## Existing-file experiment, not deployment

On a second disposable copy, replacing the 2,226 recognized full-inspection responses with small experimental markers and compacting reduced size from **1,188,454,400 to 23,715,840 bytes**. Every non-operation table's complete ordered-row hash matched. The full original snapshot was retained separately. [Experiment summary](team-store-read-growth-20261114/copy-size-experiment.json).

This quantifies the cause and potential savings; it is **not a production cleanup implementation**. It uses legacy payload recognition, which is not adequate provenance for an automatic purge. No experimental file is an approved runtime database. Production repair still needs verified backup/provenance, preserved effect receipts/IDs, controlled writers, review and integrity checks. Installing this release prevents the new-client behavior; it neither shrinks an existing file nor upgrades schema 9 automatically. All active clients must update and reconnect.
