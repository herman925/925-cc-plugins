# Codex shared-writer release repair

Release: **team-orchestration-925 0.1.6**, shared schema 8 and Mod 0.5.57 unchanged.

## Confirmed live defect

On 2026-11-05 the real Orca-hosted Codex conversation exposed all eight team tools. Its first `shared_team_status` call returned `STORE_WRITER_TOO_OLD`: the adapter's hardcoded `team-orchestrator` writer version was 0.5.56 while the existing project required 0.5.57. This was an adapter release-metadata defect, not a failed MCP connection. No team was created or edited through that refused call.

## Repair

The deterministic shared-runtime packager generates `src/runtime-release.mjs` from the Mod manifest. The production Codex adapter defaults to that packaged writer identity; its entry point no longer supplies a separate hardcoded version. MCP initialization also reports the shared implementation release and the current package name. The Codex plugin release number remains separate from the writer-family implementation release.

`sync-shared-store.mjs --check` refuses a stale generated release before checking the two runtime copies. Existing writer/protocol/version guards are unchanged. A genuinely old client still fails after the newer client advances the fence; no recorded version is lowered, and runtime metadata is never inferred from the database.

## Verification

- Minimum Node **22.13.0**, SQLite and real PostgreSQL **18.6**: **388 passed, 0 failed, 0 skipped**. The disposable PostgreSQL instance was stopped afterwards.
- New two-engine regression: create an older fixture, edit through the current Mod-release API, read status and edit through the production Codex default, and verify that the older adapter remains refused and the recorded version stays current. Native identity/confirmation are substituted in this fixture; it is not a live-model acceptance run.
- Metadata checks compare the generated identity with the Mod manifest and both packaged copies. MCP wire initialization reports that identity.
- Native package install, seven-skill discovery, update, removal and pinned npx copy all pass in fresh temporary consumers, with zero model turns. All **45** runtime files match both packages.
- Syntax checks and `git diff --check` pass. The unchanged Mod UI suite was not repeated for this Codex metadata repair.

The current connected process still holds the old adapter until the installed package and owned project setup are updated and MCP reconnects. A successful post-update live status call, native hook review, real create/edit/connect and mixed-model task/meeting acceptance remain pending. Do not report the fixture passes as those live results. No CEO testing handoff was made.
