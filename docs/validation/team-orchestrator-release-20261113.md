# Team Orchestrator release review — 2026-11-13

Release: **Claude Mod 0.5.62 / Codex 0.1.12 / schema 11 / writer protocol 2**. [PR #204](https://github.com/herman925/925-cc-plugins/pull/204) incorporates the already-merged branch ancestry of draft PR #199; #199 needs no separate merge. The separate Orca plugin stays at 0.1.25, and Hermes shared-runtime integration is pending.

## Checks on the final executable source

| Check | Result | Evidence |
| --- | --- | --- |
| Full common suite, SQLite + real disposable PostgreSQL, Node 22.13.0 | **708 passed, 0 failed, 0 cancelled, 0 skipped** | [Full TAP](team-orchestrator-release-20261113/common.tap) |
| Claude Mod SDK/UI | **474 passed, 0 failed**, 48 files | [Log](team-orchestrator-release-20261113/mod.log) |
| Native identity and public-source guard regressions | **18 passed, 0 failed, 0 skipped** | [After](team-orchestrator-release-20261113/guard-after.tap), [reproduction before correction](team-orchestrator-release-20261113/guard-before.tap) |
| Shared runtime packaging | **86 matching files**, both packages | `node team-orchestrator/scripts/sync-shared-store.mjs --check` |
| Repository patch hygiene | `git diff --check` passed | Final release preparation |

These are separate runs, not an additive test total. The full suite ran after both guard corrections and all prior managed-lead/discovery/newline changes. Its wrapper reported that its own disposable PostgreSQL cluster was stopped. [Artifact SHA256 values](team-orchestrator-release-20261113/hashes.json) preserve the exact recorded bytes. No GitHub checks were configured on #204 at review time. Claude's manifest validator passed with its existing missing-author warning. Docker was not exercised.

The review reproduced two defects before fixing them:

- When Orca host proof was unavailable, an OS-verified Codex conversation which had never joined a team lost ordinary tools. The guard now uses a narrowly scoped, OS-verified read-only membership projection. It can establish absence, never grant a binding or team API authority. Team calls still require full host proof; stale/reserved member restrictions remain enforced. Invalid thread ownership is refused.
- A checked public-source patch mentioning the private provider directory in a comment was refused. The checked source-edit exception now runs before that content check; actual writes to the private provider directory remain refused.

Both corrections are included in both packaged runtimes. No actual project hook, configuration, team database, controller approval or existing session was changed during release review.

## Implementation and acceptance boundaries

This release includes one dispatcher for reviewed owned Claude/Codex sessions, provider-neutral readiness, tracked two-way inbox turns, optional new-team managed leads, reviewed native question/permission relay, full-runtime compatibility checks, explicit backed-up upgrades and the prior meeting/migration/hosted-reference foundations. See the [feature and update guide](../UPDATING-TEAM-ORCHESTRATOR.md).

[Prior native evidence](owned-claude-managed-lead-20261113.md) records both mixed-provider directions using actual native CLIs and deterministic loopback model responses, synthetic fixture creation/launch grants, separate worker outcome/head acceptance, and native proposals left unanswered. It does not establish real human approval, real-model reasoning, positive live Codex hook trust, project-hook compatibility, native mixed meeting/replay acceptance or long-wait/lost-owner/viewer recovery. Those limits remain open on the Wayfinder map.

Original Orca terminal auto-input remains blocked without its host target fence; explicit new managed teams can use reviewed owned connections from an Orca controller. Existing conversations are not adopted automatically. Full owned creation/review uses the Codex workflow; Mod panel parity, hosted onboarding and classic migration clients are unfinished. Package updates do not activate old pinned runtimes, upgrade stores, grant authority or launch workers.

## Update-path verification

The native Codex plugin installer was exercised in a disposable process-local `CODEX_HOME`, without changing the user's actual configuration. Before merge, normal main installation reported **0.1.11**. The same fixture is retained for post-merge marketplace refresh/reinstallation verification, whose readback will be recorded on the merged PR. A first fixture with a long temporary root hit Windows Git path-length limits; the successful fixture used a shorter root. This is an installer-fixture limit, not evidence of a team/runtime failure.

Claude update command syntax was checked against the installed CLI help; its manifest validates. No real global plugin update, project runtime apply or store upgrade was performed. Follow [the update guide](../UPDATING-TEAM-ORCHESTRATOR.md) separately for each installed client and project.
