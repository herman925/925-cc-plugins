# Sidebar layout — 0.5.49

The shared workspace is organised for a narrow right panel. Compact Team/Settings navigation replaces the wide header. Verified access collapses into a status row with an Access button; unready access stays actionable. A team picker, Members/Tasks tabs and native subject selectors lead to one detail view at a time. Team info expands the full purpose. Task details retain full instructions, expected result, worker outcome, evidence and separate head decision.

Selections identify stable member or assignment IDs. Selecting does not connect, pick up or accept anything. Explicit action buttons operate on the displayed subject. A subject that disappears after refresh requires another choice. Returning to the same opened task preserves unsent review fields; changing the opened task clears those fields. Pending-operation recovery and critical access notices remain visible.

Setup uses native labelled scalar fields and multiline instruction fields. Workspace task/review inputs now have visible native labels and placeholders, fixing empty fields that previously collapsed into captions. Newly admitted assignments select their own task and clear the previous task's unsent review fields. Settings has Display/Connection tabs and Classic teams when applicable. Placement help expands on demand; classic card controls appear only with a classic roster. The existing single-pane right default and inline fallback remain.

Update the marketplace and plugin:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Restart/resume Claude Code and confirm **0.5.49**. Open Team Orchestrator, choose Team, select a team/member/task, and use explicit Connect/Open actions. Access and Team info expand the less-used details. No slash command is needed for these controls.

The host chooses physical placement. Fullscreen with at least 110 terminal columns can dock; classic or narrow hosts use the explained inline fallback. No global renderer settings are changed. This release does not migrate data, approve management, connect sessions or deliver tasks automatically.

## Validation

Local and final independent Mod suites each passed **409 tests, 0 failed, 42 files**. Plugin validation passed with existing directory metadata warnings; 16 packaged store modules remain unchanged. Layout detector returned no findings.

Native checks used an owned disposable project in an actual right dock: setup labels and retained drafts, explicit permission/Create, two connected members, keyboard member selection, two assignments through the repaired task fields, task selector navigation, separate Open with full instruction/expected-result endings, Access expansion, Settings tabs and placement help. No task was picked up, executed or accepted in this layout run. Outcome/evidence/head-decision rendering, missing/duplicate targets and uncertain-operation recovery remain SDK regression coverage. This does not establish new schema, PostgreSQL, scheduler, migration or whole-app-restart acceptance. No real project store or global configuration was changed.

See the [independent report](INDEPENDENT-SIDEBAR-0.5.49.md) and [tested runtime hashes](SIDEBAR-0.5.49-RUNTIME-HASHES.json). Hashes identify tested Windows bytes; Git can normalize line endings on other checkouts.
The immutable independent report SHA256 is `9762af012ef9af8493cd9082f6e819cdb6a4276b02804db99178a5c50b14659c`. The host reported an actual 68-column dock body for the requested 66-column pane.
