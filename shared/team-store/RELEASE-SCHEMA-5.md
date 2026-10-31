# Schema-5 preview publishing notes — 2026-10-31

Herman authorized merging related work and pushing it so the plugin updates can be tested. The existing guardrail and Windows-native-path branches are already ancestors of main. The new shared-store implementation, question guidance and Orca launch-race repair are integrated together. Unrelated JEV-router/clean-view branches and superseded research branches are excluded.

Versions: Team Orchestrator Mod **0.5.43**, Session Panel **0.3.65**, Orca plugin **0.1.25**. The standalone shared package remains private, not an npm publication. The original independent acceptance used source Mod 0.5.42; its report is preserved unchanged. The publication delta bumps version metadata, rebuilds the Orca bundles and documents installation. The shared-store runtime logic remains identical to the accepted source.

## Update and test the Mod

Run these in a terminal:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
claude plugin update session-panel@herman-mods
```

Run `/reload-plugins` in the Claude Code session to test; for an existing legacy team, reload the top first. Confirm Team Orchestrator **0.5.43** and Session Panel **0.3.65** in their headers.

For the new shared-store flow, use a fresh disposable project and Node 22.13 or newer. Enable **Shared store preview** in `/config`; set **Shared store Node command** to an absolute executable path if `node` is not available. Open `/team` → **Shared store** and approve the displayed project/conversation. The model can then use `shared_team` for fresh-team creation, native binding, assignment admission/pickup, outcome reporting and separate head acceptance. All required settings/generations are explicit. The preview does not launch workers or migrate an existing team; sessions must already exist and target binding needs fresh explicit native identity evidence.

The real idle-caller approval path is verified on Windows. Other hosts refuse missing native conversation proof until their process-creation fingerprint formats are verified. Do not use a production team's old store as a scratch fixture.

## Update and test the Orca plugin

Pull the published main branch and update/reload the plugin from the repository's `team-orchestrator-orca-plugin` directory using Orca Settings → Plugins. Confirm **0.1.25**. Self-contained `main.mjs`, `panel.html`, `runtime-adapter.cjs` and `claude-statusline.cjs` are committed; no source patch or separate helper installer is needed.

The Orca plugin still uses its existing native lifecycle/store. Schema-5 shared-store integration there, existing-store migration, inbox/replay/scheduler/gates and whole-Orca restart acceptance remain outside this release. No global install, automatic reload or retained-session restart is performed by publishing.

## Publishing verification

The versioned build passes Mod validation and 366 tests; Session Panel validation and 310 tests; 119 shared-store SQLite tests (6 PostgreSQL skips); 657 Orca-plugin tests (3 skips); all three pinned-host contracts; and both focused browser regressions (multi-lead launch and bound terminal navigation). All 16 packaged shared-store modules match the accepted source. Logs are preserved under `validation/publish-2026-10-31/`. The independent complete two-engine run of the same shared runtime passed 217 tests; see [the unchanged independent acceptance report](INDEPENDENT-ACCEPTANCE-SCHEMA-5.md).

The first Orca unit command used the repository root; its relative build fixture could not resolve `src/worker.mjs`. Rerunning from the plugin directory passed all 657 tests without a source change. Archived historical `.patch` files retain required blank context-line spaces; normal source diff checks pass, and archived patch checking allows those context spaces.

The already-included implementation refs are `guardrails/briefing` (`71eb688`), `guardrails/team-orchestrator` (`fa8fd59`), `fix/windows-native-path` (`473b8e6`) and `backup/pre-merge-fdc640b` (`fdc640b`). None adds a missing commit to main. Old research/spec snapshots and the older Session Panel 0.3.54 branch are not used to replace the current implementation. The standalone draft under root `docs/validation/` remains outside this integration.
