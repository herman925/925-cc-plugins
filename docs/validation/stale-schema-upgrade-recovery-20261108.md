# Resumed-session schema upgrade recovery — 2026-11-08

A disposable schema-9 store with a resumed native binding reproduced another closed recovery loop before activation: the stale guard refused `shared_team_upgrade`, while the current API could not rebind an older store. The upgrade handler also used the binding-sensitive authority reader. Restarting alone could not make that sequence work. The new regression first failed with the exact stale guard denial.

The correction admits the dedicated reviewed upgrade entrypoint through stale recovery, including the launch-enabled preflight and bare/prefixed hook names. Its private schema-only reader validates supported schema, integrity and writer protocol in a read-only transaction, returning version metadata without member authority. Ordinary guard inspection still rejects stale bindings. Native review, caller revalidation, complete backup, transactional upgrade and exact receipt reconciliation remain in place. Unknown schema/protocol/native identity is still refused. All unrelated effects retain their previous restrictions.

The regression demonstrates refusal leaves schema 9 unchanged; a fixture-confirmed upgrade saves a schema-9 backup and updates to schema 10; the original binding/incarnation/generation remains stale and unchanged; no worker consent/readiness is manufactured; status then reaches explicit rebind recovery. Reconciliation returns the original upgrade receipt without another review. This is fixture evidence, not a delivered human form or live recovery.

Validation:

- Focused SQLite recovery/guard/preflight: **12 passed / 0 failed / 7 PostgreSQL skips** before the full both-engine run.
- Final whole common suite: **546 passed / 0 failed / 0 cancelled / 0 skipped**, real SQLite + disposable PostgreSQL, Node 22.13 and native setup enabled. TAP `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-kLomE9/suite.tap`; SHA256 `4CDF17B2282B54D70985615FC4C85B28E391E2021F281817051B1DE171AACA6E`. The owned PostgreSQL cluster stopped successfully.
- All three native deterministic-model policy controls passed again: `C:/Users/Herman/AppData/Local/Temp/team-worker-approval-native-IfGWTD/evidence.json`; stdout `%TEMP%/worker-approval-native-upgrade-candidate-20261108.jsonl`, SHA256 `889315E19CCBB12CF1BC8CC0A71C4BC2FD344778DB834A61F5142CD66324564B`. No real model/team or answered human form.
- Both packages retain **59 byte-matching runtime files**. Read-only normal setup preview now identifies **`2ff690fa68982d98de6b751f0a71f725ffd21da9d5a300a52f0f9f10f8312133`**, schema 10. This supersedes the earlier b9c4b8d4 preview. Hook configuration is unchanged, native hook review is not required, reconnect is required, active runtime is not inspected. **No apply, install, activation or real schema upgrade was run.**

Mod SDK evidence is unchanged: 467 pass / 1 existing parallel crypto timing failure, with identical isolated crypto tests passing 16/16. A real native Mod recovery and candidate activation remain unproven. This source correction does not complete the wider Wayfinder or migration workflow.
