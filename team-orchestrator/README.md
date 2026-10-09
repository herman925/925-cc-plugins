# team-orchestrator

Builds and manages a team of Claude Code sessions as Orca tabs: a form to start a team, a live roster, an org chart, and a
guard that keeps the heads from writing files themselves and everybody from starting subagents unless you say so.

This page explains the two rules that people ask about. Everything else is on the screen.

## Short names in the org chart

Each member has a name (`Hualong PC Console Boss`). The org chart has little room, so it shows a short name instead.

**You decide the short name.** The rule below is only a fallback for members that have none.

### Where to set it

- **Team actions → Sessions → Set short name…** Tick one row of the team, open the box, type, press Save (or Enter).
  An empty name clears it. One row at a time.
- **`team_launch` and `team_adopt`**: each member takes an optional `short`. Adopting a member again keeps the short name
  it already has; an empty `short` clears it.
- **`member_move`** keeps it.

The short name is saved in the roster file next to the member.

### What the chart does with it

- A short name you set is shown **exactly as you typed it**. The chart never changes it. Only when the chart would not fit
  in the width, the long ones are cut with "…" to 14, then 10, then 6 characters. If even that does not fit, the chart
  shows dots only.
- Two members with **the same short name** both show it. The chart adds "!" after each of them and the roster row says
  "short name used twice". Nothing is renamed behind your back. Capital letters do not count: `Lead` and `lead` are the same.
- A member with **no** short name gets one from the rule, drawn dim.

### The rule (for members with no short name)

The rule only looks at the letters of the names. It does not know what they mean.

1. Take the name and drop the words it shares with its team name (`Hualong PC Worker A` in team `Hualong` leaves
   `PC Worker A`). Also drop the words that every member of the team starts with.
2. Try these in order and take the first one that no other member already has:
   1. the first word if it is all capitals, and the last word (`PC Boss`);
   2. the first letter and a short tail of numbers or letters (`Worker 5` → `W5`);
   3. the last word (`Workers`);
   4. the first word;
   5. all the words that are left.
3. If members still clash, put the first word of the team in front (`Dev Head`, `UI Head`), then the whole name.

The rule keeps away from every short name you set: if you call the CEO `Workers`, the member it would have called
`Workers` takes the next try.

### Hualong

The real roster has two teams, `Hualong-HQ` and `Hualong-PC`. The rule cuts a team name at the hyphen, so
`Hualong-PC` takes the words `Hualong PC` off every name in that team. This is what the rule gives, with no short name set:

| Team | Name | What the rule gives |
|---|---|---|
| Hualong-HQ | Hualong CEO | CEO |
| Hualong-HQ | Hualong Workers | Workers |
| Hualong-HQ | Hualong Worker 5 | W5 |
| Hualong-PC | Hualong PC Console Boss | Boss |
| Hualong-PC | Hualong PC Worker A | WA |
| Hualong-PC | Hualong PC Worker B | WB |

The roster file of 2026-10-05 holds other names in the same two teams: `Hualong-Messenger` gives `Messenger`,
`Hualong-PC-Lead` gives `Lead`.

The team name matters. If all six were in one team named plain `Hualong`, the rule would keep the `PC` and give
`PC Boss`, `PC A` and `PC B`. Both cases are tests (`layout.test.ts`).

Where a label is not the one you want, set it by hand.

### An example the rule does not understand

`HK University of Hong Kong president` should be `HK president`. The rule does not know that. What it gives depends on
the words around it:

- in a team that is also called `HK` it drops the shared word `HK` and gives `president`;
- in a team with another name it takes the first word (all capitals) and the last word and gives `HK president`, by luck.

If the short name matters, set it.

## The guard: no subagents, and heads do not write

A hook watches the tools of every session that is **on the roster**. A session that is not on the roster is never touched.
The plugin knows which member a session is from its Orca tab, its **session id** and **its name**; see [Identity (0.5.10)](#identity-0510).

| Tool | Who is refused | Unless |
|---|---|---|
| `Agent` (a subagent) | every roster member | allowed (below) |
| `Write`, `Edit`, `NotebookEdit` | a member with reports (somebody has it as boss), the CEO included | allowed (below), or the file is in its own memory folder `~/.claude/projects/<project>/memory/…` |

The refusal says who is refused and tells the model to hand the work to a worker with `SendMessage`, or to ask you to allow it ("allow it yourself"; in Chinese "或自行授權"). From 0.5.13 the built-in helpers `statusline-setup` and `claude-code-guide` always pass.
Each refusal, and each time a permission lets a call through, leaves one line in a toast, for example
`blocked Agent: Hualong CEO has no subagent permission`.

A subagent runs inside its session, so a refusal for the session covers its subagents too.

### How you allow something

1. **Standing:** Settings → Permissions. Each member has **Allow subagents** and **Allow writes**, both off. They are kept
   in the roster file, which the guard reads again on every call, so a change counts at once in every session of the project.
2. **One turn:** type a keyword in your own message.
   - `#allow-subagent` lets the Agent tool through for that turn.
   - `#allow-write` lets Write, Edit and NotebookEdit through for that turn.

   The words count only in a prompt **you typed at the terminal** (the engine's `composer` origin). The same words in a
   message from another session, in a tool result, or in a prompt that another plugin submitted allow nothing. A later prompt
   of yours without the words takes the grant back, and the grant also ends when the turn ends.

### Known limits

- **Bash is not guarded.** A head can still change files with a shell command. This is on purpose for now.
- The engine hands the hook the whole prompt text, so a keyword you **paste** into your own prompt counts like one you type.
- A prompt you type while a turn is running applies at once to the turn that is running.
- The one-turn grant lives in the session's memory: a reload of the plugin (`/reload-plugins`) forgets it.
- A session that matches nothing on the roster (no tab, id or name of a member) is treated as not on the roster.

## Team files and live status (0.5.0)

Everything a team needs lives in `.claude/team-orchestrator/` inside the project (git-excluded):

| File | What it holds | Who writes it |
|---|---|---|
| `roster.json` | Structure: teams, bosses, roles, levels, and each member's `statusFile` | The mod, on a structural change |
| `status/<name>.json` | One member's live status: state, last turn, heartbeat, model, effort, context %, task line, last "clean", leftover-process count | That member's own session only |
| `settings.json` | Team worker settings: auto-close, idle minutes, never-close list, reopen as resume or fresh, max open sessions | Settings → Workers |
| `queue.json` | Messages for closed workers waiting for room under the session cap | The mod |

Members report their own state on turn start and end, when they ask you something, and on a 60 s heartbeat. A member
silent for 5 minutes shows as offline. Nobody reads other members' screens any more. Only the team's top session asks
Orca whether tabs still exist, at most every 2 minutes, one call at a time, and only when someone has been silent for
over 2 minutes; the interval doubles (up to 10 minutes) while Orca answers slowly.

Workers that said "clean" and stayed idle for the set minutes are closed. A message to a closed worker reopens it
(`claude --resume`, or fresh and briefed again) and is then delivered. When the session cap is full and every worker is
busy, the message waits in the queue. Anyone with reports is never closed.

The old single file `.claude/team-orchestrator.json` is moved into the folder on first use (a copy stays as
`roster.json.bak`), and the old path is left as a pointer.

## Staged Create and on-demand members (0.5.03)

Create writes the whole roster to `roster.json` first. It then starts only the top member and, under a CEO, each team's head. Leads and workers are marked "not yet" (`pending` in the roster). Each one starts the first time its boss messages it with the `team_message` tool. It starts fresh, gets its briefing, and then receives the message.

Sessions start a batch at a time. The default batch size is 3. Each batch is started, waited for until ready, and briefed, and the next batch follows 5 s later. While this runs, a "Starting the team" window takes over the panel and shows each member's progress.

Settings → Workers has two options for this:

- **Launch:** "On demand" (the default) or "All at Create".
- **Batch size:** 1, 2, 3, 4 or 6.

Bosses message their reports with `team_message`, not `SendMessage`. SendMessage checks the name before any plugin hook runs, so it cannot start a member that has no session yet. It also rejects a name that a Remote Control copy shares. `team_message` starts or reopens the member when needed, then sends to the session on this machine by its `name [ref]`.

## Role files and the start-up pointer (0.5.04)

Each member's role lives in `.claude/team-orchestrator/roles/<name>.md`. The file has two parts:

- **Above the marker:** the generated part, built from the roster. It holds the job for the member's level, its boss and reports, messaging rules, housekeeping, the team and the team files. It is rewritten whenever the team changes.
- **Below the marker:** "Personality and notes", for a voice, a working style or extra rules. The mod never changes this part.

Every session starts with a short pointer in its system prompt, passed with `--append-system-prompt` at Create, on an on-demand start and on every reopen, whether resumed or fresh. The pointer gives three things:

- the member's name and boss
- the one rule for its level
- the path of its role file

The member reads the file once. When the file changes, Claude Code tells the session what changed, so nothing is re-sent every turn except the short pointer.

Create's first prompt asks each new session to read its role file and answer "Noted". Nothing is typed into a terminal any more.

The SendMessage description now says that a teammate who is not running is unknown to it, and that `team_message` should be used instead. On a team, `team_message` is listed up front, not behind ToolSearch.

## Model names on start and reopen (0.5.05)

The roster shows a short model name, such as `haiku-5-5`. Before 0.5.05, a start or reopen passed that name to `claude --model`. Claude Code launched with it, but the API rejected it on the first call, often an automatic compaction. Every start, reopen and restart now normalises the name:

- Aliases (`opus`, `sonnet`, `haiku`, `fable`) pass as they are.
- Full `claude-...` ids pass as they are.
- Short names (`haiku-5-5`) and display names (`Haiku 5.5`) become `claude-haiku-5-5`.
- Anything else is left out, so the session uses its default model. (From 0.5.13 any other name passes as typed; see [0.5.13](#model-messages-workspaces-and-other-clis-0513).)

## Windows, macOS and Linux (0.5.06)

- **Orca command.** This is a plugin option, `Orca command`, in `/config`. When it is empty, the mod chooses `orca.exe` on Windows and `orca` elsewhere, checks that the command starts (`--version`), and saves it into the option once. When you edit the option, the mod refuses a command that does not start and shows the error. At every start the mod checks the command again and shows a toast only on failure.
- **Workspace.** New members open in the workspace of the tab you typed in. The mod reads `ORCA_WORKTREE_ID`, which Orca sets in every terminal, before it asks `orca worktree current`. Asking by folder picks the wrong workspace when two Orca workspaces share one folder.
- **Errors.** A team tool never crashes; it returns a sentence that says what failed. Before this release, a hook that threw was skipped, and the engine then said no hook had answered, which looked like missing code.
- **macOS and Linux.**
  - Transcript tails are read with `tail`.
  - The leftover count uses `ps`, counting shells and runtimes under the member's own `claude` process. It shows "unknown", not zero, when that process cannot be found.
  - Housekeeping notes give each platform's own process names.
  - The start text also removes `$`, the backtick, the backslash and (0.5.07) `!`, which an interactive bash or zsh would expand.
- **Scratch clean-up without asking.** This is in Settings → Workers and is on by default. A worker may delete inside its own session's temporary folder without a prompt. Heads and leads may also delete in the system temp folder and in the project scratch folder (`.claude/scratch` by default). The mod approves only a single plain delete command, lifting an "ask" to "allow"; it never overrides a deny. Everything else still asks. The cross-CLI design (Codex, Hermes and others) is tracked in #51 and #55.
- **Model and effort saved in the roster.** Before this release, `roster.json` did not keep them. A member started on demand from another session (for example, a lead's first `team_message`) then came up on the CLI defaults instead of the values chosen at Create.

## Version in the panel (0.5.08)

The panel header shows the installed version next to the title (`◆ TEAM ORCHESTRATOR v0.5.08`). The mod reads it once per load from its own `plugin.json`, so it always matches what is installed.

## Band title pill (0.5.09)

The band above the prompt starts with a filled title pill in the same colours as Clean View: cyan background, bold black text. It reads `◆ Team Orchestrator v0.5.09`. With NO_COLOR set, it uses reverse video instead. A Button cannot take a background colour, so the open and close control is the small `▸` / `▾` button beside the pill. The `t` hotkey still opens and closes the panel.

## Identity (0.5.10)

A member stays recognised after `/clear`, `/rename` or a fresh `claude` in its tab (#57). Each session checks three
facts against the roster: its Orca tab (`ORCA_TERMINAL_HANDLE` against the member's handle), its session id, and its
name (from the machine's session registry, `~/.claude/sessions/<pid>.json`, else its transcript title). The rules are
in `hooks/identity.ts`; the answer is worked out once per refresh, not on every tool call.

| Facts that match | Treated as | Roster update |
|---|---|---|
| tab + id + name | the member, full rights | none |
| tab + id, new name (`/rename`) | the member, full rights | name and address take the new name, its reports follow, its role and status files move, a toast says so |
| tab + name, new id (`/clear`) | the member, full rights | session id = the new id, so a reopen resumes the right conversation |
| id + name, another tab | the member if its own tab is gone; **on hold** if that tab is still open | handle = this tab |
| tab only (a fresh `claude` in the tab) | the member, re-attached | takes the id and name; the next prompt carries "You are X in team T. Your role file is …; read it now." once |
| id only, or name only | **on hold** | none |
| nothing | not on the team | none |

- **Outside Orca** (no tab handle) the tab is unknown, not a mismatch. A registry record with the session's id in a
  folder under the project counts in place of the tab, as proof of the same machine, beside an id or a name and only
  while the member is not running elsewhere. No record (another device) means on hold.
- **A `/rename` to another member's name is not followed**: the session stays who its tab and id say, with that
  member's rights, never the other's.
- **On hold** means the strictest guard (Write, Edit, NotebookEdit and Agent refused unless you type
  `#allow-write` or `#allow-subagent` for that turn), every team tool refused with a sentence saying why, and no status
  written under the member's name. Once per session id the mod records the case in `claims.json`, warns the member's
  head, and tells the team top (by session id, `$.session.send`) to ask you at once with AskUserQuestion: **this is
  X**, **new member under X's boss**, or **reject**. The top applies the answer with the `member_claim` tool
  (`{ sessionId, decision: "is" | "new" | "reject", member }`), which only the confirmed team top may call.
- **#61:** the roster's bulk rename and restart keeps each member's saved model and effort when they are left on "keep".

## Locked team files, safe scratch clean-up, Orca self-fix (0.5.11)

- **Team files (#58).** `.claude/team-orchestrator/roster.json` and `settings.json` are changed only by the mod itself,
  by sessions not on the roster, and by the team top (boss `user`). Every other member, and any session on hold, is
  refused `Write`, `Edit` and `NotebookEdit` on them, and any `Bash` or `PowerShell` command that names them and is not
  plainly read-only (`cat`, `type`, `Get-Content`, `ls`, `dir`, `grep`, `Select-String`, `jq` without `-i`, one plain
  command or a pipe of them). A mixed or unclear command (a redirect, a substitution, another program) is refused
  with the reason. No grant opens them: `#allow-write` and Allow writes do not. `status/`, `roles/` and `queue.json`
  stay writable. Rules: `isTeamFilePath`, `namesTeamFile`, `notReadOnly`, `judgeTeamFiles` in `hooks/guard.ts`.
- **Rights changed outside the mod (#58).** What the mod last wrote for each member's Allow writes and Allow subagents
  is recorded in the plugin's store. The team top's refresh compares the roster file with it; a difference seen on two
  refreshes in a row is toasted to the top once and noted on the member's row. Nothing is reverted.
- **Scratch auto-approve (#60).** Only plain literal paths: a `*`, `?`, `[` or `]` in a target, or a trailing slash,
  leaves the engine's ask. Before approving, every folder from the allowed root down to the target, and the target,
  is listed: a link (or anything that is neither a file nor a folder) asks. A recursive delete (`rm -r`, `rm -rf`,
  `Remove-Item -Recurse`, `rd /s`, `rmdir /s`, `del /s`) also walks the target, up to 2000 entries, and asks if any
  entry inside is a link or the folder is larger. Hard links are left alone. Rules: `scratchDeletePlan` and
  `linkFree` in `hooks/platform.ts`.
- **Orca command (#70).** At start, a saved Orca command that fails `--version` while the platform default (`orca.exe`
  on Windows, `orca` elsewhere) works is switched to the default in `/config`, with a toast.
- **Helpers (#73).** A subagent's or a workflow agent's call (it carries `agentId`) is judged as its spawning member,
  by the grants standing right now: Allow writes and Allow subagents, and a one-turn `#allow-…` until the spawner's
  own turn ends. Tests in `hooks/lock.test.ts`.

## One writer, and teams on two PCs (0.5.12)

**One writer (#59).** Only the team top's session, on the top's machine, writes `roster.json` and `settings.json`.

- Every other session writes a small change file instead, `.claude/team-orchestrator/changes/<ms>-<rand>.json`. It holds
  only the member fields that session changed (or a settings patch). The session's own panel shows the change at once.
- Every session reads the roster as the file plus the change files not yet applied, oldest first, field by field. So
  all sessions see the same team before the top has caught up.
- The top's refresh (every 30 s) folds the change files into the files. The mod cannot delete a file, so applied
  change files stay where they are and `changes/applied.json` lists them. A change file older than 7 days is ignored by
  its name alone.
- Until a team has a running top on this machine, a session that is not on the roster (your own) writes in its
  place. The first write of a new team is always direct.
- A change of Allow writes or Allow subagents that arrives in a change file is toasted to the top, with who made it.
  Members may not write `changes/` or `meta.json` with tools, so a change file cannot be forged by hand.

**Schema stamp.** `meta.json`, beside the roster, holds `schemaVersion`, `writtenBy` (the top's mod version) and
`topMachine`. `roster.json` stays a plain array, so 0.5.11 and older still read it. A session whose mod is older than
`writtenBy` writes no team file. It toasts once: update team-orchestrator and `/reload-plugins`. Its changes wait as
change files for a current top.

**Queue.** One file per message, `queue/<ms>-<rand>.json`: `to`, `from`, `message`, `created`, `state`
(pending, sending, delivered, failed) and `tries`.

- The top's round delivers what has room. "No room under the cap" is not a failed try.
- After 3 failed tries the entry is marked failed, and the sender's head is told.
- Delivered and failed entries are pruned after a day, everything after 7 days. `queue/pruned.json` lists them.
- An old `queue.json` is moved in once and left as `[]`.

**Machines (#64).** Status files live on each machine, never in the project:
`<claude config dir>/team-orchestrator/<project key>/status/<name>.json`. The project key is the project path with
every character but a letter or digit turned into `-`, the way Claude names its projects folders. A status file an older
version left in the project is read once per member and moved.

- Every member records its home machine (`machine`, the computer name) at launch, adopt, reopen and identity re-attach.
- A member whose home is another PC is never matched by tab or registry here. With only its id and name it is held for
  you to decide.
- Reopen, auto-close, the tab check and messaging skip it. The roster shows it dimmed, "on PC-X".
- `team_message` to it answers that its conversation lives on that PC, and asks whether to start a fresh copy here.
  With your yes, `startHere: true` starts one, and this PC becomes its home.
- When `meta.json` records another PC as the top's, team-top actions here are off: writing the team files, auto-close
  and the queue. A toast names the PC that holds the top.
- The top's session here is told to ask you with AskUserQuestion. `team_take_top { take: true }` moves the top to
  this PC, and only after an AskUserQuestion answered in the same turn. The old PC's sessions then write change files.

**Updating a running team.** Reload every session (`/reload-plugins`), the top first. Until a session reloads, it still
writes `roster.json` itself and its status in the project, and the updated top shows it offline.

Rules: `hooks/changes.ts`. Tests: `hooks/writers.test.ts`.

## Model, messages, workspaces and other CLIs (0.5.13)

**Model and effort: chosen vs running (#63).**

- A reopen (and a bulk restart left on "keep") passes the member's own last `requestedModel` from its transcript, as
  typed: `[1m]`, `/model` switches and gateway names are kept. Without one, the roster's model is used.
- A member started on "default" keeps what it actually ran after its first run: the roster records the model it used,
  so a later change to the account default does not move it.
- `--model` gets the `claude-` prefix back only for the old short form (`opus|sonnet|haiku|fable` followed by digits,
  such as `haiku-5-5`). Any other name goes through unchanged, so a wrong one fails visibly at start. `default`, `keep`
  and an empty name give no `--model`; so does a name a shell would read as more than one word. A name with `[1m]` is
  quoted.
- Each member writes its live context window (`$.session.usage().context.window`) and fill into its status file at the
  end of each turn. The roster's context percent uses that window instead of the "200k unless [1m]" guess.

**Messages reach this project's member, by session id (#67).** `team_message`, a message to a closed member and the
queue send with `$.session.send({ to: { sessionId } })`. That reaches only the live local session with that id: never a
same-named member of another project, never a Remote Control copy. The ListAgents lookup is gone. Each member records
`location`: `local`, `remote` or `other-cli`.

- A failed send says why (the engine's reason).
- A local member with no session id yet is not messaged by name; the next refresh finds the id.
- A member on another device gets a sentence: the messenger route (#72) is not built yet. The fresh-copy offer of 0.5.12
  stays.
- `@team` messages go to the head by session id as well, when its id is known.

**Workspace after /cd or a moved project (#68).** `ORCA_WORKTREE_ID` counts only while that workspace's folder contains
the project root (the folder after `::` in the id, else Orca's `worktree show`). Otherwise `orca worktree current`
answers. A member's saved workspace that Orca no longer has, or that no longer holds the project, is replaced the same
way at reopen or restart, and recorded (a session that is not the team top records it through a change file).

**Members of other CLIs (#69).** `team_adopt` reads which CLI each tab runs, from Orca's terminal list (`agentIdentity`,
else the one CLI its command line names), and records `cli`. A member that is not Claude is **not managed**: it is
never reopened, auto-closed, briefed, messaged or tab-polled, and the roster shows it as "not managed (codex)". A tab
whose CLI cannot be told is treated as Claude, as before.

**"You", not a name, and built-in helpers (#76).** Messages to the person say "you" ("allow it yourself", "或自行授權");
messages to the model say "the user". The Agent guard lets Claude Code's own helpers `statusline-setup` and
`claude-code-guide` through; every other subagent type stays blocked without Allow subagents or `#allow-subagent`.

Rules: `hooks/status.ts`, `hooks/guard.ts`. Tests: `hooks/route.test.ts`, `hooks/guard.test.ts`.

## Side by side that actually fits (0.5.14)

In the "Side by side" layout, a card no longer needs room for its widest table before it can share a row. Cards are sized to the medium tier, falling back to the narrow tier to keep two on a row, and each card then shows the widest tier its width allows. On a 1920 x 1080 screen (about 160 to 210 columns), four teams appear as a 2 x 2 grid. Only a terminal under about 72 columns stays stacked.
