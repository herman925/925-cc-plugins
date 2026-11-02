# Native Codex with the Claude Mod

The first route connects an existing Orca-hosted Codex terminal to the Mod's shared workspace. It is a native local MCP adapter, **not an Orca plugin panel**. Both providers use the same shared task, inbox, meeting, permission and receipt records. Automatic Codex launch and an independent non-Orca adapter remain later work.

In Create team, choose **Codex · connect existing session** for a member. The member picker matches that configured CLI to an explicitly verified native session. Codex members have Connect session, not a misleading Claude Launch button. The approved Claude controller configures and binds the roster; a bound Codex head can then coordinate its workers through the member API. This release does not expose model-driven controller approval or target-identity injection.

## Preview setup

The adapter is `store/codex-mcp.mjs`. It requires Node 22.13+, the absolute native `codex.exe` executable, a fixed project/Orca terminal/context, and the actual Codex home. Windows native identity is implemented; other operating systems remain unsupported in this adapter.

`store/codex-setup.mjs` generates reviewable configuration into a **new explicitly named directory**, without installing anything. Supply a trusted JSON file:

```json
{
  "scope": {"projectRoot":"C:/path/to/project","terminalHandle":"term_actual_handle","contextId":"actual_context"},
  "codexExecutable":"C:/path/to/native/codex.exe",
  "codexHome":"C:/Users/you/.codex",
  "orcaCommand":"orca"
}
```

```text
node store/codex-setup.mjs trusted-settings.json C:/path/to/new-review-directory
```

Review the generated `config.snippet.toml` and `hooks.json`, merge them into the intended Codex configuration layer without replacing existing settings/hooks, reconnect, and review/trust the exact hook in Codex's hook interface. These scope values belong to that terminal; regenerate them for another session rather than committing a fixed terminal configuration for all users. No hook trust bypass is used.

Codex discovers `shared_team`, `shared_inbox_read`, `shared_inbox_seen` and the private-purpose `team_guard` callback. Each call verifies native transport metadata, its direct native parent PID/creation fingerprint, that parent's unique ownership of the thread writer lock, and the current Orca provider conversation/context/incarnation. Tool arguments cannot select an actor, database path, approval action or target. Missing or redirected ownership fails verification; an ephemeral transport thread alone is insufficient.

The PreToolUse MCP hook evaluates live standing member switches. Heads without write permission cannot edit files or run mutating shell/code tools; subagents require permission. Private authority/configuration data and shared database writes remain protected. Prompt keywords such as `#allow-write` do not grant Codex permissions because native prompt provenance does not distinguish human and peer text reliably.

Hook failures that reach the adapter return Codex's supported blocking shape. The host can skip untrusted, missing or disconnected hooks; hooks remain best-effort guardrails rather than an OS sandbox. **Do not treat an attached Codex session as guard-accepted until the installed/trusted hook has been tested in that live session.** The current automated/native evidence does not establish positive live-model guard acceptance or automatic hook installation.

Wake delivery uses Orca's existing inter-agent service for Codex targets and the native Mod send path for Claude targets. Targets are reverified after the shared reservation commits. Wakes contain pointers only and never clear unread mail, admit duplicate work or confer authority. Codex can explicitly recover its durable inbox after a restart; automatic native context injection and background recovery while no MCP calls occur remain outside this preview.

The official [Codex hooks documentation](https://learn.chatgpt.com/docs/hooks) describes the MCP callback format, trust review, tool coverage and failure behavior used here. See [durable meetings](../../shared/team-store/SCHEMA-8-MEETINGS.md) and [validation evidence](../../shared/team-store/VALIDATION-NATIVE-MEETINGS.md).
