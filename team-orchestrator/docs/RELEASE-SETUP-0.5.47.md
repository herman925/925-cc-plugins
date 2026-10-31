# Guided setup release — 0.5.47

This release changes the Team Orchestrator Mod's setup and navigation. It uses the existing schema-5 typed API and identical packaged store modules. The Orca plugin's native lifecycle remains separate.

## Update and try it

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Restart/resume the Claude Code conversation after updating and confirm **0.5.47**. This loads the new manifest/configuration row; a hooks-only reload can leave the previous catalogue in memory. Use a disposable project for a fresh-team trial.

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

Local Mod suite: **397 passed, 0 failed, 41 files**. Manifest/hooks validation passed with existing metadata warnings. Packaged store check verified all **16** unchanged modules. This UI release does not establish new Docker, minimum-Node, migration, whole-Orca restart, scheduler or cross-client lifecycle acceptance. Independent validation also passed **397 tests** on the final frozen candidate. Actual native evidence covers inline draft retention, multiline purpose/roles, member/reporting-line selectors, a supported project preference save, new-conversation mode persistence, other-project defaults, contextual management approval followed by separate creation, no inherited authority in a new authenticated conversation, and explicit Head connection with Worker left unconnected.

These are layered measurements: isolated configuration persistence and authenticated approval/creation used separate fixtures. V2/V3 evidence for unchanged positive UI paths is retained alongside final V4 checks; there was no single combined default-Off authenticated run. The inherited-global-On Create persistence edge is covered by the SDK suite/source checks. Pane paint was observed, but pane field editing remains unverified; use **Edit inline** for the measured keyboard flow. Tested native host: Claude Code 2.1.316. See [the independent report](INDEPENDENT-SETUP-0.5.47.md) for exact scope and evidence.

The archived report is an exact copy of the independent original (SHA256 `12005deedb381df1422ec20877b8d7ad25a961330d727b8aa35d7619114b8815`). [Runtime hashes](SETUP-0.5.47-RUNTIME-HASHES.json) identify the tested Windows bytes; Git may normalize line endings on other checkouts.
