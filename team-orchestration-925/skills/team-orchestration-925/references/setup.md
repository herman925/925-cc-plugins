# Setup and diagnosis

The skill contains its matching runtime under `scripts/runtime/`; it must not refer to the developer's checkout. Node 22.13+ and a native Windows Codex session in Orca are required. No account/API key is added by this package.

Run `node <this-skill>/scripts/setup.mjs preview` from the user's project. The helper discovers the native CLI and verifies project/session scope; it uses Codex's own config writer/parser in disposable staging. Preview explains the project-local server and hook changes without applying them. It never prints existing configuration or secrets.

The config-writer executable is resolved from PATH, including the native package behind a Codex npm shim; it is checked with `--version`. No ancestor/process query or shell-shim execution is required. For a non-PATH installation, the person may explicitly configure `TEAM_CODEX_EXECUTABLE` as an absolute native `codex.exe` path. This does not prove caller identity; the native MCP adapter separately retains its exact parent/thread-lock/Orca verification.

Treat `SETUP_HOST_ACCESS_DENIED` as a host/profile/local-connection access problem, `SETUP_HOST_UNAVAILABLE` as a missing Orca CLI/profile prerequisite and `SETUP_CODEX_NOT_FOUND` as executable discovery. A failed Orca subprocess reports its own stage/exit classification; it is not described as a missing project. Do not infer a successful setup, silently switch projects or approve permission escalation from these errors.

When the user requests setup, review that preview and use `apply`. Only this project's `.codex/config.toml`, `.codex/hooks.json` and owned setup receipt are changed; global Codex settings and real team stores remain untouched. Existing unrelated settings/hooks are preserved. Existing unowned or modified team configuration is refused instead of overwritten. Private recovery backups stay outside the project.

After setup, reconnect/reload MCP through the client's available controls or start a fresh Codex session in the project. Review/trust the exact team permission hook through Codex's native hook interface. The helper does not mark it trusted. Invoke `$team-orchestration-925` again and inspect `shared_team_status` before team creation.

`diagnose` reads the current installation and supported prerequisites. `remove` removes only the owned MCP/hook entries and preserves unrelated user changes; it does not delete teams, transcripts, other skills, global config or the current conversation. A partial setup uses the recorded recovery journal; changed/unowned files require manual review rather than an unsafe overwrite.

If the current host is not verifiably Orca, or native process/thread ownership fails, explain the unsupported condition. An installed Orca executable alone is insufficient. Do not invent terminal IDs, switch to the Orca plugin store or choose a standalone adapter that has not been implemented.
