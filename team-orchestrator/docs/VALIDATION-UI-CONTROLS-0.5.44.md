# Clickable controls validation — 0.5.44

The UI follow-up adds a Settings button in the closed band, an always-visible Shared store tab, saved On/Off controls, editable Node/Orca fields, friendly access states and expandable diagnostics. The preview remains off by default. Core shared-store modules, database schema and native verifier are unchanged. The tool catalogue is registered at startup; current enablement gates each call, while existing shared-member and store guards stay enforced when Off.

## Local checks

- Current full Mod suite: **373 passed, 0 failed**, 38 files, 24.49 seconds after the compact layout patch.
- Manifest/hook validation: passed with existing directory metadata warnings.
- Packaged shared-store runtime: all 16 modules match the accepted source.
- Diff checks: passed.

Logs are under `validation/ui-controls-0.5.44/`. New behavior checks cover real-type boolean configuration inputs, refusal preserving effective settings, draft versus saved executable paths, direct Orca validation without own-hook re-entry, no implicit controller approval, collapsed receipts, uncertain approval readback and guards while Off.

## Independent live checkpoints

Tester: CC Plugin CEO. Evidence directory: `C:/Users/Herman/AppData/Local/Temp/ui044-ceo-M0Ztcp`. Herman was notified before every testing handoff. Existing retained A/B/C and installed plugin copies were preserved.

The first fixture uses an isolated `CLAUDE_CONFIG_DIR`, no copied credentials and the actual source manifest default false. Native Settings and Shared store open with buttons, without slash commands. This fixture verifies canonical option persistence without changing real user options. Its missing authenticated/native agent association correctly refuses access verification; this is not treated as approval evidence.

`msg_3fff2c2d438a` confirms the repaired On action saves a boolean true, preserves the Node executable path with spaces, and creates neither store nor ticket by toggling. `off-options.json` records the later canonical false. Invalid Orca Save invokes the existing validator directly and leaves `orca.exe` saved. Options survive a real source-plugin reload.

A separate authenticated fixture uses only a temporary per-invocation settings file, with preview enabled for that invocation. It does not click persistent option controls. Actual `shared_team.inspectCaller`, Check access and the explicit approval button succeed through the native verifier. One controller and atomic receipt are recorded, with no team created; the main view shows Approved, while Details reveals the receipt on demand. `msg_2069dde049d4` also independently reproduces 373 test passes and reports unchanged real settings/install-record hashes.

## Failures found and repaired

1. Registering the catalogue from an ordinary toggle callback was unavailable in the test host. Registration now happens once at startup; the runtime flag gates use without a reload.
2. Actual On was refused because the helper supplied string `"true"` to a boolean config row. The live generated SDK confirms typed boolean values and that a plugin's own config hooks are skipped for its own setter. The repaired helper sends a boolean, preserves denial reasons and invokes Orca validation directly. Tests now enforce those host semantics.
3. The first three-card layout pushed primary actions below the viewport. The compact UI puts toggles and actions before optional connection fields, displays a short project label, and retains the full proof path in Details. This layout delta changes no action or authorization logic.

## Visual evidence and scope

Actual terminal readbacks provide native control/layout evidence at the recorded viewport sizes. Clipped, occluded and wrong-window PNG captures are rejected as proof and excluded from repository assets. Later `normal-settled.png` and `narrow-settled.png` show the correct Orca fixture; Codex visually reviewed both. The compact status/project/On-Off/Check controls are visible. Images remain local, rather than publishing unrelated surrounding application chrome.

The [unchanged independent report](INDEPENDENT-UI-CONTROLS-0.5.44.md), received as `msg_ce558420ed7b`, records functional acceptance and normal-width visual acceptance at 131 terminal columns, with its initial narrow-visibility limit. The [subsequent narrow-workflow addendum](UI-CONTROLS-NARROW-ADDENDUM.md), `msg_3abc7bf96033`, verifies ordinary native Tab/focus scrolling visibly reveals and activates Connection and Details at 60 columns. The bounded narrow workflow is accepted with scrolling; all advanced settings/diagnostics need not fit simultaneously. Temporary window geometry/topmost changes were restored, canonical real settings/install-record hashes still match their baseline, and retained A/B/C remain intact.

The peer independently reran the final source: 373 passed, 0 failed, 38 files, 20.90 seconds. The final Boolean option snapshots, approval database readback, preservation/addendum checks and independent test log are preserved under `validation/ui-controls-0.5.44/`. No broad lifecycle rerun, schema migration, new Orca integration or whole-app restart is claimed for this UI follow-up.
