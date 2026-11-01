# Sidebar layout — 0.5.49

The shared workspace is organised for a narrow right panel. Compact Team/Settings navigation replaces the wide header. Verified access collapses into a status row with an Access button; unready access stays actionable. A team picker, Members/Tasks tabs and native subject selectors lead to one detail view at a time. Team info expands the full purpose. Task details retain full instructions, expected result, worker outcome, evidence and separate head decision.

Selections identify stable member or assignment IDs. Selecting does not connect, pick up or accept anything. Explicit action buttons operate on the displayed subject. A subject that disappears after refresh requires another choice. Returning to the same opened task preserves unsent review fields; changing the opened task clears those fields. Pending-operation recovery and critical access notices remain visible.

Setup uses native labelled scalar fields and multiline instruction fields. Settings has Display/Connection tabs and Classic teams when applicable. Placement help expands on demand; classic card controls appear only with a classic roster. The existing single-pane right default and inline fallback remain.

Update the marketplace and plugin:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Restart/resume Claude Code and confirm **0.5.49**. Open Team Orchestrator, choose Team, select a team/member/task, and use explicit Connect/Open actions. Access and Team info expand the less-used details. No slash command is needed for these controls.

The host chooses physical placement. Fullscreen with at least 110 terminal columns can dock; classic or narrow hosts use the explained inline fallback. No global renderer settings are changed. This release does not migrate data, approve management, connect sessions or deliver tasks automatically.

## Validation

Local Mod suite: **408 passed, 0 failed, 42 files**. Plugin validation passed with existing directory metadata warnings; 16 packaged store modules remain unchanged. Layout detector returned no findings. Independent native rendering and keyboard validation is pending; this document will record the final evidence before publication.