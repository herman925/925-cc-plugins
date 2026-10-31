# Guided setup release — 0.5.47

This release changes the Team Orchestrator Mod's setup and navigation. It uses the existing schema-5 typed API and identical packaged store modules. The Orca plugin's native lifecycle remains separate.

## Update and try it

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Reload through the normal plugin control and confirm **0.5.47**. Use a disposable project for a fresh-team trial.

1. Click **＋ Create team**. Give the team a name and purpose.
2. In **Members**, select a member to edit its name, role and multiline official instructions. Reports to lists earlier members; add/remove workers as needed.
3. In **Options**, choose capacity and pickup timing. Advanced contains answer/task windows, replay and executable settings. These stored windows do not add automatic scheduling or window enforcement.
4. In **Review & permission**, choose **Use shared workspace for this project** if needed, then explicitly **Allow team management**. Confirm the project path. Permission alone does not create the team.
5. Click the separate **Create team** action. Confirmed creation opens **Team workspace**. Use **Connect session**, choose a verified session, then explicitly **Connect selected session** for each member.
6. A connected head assigns tasks and separately reviews worker outcomes. Connected workers open their own Tasks, read the role and brief, and report evidence. No automatic launch or delivery is added.

Close and Back keep an unfinished draft in this conversation. Discard asks before clearing it. Whole-app restart recovery of drafts/pending UI requests is not promised. If creation is unconfirmed, reconcile the original request before attempting anything else.

## Preference and permission

Project mode is remembered for later conversations at the same project path in this client installation. Other projects retain their saved choices or global fallback. A new conversation requires its own management approval. Existing approvals coexist under the existing conflict guard; turning mode Off revokes neither approval nor store guards.

The initial existing-store label is **Open teams** until authorized team discovery. It never infers a team from a SQLite file or an unapproved empty projection. Existing classic teams remain separate and are not migrated.

Settings groups Display, Connection and existing Classic teams. The native setup pane uses an inline fallback when unplaced; **Edit inline** switches to it explicitly and retains the draft. Native Tab/Enter/Escape and widget scrolling still apply on narrow terminals.

## Validation scope

Local Mod suite: **397 passed, 0 failed, 41 files**. Manifest/hooks validation passed with existing metadata warnings. Packaged store check verified all **16** unchanged modules. This UI release does not establish new Docker, minimum-Node, migration, whole-Orca restart, scheduler or cross-client lifecycle acceptance. Independent native validation evidence is recorded separately before publication.
