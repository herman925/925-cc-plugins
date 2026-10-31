# Shared team workspace — update and test 0.5.45

This increment adds clickable team creation, native session binding, a visual roster, task assignment, worker reporting and separate head outcome review to the Mod's existing opt-in schema-5 preview. The preview remains off by default. Session Panel and the Orca plugin are unchanged.

Update the marketplace and Mod from main:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Reload the plugin through Claude Code's normal reload control or start a new conversation, then confirm **Team Orchestrator v0.5.45** in its band. Publishing does not update installed copies or reload sessions automatically.

In a fresh disposable project, click **⚙ Settings**, switch **Shared-store preview** On, and open **Shared store**. **Check access**, then explicitly **Approve controller** for this project/conversation. **Refresh** loads the workspace. **Create team** opens its editable form; creation does not launch or bind sessions.

Use **Bind session** on the head and worker roster cards. **This verified conversation** can bind the current caller with fresh native verification, including the supported Windows idle caller proof. Other session choices require explicit native provider association. Another idle conversation may approve itself as a controller and bind itself from its own panel; approving it does not revoke the first controller. A bound worker does not otherwise need controller approval.

From the bound head, **Assign task** to a direct report. The worker refreshes its **Tasks**, picks up the assignment, reads the displayed official role and brief before work, then reports an explicit outcome, summary and evidence. The head reviews that evidence and accepts or rejects with a reason. There is no automatic assignment notification in this increment. See [the workspace guide](../../team-orchestrator/docs/shared-team-workspace.md) for the full flow and receipt recovery.

Node 22.13+ is required. Connection fields accept its executable and the Orca executable without slash commands. Use native keyboard navigation and scrolling for long forms or narrow panels. The Orca plugin continues to use its existing native store/lifecycle. Existing-team migration, scheduler/replay/delivery, automatic window fencing, rejected-task recovery, whole-Orca restart and broader shared-store integration remain separate work.

Independent validation passed 380 Mod tests and 222 SQLite/PostgreSQL tests, plus the bounded real panel flow after the disclosed input-render repair. See [workspace validation](../../team-orchestrator/docs/VALIDATION-WORKSPACE-0.5.45.md) for evidence and limits. Historical schema-5 and 0.5.44 reports retain their original scope.
