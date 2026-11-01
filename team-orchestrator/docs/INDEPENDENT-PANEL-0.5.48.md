# Independent right-panel 0.5.48 acceptance

## Recommendation

Accept the bounded panel/navigation increment on the frozen close-warning repair, local implementation commit 48853da as reported by Codex. No confirmed blocker remains. This is a test recommendation, not publication authorization.

Evidence root: C:/Users/Herman/AppData/Local/Temp/panel048-ceo-6pdo7C
Report: C:/Users/Herman/AppData/Local/Temp/panel048-ceo-6pdo7C/FINAL-RIGHT-PANEL-048.md
Original handoff: msg_c922c7c4e956. Repair handoff: msg_e0c6057ed113. Coordination thread: msg_b6ef7d3f9b81.

## Independent measurements

| Check | Result | Evidence |
|---|---|---|
| Initial frozen suite | 402 passed, 0 failed; 42 files; 27.93 seconds | tests.log |
| Narration-corrected final suite | 402 passed, 0 failed; 42 files; 29.59 seconds | final-tests.log |
| Close-warning repaired suite | 403 passed, 0 failed; 42 files; 27.19 seconds | close-fix-tests.log |
| Final runtime identity | All 5 hashes match team048-close-fix-hashes.json | close-fix-hashes.json; independent final comparison |
| Validation | Passed with existing metadata warnings | close-fix-validation.log; directory-submission metadata checks remain separate |
| Packaged store parity | 16 modules verified | sync-shared-store.mjs --check |
| Fullscreen placement | Actual right dock, bodyColumns 66 | Native screen and read-only render event |
| Fullscreen host facts | placement:dock; viewport columns:184, rows:47, isFullscreen:true | final-actual-dock.json; fullscreen.debug.log; final-native-facts.json |
| Classic placement | Actual inline pane with explanation | classic-fallback.json |
| Classic host facts | placement:inline; bodyColumns:247; viewport columns:251, rows:47, isFullscreen:false | classic.debug.log |
| Repair regression | 0 new ui.render hook-skipped warnings after repair | New debug window and fresh repaired process |
| Protected globals | 2/2 hashes unchanged | global-baseline.json; final comparison |
| Window geometry | Before/after bounds identical | window-before.json; window-after.json |

The actual fullscreen render viewport reports 184 columns beside the 66-column dock. The complete terminal screen spans 251 cells. These are separate measurements; neither is inferred from isPlaced:true.

## Frozen source sequence

1. Copied an independent source-mod snapshot. Verified all five original candidate hashes.
2. Received the final b3f821d narration correction.
   2.1 Proved that reversing the single 'Team Orchestrator opened' string change reproduces the original register.tsx bytes exactly.
   2.2 Preserved source-initial-preserved and explicitly overlaid the final file. Verified all five final hashes.
3. Reported the real native close warning before changing the snapshot.
4. Received Codex's frozen close repair.
   4.1 Preserved source-before-close-fix.
   4.2 Copied only repaired register.tsx and its updated navigation.test.tsx regression.
   4.3 Verified all five close-fix runtime hashes and independently ran 403 tests.

Tester did not edit product implementation. Scratch launchers, observation code and native input helpers are separate from source-mod.

## First failure: infrastructure, not a test failure

The initial background command returned exit 1 after tests, validation and packaging completed. Its last operation refused:

```text
runtime_error: Not a valid git repository: C:\Users\Herman\AppData\Local\Temp\panel048-ceo-6pdo7C\project
```

The fixture directory was empty and lacked Git metadata. Initialized only that owned disposable project and repeated registration successfully. No global or real-project change followed. Codex received checkpoint msg_2e4444e17d91 with the exact distinction.

A combined startup Down+Enter input selected Exit before the native selection settled. Relaunched only the owned fixture. Separate Down, visible selection readback, then Enter trusted the owned project. This was authorized simulated-user fixture setup, not approval for any team or real project.

## Native execution

### Actual right placement

Used isolated CLAUDE_CONFIG_DIR and per-invocation tui:fullscreen. Did not run /tui fullscreen or save a real renderer setting. The fixture loaded source-mod through --plugin-dir, with installed Team Orchestrator disabled in that invocation.

The native screen shows the transcript left and one Team Orchestrator body right. The band contains only compact navigation and Edit inline. A separate read-only observation plugin logs the actual ui.render placement/viewport, ui.open request and ui.close origin. It passes every event through unchanged and invokes no action handler or state mutation.

The first observer was loaded after the product's consuming render hook, so it initially observed open/close but not Pane rendering. A fresh repaired fixture reversed plugin order. It then observed placement:dock and isFullscreen:true. The fresh classic fixture observed placement:inline and isFullscreen:false. No product routing was modified to obtain these facts.

### Draft, view switches and one body

1. Opened Create team from the compact band in the original fullscreen fixture.
2. Focused the real pane field and typed Panel048Kept.
3. Advanced to Members. Clicked the host's native frame X, not the Mod's x Close button.
4. Observed the pane disappear and Continue setup appear in the compact band.
5. Reopened. The body docked right and retained Members step.
6. Used Back. The Team name remained Panel048Kept.
7. Switched setup → Settings → Connection → shared workspace Off → draft.
   7.1 Each view occupied the same right-side team-dock body.
   7.2 No second setup body appeared above the prompt.
   7.3 Shared workspace stayed Off. No approval, creation, binding or task action occurred.
8. After the close repair loaded, selected actual Edit inline.
   8.1 The native dock closed. One full body appeared inline with Dock right in the band.
   8.2 Switched inline Settings → draft. Panel048Kept remained.
   8.3 Selected Dock right. The same draft returned to one right pane.
9. Repeated native frame X and reopen after the repaired reload.
10. Repeated native frame X/reopen and Inline/Right in a fresh repaired fullscreen process without historical warning text.

Evidence includes members-before-close.json, native-x-closed.json, reopened-members.json, reopened-name.json, settings-right.json, connection-right.json, shared-right.json, repaired-inline.json, inline-settings.json, repaired-right-return.json, repaired-x-closed.json, final-actual-dock.json and fresh-inline-clean.json.

Draft member IDs and pending operation identity were not inspected live. The final suite covers state preservation. No pending mutation was created for this increment.

### Confirmed native defect and repair

Before repair, native frame X successfully closed the pane, but the transcript reported:

```text
team-orchestrator: ui.render hook skipped: threw HooksError: team-orchestrator: the on("ui.render") hook returned no result
```

Sent exact reproduction and source location to Codex as msg_d01ff6584c3d. Codex confirmed the inactive Pane null return as a presentation defect and replaced it with a resolved empty Box. The obsolete setup pane received the same empty-body handling. No store, authority or placement behavior changed.

Verified watched reload at 08:27:57Z before new actions. Inline teardown occurred at 08:28:45Z; native X person-close occurred at 08:29:30Z; reopen followed at 08:29:43Z. The later debug window contains zero new ui.render hook-skipped warnings. The historical warning remains in the original transcript and was not treated as a fresh failure or removed.

A fresh repaired fullscreen process then reproduced native close/reopen and explicit Inline/Right with no warning in its transcript. Read-only observer confirmed person-origin team-dock close and subsequent dock rendering. This supplies fresh native proof beyond suppression of repeated historical error text.

### Classic host fallback

Launched a separate owned process with per-invocation tui:default. Opened Settings through the native band. The host placed one inline pane while Right panel remained selected.

The visible message explains the classic renderer, fullscreen/110-column requirement and /tui user-wide save/restart effect. It does not claim successful docking. Actual event facts report placement:inline and isFullscreen:false.

This measures the requested classic-host alternative. No narrow-fullscreen resizing or unplaced-pane fault injection was needed. Narrow/unplaced explanations remain final-suite evidence rather than fresh native claims.

## Harness limits and preservation

| Area | Status |
|---|---|
| Native input | Used actual terminal keyboard and mouse reports against visible controls. No hidden handler invocation. |
| Missed input attempts | Excluded. A first frame-X click landed one cell beyond the mark; corrected to the visible mark. Escape in a setup-focus helper closed the pane, so that attempt was not counted as Inline success. |
| Read-only observer | Separate scratch plugin; debug facts only; no config, state, store, process or action mutation. |
| Shared workspace | Off/unapproved presentation observed. Existing populated team selection was not exercised live. |
| Classic roster/form | No existing classic fixture was used. Final regression suite covers those routes; no team was created merely for layout coverage. |
| Narrow/unplaced | Host-test evidence only. Classic fallback was the measured native alternative. |
| Real user store | No raw DB read, approval, mutation, migration, deletion or cleanup. |
| Globals | No installation, reload, renderer preference or real settings change. Both protected file hashes unchanged. |
| Window | No move/resize performed. Before/after bounds match. |
| Prior fixtures/transcripts | No closure, edits or cleanup by this work. |
| Current fixtures | Three new owned terminal handles retained. |
| Publication | No tester commit, merge, push or release installation. |

Current fixture handles:

| Fixture | Handle |
|---|---|
| Original fullscreen, retained Panel048Kept draft | term_e8347f70-b6d3-4a8b-8078-568580ea30d1 |
| Fresh repaired classic renderer | term_62187c77-6735-4fec-a50d-d9cd8f16cfbc |
| Fresh repaired fullscreen render facts | term_2f562977-4060-41b2-9dce-56e1d4649821 |

The real repository still reports only the protected untracked .team-orchestrator/ and unrelated docs/validation/. Tester did not inspect or clean their contents.

## Exit scope

No new schema or lifecycle acceptance was required or performed. No approval/create/bind/dispatch, worker launch, delivery/replay/scheduler, migration, whole-Orca restart or release installation is claimed.

Conclusion: actual fullscreen right placement, one-pane view switching, native frame close/reopen and explicit Inline/Right retention are measured. The native close warning is repaired and independently verified. Final repaired suite: 403 passed, 0 failed. Recommend acceptance with the live-coverage limits above.
