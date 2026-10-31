# Panel navigation — 0.5.47

A new project starts with **＋ Create team** and **Settings** in the band. The arrow or `t` opens the same team entry. Create team opens a draft before workspace mode or management permission is enabled.

Setup has four steps: **Team → Members → Options → Review & permission**. Back, Close setup and switching to Settings keep the draft and its member identities in this conversation. Discard requires its own confirmation. Draft recovery after a whole-app restart is not promised.

Review shows the project path and saved settings. **Use shared workspace for this project** remembers this project's mode in this installation; other projects keep their defaults. **Allow team management** approves only this conversation. **Create team** is a separate action that appears after confirmed permission. Opening a draft, enabling the project mode or approving management never creates the team automatically.

After confirmed creation the main entry becomes **Team workspace**. It provides a team dropdown, **＋ New team**, **Members** and **Tasks**. A store file alone cannot prove a team exists: before authorized discovery, an existing store uses the neutral **Open teams** label. Bound workers can open their own tasks without controller approval.

Click the active Team/Settings entry again to close it; clicking the other switches views. There is one Settings entry at a time. Settings contains **Display** and **Connection**, plus **Classic teams** when an older roster exists. Classic roster data and creation remain a separate explicit destination; nothing is migrated.

Setup uses a sized native pane with keyboard/click controls and Escape-to-close. Hosts without a placed pane use the inline band fallback, never two copies of the form. **Edit inline** in the band switches an open setup pane to that same inline form while retaining its draft. Dropdowns select members and reporting lines; official instructions and purpose use multiline fields. Decorative timer redraws do not refresh the form. Narrow panes can still require Tab navigation and scrolling.

Update the marketplace and Mod:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Reload through Claude Code's usual plugin reload control and confirm **0.5.47**. Updating never approves a controller, creates a team or connects a session.
