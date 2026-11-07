# Completion work — 2026-11-08 development checkpoint

This continues Herman's instruction to implement all remaining lanes in [Wayfinder #2](https://github.com/herman925/925-cc-plugins/issues/2). It supersedes implementation-status statements in the earlier reconciliation, while preserving that audit's release evidence. It is not a claim that the whole roadmap is complete.

## Decisions recorded through native multiple choice

- Meetings default to joined members. Required contributions still wait or are explicitly deferred; each meeting can choose all invitees.
- Existing-worker setup that requires a new process must resume the same conversation when idle, preserve history/work, and stop if safe native resume cannot be verified. No automatic stop, replacement or process refresh has been implemented or performed.
- Hosted PostgreSQL uses a named environment variable configured outside the orchestrator on each machine. Project and new worker profiles save the name, never the connection secret.
- Classic-team migration preserves original data, briefs and notes. Unfinished work is imported for the head's review and requires fresh assignments before execution. Migration preview/apply remains to be built; the answer is not permission to migrate live data.

## Implemented source

Branch `feat/team-orchestrator-completion` contains reliability commit `eb83e26` and local merge `07e0781` of the draft readiness foundation. GitHub PR #199 remains untouched; this checkpoint neither pushes nor merges into main.

The development shared runtime is schema 10. Both repository client packages contain **59 byte-matching runtime files**. Published manifests remain Mod 0.5.61 / Codex 0.1.11; these are development source changes, not a released or installed schema-10 package.

- Plan-scoped immutable consent covers the four worker tools. Process-only legacy launch approval is insufficient; there is no backfill of tool consent.
- The private native adapter records status, role/team inspection, inbox delivery and exact bootstrap-receipt confirmation. Model tools cannot supply the runtime proof or ready flag. Native epoch, execution key, binding, reviewed plan and role generations fence observations; disconnect and expiry retain capacity.
- Admission and retry check readiness inside the transaction before any task, assignment, delivery or pickup clock is created. Reviewed setup of a bound native worker retains its existing launch and current valid work, blocks new admission, and marks setup pending.
- Configuration and the Mod roster expose readiness. Assign stays hidden until ready, including during pending setup.
- Explicit backed-up upgrades from schemas 5–9 to 10 preserve history and do not fabricate worker grants. No live store was upgraded.
- The tool catalogue declares operation-specific required fields and excludes private runtime commands.
- The source guard recognizes narrowly bounded reads of real public project files. It still refuses adapter execution, private state, mixed shell effects and redirected paths. This correction is not loaded in the current installed runtime; earlier denied public-source reads were not retried through another route.
- Controller, worker-launch and schema-upgrade reviews now share timing-only refusal diagnostics. Fast negative replies report `API_APPROVAL_UNVERIFIED`; timing never proves delivery or supplies consent.
- PostgreSQL engine options can resolve a named environment variable. New hosted worker profiles persist only the reference, retain the selected engine, and refuse missing credentials without SQLite fallback. Remote references require `sslmode=verify-full`; this is not a live remote TLS acceptance test. Old private profiles remain readable for compatibility and are never copied into new secret-bearing profiles.

## Validation

1. **Full SQLite plus actual PostgreSQL: 516 passed, 0 failed, 0 cancelled, 0 skipped.** Node 22.13, native Codex setup checks enabled. Retained TAP: `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-Ihv84v/suite.tap`; SHA256 `E653108CBFFAE56D388EE347324B368786064BDA2442C302D21D2C118EAEA4AD`. A fresh owned loopback cluster was stopped successfully. An earlier run's 45-second per-file limit cancelled two large files; the corrected run used 180 seconds and completed them. The earlier incomplete run is not counted as a pass.
2. **Mod SDK: 467 passed / 1 failed**, 468 tests in 47 files. Log `%TEMP%/mod-schema10-pass2-20261108.log`; SHA256 `39ABD439B19FB39417C9B3B011497B3606A9CC7089DAE8234B05EC9ACF73767E`. The only failure is the pre-existing six-second crypto unlock assertion under the parallel full run. Unchanged crypto source/test in an isolated copy then passed **16/16**, including that same timing assertion. No KDF parameter or test limit changed. Isolated log `%TEMP%/crypto-isolated-pass2-20261108.log`; original test SHA256 `6EF9A4A183D4926A839C5F267DEF70802176E07C7CC3767E4A3DCA24750F1A3F`. Isolation does not turn the full-run failure into a green result.
3. **Actual Codex 0.166, isolated home, zero model turns:** the native parser accepts the four per-tool overrides under never/full-access and loads the production tool catalogue. Evidence: `C:/Users/Herman/AppData/Local/Temp/team-worker-policy-native-vVKsh4/evidence.json`. No manual tool calls or human approvals were used. This does not prove model-side worker access or live native identity.
4. Runtime parity and whitespace checks passed. Focused hosted-reference / copied-profile tests passed on both engines: 32/32 before the final complete run.

## Remaining acceptance and implementation

D2's original in-plugin probe failure still needs actual host evidence. D3 has source/SDK recovery coverage but no new live Mod rebind. Safe automatic existing-worker idle/resume, real reviewed worker bootstrap/task/outcome/head acceptance, mixed-model meeting/replay and whole-Orca restart remain unproven. Fixtures substitute native identity and user responses; they do not establish human/native acceptance.

Hosted onboarding is incomplete. Selecting a remote store requires an enforceable per-machine guard-membership enrollment/discovery protocol; treating a missing local SQLite file as remote nonmembership would drop enforcement. The environment-reference foundation alone is not a user-facing hosted setup or safe store switch. No production credentials were read, saved or changed.

Migration preview/apply and partial recovery, separate Orca-plugin convergence, independent/Hermes parity, project/worktree/clone authority, remote transport, profiles/handbook, tracker/context, topology/observation and bounded AFK lanes remain open. The current source checkpoint does not complete those tickets. Installed runtime/configuration, live team records, existing workers, roles and approvals remain unchanged.
