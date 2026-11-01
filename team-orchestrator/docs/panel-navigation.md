# Panel navigation — 0.5.50

A new project starts with **＋ Create team** and **Settings** in the band. The arrow or `t` opens the same team entry. Create team opens a draft before workspace mode or management permission is enabled.

Setup has four steps: **Team → Members → Options → Review & permission**. Back, Close setup and switching to Settings keep the draft and its member identities in this conversation. Discard requires its own confirmation. Draft recovery after a whole-app restart is not promised.

Review shows the project path and saved settings. **Use shared workspace for this project** remembers this project's mode in this installation; other projects keep their defaults. **Allow team management** approves only this conversation. **Create team** is a separate action that appears after confirmed permission. Opening a draft, enabling the project mode or approving management never creates the team automatically.

After confirmed creation the main entry becomes **Team workspace**. It provides a team dropdown, **New team**, **Members** and **Tasks**. A store file alone cannot prove a team exists: before authorized discovery, an existing store uses the neutral **Open teams** label. Bound workers can open their own tasks without controller approval.

Click the active Team/Settings entry again to close it; clicking the other switches views. There is one Settings entry at a time. Settings contains **Display** and **Connection**, plus **Classic teams** when an older roster exists. Classic roster data and creation remain a separate explicit destination; nothing is migrated.

The entire Mod now requests **one right panel** by default: setup, workspace, classic teams and Settings all use the same native pane. Existing stacked/side-by-side card choices remain card arrangements and do not override placement. Closing the native frame closes the panel without resetting its right preference. Changing views or completing Create keeps that pane.

**Settings → Display → Panel** chooses **Right panel** or **Inline**. The compact band also offers **Edit inline** or **Dock right** while open; the choice applies across views and retains the current draft/workspace. Card arrangement is a separate control. There is only one full body, never both the band and pane.

Actual right docking belongs to the host: Claude Code must use its **fullscreen renderer** with at least **110 terminal columns**. Classic mode seats a requested pane above the prompt; narrow fullscreen windows also use inline placement. The panel explains the actual condition using the host viewport. Closing it does not convert the saved preference to Inline. If the host has not placed a requested pane at all, the band provides the controls and **Retry right panel**; an explicit retry can place a pane that was deferred on background startup.

The host's normal **/tui** command changes its user-wide renderer preference and requires a restart. The Mod does not run it or change global host settings automatically. Its SDK has no live placement/renderer setter. **Right panel** therefore requests docking where supported; it cannot force a classic/narrow host to dock.

Native Tab/Enter/Escape and widget scrolling still apply. Dropdowns select members and reporting lines; official instructions and purpose use multiline fields.

Update the marketplace and Mod:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Restart/resume the Claude Code conversation after updating so the host loads the new manifest and configuration row, then confirm **0.5.50**. A hooks-only reload can retain the old configuration catalogue. Updating never approves a controller, creates a team or connects a session.

## Sidebar hierarchy

The shared workspace uses compact Team/Settings navigation. A project/status row expands Access controls only when needed; an unready workspace keeps those controls visible. Choose a team, then Members or Tasks. Each native selector shows one subject with its details and explicit actions. Changing a selector does not connect a session, pick up work or accept a task. Missing selected subjects require another explicit choice.

Team info expands the full purpose. Open task retains full instructions, expected result, worker outcome, evidence and the separate head decision. Pending-operation recovery and critical access notices remain visible. Setup uses labelled single-line inputs and separate multiline instructions. Task and review forms use visible native labelled inputs; a new assignment selects its own task and clears the previous task's unsent review fields. Display settings keep placement help behind an expander and show classic card controls only when a classic roster exists.

## Creation choices

The first Create team step exposes the original **Squad** (head + 3 workers), **All-Purpose Team** (CEO + 2 heads, 4 workers each) and **Tech Team** (CEO + 4 heads, 4 workers each). Click a template to preview, then **Use template** to replace the draft name and members. Purpose and options stay. CEO templates use named reporting branches within one shared roster; they do not create several independent shared teams. Every member remains editable.

**Interview me** starts interactive questions in the conversation. The agent uses the available multiple-choice question tool and returns its proposal to **Review & permission** through `team_draft`. The visible request stays short; a read-only helper supplies the complete current draft and question guidance to the agent. Create stays unavailable until the proposal finishes or is cancelled. It fills a draft only. You still review members and options, explicitly enable the project mode, allow management and Create separately. Editing the draft during an interview makes that proposal stale; Cancel proposal and restart Interview me to include your edits. Cancelling invalidates the proposal, without silently stopping the model turn.

In Members, **Edit member** opens and closes its list. Choosing the same or a different member closes it; **Close member picker** is also available. Buttons use native click or Tab/Enter. Escape follows the host's setup-pane close behavior; reopening retains draft/selection with the picker closed. Inline Escape follows host focus behavior and is not a separate custom picker key handler.
