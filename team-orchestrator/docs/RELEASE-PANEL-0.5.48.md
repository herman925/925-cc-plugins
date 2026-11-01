# Right-panel default — 0.5.48

All Team Orchestrator views now share one native panel and default to requesting the right side. Setup no longer uses a second pane, and closing the panel no longer changes its preference to stacked. Inactive and obsolete panes return a valid empty drawing, avoiding a close-time hook warning. Existing card arrangement is preserved independently. No team/store/configuration/permission migration is performed.

Update the marketplace and plugin:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Restart/resume Claude Code and confirm **0.5.48**. Open Team Orchestrator, switch between Create team, workspace, classic teams and Settings, then close/reopen the native frame. The same right-panel preference should remain. Settings → Display separates Panel from Team cards. **Edit inline** and **Dock right** switch the whole UI while keeping its current state.

## Host constraints

The Mod requests a native pane; the host chooses physical placement. Fullscreen mode with at least 110 terminal columns docks beside the transcript. Classic mode or a narrow window places the pane inline. Background startup can defer an unasked pane until the host's placement floor is met; **Retry right panel** is an explicit user-open action. An unplaced fallback is distinct from a placed inline pane and from the user's explicit Inline preference.

The normal host **/tui** command changes a user-wide renderer preference and requires a restart. This release does not run it, set an undocumented fullscreen/placement property or change global host configuration. Viewport/placement are read-only facts in the supported SDK. If a pane appears above the prompt, the UI explains the actual classic/narrow host condition.

## Validation

Local Mod suite: **403 passed, 0 failed, 42 files**. Validation passed with existing metadata warnings; all 16 packaged store modules remain unchanged. Independent final suite also passed **403 tests**. Native checks observed actual `placement:dock` with fullscreen, actual `placement:inline` with classic mode, one pane across setup/Settings/shared access, native frame close/reopen, retained draft text/step and explicit Inline/Right switching. The native close-time warning was repaired and fresh retests produced no new warning.

The live shared view was Off/unapproved; populated teams and classic roster/form routing remain regression-suite coverage. Narrow/unplaced hints were tested in the SDK suite, not a new native resizing/fault run. No global renderer settings or window geometry changed. [Independent report](INDEPENDENT-PANEL-0.5.48.md) records exact scope and retained evidence. Its archived SHA256 is `d390207ec24e2cf107282424dde7d47e0fef6690b2306a0a9163f81198a9eaaa`; [runtime hashes](PANEL-0.5.48-RUNTIME-HASHES.json) identify the tested Windows bytes (Git can normalize newlines on other checkouts). This is a layout/navigation increment; it does not establish new schema, PostgreSQL, lifecycle, migration, launcher or scheduler acceptance.
