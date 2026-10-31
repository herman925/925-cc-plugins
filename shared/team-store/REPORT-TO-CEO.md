# Schema-4 report prepared for Claude acceptance

**Handoff authorized by Herman after notification**, to Claude in Orca tab c8adfae3-384d-4202-937b-e5b29d273071. The old provider session was not resumed. Delivery evidence is recorded separately.

Authority: corrected handover `msg_ad39206ff32e`, current map #2 and consolidated #152. Codex now owns the complete contract/conformance surface; the old approval gate was removed.

DDL: `contract.mjs`; generated review renderings `SCHEMA-4-SQLITE.sql` and `SCHEMA-4-POSTGRES.sql`; exact schema-3 diff `SCHEMA-4-CHANGES.patch`; reasoning/boundaries `SCHEMA-4.md`.

**Delivery decision:** refine existing `deliveries`; it already IS the batch-state table. No `delivery_batches` table or second status owner. Required unique message/delivery identities and deferred mutual composite FKs enforce exactly one message per delivery at commit, in one team. Immutable message rows carry stable team/thread/sender/recipient/body/kind/time; generated canonical endpoints enforce routing. Database guards reject update, replacement and deletion (also PostgreSQL TRUNCATE). Replay count/time live on deliveries, so replay/ack/thread closure leave message content unchanged.

**Thread decision:** required team, nullable task in that Run/team, optional assignment belonging to that task. Team coordination needs no fabricated task. Separate partial indexes enforce open-thread identity for task-owned and team-owned conversations. Owner transfer remains open.

**Windows/retries:** explicit positive pickup/answer minutes and replay milliseconds; task minutes explicitly positive or NULL/off. Question deadline is on the thread, paired with actual question-delivery time, independent of pickup. Assignment snapshots task minutes; off requires NULL deadline, enabled-before-pickup has none, enabled-after-pickup requires deadline at/after pickup. Retry history permits one root per task and one same-task successor per predecessor; no self link. No retry-admission workflow was added.

**JSON:** existing gate TEXT columns remain opaque with open/resolved presence checks. No identical portable JSON parser was selected; syntax/at-least-two-options/offered-choice validation is explicitly the client's obligation in RULES.gates. Store-side option interpretation and gate application remain absent.

Validation: **192 pass, 0 fail, 0 skip**, 33.92s; real SQLite 3.53.4/PostgreSQL 18.6, Node 26.9.0. Counts: SQLite path 100, hosted path 90, general 2. Hosted includes one no-server driver check; SQLite-only **103 pass/6 standalone skips**, with 89 live-PostgreSQL cases added when configured. Per shared engine: 26 prior conformance + 14 new layout + 9 bootstrap + 22 runtime + 12 configuration; other checks 5 SQLite / 7 hosted; machine-only 12. TAP artifacts preserve both runs. Node 22 minimum/Docker execution remain untested.

Exact new/changed refusal texts: `SCHEMA-4-REFUSALS.md` (12 templates); full `REFUSALS.md` (132 templates/67 codes). Machine DDL unchanged; only prior SQL constant changed is admitAssignment's task-window binding. Existing fixed persistence primitives were adapted to mandatory new references; no inbox send/check workflow or transport was added.

Unimplemented: real delivery/pickup observation, timers/scheduling, replay eligibility/rate enforcement, terminal-thread/attempt lifecycle, acyclic retry eligibility, relay authority, acknowledgement ownership, gate application, migration, client integration. Neither client imports this foundation; an existing-Mod live run cannot establish schema-4 lifecycle acceptance. No real-team action, commit, push or release.

Please independently test both engines and report evidence to term_e1bd773e-211e-46fe-bf60-a44b7208a45c. Keep any current-Mod live acceptance separate from schema-4 integration claims; preserve all uncommitted work and existing scope limits.
