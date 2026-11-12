# Completion work — 2026-11-08 development checkpoint

This continues Herman's instruction to implement all remaining lanes in [Wayfinder #2](https://github.com/herman925/925-cc-plugins/issues/2). It supersedes implementation-status statements in the earlier reconciliation, while preserving that audit's release evidence. It is not a claim that the whole roadmap is complete.

## Latest candidate

The source candidate is now **Mod 0.5.62 / Codex 0.1.12 / schema 10**, with **59 matching runtime files**, published on the completion branch as [draft PR #204](https://github.com/herman925/925-cc-plugins/pull/204). Published main remains **0.5.61 / 0.1.11 / schema 9**. Both Codex manifests and its setup receipt version are aligned. No main merge, release, installation, activation or live migration occurred.

The final candidate common suite passed **547/547, zero failures/cancellations/skips**, with real SQLite and owned PostgreSQL, Node 22.13 and native Codex setup enabled. Retained TAP: `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-yy1s4v/suite.tap`; SHA256 `1C8A3A4970A392BCFEB5C38B1B091BDB53D9BC1FB7F2A292123EEB22F9CA28E2`. All owned PostgreSQL clusters stopped successfully.

Mod 0.5.62 SDK validation remains **467 pass / 1 fail**, 468 tests across 47 files. `%TEMP%/mod-candidate-0562-20261108.log` records the same existing parallel crypto timing failure (7088.3165 ms versus 6000 ms). Unchanged isolated crypto tests passed 16/16 as documented below. This is not a green full Mod suite.

Additional regressions reproduced and corrected the Mod native ticket validator's hardcoded schema-9 target and the import API's missing-CLI fallback. Current source accepts explicit schemas 5–9 upgrades to the current target, rejects stale targets, and requires imports to preserve an explicit supported CLI. New worker startup forwards the external PostgreSQL variable by name through native MCP `env_vars`, retains host identity variables and makes the exact inbox confirmation step explicit. Missing credentials identify the variable without printing its value.

Actual native Codex zero-turn controls proved a harmless sentinel absent without forwarding and present with the production forwarding helper. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-worker-policy-native-2Fai75/evidence.json`. These checks do not prove a real worker/human review.

A later [native policy-routing probe](worker-native-policy-routing-20261108.md) used a canned local model response through real Codex 0.166. All three controls passed: without the four overrides a granular-policy call requested confirmation; with them all four worker tools ran while management required confirmation; under never/full-access the production management handler still refused an unreviewed effect. Pending fixture requests were cancelled through turn interruption, never answered. This establishes native tool routing with deterministic model data, not real worker/human/lifecycle acceptance. Those validation-only files did not alter product behavior. The later [stale-schema recovery correction](stale-schema-upgrade-recovery-20261108.md), committed as `2a80f88`, is included in the final 546-test run: a resumed older store can reach its own reviewed/backed-up upgrade before the still-required explicit rebind.

Read-only normal setup preview produced runtime digest `43bf6a2f7d0216e913da82eb74c5434cf9c024dbcddc42087538ea3fa65f3cfe`, 59 files, schema 10. It reports `hookConfigurationChanged: false`, `requiresNativeHookReview: false`, `requiresReconnect: true`, `activeRuntime: not-inspected`. No apply was run. An unchanged hook must not be described as requiring another hook review.

The [migration foundations report](migration-foundations-20261108.md) records complete private backup, native command assembly and transactional import/reconciliation. Native client wiring and actual source-session activation remain incomplete; the exit-versus-idle-handover design question remains pending. The [Hermes research note](hermes-adapter-research-20261108.md) records primary-source leads without enabling managed membership.

A later same-conversation resume again blocked the native question tool while stale. One native-reviewed reconnect restored the original member at binding generation 3, with controller generation 1, member generation 2, configVersion 8 and unchanged standing switches. Source `4f6eb2f` separately fixes native draft-question reachability during stale recovery. That new source is not activated; actual recovery used the already installed schema-9 runtime. See [exact receipt and 547-test evidence](stale-native-question-recovery-20261108.md). The migration workflow question remains pending.

## Decisions recorded through native multiple choice

- Meetings default to joined members. Required contributions still wait or are explicitly deferred; each meeting can choose all invitees.
- Existing-worker setup that requires a new process must resume the same conversation when idle, preserve history/work, and stop if safe native resume cannot be verified. No automatic stop, replacement or process refresh has been implemented or performed.
- Hosted PostgreSQL uses a named environment variable configured outside the orchestrator on each machine. Project and new worker profiles save the name, never the connection secret.
- Classic-team migration preserves original data, briefs and notes. Unfinished work is imported for the head's review and requires fresh assignments before execution. Native client review/apply remains unwired; the answer is not permission to migrate live data.
- Migrated permission switches start off. Old Allow writes / Allow subagents values remain archival and are not transferred; enabling either later uses normal team editing.

## Implemented source

Branch `feat/team-orchestrator-completion` contains reliability commit `eb83e26` and local merge `07e0781` of the draft readiness foundation. GitHub PR #199 remains untouched. The completion branch is pushed as draft PR #204; it is not merged into main.

The readiness source checkpoint was subsequently committed as `41fb4a2`, and the migration/hosted candidate as `c982f2e`. Native migration foundations now live in `shared/team-store/migration/`; the transactional private API is packaged, while source capture/backup/command helpers are source-only and no migration UI/tool is exposed. They preserve explicitly pruned mail, flag uncertain sends, keep proposed permissions off and retain source/backup fingerprints. The earlier 516-test checkpoint below predates that work; use the latest candidate result above.

The development shared runtime is schema 10. Both repository client packages contain **59 byte-matching runtime files**. Source manifests now label Mod 0.5.62 / Codex 0.1.12; published main remains Mod 0.5.61 / Codex 0.1.11. These are development source changes, not a released or installed schema-10 package.

- Plan-scoped immutable consent covers the four worker tools. Process-only legacy launch approval is insufficient; there is no backfill of tool consent.
- The private native adapter records status, role/team inspection, inbox delivery and exact bootstrap-receipt confirmation. Model tools cannot supply the runtime proof or ready flag. Native epoch, execution key, binding, reviewed plan and role generations fence observations; disconnect and expiry retain capacity.
- Admission and retry check readiness inside the transaction before any task, assignment, delivery or pickup clock is created. Reviewed setup of a bound native worker retains its existing launch and current valid work, blocks new admission, and marks setup pending.
- Configuration and the Mod roster expose readiness. Assign stays hidden until ready, including during pending setup.
- Explicit backed-up upgrades from schemas 5–9 to 10 preserve history and do not fabricate worker grants. No live store was upgraded.
- The tool catalogue declares operation-specific required fields and excludes private runtime commands.
- The source guard recognizes narrowly bounded reads of real public project files. It still refuses adapter execution, private state, mixed shell effects and redirected paths. This correction is not loaded in the current installed runtime; earlier denied public-source reads were not retried through another route.
- Controller, worker-launch and schema-upgrade reviews now share timing-only refusal diagnostics. Fast negative replies report `API_APPROVAL_UNVERIFIED`; timing never proves delivery or supplies consent.
- PostgreSQL engine options can resolve a named environment variable. New hosted worker profiles persist only the reference, retain the selected engine, and refuse missing credentials without SQLite fallback. Remote references require `sslmode=verify-full`; this is not a live remote TLS acceptance test. Old private profiles remain readable for compatibility and are never copied into new secret-bearing profiles.

## Earlier validation checkpoints

The previous `c982f2e` candidate passed 542/542 at `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-nocDmX/suite.tap`, SHA256 `547381377D07E0785F2C8CDDE7B255F92C08D3F41B931A5A503A4B4658607714`. Its b9c4b8d4 runtime preview is superseded by the current recovery-corrected preview above.

1. **Full SQLite plus actual PostgreSQL: 516 passed, 0 failed, 0 cancelled, 0 skipped.** Node 22.13, native Codex setup checks enabled. Retained TAP: `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-Ihv84v/suite.tap`; SHA256 `E653108CBFFAE56D388EE347324B368786064BDA2442C302D21D2C118EAEA4AD`. A fresh owned loopback cluster was stopped successfully. An earlier run's 45-second per-file limit cancelled two large files; the corrected run used 180 seconds and completed them. The earlier incomplete run is not counted as a pass.
2. **Mod SDK: 467 passed / 1 failed**, 468 tests in 47 files. Log `%TEMP%/mod-schema10-pass2-20261108.log`; SHA256 `39ABD439B19FB39417C9B3B011497B3606A9CC7089DAE8234B05EC9ACF73767E`. The only failure is the pre-existing six-second crypto unlock assertion under the parallel full run. Unchanged crypto source/test in an isolated copy then passed **16/16**, including that same timing assertion. No KDF parameter or test limit changed. Isolated log `%TEMP%/crypto-isolated-pass2-20261108.log`; original test SHA256 `6EF9A4A183D4926A839C5F267DEF70802176E07C7CC3767E4A3DCA24750F1A3F`. Isolation does not turn the full-run failure into a green result.
3. **Actual Codex 0.166, isolated home, zero model turns:** the native parser accepts the four per-tool overrides under never/full-access and loads the production tool catalogue. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-worker-policy-native-vVKsh4/evidence.json`. No manual tool calls or human approvals were used. This does not prove model-side worker access or live native identity.
4. Runtime parity and whitespace checks passed. Focused hosted-reference / copied-profile tests passed on both engines: 32/32 before the final complete run.

## Remaining acceptance and implementation

D2's original in-plugin probe failure still needs actual host evidence. D3 has source/SDK recovery coverage but no new live Mod rebind. Safe automatic existing-worker idle/resume, real reviewed worker bootstrap/task/outcome/head acceptance, mixed-model meeting/replay and whole-Orca restart remain unproven. Fixtures substitute native identity and user responses; they do not establish human/native acceptance.

Hosted onboarding is incomplete. Selecting a remote store requires an enforceable per-machine guard-membership enrollment/discovery protocol; treating a missing local SQLite file as remote nonmembership would drop enforcement. The environment-reference foundation alone is not a user-facing hosted setup or safe store switch. No production credentials were read, saved or changed.

Migration client preview/apply and partial recovery, separate Orca-plugin convergence, independent/Hermes parity, project/worktree/clone authority, remote transport, profiles/handbook, tracker/context, topology/observation and bounded AFK lanes remain open. The current source checkpoint does not complete those tickets. The earlier source checkpoint issued none; the later own-session native-reviewed rebind is documented above. No candidate install/activation, worker restart, schema upgrade or role/permission change was performed. The existing installed observer remains separate and can continue normal replay/receipt activity; no byte-unchanged claim is made about its live database.
