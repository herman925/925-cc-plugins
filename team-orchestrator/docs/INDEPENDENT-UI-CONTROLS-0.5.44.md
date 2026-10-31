# Independent UI-controls acceptance — 0.5.44

Date: 2026-10-31. Scope: bounded isolated UI acceptance, not a lifecycle rerun.
Evidence root: `C:/Users/Herman/AppData/Local/Temp/ui044-ceo-M0Ztcp`.

## Verdict

Functional controls passed after the disclosed boolean-save repair. Real native approval and friendly Approved status passed. Normal-width compact controls passed visual review. Full narrow-layout acceptance remains limited: at 60 terminal columns, Connection/Details require scrolling. Do not claim all controls fit without scrolling.

## Evidence layers

| Check | Actual result | Evidence |
| --- | --- | --- |
| Default preview | Manifest remains false; visible OFF state | shared-off-screen.json |
| No slash commands for navigation | Real band-settings and tab-shared keyboard/button handlers opened pages | ui.debug.log, settings-off-screen.json |
| Initial On | Failed; CONFIG_SAVE_FAILED / Option was refused; canonical option absent | on-failure-details.json |
| Repaired On | Real UI saved boolean true in canonical isolated plugin options | on-retry-options.json, on-retry-screen.json |
| Off | Real UI saved boolean false | off-options.json, off-after-toggle-screen.json |
| Toggle side effects | No team/store/ticket in isolated persistence project | final-functional-check.json |
| Node draft | Typing did not persist; no draft execution | node-draft-screen.json, ui.debug.log |
| Node Save | Exact `C:/Program Files/nodejs/node.exe` saved; spaces preserved | options-after-save-tests.json |
| Node invocation | Actual Check access used that executable as argv[0], no shell | ui.debug.log at 13:39:59 |
| Failed Orca Save | Direct existing validator refused missing executable; prior canonical `orca.exe` unchanged | invalid-orca-save-final.json |
| Persistence | Options survived actual plugin.json-triggered reload; Off and exact Node/Orca remain | narrow-current-screen.json, final-functional-check.json |
| Isolated Check access | Correctly refused missing native agent-status association | approval-native-snapshot.json; check-access-screen.json |
| Authenticated model tool | Real shared_team inspectCaller returned STORE_NOT_FOUND in fresh auth project | auth.debug.log / primary transcript |
| Authenticated UI Check access | NEEDS APPROVAL; unavailable fresh store treated as unapproved | auth-needs-approval.json |
| Explicit Approve | Actual button generated scoped ticket and atomic receipt; one unrevoked controller, zero teams | auth-approved-db.json |
| Friendly status | APPROVED appears without raw JSON by default | auth-approved-screen.json |
| Details | Real Details handler reveals diagnostics/identifiers on demand | auth-details-real.json, compact-details-expanded.json |
| Independent full Mod suite | 373 passed, 0 failed, 38 files; 20.90s on final source | final-mod-tests.log |

## Repairs and source provenance

New source copy; retained schema-5 A/B/C copies were not changed.
Initial source manifest 0.5.44 preview default=false was preserved.

1. One-file functional repair: copied/hash-matched `hooks/register.tsx`, SHA256 `338fc662ed99d1427a2b265d010b0423833cbab874b47a247e7a6a109b404266`.
   The original UI sent String(true) to a boolean option. Native own-plugin config hooks are skipped, so direct Orca validation was also required. The actual On retry then persisted a boolean and invalid Orca Save retained prior effective value.
2. One-file layout repair: copied/hash-matched `hooks/shared-store.tsx`, SHA256 `32be4766b11eed63324cf0cb3133a49c7e36feb01139879e3473b7588ddfc5bd`.
   Compact status/options/access card replaces the initial three-card layout. Existing actual approval was read back; no duplicate approval submitted.

Core packaged store/native/API modules were not modified by this UI acceptance.

## Configuration/authentication separation

Persistence fixture uses owned `config/` through CLAUDE_CONFIG_DIR. It contains no copied credentials. Only a non-secret onboarding-complete flag was seeded in its own .claude.json after normal first-run setup stopped at login. Workspace trust stayed in the owned fixture. The optional trust question was withdrawn as unnecessary; no question answer is approval evidence.

The isolated fixture cannot authenticate a model turn and lacks a matching Orca agent-status tab association. The strict private verifier correctly refused; no proof check was weakened.

A separate NEW auth-project uses existing normal authentication with fixed per-invocation source options and explicit Node/Orca paths. No option Toggle or Save action occurred in that authenticated fixture. Real settings.json and installed_plugins.json hashes match the starting baseline after approval and at final check. No credentials were printed/copied or changed.

Both approvals/testing identities are separate from retained A/B/C and real repository authority. Only auth-project received the actual UI-generated controller approval. No team was created.

## Actual visual evidence

Accepted PNGs, independently viewed:

| PNG | Window | Measured terminal readback | Result |
| --- | --- | --- | --- |
| normal-settled.png | 2500x1380 | 131 columns | Approved status, project, On/Off, Check access, Connection and Details visible. Lower supplementary content/Session Panel can remain folded. |
| narrow-settled.png | 1450x1120 | 60 columns | Status/project/On-Off/Check access visible. Connection/Details below fold; up7/down17 more. Narrow full-control visibility is not accepted. |

Screenshots came from the actual selected Orca fixture window, made temporarily topmost on the primary monitor to avoid overlapping apps. Window position/size and topmost flag were restored afterwards. Right sidebar was hidden for capture; that app UI layout change is not product configuration.

Rejected local capture attempts include compact-normal.png, compact-normal-window.png, early computer-use screenshot paths and other occluded/clipped/black captures. They are harness failures, not accepted UI screenshots. Do not publish or copy wrong-app captures into repository evidence.

## Actual versus unit-only limits

The actual isolated persistence fixture could not invoke model tools because model authentication is unavailable there. Effective disabled-tool refusal and existing shared-member/raw-store guards while Off are covered by the independently rerun native-hook unit suite, not a new fully live bound-member Off run. No existing A/B/C team was altered to obtain that evidence.

Unknown/uncertain approval retry gating was exercised by the unit suite, not forced through a live transport fault in this bounded UI run. The actual native Check access failure kept approval unavailable, and successful auth-project approval received a confirmed receipt.

Repeated-render no-native-I/O behavior is covered by the suite's explicit redraw regression; general roster/status timers still perform their own existing work. No claim that every session process is silent is made.

## Harness issues retained

Keyboard input once appended `node` to a draft and once placed missing-Orca text in the prompt after a hot reload changed focus. These were tester input errors, not save/validation evidence. Corrected through exact focus readback and field editing before the counted save tests. A later helper navigated by actual ui.focus logs. No slash command was used to reach Settings or Shared store.

The initial missing-Orca pre-repair action is not counted as validator proof. Only the final real field/save action and its validator error establish the repaired behavior.

## Retained inventory and preservation

| Resource | Handle / location |
| --- | --- |
| Isolated persistence UI session | term_ffed5731-2377-46c7-9192-d7799f43065a |
| Authenticated access-only UI session | term_7dcc0fb7-1bd4-49d1-9649-140133a86d84 |
| Owned narrow-layout empty shell | term_0f95526d-f0b5-423c-be41-44549a32e96e |
| Source/config/projects/evidence | this evidence root |

Prior A/B/C and original schema-4 resources remain untouched. No retained session was closed. No broad lifecycle rerun, migration, commit, push, global installation, credential copy or real option mutation occurred. Product source edits belong to Codex; acceptance changes are isolated fixture copies/scripts only.
