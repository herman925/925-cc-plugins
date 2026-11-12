# Native questions during stale recovery — 2026-11-08

After the same Codex conversation resumed, the installed hook refused both the requested native question tool and an ordinary skill-file read with API_STALE_BINDING. Native status and session discovery remained reachable. The original controller approval was still active; no new controller approval was requested.

## Actual own-session restoration

The specific native-reviewed request `recovery-bind-20261108-dfa658b6-01` connected the same verified conversation to the original `native-acceptance-head-20261105` member. Its receipt was:

```json
{"operationId":"recovery-bind-20261108-dfa658b6-01","kind":"api","result":{"memberId":"native-acceptance-head-20261105","bindingGeneration":3}}
```

Follow-up status verified that exact binding, controller generation 1, member generation 2 and configVersion 8. Existing standing access remained Allow writes=1 / Allow subagents=0. The skill-file read then succeeded, and the native migration question call was accepted. The agent generated no form response. The elicitation probe recorded one human-paced response while still reporting delivery as unverified; timing is not presentation proof.

This is a later live management operation and supersedes earlier checkpoint statements that no rebind had been performed. It used the already installed runtime and schema-9 store. It does not establish activation of the schema-10 candidate or live acceptance of its new guard code. No team creation/edit, worker launch, schema upgrade, hook disabling or permission change occurred.

## Permanent source correction

Source commit `4f6eb2f` keeps exactly Codex's native `request_user_input` / `request_user_input_async` entrypoints and their `functions.` names reachable during verified stale recovery. Questions may mention protected paths without becoming file reads. Answers remain draft data; they cannot satisfy native management confirmation. Unknown MCP lookalikes, shell/patch effects and unverified native identity remain refused.

The regression first failed with the guard's private-state denial on a question mentioning a protected path. It now covers both ordinary migration questions and protected-path wording through the real launch-enabled stale preflight. The actual earlier installed-tool refusal separately showed the ordinary question blocked by the stale allowlist.

- Focused adapter/preflight suite: **14 passed / 0 failed / 0 skipped**. Green TAP `%TEMP%/stale-native-question-green-20261108.tap`, SHA256 `DFA08F577461324FAF2281D509B9AF948E7A59208B83E2A704B3C50D293FAA73`. Red TAP `%TEMP%/stale-native-question-red-20261108.tap`, SHA256 `4DE697C0B227236168B07C9676D38CDD40F822FF728B672FE0820489CCE94E25`.
- Full common suite: **547 passed / 0 failed / 0 cancelled / 0 skipped**, real SQLite + owned PostgreSQL, Node 22.13 and native setup. TAP `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-yy1s4v/suite.tap`; SHA256 `1C8A3A4970A392BCFEB5C38B1B091BDB53D9BC1FB7F2A292123EEB22F9CA28E2`. Owned PostgreSQL stopped successfully.
- Normal setup preview only: **`43bf6a2f7d0216e913da82eb74c5434cf9c024dbcddc42087538ea3fa65f3cfe`**, 59 matching runtime files, schema 10. This supersedes the 2ff690fa preview. Hook unchanged; no new native hook review required; reconnect required; active runtime not inspected. **No apply or candidate activation was run.**

Mod SDK evidence remains the earlier 467 pass / 1 existing parallel crypto timing failure, not a green full Mod run. The migration workflow question is still awaiting Herman's native answer. This source fix neither chooses the migration policy nor completes the remaining Wayfinder lanes.
