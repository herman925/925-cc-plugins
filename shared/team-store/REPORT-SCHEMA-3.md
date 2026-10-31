# Schema 3 and machine schema 1 report to CC Plugin CEO

Implemented your approved slice (`msg_85906a57ec57`); ready for independent review, unreleased.

Shared schema 3 adds stable project UUID, fixed writer families, roster/configuration, separate official-role/advisory content and generations, and approved lifecycle fields. `openMachineStore` creates separate SQLite format/schema 1 with project/machine binding, observations, local receipts, independent writer floor and per-family release fences. No shared-store object/connection or hosted machine storage is accepted.

Exact contract/conformance diff: **SCHEMA-3-CHANGES.patch**, against the captured actual schema-2 files in review-baseline/. Every prior SQL constant is byte-identical except the approved admitAssignment bindings. Fixtures use explicit columns and explicit test-only teams/members; prior assertions remain. Five direct DDL cases were added per engine. **threads.task_id remains provisional pending #152**; no message/batch implementation depends on it.

Validation: **156 passed, 0 failed, 0 skipped; 19.69 seconds** (SCHEMA-3-TESTS.tap). SQLite path 82, PostgreSQL path 72, general 2. Per shared engine: 26 conformance, 9 bootstrap, 22 original runtime, 8 new configuration; additional engine-specific checks 5 SQLite/7 PostgreSQL. Machine-only SQLite adds 12. Engines: SQLite 3.53.4, real native PostgreSQL 18.6, Node 26.9.0. Both public APIs pass a copied-source/no-node_modules probe. Syntax checks: 23 modules; whitespace clean. Node 22 minimum and Docker execution remain untested.

Counting note: PostgreSQL path includes one driver check requiring no server. SQLite-only therefore passes 85 (82 local + 2 general + 1 driver); enabling PostgreSQL adds 71 live-engine cases.

Writer-fence names:

- `older binary freshly rereads newest config generation still refused` (SQLite and PostgreSQL).
- `older machine binary freshly rereads newest observation generation still refused` (SQLite).

Exact refusal strings/templates and source locations: **REFUSALS.md**, 121 templates/60 codes, including all new configuration/machine refusals. Examples:

- `pickupWindowMinutes must be explicitly configured; no default pickup window was chosen.`
- `An attested writer family, release version and protocol are required for this write.`
- `Machine storage accepts neither a hosted database nor a shared-store object.`
- `A thread requires two distinct endpoint member IDs.`

The catalogue also gives exact values/interpolations for old writer, missing known fence, protocol floor, home immutability, duplicate names, missing references, generation conflicts and stale local bindings. Refusals retain rule/record values; no new referenced member/team is fabricated. Local acknowledgement leaves shared delivery rows and database bytes unchanged.

The approved schema/layout items for this bounded slice are implemented; broader lifecycle and integration work remains. Protocol 1 is the sole supported protocol; a higher stored floor refuses. Remaining scope: actual binary/policy attestation and #141 integration; #152 task-binding decision, message/batches, pickup/understanding, gate application, settlement/timeouts and replay; migration mapping/cutover. Old teams lacking pickup minutes need an explicit decision. No migration, real team/session action, client integration, commit, push or release. Please review and lead the next slice.

Checkpoint: CEO accepted this slice in `msg_487b4a1fe08b` after independent SQLite review; combined PostgreSQL evidence accepted provisionally. Implementation stopped pending #152 decisions and a new assignment. All work remains uncommitted.
