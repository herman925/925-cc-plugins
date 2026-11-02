# Letter-first skill invocation repair

`team-orchestration-925` 0.1.1 replaces the original `925-to` plugin/skill identifier, using the user's selected name. The display name remains **925 Team Orchestrator**. Mod 0.5.56, shared schema 8, management behavior and all 43 packaged runtime files are unchanged.

The installed Orca composer's mention parser explicitly returns no match when the first skill-name character is a digit or hyphen. It rejects both `$925-to` and `$925-to:925-to`. Codex had successfully discovered the old skill, so installation/discovery tests alone did not expose this UI failure. The namespace also matters: a plugin registers `plugin-name:skill-name`, while a repository skill uses its unprefixed name.

The repair renames both the plugin and its skill. Type `$team-orchestration-925` and select **925 Team Orchestrator** in the picker. For a plugin, the complete explicit token is `$team-orchestration-925:team-orchestration-925`. Repository skill installation uses `$team-orchestration-925`.

Validation for this repair:

- Executed the actual installed composer's isolated pure parser: both old names refused, both new names accepted. The host asset hash and exact extracted parser are recorded; no installed host code was modified.
- Native Codex installed the new package, reported the exact namespaced skill, updated a disposable release and removed it. The pinned npx route installed the same self-contained skill/runtime.
- Six setup tests passed on Node 22.13, including legacy owned adapter-path update with unchanged receipt/recovery identity, interrupted setup and hard-exit recovery.
- Skill frontmatter validation and the 43-file/two-package runtime equivalence check passed. The unchanged shared runtime retains the [earlier 368-test two-engine and 438-test Mod evidence](VALIDATION-925-TO.md); those full suites were not rerun for a package/path rename.

Evidence: [validation/skill-invocation](validation/skill-invocation/). Run `node shared/team-store/validation/probe-skill-invocation.mjs <installed-Orca-composer-asset.js>` and the updated `probe-925-to-installers.mjs <native-codex.exe>` to reproduce the parser/distribution checks. All validation fixtures use disposable installation/configuration roots and start zero model turns. Native hook trust and real mixed-model acceptance remain separate.

Legacy setup file names and the private `925-to/installations` recovery directory deliberately stay stable. An existing configured project updates through the replacement skill's setup helper before removing the old plugin. Team data, approval identities and the `team_orchestrator` MCP server name are preserved.
