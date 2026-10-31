# Panel navigation — 0.5.46

Click the band arrow to open or close Team Orchestrator. The **⚙ Settings** shortcut appears while the panel is closed. Once open, use the panel's **Settings** tab; the shortcut is hidden so only one Settings entry is visible.

Click a tab to switch to it. Click that active tab again to close the panel. This applies to **Roster**, **New team**, **Settings** and **Shared store**, including the docked layout. Closing Shared store does not run another access check. Opening it checks access as before.

While Shared-store preview is **On**, the older **New team** tab and empty-roster quick starts are hidden. The empty roster offers **Open shared workspace**. Inside Shared store, **Create team** appears only after explicit controller approval. Bound members can still use their permitted team/task controls without controller approval. Existing roster management remains available; turning the preview Off restores the older creation flow.

The shared team workspace appears before expanded Connection details. A first-use missing store is explained as **No shared store yet. Approve controller to set up this project.** Approval and creation remain separate explicit actions. No permission, native identity, schema or lifecycle rule changes.

Update the marketplace and Mod:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Then reload through Claude Code's usual plugin reload control and confirm version **0.5.46**. Long forms still use native Tab navigation and scrolling. Updating does not reload sessions, approve controllers or create teams automatically.
