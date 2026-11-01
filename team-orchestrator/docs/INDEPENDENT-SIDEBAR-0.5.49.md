# Independent sidebar 0.5.49 acceptance

## Recommendation

Accept the bounded sidebar redesign on frozen final3 runtime bytes. No confirmed blocker remains after the native label/input repairs. This is an independent test recommendation, not publication authorization.

Handoff thread: msg_33504e8e5f63. Initial candidate: msg_3ee582e8db64. Final3 repair: msg_80b16db7c900.
Evidence root: C:/Users/Herman/AppData/Local/Temp/sidebar049-ceo-z5Jc0j
Report path: C:/Users/Herman/AppData/Local/Temp/sidebar049-ceo-z5Jc0j/FINAL-SIDEBAR-049.md
Final identity: runtime-hashes-final3.json, copied from team049-runtime-hashes-final3.json. All six files independently match.

## Measured results

| Check | Result | Evidence |
|---|---|---|
| Initial SDK suite | 408 passed, 0 failed; 42 files; 36.68 seconds | tests.log |
| Setup-label repair suite | 408 passed, 0 failed; 42 files; 32.70 seconds | final-tests.log |
| Final3 SDK suite | 409 passed, 0 failed; 42 files; 36.76 seconds | final3-tests.log |
| Validation | Passed with existing directory metadata warnings | final3-validation.log |
| Packaged shared-store parity | 16 modules verified | sync-shared-store.mjs --check |
| Final runtime hashes | 6/6 match | runtime-hashes-final3.json and source-mod |
| Actual native placement | Right dock; isFullscreen:true | native.debug.log, read-only observer |
| Measured geometry | bodyColumns:68; viewport columns:182, rows:47 | Actual host render event, not isPlaced inference |
| Populated native fixture | 2 members, 2 connected, 2 inert task records | connected-members.json, two-task-selector.json |
| UI render faults | 0 hook-skipped/tree-rejection faults found | Native debug log |
| Protected globals | 2/2 SHA256 values unchanged | global-baseline.json; final comparison |
| Window bounds | Before and after match | window-before.json, window-after.json |

The product requests a 66-column dock. This host reported a 68-column body. Native acceptance therefore covers the actual approximately 66-column sidebar, not a claimed exact 66-column measurement. Saved host sizing can override the requested width. No window move or resize was performed.

## Native fixture and authorization

Created a fresh owned project and source snapshot. Used per-invocation tui:fullscreen and projectWorkspaceModes, with the installed Team Orchestrator disabled for that invocation. These declared overrides are fixture setup, not evidence of preference persistence. No renderer/global option Save occurred.

Used normal existing provider authentication without credential copying. The native panel verified the caller, then actual simulated-user Allow team management approved only the disposable conversation/project. Separate Create made Sidebar049Fixture. The native verified-self picker connected Head. A second fresh owned Claude process supplied a strictly verified Worker target. A separate Connect selected session action linked Worker.

No fabricated actor, ticket, private UI state, hidden action handler, raw database write or verifier workaround was used. Actual UI actions invoked the existing trusted bridge. The read-only observer records open/close/placement/viewport facts and passes events through unchanged.

Fixture handles:

| Fixture | Handle |
|---|---|
| Head/controller and rendered sidebar | term_8e5b628a-56ef-4347-8c5d-f3aeb1c60478 |
| Verified Worker target | term_1a8cb332-af9c-4664-b460-00071ff4482a |

Both remain present in the final terminal inventory. Retain them for inspection.

## Rendered layout and controls

### Header, access and member detail

1. The host displays one right-side body with a compact product header and short Team/Settings navigation.
2. Ready access initially collapses to project plus APPROVED · Access. The team selector appears before the toolbar.
3. Members shows one native selector and one selected detail, not a stack of member cards.
4. Opened the native member selector and used Down then Enter to choose Worker.
   4.1 Head detail disappeared. Worker detail displayed role, Reports to Head and Not connected.
   4.2 The sidebar still showed 1 connected member until the separate Connect action.
   4.3 Session dropdown selection likewise left the count unchanged before explicit Connect.
5. Worker connection then produced 2 connected members and the permitted Assign task action.
6. Expanded and collapsed Access through its visible control.
   6.1 Expanded state exposed workspace mode, Check access, Connection and Details.
   6.2 The validation notice 'Enter task instructions and an expected result.' remained visible after collapse.
   6.3 No settings-save, approval or mutation action was attached to the member selection itself in the inspected source/tests.

Live selection evidence consists of native keyboard events and rendered state/counts. Final SDK tests independently assert mutation boundaries. No raw operations-table audit is claimed.

Evidence: populated-first.json, member-dropdown.json, worker-selected.json, worker-choice-only.json, connected-members.json, access-expanded.json and access-collapsed-notice.json.

### Task preparation, selector and full detail

An initial model-driven attempt to prepare public typed fixture records stalled before shared_team execution. The screen reported:

```text
Waiting for API response · will retry in 3m 44s · check your network
```

A 90-second tui-idle wait timed out. Interrupted only that owned model turn. Did not retry the provider or investigate network infrastructure. No task record came from that interrupted attempt.

The initial normal Assign form exposed a real empty-input affordance defect. Its caption Text appeared, but the empty Input had no visible label or placeholder. Clicking the caption did not focus the field; attempted typing reached the composer instead. Empty submission only produced local validation. Codex repaired the shared input helper in final3.

Final3 native retry succeeded:

1. Actual Task instructions: Enter value and Expected result / acceptance criteria: Enter value controls were visible.
2. Clicked the labelled task field and typed a long ALPHA fixture brief.
3. Pressed Tab, then typed the expected result into the next native field.
4. Explicit Assign recorded the inert task. The sidebar confirmed 1 visible task.
5. Repeated the normal form once for BRAVO. The sidebar confirmed 2 visible tasks.
6. The newest BRAVO preview was selected after admission, consistent with the final2 selection-state repair.
7. Opened the task selector. It displayed member, Awaiting pickup and ALPHA/BRAVO instruction excerpts.
8. Used Down and Enter to select ALPHA. Separate Open task displayed the full detail immediately below the selector.
9. Verified both ending markers in native readback:

```text
INSTRUCTION-END-ALPHA.
EXPECTED-END-ALPHA.
```

The preview truncates, but opened instructions and expected result remain complete and readable. No list of all task cards precedes detail. Both tasks remain Awaiting pickup. No pickup, task work, worker outcome, head acceptance or automatic delivery occurred.

Evidence: assign-form.json and task-preparation-state.json preserve first failures. final3-assign-visible.json and final3-fields-typed.json show the repair. first-task.json, two-task-selector.json and full-task-detail.json show recorded tasks and full detail.

Outcome/evidence/acceptance rendering remains SDK-only coverage. Codex explicitly accepted this bounded native scope. No additional lifecycle exercise was needed to accept the selector/detail layout.

### Setup and retained draft

Initial candidate native editing exposed duplicated separators such as Team name: :. Codex changed the label to its bare caption, leaving the host separator.

On final3:

1. Opened a new draft without creating another team.
2. Clicked Team name: Enter value and typed Final049DraftKept.
3. Observed Team name: Final049DraftKept with exactly one separator.
4. Advanced to Members, closed through the host frame X, reopened, then used Back.
5. The single labelled field retained Final049DraftKept.

Evidence: final-label-edited.json and final-label-retained.json. Original double-separator evidence remains in setup-first.json and back-name-retained.json.

### Settings

Actual native Settings showed Display and Connection, without irrelevant classic-only controls in this shared fixture. Placement help expanded into readable fullscreen/110-column guidance and disclosed the user-wide /tui save/restart effect. Connection exposed project mode and Node/Orca controls. No Save was pressed.

Evidence: settings.json, placement-help.json and final-settings-connection.json. These are native navigation/readback checks, not proof that option saving works anew in this increment.

## Version and defect accounting

| Version | Change or finding | Independent treatment |
|---|---|---|
| Initial | Compact layout, duplicated setup separator; invisible task fields | Preserved original source and failure captures; reported promptly |
| Final label | Bare setup Input label | Copied team-setup.tsx and aligned navigation test; 408/0 |
| Final2 | Newly admitted task selects its own ID and clears old review fields | Copied shared-workspace.tsx/test; separate snapshot retained |
| Final3 | Shared scalar inputs gain native label and visible placeholder | Copied workspace/test; verified all six hashes; 409/0 and native typing/Tab/Assign succeeded |

Historical source copies: source-before-label-fix, source-before-selection-fix and source-before-input-fix. No tester implementation edits occurred.

The final2 old-review-state case remains regression-test evidence, not a full native old-outcome/acceptance scenario. Native admission did demonstrate the newly admitted BRAVO preview selected afterward.

## Harness faults and limits

1. The copied keyboard helper initially searched fullscreen.debug.log instead of native.debug.log and raised ENOENT. Corrected only the scratch helper.
2. Some text-label clicks hit captions or a heading rather than an action. Those attempts are excluded. Only subsequent confirmed button actions count.
3. A first input attempt left unsent text in the composer. It was never submitted as task work. Partial clearing did not remove every wrapped line; this is visible in retained captures, not hidden.
4. Native screenshots here are terminal screen captures plus structured render facts. No full desktop image was published or used as geometry proof.
5. Exact 66-column width, 100-task scale, duplicate-label suffix edge, removed selections, uncertain receipts, long evidence and member-only access are SDK coverage, not freshly measured native cases.
6. The separate Worker process served only as a verified connection target. It performed no assigned work.

## Preservation and exit scope

| Resource | Final state |
|---|---|
| Real repository .team-orchestrator/ | No raw read, approval, mutation, migration, deletion, commit or cleanup |
| Unrelated docs/validation/ | Preserved |
| Global settings/install records | Both baseline hashes unchanged |
| Renderer | Only declared per-invocation fullscreen; no global renderer changes |
| Window | No move/resize; final bounds equal baseline |
| Prior reports, fixtures and transcripts | No edits, closure or cleanup by this work |
| Current fixture data | One team, two connected members, two inert unpicked tasks; additional draft retained |
| Tester implementation/publication | No product edits, commits, merge, push or installation |

No schema/PostgreSQL/lifecycle acceptance was repeated. No scheduler, replay, migration, task delivery, worker execution, outcome acceptance, whole-Orca restart or release installation is claimed.

Conclusion: final3 repairs both observed native affordance defects. The compact member and task selector/detail layout works through normal native controls. Final3 independent suite: 409 passed, 0 failed. Recommend bounded acceptance with the stated live-coverage limits.
