# session-panel

Session Panel hides tool calls, diffs and command output while Claude works, and shows a calm step checklist above the prompt, with a Hide details / Show details button. It also holds a prompt enhancer, a list of the assumptions Claude states, and grouped settings. Made for people who do not read code.

Version 0.3.34. The version is shown dim beside the band title, as ` v0.3.34`. It is read once per load from the plugin's own manifest, and nothing is shown if that read fails.

Check it: `claude plugin validate session-panel` and `claude plugin test session-panel`.

## The band

The band sits above the prompt, in this order: the title line, the Settings button, the enhancer buttons, the Assumptions list, and the checklist.

- **Title:** ` Session Panel ` (or ` Session Panel · off ` when hidden), then the version.
- **Hide details / Show details** and `/simple on|off` toggle the hiding. The setting is kept between sessions. It starts on.
- **Settings** opens the grouped settings (below).
- **Stop** appears only while a turn is running. It cancels that turn. The toast is `Stopped`, or `Nothing to stop: the turn has ended.` if the turn already ended.
- **Checklist:** Claude plans the job with `mcp__session-panel__plan_steps`, reports progress with `mcp__session-panel__report_progress`, and asks questions with `mcp__session-panel__ask_choices` (numbered choices in the band, when `/askchoices on` is set).
- `NO_COLOR` is honoured. `NO_MOTION`, `REDUCE_MOTION` or `PREFERS_REDUCED_MOTION` gives a static meter.

### Commands

| Command | What it does |
|---|---|
| `/simple on`, `/simple off` | Shows or hides tool details. With no argument, flips it. |
| `/simple bars`, `/simple list` | Sets the progress look. |
| `/progress` | Flips between the bar view and the list view. |
| `/progress-clear` | Removes the finished bars. |
| `/askchoices on`, `/askchoices off` | Turns the `ask_choices` picker on or off. Off by default. |
| `/enhance` | Enhances the text in the prompt box. |
| `/enhance <draft>` | Enhances a draft given in the command. Shows the result and the model that answered (`via`), with its notes. |

## The plan gate

Until the job has a plan, other tools are refused for the main agent. Subagents are never gated.

- The refusal says: `Blocked by the Session Panel mod until this session calls mcp__session-panel__plan_steps (see the Session Panel system section).`
- The rule itself is in a system-prompt section, `session-panel:plan`. It asks for `plan_steps` before any other tool, and says to skip the plan if the tool is still missing.
- **Escape:** after 3 refusals in a row with no plan, tools go through. The toast says `Session Panel: no plan_steps call after 3 tries, so tools are open.` A plan, or the end of the job, resets the count.
- If the gate hook ever fails, tools are allowed through.

## The enhancer

The enhancer rewrites the prompt box so Claude can act on it, using the project context. It is on by default.

- **Buttons:** Enhance, Undo and Send.
  - **Enhance** rewrites the box. The result is `Enhanced. Check the box, then Send.`
  - **Undo** restores the text from before the last enhance.
  - **Send** submits the box as it stands.
- **Notes:** after an enhance, 2 to 4 short notes show under the buttons, saying what was added and which sources were used.
- **Questions:** if the draft is vague, the enhancer asks up to 3 questions, one `ask` call each, then enhances again with the answers.
- **No picker:** in a session with no picker (for example `claude -p`), the questions cannot be asked. The result is `Enhancer: it needs answers, and no picker is open in this session.`
- **Auto-enhance on Enter** (a setting, off by default): the first Enter enhances and fills the box, and does not send. The second Enter sends the enhanced text.
- **Other messages:** `The box is empty. Type a draft first.` when there is nothing to enhance. `The enhancer is off. Open Settings to turn it on.` when it is off. `Enhancer: something went wrong. The box is unchanged.` on an unexpected error.

### Model and chat

- **Model:** Haiku by default. Settings offer Haiku, Sonnet and Opus.
- **Chat context** (a setting):
  - **Haiku + recent** (default): sends the last 6 user and assistant text turns to the model on the chosen model. Each turn is capped at 1500 characters, and the whole excerpt at 6000 characters, keeping the newest end.
  - **Full chat (session model)**: asks the session itself, so the model sees the whole conversation. It falls back to the chosen model only if there is nothing to ask yet.

### Context sources

Each source has its own toggle in Settings > Enhancer. Each is capped at 4000 characters.

| Source | Default | What it reads |
|---|---|---|
| CLAUDE.md and AGENTS.md (project and global) | on | The global `~/.claude/CLAUDE.md`, and the `CLAUDE.md` and `AGENTS.md` files in the folders above the session. |
| Project skills list | on | The folder names in `~/.claude/skills` and `.claude/skills`. A missing folder counts as none. |
| CONTEXT.md, PRD, ADRs and glossary | on | `CONTEXT.md`, `PRD.md`, `GLOSSARY.md`, and the file names in `docs/adr`. |
| GitHub (wayfinder map, else recent issues) | off | The open issue labelled `wayfinder:map`: its body, with the titles of its open child tickets (GitHub sub-issues). If there is no open map, `gh issue list --limit 10`. gh runs in the session's folder, so that folder must be a GitHub repository. A gh that is missing or not signed in gives nothing. |

Each file's digest is cached by its modification time, in the plugin store. A file that cannot be read is skipped.

## First-run setup

The first interactive session with no saved setup asks five questions, once:

1. `Turn the enhancer on?` (On, Off)
2. `Which model should the enhancer use?` (Haiku, Sonnet, Opus)
3. `Which band view by default?` (List, Bars)
4. `Which context sources should the enhancer read?` (All, Instructions and skills only, None)
5. `How much chat should the enhancer read?` (Haiku + recent, Full chat)

The answers are saved. Settings > Setup > **Run setup again** asks the questions again.

## Settings

Settings is a button on the band. It has five groups; only Enhancer is open at first. Each group collapses.

- **Band:** Hide tool details; Ask choices; Progress look (List, Bars).
- **Enhancer:** Enhancer (on or off); Auto-enhance on Enter; Model; Chat context; the four context sources.
- **Assumptions:** Track assumptions; Flag undeclared edits.
- **Shelf:** placeholder, coming in a later stage.
- **Setup:** Run setup again.

## Migration from clean-view

On the first session that loads this plugin, the choices saved under `clean-view@herman-mods` (or `clean-view`) in the user settings are copied into this plugin's store: the hiding setting, the progress look and the ask-choices setting. A value that is already in the store is never overwritten, and the copy runs once.

## Assumptions

Claude is asked to state each assumption it makes while building, as its own line:

`ASSUMPTION: <one short sentence>`

The rule is a system-prompt section, `session-panel:assume`, on when Track assumptions is on. The line must start with plain `ASSUMPTION:`, with no bold, bullet or heading. Lines inside a code fence are ignored. Each text is cut at 200 characters.

- **Declared entries:** each `ASSUMPTION:` line in a reply becomes an entry. The same text listed twice in one turn is kept once.
- **Flagged entries:** a turn that writes files inside the project root and states no assumption adds one row for the whole turn. Its text is `<file name>, no stated assumption` for one file, or `<N> files, no stated assumption` for more. Its path cell shows the first file, relative to the project root, with ` +N-1` when there are more. Edits outside the project root are ignored. Files are written by Edit, Write, MultiEdit, NotebookEdit, and by Bash or PowerShell commands that write (redirects, `Set-Content`, `Add-Content`, `Out-File`, `Copy-Item`, `Move-Item`, `sed -i`, `cp`, `mv`). A denied or failed call writes nothing and is not flagged. The flag needs Track assumptions and Flag undeclared edits both on.
- **The list** is newest first, capped at 50 entries. Open entries come first in the panel, then the resolved ones, dimmed with their status.
- **Title:** `Assumptions (N open)`, with the count of open entries. Click it to expand.
- **Confirm** sets an entry to `confirmed`.
- **Wrong** sets it to `wrong`, then puts the correction prefix in the box for you to finish. Nothing is sent.
  - A declared entry gives `Assumption '<text>' is wrong. Instead: `
  - A flagged entry gives `About the edits in turn <n> (<first file> and <N-1> more): `, or `About the edits in turn <n> (<file>): ` for one file.
- Confirm and Wrong appear only on open entries. They are two separate buttons, `[Confirm] [Wrong]`.
- **Table:** one row per entry, one column per field: id, kind, status, turn, text, path, at, actions. On narrow bands `at` drops first (below 90 cells), then `path` (below 70). Text is cut with an ellipsis. Times show as HH:MM.
- **Hidden:** the panel is not shown at all when there are no assumptions.

### The shared file

Each session keeps its list in one file, written on every change and read back when the session starts:

`<project root>/.claude/session-panel/assumptions/<session id>.json`

- The file name is the session's name, with the team-orchestrator rule: any run of characters that is not a letter, a digit, `.`, `_` or `-` becomes `_` (so `Mod Builder 2` is `Mod_Builder_2.json`). The name comes from the session registry (`<config dir>/sessions/<pid>.json`, field `name`), matched by this session's id. With no name, the file is the session id's file, as before.
- Takeover: when a session closes and a new one starts with the same name, the new session takes over the same file. It keeps the old entries (each still tagged with its old `sessionId`) and sets the file's top-level `sessionId` to itself.
- A live owner: if the file's owner is still in the registry, or another live session has the same name, this session writes `<name>-<first 8 of the session id>.json` instead, and shows one toast.
- The folder `.claude/session-panel/` has a `.gitignore` with `*`, so git ignores the whole folder. The project's own `.gitignore` is not changed.
- Shape: `{ "version": 1, "member": "<name>", "sessionId": "<owner session id>", "entries": [...] }`. `member` is the session's name, or its session id when it has no name.
- Each entry: `{ id, text, turn, kind: "declared" | "flagged", path?, paths?, status: "open" | "confirmed" | "wrong", at, resolvedAt?, sessionId }`. `path` and `paths` are on flagged entries only: `path` is the first file, `paths` all of them, both relative to the project root.
- Files from before 0.3.34 (named by session id) are left as they are. A session with no name still reads and writes its own id file. Nothing is merged or moved.
- An unreadable file is never overwritten.
- Failures show a toast: `Assumptions not loaded: <reason>.` on a bad file, and `Assumptions file not written: <message>` if a write fails. A failed write never stops the turn.

## Status lines from the team head

A status line changes an entry's status without a model turn. It is one line, alone on its own line:

- `SESSION-PANEL: confirm <id>`
- `SESSION-PANEL: wrong <id>`

**Where it is accepted:**

- **Typed by you** in a plain prompt: accepted.
- **Inside a cross-session message:** accepted only when `from-name` is this member's boss, or the team top (the member whose boss is `user`, in the same team). Both come from `.claude/team-orchestrator/roster.json`, which this plugin reads and never writes. This member is found by its session id.
- **Anywhere else:** refused. The reason is shown as a toast and as the drop note:
  - `Refused: <name> is not this session's team head.`
  - `Refused: the team roster cannot be read, so <name> cannot be checked.`

**Envelopes.** A message from another session arrives in `<cross-session-message from="..." from-name="...">` ... `</cross-session-message>`. Only unescaped tags count. A tag written inside a body with a backslash is plain text, so a forged envelope inside a body applies nothing.

- A prompt with more than one envelope, or a broken one, applies no status. The toast is `Refused: more than one message envelope.`, or `Refused: the message envelope is malformed.`. A prompt with status lines is dropped with that note.

**What happens next:**

- An accepted `wrong` also fills the box with the Redirect text, the same as the local Wrong button. Nothing is submitted.
- If the message holds only status lines, it is dropped, so no model turn starts. The note is shown.
- If it holds other text too, the status is applied and the whole message goes on to the model.
- An unknown id, or an entry already resolved, changes nothing and says why: `No assumption <id> in this session.` or `Assumption <id> is already <status>.`
- An applied line says `Assumption <id> marked confirmed.` or `Assumption <id> marked wrong.`

**Known limit:** the sender is matched by `from-name`, not by session id.

## Cross-mod functions

- Session Panel band: the title " Session Panel " with its version (" v0.3.32") when known, read from the plugin's own manifest.
- Cross-session messages and the head line: Session Panel reads `SESSION-PANEL: confirm <id>` or `SESSION-PANEL: wrong <id>` alone on its own line inside the cross-session envelope, with the envelope's from-name as the sender. Escaped tag forms are plain text. More than one envelope, or a malformed one, applies no status. Only the member's boss or the team top may send these lines. The head is matched by display name, not session id, so a second session with the same name could pose as head. A head's `wrong` fills the member's box with the Redirect text and submits nothing. A status-only message is dropped.
- Toasts, as in the code: "Assumption <id> marked confirmed." / "Assumption <id> marked wrong." / "No assumption <id> in this session." / "Assumption <id> is already <status>." / "Refused: <name> is not this session's team head." / "Refused: the team roster cannot be read, so <name> cannot be checked." / "Refused: more than one message envelope." / "Refused: the message envelope is malformed."
- Team-orchestrator roster view: each member's row shows "N open". Opening it shows "Open assumptions of <name> (N)". The boss and the team top see Confirm and Wrong, which send the status line as a team message. Others see the count and list only. Team-orchestrator never writes an assumptions file.
- Shared files: `<project root>/.claude/session-panel/assumptions/<name>.json` with version, member, sessionId, and entries (id, text, status, kind, turn, path (flagged entries only), paths (flagged entries only), at, resolvedAt, sessionId). `.claude/session-panel/` has a `.gitignore` with `*`.
- What needs what: Confirm and Wrong need Session Panel installed and enabled in the member's session. The counts need the files, which only Session Panel writes. Settings → Assumptions → Show (key `assumptions`), off by default, in the Team Orchestrator band's team Settings: team-orchestrator reads the files only when it is on AND Session Panel is present and enabled.
- Detection: team-orchestrator detects Session Panel from `enabledPlugins["session-panel@herman-mods"]` in `.claude/settings.local.json`, then `.claude/settings.json`, then the user `settings.json`. It rechecks on each roster refresh (every 30 s). After enabling Session Panel, run `/reload-plugins`.
