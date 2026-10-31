# Focused independent UI handoff — 0.5.46

Herman requested this correction and was notified before this handoff. Codex owns implementation; CC Plugin CEO leads independent verification. Repo `C:/Users/Herman/Downloads/925-cc-plugins`, branch `fix/team-panel-navigation`, base main `683bfaee81cae40a84d8211096e0d1ecf044e226`. Version 0.5.46 is not committed/pushed yet.

## Candidate

- Each of the four top tabs toggles closed on a second click; selecting another tab switches normally. Active tabs have a primary highlight. Shared close performs no native verification. The explicit Close and band arrow use the same panel visibility helper.
- Dock close actually closes its pane; a closed pane renderer does not substitute Roster. The band shortcut can reopen Settings in dock mode. No empty dock is opened on startup while view is closed.
- Band Settings shortcut is visible only while closed; open panels have only the Settings tab.
- With preview On, old New team and empty legacy quick starts are hidden. Empty roster offers Open shared workspace. The workspace is shown only for an approved controller or verified bound member; shared Create team remains controller-only. Preview Off retains the original creation flow without introducing shared approval there.
- Shared workspace is above expanded Connection details. STORE_NOT_FOUND is a friendly first-setup explanation in Details.
- Only runtime UI sources `hooks/register.tsx` and `hooks/shared-store.tsx`, plus manifest version, changed. Shared workspace implementation, native identity, bridge, core API/schema and all 16 packaged store modules are unchanged.

Local full suite:385 passed/0 failed,40 files,24.47s; validation passes. Five new meaningful host navigation/visibility cases. Older refresh helpers now avoid clicking an already-active Roster tab; original assertions remain. Logs/hashes under `docs/validation/navigation-0.5.46/` inside the Mod directory.

## Requested focused checks

1. Independently run the full Mod suite, validation and package --check. No PostgreSQL, full store suite, model fixture task or repeated lifecycle flow is needed for unchanged core.
2. Use disposable owned source fixtures with the candidate. Do not reload/update the installed user Mod or save real user configuration. No team creation or controller approval in the user's real repo is authorized. Preserve its new untracked `.team-orchestrator/` and root `docs/validation/` draft. Preserve all prior fixtures; new lightweight disposable fixtures are fine.
3. With preview Off, exercise all four tabs by actual native focus/keyboard or click: open, switch to another, then click the same active tab to close. Verify one Settings entry while closed and one while open. No legacy Create/launch action needs activation.
4. With preview On and a verified unapproved caller, confirm New team/quick starts are absent and Shared store has Approve controller without Create team. A bound/approved disposable fixture or the existing accepted source test fixture may confirm team controls remain usable and expanded Details follows them. This is navigation only; do not change roster/task/binding data unnecessarily.
5. Check dock close/reopen if supported by the actual host, and a narrow native layout (about60cols) for duplicated Settings and reachable tab buttons. Normal scrolling is acceptable. Do not invoke hidden handlers as UI acceptance. Stop a keyboard sequence if target focus fails; avoid the previous combined Ctrl+A/Ctrl+K input sequence.
6. Record exact coverage/limits in an immutable report at an absolute path, send its path/hash and measured results to Codex. Report any defect before changing product source. Copy only the necessary candidate files into an owned source fixture and verify recorded hashes.

No install/config edits, real-project approval, database inspection, raw counters, guard bypass, app restart, session cleanup, commit, merge or push is requested from the tester. Codex will publish related work after the focused evidence settles. Retain fixtures for inspection.
