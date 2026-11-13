# Storage growth: queries are not events

A reported 1.19 GB team store contained three members, 29 tasks and 94 messages. Its 21,622 operation receipts held 1.17 GB; 2,226 full team-inspection responses accounted for 1.16 GB. The inspections repeatedly serialized briefs, evidence and history into new durable receipts. The file had no free pages. This was an API persistence defect, not a SQLite capacity limit. Moving the same implementation to PostgreSQL would retain the same duplicate payloads.

## Permanent separation

| Category | Examples | Contract |
| --- | --- | --- |
| Current-state query | Caller, configuration, team, assignment, inbox preview, notifications, dispatch eligibility, meeting inspection | Explicit allowlist; database-enforced read-only snapshot; no lease acquisition, writer-fence advancement or operation receipt |
| Durable effect | Assign, acknowledge/read own inbox, report outcome, accept work, expire a deadline, reserve a delivery, approve or bind | Atomic state transition and exact durable idempotency receipt; unknown results reconcile with the original operation ID |
| Background observation | Check whether a deadline or delivery is due | Read-only eligibility first; invoke the durable transition only when needed or when reconciling a pending effect |
| Large artifact | Full transcripts, attachments, generated documents | File/artifact reference in a concise record; not an unbounded inline operation payload |

Query request IDs correlate calls. They do not freeze an old result or reserve an effect ID. Repeating or reconciling a query resamples currently authorized state and returns `readOnly: true`. Durable effect replay semantics remain unchanged. In particular, `readInbox` acknowledges a delivery and is **not** a read-only query despite its name. Native runtime readiness observations also remain effects.

SQLite uses `query_only` plus a read transaction; PostgreSQL uses a repeatable-read, read-only transaction. Adding a command does not automatically classify it as a query. The database must refuse an accidental write from any query implementation. Normal write mode is restored after the query, including error paths. Queries validate schema and current actor authority inside their snapshot, never disclose an old cached receipt after a rebind, and do not bypass native caller proof.

Notification polling requests at most one pending notice and one meeting notification, without loading the team’s task briefs/evidence. Automatic prompt identity uses the explicit `identity` team projection: roster/bindings and at most ten authorized assignment metadata records, with no role documents, briefs or evidence. Full task details remain explicit on-demand queries. Controller launch observation uses the configuration projection. Background dispatch first checks the same deadline/delivery predicates used by the actual transitions, inside an enforced read-only transaction. A false eligibility result delays new activity only until the next scheduled pass; it grants no authority. An already-pending effect must reconcile even when fresh eligibility is false, because its earlier commit may already have changed that predicate.

## Resource limits and regressions

Operation input and each durable serialized result have a **1 MiB UTF-8 limit**. Oversized input is refused before execution. An oversized result throws inside the transaction, rolling back the effect and its receipt together. No text is silently truncated, no review is bypassed, and callers can reference a larger artifact instead. Existing historical receipts are not deleted or invalidated by an age-based retention policy.

The regression suite checks repeated inspections against operation count, lease state, SQLite page count and data version; verifies idle observer passes create no receipts; rejects accidental writes in real read-only transactions on both engines; proves mutation/inbox receipts still recover lost replies; and checks oversize rejection/rollback and narrow notification polling. These are storage-behavior tests, not just assertions about method names.

## Existing bloated stores

Preventing new growth does not shrink an existing file. A production repair must be a separate reviewed operation, with a complete verified backup, stopped/verified writers, exact provenance for any retired inspection receipts, preserved durable effect IDs/fingerprints/results, integrity checks and explicit compaction. No generic “delete old operations” job is safe: forgetting an effect ID could authorize its replay. Receipt payload shape alone is not adequate provenance for an automatic production purge.

The diagnostic investigation copied the database and its journal after checking unchanged source metadata; any journal recovery and compaction experiment ran only on disposable local copies. The original file and journal were untouched. An experimental copy can demonstrate potential savings; it is not a production migration, accepted authority database or permission to replace the live file.

Update every active writer/client before resuming normal use. An old running binary can continue its old persistence behavior; installing a package without reconnecting its pinned runtime is insufficient. This fix uses the existing schema 11 and writer protocol 2; an older schema still follows its separate reviewed upgrade workflow. It creates no controller approval, member binding or worker launch.
