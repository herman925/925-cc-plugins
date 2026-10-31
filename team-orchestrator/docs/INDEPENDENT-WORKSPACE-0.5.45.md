# Independent workspace 0.5.45 acceptance

Date: 2026-11-01 local; runtime logs use UTC 2026-10-31.
Evidence root: `C:/Users/Herman/AppData/Local/Temp/ws045-ceo-QiDxdH`.
Tester: CC Plugin CEO. Product source remains Codex-owned.

## Verdict and measured scope

The bounded actual workspace-panel lifecycle passed after the disclosed input-render repair. Caller-only verified self-binding passed through both idle conversations. Full raw database counters and live unknown-commit fault injection are not claimed.

| Independent check | Measurement | Evidence |
| --- | --- | --- |
| Initial complete Mod suite | 379 passed, 0 failed, 39 files; 30.40s | mod-tests.log |
| Repaired complete Mod suite | 380 passed, 0 failed, 39 files; 21.52s | repaired-mod-tests.log |
| SQLite-only full store suite | 122 passed, 0 failed, 6 standalone PostgreSQL skips; 10.49s | sqlite-only.tap/json |
| SQLite + real PostgreSQL full store suite | 222 passed, 0 failed, 0 skipped; 38.87s | both-engines.tap/json |
| Packaging/validation | 16 packaged modules match; validation completed | initial validation/background output; mod-validation.log |
| Initial live failure | Actual official-instructions field poisoned render with a control character | FIRST-LIVE-FAILURE.md; head.debug.log |
| Preserved draft recovery | Normal one-file source reload restored form and readable old draft without clearing atoms/data | recovered-preserved-draft.json |
| Team creation | Actual fields/button created Workspace045Live, two members, config version 5 | Head panel and API projections |
| Native self-binding | Head and Worker each selected This verified conversation while idle; both bindings generation 1 | self-choice-visible.json; panel/debug evidence; final API projection |
| Assignment/pickup | Actual Head Assign task and Worker Tasks/Pick up handlers committed | head.debug.log; worker.debug.log |
| Model role/brief before fixture | Read of real panel snapshot completed, requirements stated, then fixture Bash | final-verified-evidence.json primary transcript order |
| Worker outcome | Actual panel stored succeeded summary/evidence | worker-reported-panel.json; API projection |
| Before Head acceptance | Task open/outcome null; attempt succeeded generation 3; acceptance null | ws045-head-team-before-accept receipt |
| Separate Head acceptance | Actual reason field/Accept outcome handler; task succeeded; separate acceptance names Head | final API receipt; head-accepted-panel.json |
| Global preservation | settings.json and installed_plugins.json hashes unchanged | final-verified-evidence.json |

Node v26.9.0, real SQLite 3.53.4 and PostgreSQL 18.6. No Docker/minimum-Node rerun was required.

Runner fault, not product failure: the reused runner retained a stale expected pass count of 211. It asserted only after the full TAP completed with 222 passes/0 failures/0 skips. The runner's foreground result was failure; the actual suite JSON/TAP records success. Its finally block stopped its OWN PostgreSQL cluster normally. Data/logs remain; port 56047; postgres-stopped.json confirms pidfile absent. No other server was controlled.

## Candidate and repair provenance

Captured starting Git status and source/document hashes before tests; preserved unrelated root docs/validation draft.
New isolated source copy and project only. Source version 0.5.45; preview remains false in manifest. Fresh sessions used fixed per-invocation source options to enable preview with exact Node/Orca paths and disable installed Mod for those invocations. No credentials were copied, printed or changed. No option Toggle/Save controls were used in these normally authenticated fixtures.

Initial reviewed native binding route:

1. Verify exact own nonempty string projectRoot/conversationId/terminalHandle/contextId.
2. Re-prove privately supplied caller at submit; exact-self may use its caller proof.
3. Other targets retain strict explicit-provider target proof.
4. Current controller/home/member/config/old-binding generations and common lease remain enforced.
5. Current tests cover one-field mismatches, inherited/extra/malformed properties, wrong parent/birth/inherited context, stale provider/epoch/incarnation and no idle-other fallback.

Real idle self selection was offered once per panel and both binding operations succeeded. No title-based identity or fabricated registry/ticket data was supplied.

Only authorized product-fixture update after failure: `hooks/shared-workspace.tsx`, SHA256 `98f15c0c26ce55e97d610f643079fda4d884701aca745c1feace493b1eb7213c`, equal to the authoritative repair-hash file. Original fixture file retained as workspace-before-repair.tsx. No core store/API/native module changed for this repair, so the independent 222-case engine result remains applicable.

## First failure and recovery

The tester focused prefilled workspace-member-official-1 and sent Ctrl+A, Ctrl+K and plain ASCII role text as one native terminal text event. The host settled the change, then refused the entire render:

```text
Input "workspace-member-official-1" value holds a control character
```

The exact stored offending code point is unproven. U+0001 and U+000B were the transmitted editing keys; native key handling/test-sequence cause was not established. Do not describe this as a proven native keyboard bug.

The repair flattens CR/LF/tab and removes other terminal controls at input/render/submission, preserving readable Unicode. After ordinary source hot reload, the original readable default plus appended instructions reappeared. No atom deletion, conversation reset or approval/store-data reset occurred. The original FIRST-LIVE-FAILURE.md and prior artifacts remain unchanged.

An earlier helper failed to focus Create; an unconditional subsequent Enter opened Session Panel Settings, not team creation. That action is not creation evidence. All counted mutations after repair used successfully located native focus before Enter and stopped on focus failure.

## Actual panel lifecycle

Fresh project: this root's live-project.
Team name: Workspace045Live. Purpose: Bounded real panel acceptance.
Two default boss-first members: Head and Worker. Windows/capacity remained editable documented form defaults: pickup 2 minutes, answer 3 minutes, task window off, replay 1000ms, capacity 8. No migration-default decision is inferred.

| Fixture | Conversation | Native handle |
| --- | --- | --- |
| Head | 13310975-768e-4b52-8367-93d5e08045ed | term_12125f3e-74a0-421c-ba95-0588e176bcf6 |
| Worker | 72683442-5b70-4595-860b-26ae5bdf876f | term_11d29cd4-414a-4ba2-a9e9-bd81e6694240 |

Each controller approval came from the actual panel button as authorized simulated-user fixture action, not a model field or unrelated question answer. Worker approved itself separately to exercise exact idle self-binding rather than relaxing other-target proof.

Head created the team through actual fields/button, selected its own verified conversation, and Worker used its own panel to bind the other member to itself. Roster Bound states and final API binding rows agree.

Head assigned through the task form. The worker refreshed Tasks, opened the task and picked up through the button. The actual role/task/expected-result UI was captured in worker-role-brief-visible.json. The model then Read that exact tester-captured panel snapshot, stated its role/brief requirements, and only afterwards ran fixture work. This snapshot delivery was test-harness communication; UI drawing alone is not model comprehension evidence and no automatic transport is claimed.

Fixture result:
- Exact first line: `Workspace panel acceptance fixture.`
- Whitespace-separated words: 12.
- 2 lines, 85 bytes.
- SHA256: `01faf5d0dc019f6aa682b79df16088142a9d103797605684bcd5458a8ddc485d`.

Worker reported measurements as text only. Tester entered that measured summary/evidence in Worker's actual panel fields and activated Report succeeded. The model did not execute lifecycle mutations through shared_team.

Head Read its actual review-panel snapshot and used permitted inspectCaller/inspectTeam read commands. The before-acceptance projection showed task open, attempt succeeded generation 3, acceptance null. Head stated the evidence matched the independent expected fixture values. Tester then entered review reason and activated actual Accept outcome. Final read projection shows task succeeded and separate acceptance by Head.

Task ID: bf027c0895cfd7d002133dcdbedfe584.
Assignment ID: 34abf5beed9dadedaae40f553b16b97a.
Head member ID: 8c64fb4e5d751d40b2336cf90498290d.

Final permitted API evidence: one discovered team, two bindings, one visible assignment, explicit attempt succeeded, separate accepted decision, task succeeded. Full raw table counts/operation-ledger duplicate counts were NOT independently inspected.

## Guards and evidence boundary

Installed Mod guard refused raw SQLite shell inspection even though intended read-only. That refusal was respected; no alternate shell/script/tool performed it. A request to Codex for raw counters was sent, then explicitly withdrawn before any confirmed inspection; Codex acknowledged it would not inspect or bypass the refusal. No raw counter result is used.

Typed API projections and actual panel results provide the accepted row/state evidence. Do not turn one visible work item into a whole-database exactly-once assertion.

Worker has no acceptance control by source/UI conditions and host tests. No valid-shaped new live self-acceptance tool probe was run here; prior schema-5 acceptance and current suite cover it separately. Live unknown receipt/commit/rollback injection was not performed. Pending-request pause, reconciliation and same-request retry are unit/API regression evidence, not a new live transport-fault observation.

No remaining product failure was observed in the completed bounded primary flow after the input repair.

## Native visual/navigation evidence

Actual owned-fixture PNGs, independently viewed:

| Artifact | Window | Evidence |
| --- | --- | --- |
| normal-roster.png | 2500x1380 | Actual selected Head fixture; team, Bound Head, Roster/Tasks controls visible; lower Worker card requires ordinary scrolling. |
| narrow-task.png | 1450x1120 | Actual selected fixture; succeeded Worker task and Open task visible with wrapped instructions and fold indicators. |

Native Tab/focus scrolling reached team-name creation field, capacity field, Roster/Tasks, and This verified conversation at approximately 60 columns. Snapshots: narrow-create-fields.json, narrow-capacity-field.json, narrow-self-choice.json, narrow-task-readback.json. Forms are long and require normal scrolling; simultaneous visibility of every field is not claimed. No hidden-handler API was called: keyboard input reached actual focus and Enter activated current buttons.

Orca was temporarily placed topmost/on the primary monitor for unoccluded owned-window captures; restoration command removed topmost and returned original bounds. No screenshots of another app are used as evidence. No global display setting changed.

## Retention and remaining limits

Retain both new Head/Worker fixtures, project/source/evidence and stopped own PostgreSQL data for inspection. Earlier schema-5 A/B/C, UI044 fixtures and unrelated sessions remain untouched. No session cleanup, global install/reload/config change, app restart, commit, merge, push or release by this tester.

No migration, scheduler/replay/delivery, automatic task-window fencing, worker launching, rejected-task recovery, Orca-plugin integration or whole-Orca restart accepted. Raw full-table/duplicate-receipt counters and live uncertain-transport fault behavior remain explicitly unverified.
