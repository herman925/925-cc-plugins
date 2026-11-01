# Shared runtime preview — 0.5.51

Update the marketplace and plugin, then restart/resume Claude Code and confirm **0.5.51** in Team Orchestrator. Restart refreshes the registered tool catalogue.

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Open **Team Orchestrator** from its visible button. A new project starts with **Create team**: choose a template or Interview me, edit the draft, review options and allow this conversation to manage the project. Creation is a separate final action. The project remembers shared mode; other projects keep their defaults.

An existing schema-5 shared workspace shows **Update workspace**. This explicit action saves a verified backup before installing schema 6. It preserves existing approvals and history; it does not grant management permission. Nothing upgrades merely by opening the panel. Classic team files are not imported or changed.

In **Team workspace**:

1. **Members** connects verified existing sessions and assigns tasks to direct reports.
2. **Inbox** previews pending mail. **Read in conversation** reads the recipient's next message with interruption recovery. Inspecting another member's inbox does not mark it read.
3. **Tasks** shows pickup, outcome and head review separately. Reassigning returned work creates a new attempt and preserves earlier rejection/acceptance history.
4. **Add decision gate** offers separate native question/choice inputs. The top head records an offered choice and optional note. **Offer different choices** creates a replacement without overwriting history. All effective gates answered resumes the same valid assignment and queues a resume notice. Expired or returned attempts still need reassignment. Gate waits do not pause deadlines.

SQLite runs locally by default. The shared library supports explicitly configured PostgreSQL as an alternative; the Mod does not yet expose hosted-store configuration or mirror local data online. Shared setup does not launch workers or migrate classic rosters.

Verification before merge: **278 SQLite/PostgreSQL tests on Node 22.13**, **433 Mod tests**, source-hook validation, bounded native gate/lifecycle checks, fresh native Node-22 workspace update and complete SQLite backup recovery. The native lifecycle checks used a test driver. Independent real-model automatic delivery is still in progress: an idle recipient without an explicit native Claude conversation association is refused by the existing verifier. Whole-Orca restart, Docker execution, bounded question/answer transitions and broader scheduling remain unverified or unfinished.

Evidence: [runtime scope](../../shared/team-store/SCHEMA-6-RUNTIME.md), [gate checkpoint](../../shared/team-store/VALIDATION-GATES.md), [history guards](../../shared/team-store/VALIDATION-HISTORY-GUARDS.md), [backup recovery](../../shared/team-store/VALIDATION-BACKUP-RESTORE.md).
