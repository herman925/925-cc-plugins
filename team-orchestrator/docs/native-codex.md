# Native Codex with the Claude Mod

## Current setup: team-orchestration-925 0.1.5 / Mod 0.5.57

Install the [team-orchestration-925 skill or Codex repository plugin](../../team-orchestration-925/README.md), then type `$team-orchestration-925` and select the skill. Plugin installation registers `team-orchestration-925:team-orchestration-925`; repository skill installation uses the short name. The former `925-to` name was replaced because Orca's mention picker rejects a digit as the first character. Its Create team, Edit team, Connect session, Status and Meetings workflows use this same shared runtime. An active Claude session is no longer needed to approve/configure a new team. Windows Orca-hosted native Codex remains the supported host; the Orca plugin's separate store is not selected automatically.

When MCP tools are missing, the packaged setup helper previews project-local configuration using the actual native Codex config parser. It discovers the verified Orca project/session, preserves unrelated configuration and records ownership/recovery receipts. Apply the preview, reconnect and use Codex's native hook review. Installing a skill is not hook trust or controller approval. Updates/removal touch only owned configuration; interrupted changes have explicit recovery.

`shared_team_interview` supplies draft menus/forms when ordinary native question tools are unavailable. `shared_team_manage` shows the exact proposed configuration in a native confirmation; cancellation, timeout or an unsupported client grants nothing. It supports atomic team/settings edits, member addition and bounded member-field changes. Connected model replacement, member removal, hierarchy/CLI conversion and automatic launches remain unavailable. Use an explicit reviewed reconnect when a resumed conversation retains controller approval but its member incarnation changed.

The other tools are `shared_team_status`, `shared_team_sessions`, `shared_team`, `shared_inbox_read`, `shared_inbox_seen` and private `team_guard`. Typed member/meeting operations and recipient-owned read acknowledgements are unchanged. Source runtime files are packaged identically in the Mod and skill. See [the final test evidence and live limits](../../shared/team-store/VALIDATION-925-TO.md).

## Earlier 0.5.55 preview setup (manual alternative)

The following manual workflow is retained for trusted integrators. Prefer the packaged setup above for new installations.

The first route connects an existing Orca-hosted Codex terminal to the Mod's shared workspace. It is a native local MCP adapter, **not an Orca plugin panel**. Both providers use the same shared task, inbox, meeting, permission and receipt records. Automatic Codex launch and an independent non-Orca adapter remain later work.

In Create team, choose **Codex · connect existing session** for a member. The member picker matches that configured CLI to an explicitly verified native session. Codex members have Connect session, not a misleading Claude Launch button. The earlier preview required an approved Claude controller to configure and bind the roster; a bound Codex head could then coordinate its workers through the member API. In 0.5.56, the native confirmation path above provides Codex management too. Target identity is always verified outside model arguments.

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
