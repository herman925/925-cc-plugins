# team-orchestrator

Builds and manages a team of Claude Code sessions as Orca tabs: a form to start a team, a live roster, an org chart, and a
guard that keeps the heads from writing files themselves and everybody from starting subagents unless Herman says so.

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
The plugin knows which member a session is by its **session id**, and if that fails by **its name** (the title in its transcript).

| Tool | Who is refused | Unless |
|---|---|---|
| `Agent` (a subagent) | every roster member | allowed (below) |
| `Write`, `Edit`, `NotebookEdit` | a member with reports (somebody has it as boss), the CEO included | allowed (below), or the file is in its own memory folder `~/.claude/projects/<project>/memory/…` |

The refusal says who is refused and tells the model to hand the work to a worker with `SendMessage`, or to ask Herman.
Each refusal, and each time a permission lets a call through, leaves one line in a toast, for example
`blocked Agent: Hualong CEO has no subagent permission`.

A subagent runs inside its session, so a refusal for the session covers its subagents too.

### How Herman allows something

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
- A session that is on the roster but whose id and name the plugin cannot match (no transcript yet) is treated as not on the roster.

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
- Anything else is left out, so the session uses its default model.

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
