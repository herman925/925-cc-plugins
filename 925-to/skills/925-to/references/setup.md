# Setup and diagnosis

The skill contains its matching runtime under `scripts/runtime/`; it must not refer to the developer's checkout. Node 22.13+ and a native Windows Codex session in Orca are required. No account/API key is added by this package.

Run `node <this-skill>/scripts/setup.mjs preview` from the user's project. The helper discovers the native Codex ancestor and project scope; it uses Codex's own config writer/parser in disposable staging. Preview explains the project-local server and hook changes without applying them. It never prints existing configuration or secrets.

When the user requests setup, review that preview and use `apply`. Only this project's `.codex/config.toml`, `.codex/hooks.json` and owned setup receipt are changed; global Codex settings and real team stores remain untouched. Existing unrelated settings/hooks are preserved. Existing unowned or modified team configuration is refused instead of overwritten. Private recovery backups stay outside the project.

After setup, reconnect/reload MCP through the client's available controls or start a fresh Codex session in the project. Review/trust the exact team permission hook through Codex's native hook interface. The helper does not mark it trusted. Invoke `$925-to` again and inspect `shared_team_status` before team creation.

`diagnose` reads the current installation and supported prerequisites. `remove` removes only the owned MCP/hook entries and preserves unrelated user changes; it does not delete teams, transcripts, other skills, global config or the current conversation. A partial setup uses the recorded recovery journal; changed/unowned files require manual review rather than an unsafe overwrite.

If the current host is not verifiably Orca, or native process/thread ownership fails, explain the unsupported condition. An installed Orca executable alone is insufficient. Do not invent terminal IDs, switch to the Orca plugin store or choose a standalone adapter that has not been implemented.
