# Schema 4: immutable messages and corrected lifecycle layout

Implementation scope: corrected handover `msg_ad39206ff32e`, [map #2](https://github.com/herman925/925-cc-plugins/issues/2), and the consolidated S1–S8 decisions in [#152](https://github.com/herman925/925-cc-plugins/issues/152). Schema ownership transferred to Codex; the previous DDL approval gate was removed. No source ticket was edited by this slice.

The common source is `contract.mjs`. `SCHEMA-4-CHANGES.patch` records the actual change from captured schema-3 sources. Rendered SQL files are generated review artifacts, not alternate schemas or runtime inputs. Shared schema 3 and earlier refuse without migration. Machine format/schema 1 is unchanged.

## Deliveries already is the batch

Keep `deliveries` as the only owner of `outstanding`, `acknowledged`, and `fenced`. Do not add a competing `delivery_batches` state table. The settled one-message-per-batch rule needs no general membership table: `deliveries.message_id` and `messages.delivery_id` express exact one-to-one membership. Both are non-null and unique; deferred mutual composite foreign keys require the identities and team to agree, with both rows present at commit. An isolated message, isolated delivery, mismatched pairing or second member cannot commit. PostgreSQL adds its forward reference after both tables exist; SQLite declares the same constraint inline.

`messages` stores stable ID, team, thread, sender, recipient, body, kind, and database creation time. It has no status or replay flag. Generated canonical endpoint columns make a composite FK enforce the two endpoints of the named team/thread in either sender direction. The kind enum matches the settled nine Orca vocabulary values.

Immutable rows reject UPDATE, DELETE and replacement. PostgreSQL additionally rejects TRUNCATE; SQLite's INSERT guard closes the `INSERT OR REPLACE` loophole even when recursive DELETE triggers are disabled. These small dialect fragments live beside the common table DDL. Bootstrap refuses missing guards. This protects ordinary data writes, not a hostile database owner disabling triggers or changing DDL. [SQLite trigger documentation](https://www.sqlite.org/lang_createtrigger.html), [PostgreSQL trigger documentation](https://www.postgresql.org/docs/18/sql-createtrigger.html).

Replay metadata belongs to the delivery: a count and last replay time, consistent as absent/zero or present/positive. Joining those fields with an unchanged message lets a later client display a replay. No replay operation, timer or eligibility decision is implemented. Acknowledgement changes only delivery state; thread closure changes only the thread. The three settled invariants therefore hold independently.

The existing `createDelivery` persistence primitive now requires explicit message values and creates the pair atomically. That is adapter compatibility with the mandatory new layout, not transport or an inbox send/check workflow. Persisting a question leaves delivery-observation/deadline fields NULL: enqueue does not prove delivery. Missing new references refuse explicitly; no synthetic message, team or task is created.

## Ownership, attempts and windows

| Record | Layout and constraint |
| --- | --- |
| Thread owner | Required team; optional task in the same Run/team. Team coordination is valid. Composite FKs enforce ownership without an invented task. |
| Open thread identity | Canonical endpoints plus task, or canonical endpoints plus team when task is NULL. Separate partial unique indexes handle nullable-task uniqueness. |
| Attempt link | Optional assignment on a task-owned thread must belong to that task; team-only threads cannot name an assignment. |
| Retry history | Replace schema-3 `UNIQUE(task_id)` with one initial assignment per task and one successor per predecessor; same-task self-FK and non-self check. Each retry has a distinct row. |
| Question window | Thread's question-delivered time and answer deadline are both NULL or both present, deadline at/after delivery. It is independent of pickup. |
| Task window | Assignment snapshots optional task minutes. NULL minutes/deadline means off. Enabled before pickup has no deadline; enabled after observed pickup requires a deadline at/after pickup. |
| Team settings | Required positive pickup/answer minutes and replay interval milliseconds; task minutes must be explicitly positive or NULL/off. No defaults were invented. Legacy `batch` remains launch-session batching, unrelated to delivery size. |

New numeric columns also check integral stored values on SQLite; its BIGINT affinity alone does not reject fractions. PostgreSQL BIGINT storage coerces numeric SQL literals to integers; public DTO validation rejects fractional inputs before either engine sees them.

## JSON and the rules that remain behavior

Gate `options_json` and `resolution_json` already existed in schema 3, so they remain opaque TEXT with the existing open/resolved presence checks. Both engines offer native JSON validation, but their predicates and parser limits are not an identical portable parser contract. This slice selects the handover's client-validation fallback, rather than claim JSON validation is impossible. The client must validate syntax, at least two offered strings, and a resolution naming an offered option with an optional note. `RULES.gates` states that obligation. No option interpretation or gate application was added. [SQLite JSON validation and nesting limits](https://www.sqlite.org/json1.html), [PostgreSQL JSON predicates](https://www.postgresql.org/docs/18/functions-json.html).

Columns/constraints cannot observe real delivery or pickup, schedule expiry, notify a head, guarantee eventual termination, prevent an already-answered replay, enforce relay authority, decide acknowledgement ownership, or apply a gate resolution. Retry eligibility, acyclic historical lineage and closing the prior thread also require the later lease-locked lifecycle operation; the new retry API is not implemented. Owner transfer, migration mapping, client/API integration and the plugin's own evidence-store shape remain open. The existing conditional transition APIs still refuse terminal rows; arbitrary direct SQL could bypass that protocol.

Neither shipped client imports this foundation. A real team through the current Mod can test the current Mod's behavior, but cannot establish schema-4 lifecycle acceptance until integration is separately authorized. No live-team result is claimed here.
