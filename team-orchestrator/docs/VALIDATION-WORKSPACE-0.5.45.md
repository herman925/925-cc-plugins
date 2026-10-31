# Team workspace validation — 0.5.45

Scope: a clickable fresh-team workspace over schema 5. This increment adds no migration, scheduler, automatic delivery or worker launching, and does not integrate the Orca plugin with the shared store.

## Local checks

- Full Mod suite after the live-input repair: **380 passed, 0 failed**, 39 files, 24.11 seconds. The initial candidate passed 379; that evidence is preserved separately.
- Full shared-store SQLite suite: **122 passed, 0 failed, 6 PostgreSQL skips**. PostgreSQL is assigned to independent testing; SQLite skips are not counted as two-engine acceptance.
- Focused API/native checks: **19 passed, 0 failed**, including multi-team discovery boundaries, changed reporting lines, stale native incarnation and explicit native session choices and the reviewed exact caller-only self-binding exception.
- Manifest/hook validation: passes with existing directory metadata warnings. This does not assert marketplace directory submission readiness.
- All 16 packaged shared-store runtime modules match their authoritative sources. Schema and command catalogue are unchanged; API read projections and the native adapter are extended.

The six new Mod cases exercise editable creation and hierarchy, no drafting side effects, native session binding with current generations, direct-head assignment and separate review, worker role/brief pickup with no acceptance controls, lost-reply reconciliation with the original request, and refusal of invalid windows or unverifiable discovery. Redrawing performs no process calls. The API suite checks that unbound controllers receive no task evidence, members discover only their own team, and work visibility follows the current assignee/admitting-head boundary.

During implementation the host rejected a cross-file arrow helper and a missing state declaration. A type-contract import was replaced with a self-contained declaration. A state update during rendering caused `ui.render` failures; initialization now occurs only on an explicit action. The full passing run follows those fixes. These failures were not native lifecycle failures.

## Independent acceptance

Initial independent suites passed: 379 Mod tests, SQLite 122 with 6 PostgreSQL skips, and 222 real two-engine tests with 0 failures/skips. A stale wrapper assertion expected 211 after the suite passed; the tester recorded that runner error and stopped its own server normally without a redundant suite rerun.

The first actual form edit failed before creation: an input event containing U+0001/U+000B reached the official-instructions field, then the host rejected the entire tree for a control character. The host/test-sequence cause is not established, but the product now defends the single-line boundary on input/render/submission. A matching host regression passes, preserving readable Unicode. The first report remains immutable; live acceptance continues under `HANDOFF-WORKSPACE-0.5.45-INPUT-REPAIR.md`.

Final independent repaired Mod run: **380 passed, 0 failed**, 39 files, 21.52 seconds. The completed real panel flow created a named team, self-bound both idle conversations, admitted work through the head's form, picked it up through the worker's button, read role/brief before read-only fixture work, reported succeeded through the worker's fields/button, and accepted separately through the head's reason field/button. Permitted API projections show two bindings, one visible assignment, worker outcome succeeded with task open and no acceptance before review, then task succeeded with a separate accepted head decision. The 12-word, 85-byte fixture measurements match. Raw full-table and duplicate-receipt counters were not independently inspected; live unknown-transport fault injection was not performed. Unit/API receipt regressions remain their own evidence.

Normal and approximately 60-column native views were inspected. Actual focus/Tab navigation reached creation fields, capacity, self-selection and tasks. Long forms and lower cards require ordinary scrolling; the owned captures show fold indicators, not simultaneous visibility of all controls. Codex also inspected the two intended fixture captures. Full PNGs remain local to avoid publishing surrounding application chrome.

See [the unchanged complete independent report](INDEPENDENT-WORKSPACE-0.5.45.md), received as `msg_ac65d5fc231a`. Evidence copies and an explicitly API-scoped summary are in `validation/workspace-0.5.45/`. The original first-failure report, initial candidate hash list and separate input-repair hash remain preserved. Real settings/install-record hashes are unchanged; own PostgreSQL stopped; all new and earlier fixtures retained.

Herman was notified before both handoffs. Whole-Orca restart, migration, scheduler/replay/delivery, worker launching, rejected-task recovery, Orca plugin integration and broader lifecycle acceptance remain outside this increment.
