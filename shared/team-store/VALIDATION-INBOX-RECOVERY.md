# Inbox recovery and native controls: development validation

This extends development checkpoint `8a3eb3a` on `feat/shared-team-runtime`. It remains an unreleased increment; this report is not native live-team acceptance.

## Changes

- Saved API results are checked against current recipient/member and reporting scope before replay. A previously successful controller approval cannot report success after revocation. Rebinding a conversation to another member cannot recover the previous member's message.
- Automatic prompt ingestion stages each read in the existing machine SQLite store before the shared read. After interruption it reconciles that exact operation, including a verified same-conversation/same-member rebind. Uncommitted stale stages are retired; current state is staged under a fresh operation id. Terminal threads and old consumer generations cannot be revived by recovery.
- Recovery receipts remain pending until the model confirms the exact receipt through `shared_inbox_seen`. This avoids treating turn start as proof that a prompt hook's context reached the model. `shared_inbox_read` provides the same recovery path when native same-module hook reentry skips automatic attachment.
- The Inbox tab uses a native card and buttons. Its explicit preview shows sender/type without acknowledging. Read in conversation submits a short prompt; the message body comes through the reader tool. No schema, protocol or raw JSON wall is inserted into the visible prompt.
- The head can select a connected direct report and reassign a returned unpicked task. It creates a new linked attempt and keeps the predecessor history. The roster summary distinguishes tasks from attempts.

## Verification

The SQLite + real PostgreSQL suite passed 246 tests with no failures or skips in 48.26 seconds. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-runtime-pg-rEtAD7/suite.log`. Its disposable PostgreSQL server was stopped after the run.

The Mod suite passed 427 tests across 45 files in 30.52 seconds before the final state-declaration check. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-runtime-inbox-reassignment-tests.log`. Plugin validation then caught a missing `sharedMail` declaration in the state contract; that declaration was added. The final runtime-equivalent source is rerun before this increment is committed; its result is recorded below.

Syntax checks and source/packaged parity verified all 18 shared modules. Plugin validation passed after the state-contract repair, with existing directory metadata warnings. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-runtime-inbox-validation-final.log`.

The first Mod run in this increment had one existing crypto timing failure (6.767 seconds against a 6-second bound); its new inbox tests passed. Subsequent full runs passed without changing that crypto code or threshold. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-runtime-inbox-mod-tests.log`.

## Boundaries

All database fixtures and machine stores were disposable. The real project store, installed plugin and global configuration were untouched. No native multi-session worker flow, whole-Orca restart, Docker, remote transport, or minimum Node 22.13 acceptance is established here.

Recipient-owned reads are implemented. The user's open choice about head inspection/acknowledgement still needs an answer before broader inbox policy is finalized. Schema-5 rejected-outcome retry, question/answer deadlines, task expiry, gate application, hosted Mod configuration, legacy migration and Orca-plugin integration remain outside this increment. The existing historical checkpoint reports are preserved.

Final Mod rerun: 427 passed, 0 failed, 45 files, 39.15 seconds. Evidence: C:/Users/Herman/AppData/Local/Temp/team-runtime-inbox-freeze-tests.log. Validation and packaging checks passed on this frozen increment.
