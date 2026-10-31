# session-panel

Session Panel hides tool calls, diffs and command output while Claude works, and shows a calm step checklist above the prompt, with a Hide details / Show details button. It also holds a prompt enhancer, a list of the assumptions Claude states, and grouped settings. Made for people who do not read code.

Version 0.3.65. The version is shown dim beside the band title, as ` v0.3.65`. It is read once per load from the plugin's own manifest, and nothing is shown if that read fails. This update recognizes available native question tools and keeps asynchronous questions pending until an answer, cancellation or closure.

Check it: `claude plugin validate session-panel` and `claude plugin test session-panel`.

Install: `/plugin install session-panel --marketplace herman925/925-cc-plugins`

## The band

The band sits above the prompt, in this order: the title line, the Settings button, the enhancer buttons, the Assumptions list, and the checklist.

- **Title:** ` Session Panel ` (or ` Session Panel · off ` when hidden), then the version.
- **Hide details / Show details** and `/simple on|off` toggle the hiding. The setting is kept between sessions. It starts on.
- **Settings** opens the Settings card (below).
- **Stop** appears only while a turn is running. It cancels that turn. The toast is `Stopped`, or `Nothing to stop: the turn has ended.` if the turn already ended.
- **Subagents:** a subagent's or teammate's turn does not start a job, change the checklist or move the Stop button; only the session's own turns do.
- **Checklist:** Claude may open a job with an optional plan line, and the band reads it as the checklist (see [How the checklist works](#how-the-checklist-works)). `mcp__session-panel__plan_steps` sets or corrects the checklist, `mcp__session-panel__report_progress` reports a percent alongside real tool calls, and `mcp__session-panel__ask_choices` asks questions (numbered choices in the band, when `/askchoices on` is set). None of these is required. Questions go through AskUserQuestion while the question box is on (the default).
- `NO_COLOR` is honoured. `NO_MOTION`, `REDUCE_MOTION` or `PREFERS_REDUCED_MOTION` gives a static meter.

### Commands

| Command | What it does |
|---|---|
| `/simple on`, `/simple off` | Shows or hides tool details. With no argument, flips it. |
| `/simple bars`, `/simple list` | Sets the progress look. |
| `/progress` | Flips between the bar view and the list view. |
| `/progress-clear` | Removes the finished bars. |
| `/askchoices on`, `/askchoices off` | Turns the `ask_choices` picker on or off. Off by default. While the question box is on, the picker is refused even when this is on. |
| `/enhance` | Enhances the text in the prompt box. |
| `/enhance <draft>` | Enhances a draft given in the command. From the prompt box, the result goes back in the box, as Enhance does. Elsewhere (for example `claude -p`), it shows the result and the model that answered (`via`), with its notes. |
| `/enhance-key` | Adds Ctrl+X E for Enhance to your `keybindings.json`. |

## Questions

Settings → Questions holds three switches:

- **Question box** (on by default): Claude writes one short plain sentence saying what is being decided, then calls AskUserQuestion in the same reply, for permission to act (edits, deletes, sends, pushes, installs) and for choices that change scope, cost, files or direction. Routine details are not asked; Claude decides them and states them as `ASSUMPTION:` lines. When a grill skill (`/grilling`, `/grill-me`, `/grill-with-docs`) loads while the question box is on, a note is attached to that skill's text asking for each of its questions through AskUserQuestion, one call per question; it is not part of this rules line. The rule is in the system-prompt section `session-panel:rules`; it is an instruction, so Claude can still miss it. While it is on, the ask_choices picker is refused with `The question box is on: ask this with AskUserQuestion instead.`
- **Picker above the prompt** (off by default): the ask_choices buttons. It is used only when it is on and the question box is off. With the question box off and the picker off, Claude is still told to ask with AskUserQuestion, so a question is never left open in prose.
- **Warn on prose questions** (on by default): when a reply ends with a question and no AskUserQuestion call was made in that turn, a toast says `Claude asked in prose instead of the question box. Turn the warning off in Settings → Questions if it is not wanted.` It needs the question box on. It does not fire when the same turn holds a short sentence and an AskUserQuestion call; it fires only when a question ends the reply with no AskUserQuestion call. It only warns; it cannot make Claude ask again.

The question-tool guidance applies without a grill skill. Claude Code normally uses `AskUserQuestion`; the instructions also explain Codex's `request_user_input`/`request_user_input_async` and Hermes Agent's `clarify`. When names differ, use an actually exposed, permitted native or MCP interactive question tool that shows choices and returns the user's answer here. Do not invent tools, change modes/permissions or install a server. Only if no permitted interactive tool exists should the agent explain that limitation and offer numbered choices. An async accepted/pending result is not an answer: keep the turn open with the available wait/resume mechanism, without a final reply or duplicate question, until the user answers, cancels or the tool closes. Ending the turn early can dismiss the card. This is prompt guidance; the existing prose warning specifically observes `AskUserQuestion` calls, and this change does not add alternate-tool event tracking or new CLI support.

## How the checklist works

There is no gate. Tools run before any plan, and no tool call is refused for lacking one. The checklist is built from what Claude says and does, and nothing is required of it.

- **Plan line (optional):** the first reply of a new job may begin with a line of the form `Plan: Read the notes · Make the changes · Check the result`. It is read only from the main agent's first request of the turn that started the job (`turn.step` index 0). A subagent's request, a later request, and a continuation turn never set it. Only the first text block of that request is read, and it must be that line (a `Plan:` line followed by a newline). Between 1 and 8 names are taken, separated by ` · `, each cleaned the same way as `plan_steps` names. An empty, malformed or longer list gives no plan. The line is hidden in the chat only when it is exactly that line; any other text is left visible.
- **`plan_steps` (optional):** sets or corrects the checklist. It is a correction tool, not a first step. Claude is never asked to retry it.
- **`report_progress` (optional):** reports a percent for a step, with its name. It must ride in the same message as a real tool call. It is never a separate turn that only reports 100%.
  - A step with no reported percent shows no percent. The bar never invents one.
- **Tool activity:** the action line under the checklist comes from the tool in use (for example, reading or editing), or from the in-progress item of a `TodoWrite` list, cleaned. A `TodoWrite` list never replaces the checklist rows; it only sets the action line. `TaskCreate` and `TaskUpdate` do not feed the action line, because they carry no activity text.
- **Jobs with no plan (fallback rows):** a job with no plan line and no `plan_steps` gets rows inferred from the tools it uses, one row per kind of tool. A kind whose latest call is still running is active; a kind whose calls succeeded is done, except that the newest kind stays active while the job is still working; a kind whose latest call failed is upcoming and is never ticked. A job that answers with no tool calls shows `Answer your question` as its one row, so it never stays blank. A plan line or `plan_steps` later in the job replaces the fallback rows with the plan.
- **Honest completion:** a turn ending never ticks unfinished steps. A finished job with unticked steps is kept in the history with the note `Reply finished — steps not confirmed`, so a missing tick is never read as done. For a job with no plan, that note appears when a step failed or was still running at the end.

  - **Explicit plan:** the plan line or `plan_steps` creates the steps, and the first is active at once. A step is ticked when its own `report_progress` reaches 100%, or when a later step is reported (every earlier step is then ticked). A `report_progress` name that matches no step adds a new step after the current one.
  - **Turn end:** the turn's end is reported by its reason. `aborted` shows Stopped, and `error` or `refusal` shows Stuck; each keeps the steps as they were. An `answer` finishes the job, and its unticked explicit steps stay unticked under the note above. The one exception is an answer that asks the person something while steps are unfinished: that shows Needs you, `Claude is waiting for your reply`. A question from `ask_choices` or `AskUserQuestion` shows Needs you with that question.
  - **Job name:** when a turn starts, a short model call names the job. It runs beside the turn, sets only the job's name, and never touches steps, phase or the finished record. If it fails, or has not answered by the time the job ends, the job keeps the default name `Working on it`.
  - **Background work:** a job whose subagent the engine spawned in the background (the spawn's `background` flag, from the main loop; the Agent call's own input is not read), or a background Bash command, does not finish when its reply does. The action line reads `Waiting for background work`. A background subagent is followed through the engine's agent list. While it is pending, running or waiting, the job keeps waiting. When it is completed, the job finishes as normal. When it is failed or killed, the job finishes with the note `Background work stopped before it finished`, and its steps are never ticked as done. When it is idle, or absent from the list, the job waits a few more polls and then finishes with the note `Background work not confirmed finished`. If the agent list cannot be read, the same note applies. A background Bash command has no end signal the plugin can see, so its job keeps waiting until the next prompt. That prompt starts a new job, and the old one closes with `Background work not confirmed finished`.
- **Parent and subagent:** the plan line is read only from the main agent. Subagent replies are never parsed for plans.
- **Progress bar:** a job with no steps shows 0% while it runs, and 0% when it finishes with no steps. A finished job shows 100% only when every step is ticked and it has no note. Otherwise it shows the average of its steps, capped at 99%. A fallback job shows 0% while it runs and 100% only when it finishes with no note.
- **New prompt during waiting background work:** a new non-empty prompt, typed while the job waits only on background work, starts a fresh job with its own plan. The old job is closed with `Background work not confirmed finished`, and its background agent is not changed by the new job. An empty automatic continuation (an engine turn with no text) keeps the same job, its plan, and its background agent; it creates and archives nothing.


### Round trips

A job that uses the optional tools makes no extra model turns for them. The plan line rides on the reply that already starts the job, and `report_progress` rides on a tool call that was going to happen anyway. A job that uses none of them still runs and still shows its action line.

### Limits and what is not verified

- **Not verified live.** The behaviour above is covered by fixture tests (`claude plugin test session-panel`). None of it was run against a live model, and none was run with live AI spending. Whether Claude writes the plan line, and how well it keeps to it, is not measured here.
- **Background work is partly seen.** A subagent the engine spawns in the background from the main loop, as the `agent.spawn` event's `background` flag says, is followed through `$.agent.list()`, and its status is the engine's. Subagent, teammate and workflow spawns are not followed. An agent the list cannot be read for, or that is idle or missing, is not treated as finished. A background Bash command has no end signal the plugin can read, so its job waits for the next prompt. **Limit:** if a job has both a background Bash command and a background agent, the job closes as `Background work not confirmed finished` on the next prompt, even when the agent has already finished, because the Bash command keeps the job waiting. **Not covered by tests:** the engine's own Agent-tool spawn. The test kit refuses `$.agent.spawn` inside a tool call, so the background-agent tests raise the spawn from the test body before the Agent call. The spawn rule itself is tested as a pure function. The composed system prompt is checked by tests that use a stub base section: the decision-step digest, and the presence of the plan, rules and assumptions sections. Whether Claude follows the plan rule in the composed text is not checked.
- **Plan line stays visible:** the plugin does not hide a `Plan:` line in the chat. An assistant message does not say which agent loop produced it, so a subagent's first line that reads `Plan:` cannot be told apart from the main agent's, and nothing is hidden on a guess.
- **Test coverage:** the stream hook is driven through `$.turn.step` in the test kit, over a bottom the test supplies. Tests cover the plan line in a first main-agent request, with every chunk passed on byte for byte; the first text block only; a subagent request; a later index; a request with no plan line; a new non-empty prompt during waiting background work, which starts a fresh job with its own plan and does not keep the first turn's plan; and an empty automatic continuation, which keeps the waiting job, its plan, and its background agent. A mutation check (`+=` replaced by `=` in the chunk accumulator) makes the pieces test fail. Not covered: the engine's own stream, a live model's text, and the drawing of the plan line, which is no longer hidden. In the test kit, the stream returned by `$.turn.step` has no `.result`; read its final value from the loop instead. Inside a hook, `next(e).result` works.

## The enhancer

The enhancer rewrites the prompt box so Claude can act on it, using the project context. It is on by default.

- **Buttons:** Enhance, Undo and Send.
  - **Enhance** rewrites the box. The result is `Enhanced. Check the box, then Send.`
  - **Undo** restores the text from before the last enhance.
  - **Send** submits the box as it stands.
- **Notes:** after an enhance, 2 to 4 short notes show under the buttons, saying what was added and which sources were used.
- **Questions:** if the draft is vague, the enhancer asks up to 3 questions, one `ask` call each, then enhances again with the answers.
- **No picker:** in a session with no picker (for example `claude -p`), the questions cannot be asked. The result is `Enhancer: it needs answers, and no picker is open in this session.`
- **`/enhance <draft>`:** from the prompt box, the enhanced draft goes back in the box, ready to send. Elsewhere, the result is shown.
  For a draft too long for the band to stay on screen, start it with `/enhance`.
- **A key for Enhance:** Settings → Add Ctrl+X E for Enhance, or `/enhance-key`. It adds Ctrl+X, then E, to `keybindings.json` in your Claude config folder; the key enhances the box as it stands, even when the band is off screen. It runs only when you ask. If Ctrl+X E is already bound, or the file is not readable JSON, nothing is changed. By hand, the same key in the `Chat` context:

  ```json
  { "bindings": [{ "context": "Chat", "bindings": { "ctrl+x e": "command:enhance" } }] }
  ```
- **Auto-enhance on Enter** (a setting, off by default): the first Enter enhances and fills the box, and does not send. The second Enter sends the enhanced text.
- **Other messages:** `The box is empty. Type a draft first.` when there is nothing to enhance. `The enhancer is off. Open Settings to turn it on.` when it is off. `Enhancer: something went wrong. The box is unchanged.` on an unexpected error.

### Model and chat

- **Model:** Haiku by default. Settings offer Haiku, Sonnet and Opus. Cheap background calls (the job title, and the enhancer when its model is Haiku) use the model named by `ANTHROPIC_DEFAULT_HAIKU_MODEL` when that is set, otherwise the plain `haiku` alias. Sonnet and Opus choices are sent as set.
- **Chat context** (a setting):
  - **Recent** (default): sends the last 6 user and assistant text turns to the model on the chosen model, Haiku unless you pick another. Each turn is capped at 1500 characters, and the whole excerpt at 6000 characters, keeping the newest end.
  - **Full chat**: asks the session itself, on the session's model, so the model sees the whole conversation. It falls back to the chosen model only if there is nothing to ask yet.

### Context sources

Each source has its own toggle in Settings → Enhancer, under a short name. Each is capped at 4000 characters.

| Source | Name in Settings | Default | What it reads |
|---|---|---|---|
| CLAUDE.md and AGENTS.md (project and global) | CLAUDE.md, AGENTS.md | on | The global `~/.claude/CLAUDE.md`, and the `CLAUDE.md` and `AGENTS.md` files in the folders above the session. |
| Project skills list | Skills list | on | The folder names in `~/.claude/skills` and `.claude/skills`. A missing folder counts as none. |
| CONTEXT.md, PRD, ADRs and glossary | Context docs | on | `CONTEXT.md`, `PRD.md`, `GLOSSARY.md`, and the file names in `docs/adr`. |
| GitHub (wayfinder map, else recent issues) | GitHub | off | The open issue labelled `wayfinder:map`: its body, with the titles of its open child tickets (GitHub sub-issues). If there is no open map, `gh issue list --limit 10`. gh runs in the session's folder, so that folder must be a GitHub repository. A gh that is missing or not signed in gives nothing. |

Each file's digest is cached by its modification time, in the plugin store. A file that cannot be read is skipped.

## First-run setup

The first interactive session with no saved setup asks five questions, once:

1. `Turn the enhancer on?` (On, Off)
2. `Which model should the enhancer use?` (Haiku, Sonnet, Opus)
3. `Which band view by default?` (List, Bars)
4. `Which context sources should the enhancer read?` (All, Instructions and skills only, None)
5. `How much chat should the enhancer read?` (Haiku + recent, Full chat (session model)). In Settings these are called Recent and Full chat.

The answers are saved. Settings → Setup → **Run setup again** asks the questions again.

## Settings

**Settings** on the band opens a card under the button. The card floats over the band, with a solid background, so opening it or switching tabs does not move the checklist or anything else in the band. While it is open, the band keeps at least enough height for the whole card (14 rows), so the card's bottom border always shows; a band that is already taller does not change.

- **Tabs:** Band, Enhancer, Questions, Assumptions, Shelf and Setup. The open tab is a filled label with a gap in the rule under it; the others sit on the rule.
- **Table:** each tab is a table with three columns: the control (ON or OFF, the choices, or a button such as `[Add]` or `[Run]`), the setting's name, and what it does. Each column is as wide as its widest entry on that tab, so every row's name and description start at the same place, on every page of the tab. A description too long for its column wraps onto the next line, in the same column. On a card too narrow for a 30-character description column, each description goes on the lines under its name instead.
- **Pages:** the card shows 6 lines of settings. A tab with more has pages; **◀ Prev**, the page number and **Next ▶** sit on the card's title line, so they stay in view. Switching tabs goes back to the first page.
- **Band:** Hide tool details; Progress look (List, Bars).
- **Enhancer:** Enhancer (on or off); Auto-enhance on Enter; Add Ctrl+X E for Enhance (`[Add]`); Model (Haiku, Sonnet, Opus); Chat context (Recent, Full chat); the four context sources.
- **Questions:** Picker above the prompt; Question box; Warn on prose questions. See [Questions](#questions).
- **Assumptions:** Track assumptions; Flag undeclared edits; Decision step (off by default); Keep threshold (0.4 to 0.8, default 0.5); Jev pass (off by default).
- **Shelf:** placeholder, coming in a later stage.
- **Setup:** Run setup again (`[Run]`).

## Migration from clean-view

On the first session that loads this plugin, the choices saved under `clean-view@herman-mods` (or `clean-view`) in the user settings are copied into this plugin's store: the hiding setting, the progress look and the ask-choices setting. A value that is already in the store is never overwritten, and the copy runs once.

## Assumptions

Claude is asked to state each assumption it makes while building, as its own line:

`ASSUMPTION: <one short sentence>`

The rule is a system-prompt section, `session-panel:assume`, on when Track assumptions is on. The line must start with plain `ASSUMPTION:`, with no bold, bullet or heading. Lines inside a code fence are ignored. Each text is cut at 200 characters.

- **Declared entries:** each `ASSUMPTION:` line in a reply becomes an entry. The same text listed twice in one turn is kept once.
- **Flagged entries:** a turn that writes files inside the project root and states no assumption adds one row for the whole turn. Its text is `<file name>, no stated assumption` for one file, or `<N> files, no stated assumption` for more. Its path cell shows the first file, relative to the project root, with ` +N-1` when there are more. Edits outside the project root are ignored. Files are written by Edit, Write, MultiEdit, NotebookEdit, and by Bash or PowerShell commands that write (redirects, `Set-Content`, `Add-Content`, `Out-File`, `Copy-Item`, `Move-Item`, `sed -i`, `cp`, `mv`). A denied or failed call writes nothing and is not flagged. The flag needs Track assumptions and Flag undeclared edits both on.
- **The list** is newest first, capped at 50 entries. Open entries come first in the panel, then the resolved ones, dimmed with their status.
- **Title:** `==== ASSUMPTIONS (N open) ====`, with the count of open entries. Click it to open or close the section.
- **Frame:** when open, the section sits in a single-line frame: the title at its top, then the column toggles, a divider, the table.
- **Column toggles:** a line `cols: ID ☑  Turn ☑  Text ☑  Path ☑  Time ☑`. Each name is a button; `☑` shows the column, `☐` hides it. Cat, Status and the buttons always show. Hidden columns free their width for the others, and the drop order applies to the rest. Text keeps at least 30 cells while it shows. The choice is saved in the store as `assumptionColumns`, and read at the next session start.
- **Select a row:** pressing its ID or its Text opens the row’s full Text and Path below it, inside the frame, wrapped over as many lines as needed. Pressing it again closes it. Pressing another row moves the open one. One row is open at a time.
- **Reveal:** when the section opens with entries, or when the first entries appear while it is open, the frame opens first and then the rows print one by one over about 400 ms. Ordinary redraws never run it again.
- **Confirm** sets an entry to `confirmed`, shown as `✓ Confirm`.
- **Wrong** sets it to `wrong`, shown as `✗ Wrong`. It then puts the correction prefix in the box for you to finish. Nothing is sent.
- **Delete**, shown as `⌫ Delete`, removes the entry from the list and the file. There is no undo.
  - A confirmed or wrong entry is deleted at once.
  - An open entry asks first, with the question `Delete open assumption <id>? Nobody has decided on it yet.` and the answers `Delete` and `Keep`. `Keep` leaves it. With no picker in the session, the entry is kept.
- **Clear resolved**, shown as `⌫ Clear resolved` in the title line, removes every confirmed and wrong entry and keeps the open ones. It asks nothing. The toast is `Cleared <N> resolved assumptions.` The button shows only when a resolved entry exists.
- **Stale:** an open entry added three or more days ago shows `stale` in the Status cell, in dim yellow (one letter, `t`, when shrunk). Its stored status stays `open`, so Confirm, Wrong and Delete still work on it, and it still counts in `Assumptions (N open)`.
- **Auto-tidy:** when the list loads and at each turn end, a confirmed or wrong entry whose `resolvedAt` is more than seven days old is removed from the list and the file. Open entries are never tidied, whatever their age.
  - A declared entry gives `Assumption '<text>' is wrong. Instead: `
  - A flagged entry gives `About the edits in turn <n> (<first file> and <N-1> more): `, or `About the edits in turn <n> (<file>): ` for one file.
- Confirm and Wrong appear only on open entries. They are two separate buttons, `✓ Confirm` and `✗ Wrong`. Delete is a third button, `⌫ Delete`, on every row. The actions cell is 26 cells wide.
- **Table widths:** at 120 cells every column shows (Text keeps 30). At 90, Time drops. At 76, Path and Turn drop too, so the columns are ID, Cat, Status, Text and the buttons. At 60 no optional column fits: ID drops, Cat and Status are one letter, and Text is 23 cells.
- **Table:** one row per entry, one column per field: ID, Cat (kind), Status, Turn, Text, Path, Time (at), and actions. Headers are Title Case: `ID`, `Cat`, `Status`, `Turn`, `Text`, `Path`, `Time`, and an empty column for the buttons. The field names in the data are unchanged. At 90 cells Path shows and Time does not; at 76 cells neither shows. Each fixed column is as wide as its header or its longest cell, and no wider. Spare width goes to Text, and to Path when it shows. Columns are separated by ` │ `, with a rule under the header (`─┼─`) and a light rule between entries. The panel takes 2N+1 lines for N entries. Colours: the header is bold; Status is yellow (open), green (confirmed) or red (wrong); Cat is cyan (declared) or magenta (flagged); ID, Turn, Time and Path are dim; bars and rules are dim; resolved rows dim their text, but keep the Status colour. Text and the `✓ Confirm ✗ Wrong` buttons always stay, and Text keeps at least 30 cells while an optional column shows. As the band narrows, Cat and Status first shrink to one letter (`C` and `S` in the headers; `d` or `f`, and `o`, `c` or `w`, in the cells). Then the optional columns drop, in this order: Time, Path, Turn, ID. Text is cut with an ellipsis. Times show as HH:MM.
- **Hidden:** the panel is not shown at all when there are no assumptions.

### The shared file

Each session keeps its list in one file, written on every change and read back when the session starts:

`<project root>/.claude/session-panel/assumptions/<name>.json`

- The file name is the session's name, with the team-orchestrator rule: any run of characters that is not a letter, a digit, `.`, `_` or `-` becomes `_` (so `Mod Builder 2` is `Mod_Builder_2.json`). The name comes from the session registry (`<config dir>/sessions/<pid>.json`, field `name`), matched by this session's id. With no name, the file is the session id's file, as before.
- Takeover: when a session closes and a new one starts with the same name, the new session takes over the same file. It keeps the old entries (each still tagged with its old `sessionId`) and sets the file's top-level `sessionId` to itself.
- A new id after `/clear`: a session that already holds a file for another session id, or a track saved by an older version, finds its file again. It takes over the named file the same way; it never writes into the old session's id file. Its running turn state is reset; its entries come from the file.
- When the registry is read: only when the session first finds its file, when its id has changed, or for a track saved by an older version. Ordinary tool calls, and status lines, read no registry. A plain tool call that edits no file does nothing for the assumptions. A `/rename` during a session is picked up at the next `/clear` or restart.
- A live owner: if the file's owner is still in the registry, or another live session has the same name, this session writes `<name>-<first 8 of the session id>.json` instead, and shows one toast. The same tagged file is used when the registry cannot be read in full (see Fail safe).
- Fail safe: if a registry folder that exists cannot be listed, or a record in it cannot be read, the owner is unknown. The session then uses the tagged file and never takes a file over. A folder that does not exist has no sessions. The registry is read again once after 200 ms before that decision, so a record caught mid-rewrite does not tag the session for good. A takeover is written at once, so the file names the new session even with no new entries.
- The folder `.claude/session-panel/` has a `.gitignore` with `*`, so git ignores the whole folder. The project's own `.gitignore` is not changed.
- Shape: `{ "version": 1, "member": "<name>", "sessionId": "<owner session id>", "entries": [...] }`. `member` is the session's name, or its session id when it has no name.
- Each entry: `{ id, text, turn, kind: "declared" | "flagged", path?, paths?, status: "open" | "confirmed" | "wrong", at, resolvedAt?, sessionId }`. `path` and `paths` are on flagged entries only: `path` is the first file, `paths` all of them, both relative to the project root.
- Files from before 0.3.34 (named by session id) are left as they are. A session with no name still reads and writes its own id file.
- Merge: when a named session loads, its own old `<session id>.json` (only if its top-level sessionId is this session's) is merged into the named file, once. Statuses are kept. An old id the named file does not have is kept. An old id it already has gets the next free id, recorded in the named file's `idMap` (old id to new id). Head lines name current ids (the roster reads the named file's ids), so `idMap` is a record of the renumbering only and is not used for lookup. The merged file name is recorded in the named file's `merged` list, so a reload does not merge it again. After the named file is saved, the old file is retired: rewritten with no entries and `mergedInto` naming the named file, so each assumption is counted once. A failed save of the named file retires nothing, so the old file keeps its entries. If the retire write itself fails, the old file is retired on a later load, when its name is still in `merged` and it still holds entries; it is not merged a second time. Another session's id file is never merged.
- An unreadable file is never overwritten.
- Failures show a toast: `Assumptions not loaded: <reason>.` on a bad file, and `Assumptions file not written: <message>` if a write fails. A failed write never stops the turn.

## Decision step

Off by default. Turn it on in Settings → Assumptions → **Decision step**. It points the model at the assumptions worth reading this turn.

- **Score:** each assumption gets a score from 0 to 1, from five parts: status (wrong 1, open 0.6, confirmed 0.2), age (less stale is higher), kind (declared 1, flagged 0.3), files the prompt names, and word overlap with the prompt.
  - **Files:** a prompt path with a folder (`hooks/decide.ts`) matches an entry by its full path or a path suffix (`src/hooks/decide.ts` matches). A bare file name (`decide.ts`) matches by base name.
- **Must match:** with the local score, an assumption that is not wrong is kept only when it shares a file or a meaningful word with the prompt. Status, age and kind only rank the matches; they never make one.
- **Keep rule:** a wrong assumption is always kept. Any other is kept when it matches the prompt and its score is strictly above the threshold. At most 5 are kept for each kind.
- **Keep threshold:** Settings → Assumptions → **Keep threshold**, 0.4 to 0.8, default 0.5. A rule in `decide.json` wins over it.
- **Digest:** one line is added to the turn, for example `Read only these assumptions: #19 (wrong: "uses the old API"), #24, #31. Skip the rest.` The 5 newest wrong assumptions are quoted in full; any others show as `also wrong: #31, #33`. The budget is 360 characters, about 60 to 90 tokens. Nothing kept means no digest.
- **Jev pass:** Settings → Assumptions → **Jev pass**, off by default. It is a second opinion from TypeSafe, one request per turn.
  - **Key:** read from the environment variable `TYPESAFE_API_KEY`. With no key, Jev is off and nothing is said.
  - **Request:** one call to the TypeSafe API (`https://api.typesafe.ai/v1/systemone`, model `jev-latest`). It asks, for each shortlisted assumption, whether it is relevant to the prompt, and it labels the prompt with one task type: build, fix, review, research, docs or other.
  - **Shortlist:** before Jev, the local score keeps the assumptions scored strictly above the task threshold. Wrong assumptions stay. Jev then decides relevance, so the match rule does not apply here.
  - **Keep:** an assumption is kept when Jev's answer is above 0.8 (p > 0.8), at most 5 for each kind. Wrong assumptions are always kept.
  - **Fallback:** no key, an error, a reply that is not usable, or an answer later than 1.5 s, and the local score is used. A failure shows one toast: `Session Panel: the Jev pass could not answer, so the local score was used.`
- **Rules file:** `.claude/session-panel/decide.json` in the project root. It is optional and has four keys:

  ```json
  { "version": 1, "default": 0.6, "paths": { "src/**": 0.7 }, "roles": { "Builder": 0.4 }, "tasks": { "fix": 0.4 } }
  ```

  - `paths`: a glob to a threshold. `**` crosses folders, `*` and `?` stay in one folder, and matching ignores case. The longest matching glob wins.
  - `roles`: the session's role on the team roster, to a threshold.
  - `tasks`: a task type from the Jev pass, to a threshold. It applies only when the Jev pass answers.
  - `default`: the threshold when no other rule matches.
  - Order, most specific first: path, then role, then task type, then `default`, then the Settings value.
- **Never blocks a turn.** Any failure gives no digest and the turn goes on. A bad rules file gives one toast per load: `Session Panel: decide.json could not be read, so the default threshold was used.` Other failures give one toast: `Session Panel: the decision step could not run. No pointer was added.`
- **Not yet:** skill and context-source candidates, file spans, and self-tuning are later slices of #91.

## Status lines from the team head

A status line changes an entry's status without a model turn. It is one line, alone on its own line:

- `SESSION-PANEL: confirm <id>`
- `SESSION-PANEL: wrong <id>`
- `SESSION-PANEL: delete <id>`

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
- `SESSION-PANEL: delete <id>` removes the entry, open or resolved, with no question. The same envelope and head-only rules apply. An applied line says `Assumption <id> deleted.` An unknown id says `No assumption <id> in this session.`

**Known limit:** the sender is matched by `from-name`, not by session id.

## Cross-mod functions

- Session Panel band: the title " Session Panel " with its version (for example " v0.3.64") when known, read from the plugin's own manifest.
- Cross-session messages and the head line: Session Panel reads `SESSION-PANEL: confirm <id>`, `SESSION-PANEL: wrong <id>` or `SESSION-PANEL: delete <id>` alone on its own line inside the cross-session envelope, with the envelope's from-name as the sender. Escaped tag forms are plain text. More than one envelope, or a malformed one, applies no status. Only the member's boss or the team top may send these lines. The head is matched by display name, not session id, so a second session with the same name could pose as head. A head's `wrong` fills the member's box with the Redirect text and submits nothing. A status-only message is dropped.
- Toasts (Session Panel side), as in the code: "Assumption <id> marked confirmed." / "Assumption <id> marked wrong." / "Assumption <id> deleted." / "No assumption <id> in this session." / "Assumption <id> is already <status>." / "Refused: <name> is not this session's team head." / "Refused: the team roster cannot be read, so <name> cannot be checked." / "Refused: more than one message envelope." / "Refused: the message envelope is malformed."
- Team-orchestrator roster view: each member's row shows "N open". Opening it shows "Open assumptions of <name> (N)". The boss and the team top see Confirm, Wrong and Delete, which send the status line as a team message; Delete asks first. Others see the count and list only. Team-orchestrator never writes an assumptions file.
- Shared files: one file per session in `<project root>/.claude/session-panel/assumptions/`, named by the session's name (`<name>.json`), by its session id when it has no name, or `<name>-<first 8 of the session id>.json` when another live session holds the name. Each holds version, member, sessionId and entries (id, text, status, kind, turn, path and paths on flagged entries only, at, resolvedAt, sessionId). Team-orchestrator reads every file in the folder and matches each one to its member by the `sessionId` inside it. `.claude/session-panel/` has a `.gitignore` with `*`.
- What needs what: Confirm, Wrong and Delete need Session Panel installed and enabled in the member's session. The counts need the files, which only Session Panel writes. Settings → Assumptions → Show (key `assumptions`), off by default, in the Team Orchestrator band's team Settings: team-orchestrator reads the files only when it is on AND Session Panel is present and enabled.
- Detection: team-orchestrator detects Session Panel from `enabledPlugins["session-panel@herman-mods"]` in `.claude/settings.local.json`, then `.claude/settings.json`, then the user `settings.json`. It rechecks on each roster refresh (every 30 s). After enabling Session Panel, run `/reload-plugins`.
