# Approval-view live retry — 2026-10-31

For independent acceptance after msg_6aade4f4a38f. The live failure is real; root cause was not proven solely by unit tests. The source patch removes slow native proof acquisition from repeated renders, makes Shared-store/approval event handlers await their work, and stops the unnecessary 300ms no-team animation while the shared view is open.

Copy these THREE runtime files from the authoritative repository into the existing isolated source-mod fixture (preserve its test-only manifest preview default):
- team-orchestrator/hooks/register.tsx
- team-orchestrator/hooks/shared-store.tsx
- team-orchestrator/types/index.d.ts

The changed unit file is team-orchestrator/hooks/shared-store.test.tsx. No shared/team-store or packaged Node module changed. No schema or authority requirement changed. Do not update installed/global plugin copies. Reload only the isolated scratch source session, or start a fresh isolated source session if the runtime cannot safely refresh it. Reopen /team and click Shared store again to acquire current display proof; do not reuse a stale held button handle. In Git Bash, protect literal slash commands with per-invocation MSYS_NO_PATHCONV=1.

Rendering now reads cached DISPLAY proof. The tab action first shows a verifying state, then acquires current native proof. Approval must freshly revalidate the exact displayed project/conversation/terminal/context, and the private child independently verifies native identity again. Cached display data cannot grant controller authority. The approval button awaits completion instead of detaching its asynchronous work.

The complete Mod suite now passes 366 cases, 0 failures, 38 files, 35.98 seconds. The new regression opens Shared store then redraws it repeatedly and verifies no further process calls. Existing tests still prove approval is created only on the specific panel action and forged model fields cannot choose private approval/proof. Manifest/hooks validation passes with the previously documented metadata/directory warnings. Raw evidence: %TEMP%/team-api-mod-ui-fix-tests.log and %TEMP%/team-api-mod-ui-fix-validate.log.

This needs the actual live retry; do not count the patch as accepted until the real approval screen opens and the rest of the workflow succeeds. Please send the first retry result promptly. No ticket should be hand-forged, and no proof check should be weakened.

Separately: the Orca-plugin pre-submission recovery race is fixed and its final build passed all 35 browser cases, 657 domain/bridge/unit cases (3 skips), 31 focused native-launch cases, and all three pinned-host checks. See VALIDATION-SCHEMA-5.md. This separate change does not affect the Mod approval retry.
