# team-orchestrator

Team Orchestrator runs a team of Claude Code sessions for you. Each member is its own Claude Code session in its own
Orca tab. You build the team, watch it and change it from a panel above the prompt. The members message each other,
start when they are first needed, close when they have been idle, and reopen when a message arrives.

A guard keeps the members inside their roles: members with reports plan and delegate instead of writing files, and
nobody starts subagents unless you allow it.

## Contents

- [Features](#features)
- [Install](#install)
  - [Requirements](#requirements)
  - [Install the mod](#install-the-mod)
  - [Update](#update)
  - [Quick start](#quick-start)
- [Security](#security)
  - [The permission guard](#the-permission-guard)
  - [How you allow something](#how-you-allow-something)
  - [Helpers inherit their spawner's grants](#helpers-inherit-their-spawners-grants)
  - [Rights changed outside the mod](#rights-changed-outside-the-mod)
  - [One writer for the team files](#one-writer-for-the-team-files)
  - [What the mod can and cannot touch](#what-the-mod-can-and-cannot-touch)
  - [Scratch clean-up without asking](#scratch-clean-up-without-asking)
- [Details](#details)
  - [Settings](#settings)
  - [Concepts](#concepts)
  - [The panel](#the-panel)
  - [Tools the sessions can call](#tools-the-sessions-can-call)
  - [Model, effort and reopening](#model-effort-and-reopening)
  - [Auto-close, the session cap and the queue](#auto-close-the-session-cap-and-the-queue)
  - [Crashes and sleep](#crashes-and-sleep)
  - [Files and folders](#files-and-folders)
  - [Troubleshooting](#troubleshooting)
  - [Planned](#planned)
  - [Changelog (0.5.x)](#changelog-05x)

## Features

| Feature | What it does |
|---|---|
| Team builder | Quick starts (Squad, All-Purpose Team, Tech Team), a team form, or an interview that designs the team with you |
| Live roster | One card per team: state, context use, model, effort and briefing for every member |
| Org chart | A live chart whose dots follow each member's state |
| Layouts | Stacked, side by side, or docked beside the transcript |
| On-demand start | Leads and workers start the first time their boss messages them |
| Role files | One file per member: a generated role, plus your own notes that the mod never changes |
| Team messaging | `team_message` starts or reopens a member, then delivers. `@team` sends your message to a team's head. |
| Adding members | New members on a running team, within a lead's purview and with your approval (0.5.17) |
| Auto-close and reopen | Idle workers close; a message reopens them with their conversation |
| Session cap and queue | A limit on open sessions; messages wait until there is room |
| Permission guard | No subagents for members, and no file writes for members with reports, unless you allow it |
| Locked team files | Only the team top changes the roster and the team settings |
| Identity tracking | Members stay recognised after `/clear`, `/rename` or a fresh `claude`; unclear sessions are held for you |
| Crash and sleep handling | Waking up closes nothing; only members proved to have crashed are reopened |
| Two computers | A team can span computers that share one project folder |
| Other CLIs | Tabs that run another CLI can sit on the roster, unmanaged |
| Windows, macOS and Linux | Every platform Orca runs on |

## Install

### Requirements

| What | Details |
|---|---|
| Claude Code | A build that loads mods (plugins with hooks). Every member runs `claude` in its own tab. |
| Orca | Orca must be running, and its command-line tool must work. The mod opens, closes and switches tabs through it. |
| Operating system | Windows, macOS or Linux. On Windows the mod uses PowerShell for process checks. On macOS and Linux it uses `ps` and `tail`. |
| git (optional) | When the project is a git repository, the mod keeps its team folder out of commits. |

The mod has one option, **Orca command** (`orcaCommand`). You find it in `/config`, or with
`claude plugin configure team-orchestrator`.

| Value | What happens |
|---|---|
| Empty (the default) | At the next start the mod tries `orca.exe` on Windows or `orca` on macOS and Linux. If `--version` works, it saves that value. |
| A command or a full path | The mod checks it at every start. When you edit the option, the mod refuses a command that does not start and shows the reason. |
| A saved value that fails on this computer | If the platform default works, the mod switches to it and shows a toast. This covers settings synced from another platform. |

### Install the mod

1. Add the marketplace: `claude plugin marketplace add herman925/925-cc-plugins`
2. Install the mod: `claude plugin install team-orchestrator@herman-mods --scope user`
3. In a session that is already open, run `/reload-plugins`.

### Update

1. Update the marketplace: `claude plugin marketplace update herman-mods`
2. Update the mod: `claude plugin update team-orchestrator@herman-mods`
3. Run `/reload-plugins` in **every** open session of the team. **Reload the team top first**, then the others.

Why the order matters: the team top stamps the team files with its version. A session whose mod is older than that
stamp writes no team file. It shows a toast once and waits until you update and reload it. A session that has not
reloaded yet may also show as offline in the updated top's panel until it reloads.

The version in the band and in the panel header shows what each session has loaded.

### Quick start

1. Open a Claude Code session in an Orca tab, in your project.
2. Press `t`, or type `/team`. The panel opens above the prompt.
3. Pick a quick start on the welcome screen, or press **Interview me instead**.
4. Check the form, then press **Launch**.
5. Give the team work: type `@<team name>` and your message in your own session. The message goes to that team's
   head.

Only the top and the team heads start at Launch. Everyone else starts the first time their boss messages them.

## Security

### The permission guard

The guard watches every session that is on the roster. A session that is not on the roster, such as your own, is
never judged. A subagent runs inside its session, so a rule for the session covers its subagents too.

| Tool | Who is refused | Unless |
|---|---|---|
| `Agent` (subagents) | Every roster member | **Allow subagents** is on, or `#allow-subagent` this turn. Claude Code's own helpers `statusline-setup` and `claude-code-guide` always pass. |
| `Write`, `Edit`, `NotebookEdit` | Members with reports (the top, heads and leads) | **Allow writes** is on, or `#allow-write` this turn. The member's own memory folder (`~/.claude/projects/<project>/memory/`) is always open. |
| `Write`, `Edit`, `NotebookEdit` on the team files | Every member except the team top | No switch or keyword opens them. |
| `Bash`, `PowerShell` commands that name the team files | Every member except the team top | Plain reads pass: `cat`, `type`, `Get-Content`, `ls`, `dir`, `grep`, `Select-String`, `jq` without `-i`. |

The team files are `roster.json`, `settings.json`, `meta.json`, the `changes/` folder and, from 0.5.17, the
`requests/` folder. Request files are written only through `member_add`, never by hand. `roles/` and `queue/` stay
writable. Bash and PowerShell are otherwise not guarded.

Each refusal says who was refused and why, and tells the model to hand the work to a worker or to ask you. It also
shows a toast. A permission that lets a call through shows a toast only once per session and reason.

A session **on hold** (see [Identity and `member_claim`](#identity-and-member_claim)) gets the strictest guard: no
writes and no subagents without a one-turn keyword, and no team tools at all.

### How you allow something

| Way | How long | How |
|---|---|---|
| Standing switch | Until you switch it off | **Settings → Permissions → Allow subagents / Allow writes**, per member. Stored in the roster, so it counts at once in every session. |
| One-turn keyword | The current turn | Type `#allow-subagent` or `#allow-write` in your own message to that member's session. |

The keywords count only in a prompt typed at that session's own prompt. The same words in a message from another
session, in a tool result or in another plugin's prompt allow nothing. A later prompt of yours without the keyword
takes the grant back, and the grant ends with the turn. A reload forgets it.

### Helpers inherit their spawner's grants

A subagent or a workflow agent is judged as the member that started it, by the grants standing right now. A one-turn
keyword lasts until the spawning member's own turn ends.

### Rights changed outside the mod

The mod records what it last wrote for each member's two switches. If the roster file shows a different value on two
refreshes in a row, the team top gets a toast and the member's row gets a note. Nothing is reverted.

### One writer for the team files

The roster is `.claude/team-orchestrator/roster.json`. Only one session writes it, and `settings.json`: the team top's
session, on the team top's computer. The guard refuses every other member's tools and shell commands on these files
(see the table above).

- Every other session writes a small change file in `changes/` with only the fields it changed. Its own panel shows
  the change at once.
- Every session reads the roster as the file plus the change files not applied yet, oldest first. So all sessions
  see the same team.
- The team top folds the change files in on its next refresh, within 30 seconds. Applied change files are listed in
  `changes/applied.json`. Change files older than 7 days are ignored.
- While no team top is running on this computer, your own session (not on the roster) writes in its place.
- `meta.json` records the schema version, the version of the mod that last wrote the roster, and the team top's
  computer. A session whose mod is older than that version writes no team file.
- A change of **Allow writes** or **Allow subagents** that arrives in a change file is shown to the team top, with
  who made it.
- Requests for new members in `requests/` are locked the same way: no member can write them with `Write`, `Edit` or
  the shell, and only `member_add` creates them. Before the team top applies a request, it checks again that the
  member who asked is still on the roster and still allowed to ask for that team.

### What the mod can and cannot touch

| The mod can | The mod does not |
|---|---|
| Open, close and switch Orca tabs of this project's members on this computer | Close or reopen members of other computers, or members that run another CLI |
| Start `claude` sessions for members, with their role pointer | Kill processes. Members are told to close their own leftovers. |
| Write in `.claude/team-orchestrator/`, in its status folder on this computer, and in the repository's `info/exclude` | Delete files. Applied change files and queue entries stay, listed in an index. |
| Read session transcripts (title, requested model, last model, effort, context use and working folder only) | Keep or show anything else from a transcript |
| Read the session registry and look up member processes by id | Poll processes on a timer |
| Approve a plain delete of a member's own scratch files | Override a deny from your rules or your organisation |
| Send messages to members by session id | Message sessions of other projects or Remote Control copies |

### Scratch clean-up without asking

With **Scratch: Auto-approve clean-up** on, the mod approves some deletes that Claude Code would otherwise ask about.

| Member | May delete without asking |
|---|---|
| Worker | Inside its own session's folder in the Claude temp folder |
| Head or lead | The above, plus anything in the system temp folder and in the project's scratch folder (**Scratch dir**) |

Limits:

- Only one plain delete command. No pipes, chains, redirects or variables.
- Only plain literal paths. A wildcard (`*`, `?`, `[`, `]`) or a trailing slash asks.
- Every folder from the allowed root down to the target is checked on disk. A link asks.
- A recursive delete also walks the target, up to 2000 entries. It asks if it finds a link, or if the folder holds
  more entries than that.
- The mod only lifts an "ask" to "allow". It never overrides a deny.

## Details

### Settings

**Per session.** These change only the look of your own panel. They survive `/reload-plugins`, not a new session.

| Setting | What it does | Default |
|---|---|---|
| Layout | Stacked, Side by side or Dock right. See [Layouts](#layouts). | Stacked |
| Org chart | Shows or hides the live org chart above the cards | Show |
| Columns | Shows or hides STATUS, CONTEXT, MODEL, EFFORT and BRIEF. NAME always shows. | All shown |

**Team-wide (Settings → Workers).** Shared by every session, in `.claude/team-orchestrator/settings.json`.

| Setting | What it does | Default |
|---|---|---|
| Auto-close | Closes workers that said "clean" and stayed idle (On, Off) | On |
| Idle minutes | How long a worker stays idle before it is closed (5, 10, 20, 30, 60) | 10 |
| Reopen as | Resume keeps the conversation; Fresh starts a new session that reads its role file again | Resume |
| Max open | Most of this computer's members open at once (No cap, 6, 8, 10, 12) | 8 |
| Launch | On demand starts only the top and the team heads; All at Create starts everyone | On demand |
| Batch size | Sessions started at once at Launch (1, 2, 3, 4, 6); the next batch follows 5 seconds after the last is ready | 3 |
| Scratch | Auto-approve clean-up, or Ask each time. See [Scratch clean-up](#scratch-clean-up-without-asking). | Auto-approve |
| Scratch dir | The project's scratch folder that heads and leads may clean without asking | `.claude/scratch` |
| Never close | A tick box per worker; a ticked worker is never auto-closed | None ticked |

**Per member, team-wide (Settings → Permissions).** Stored in the roster.

| Setting | What it does | Default |
|---|---|---|
| Allow subagents | Lets this member use the `Agent` tool | Off |
| Allow writes | Lets this member, if it has reports, use `Write`, `Edit` and `NotebookEdit` | Off |

**Plugin option.**

| Setting | What it does | Default |
|---|---|---|
| Orca command (`orcaCommand`) | Orca's command-line tool, or its full path. See [Requirements](#requirements). | Empty: detected and saved at the next start |

### Concepts

#### Teams and levels

A project can hold several teams. Each member has a name, a role, a level and a boss.

| Term | Who it is |
|---|---|
| **Team top** | The member that reports to you (its boss is `user`). In a one-team setup this is the head. Under a CEO it is the CEO. If several members report to you, the first one on the roster is the team top. |
| **Head** | The member at the top of one team. Under a CEO, each team has its own head, which reports to the CEO. |
| **Lead** | A member with its own reports, below a head. Leads appear in three-level teams. |
| **Worker** | A member with no reports. Workers do the tasks. |

Members with reports (the top, heads and leads) plan, delegate and review. Workers do the work and report back to
their boss only.

Member names are unique across the project. When a new team reuses a name that another team has, the new member gets
its team name in front (`Team2-Head`).

#### Role files

Each member has a role file: `.claude/team-orchestrator/roles/<name>.md`. It has two parts.

| Part | Contents | Who writes it |
|---|---|---|
| Above the marker | The member's job for its level, its boss and reports, how to message, housekeeping, the whole team, and the team files | The mod. It rewrites this part whenever the team changes. |
| **Personality and notes**, below the marker | A voice, a working style or extra rules for this member | You. The mod never changes this part. |

Every member starts with a short pointer in its system prompt (`--append-system-prompt`). The pointer gives its name,
its boss, the one rule for its level, and the path of its role file. The member reads the file before its first
action. When the file changes, Claude Code tells the session what changed.

#### Staged, on-demand start

Launch writes the whole roster first. Then it starts sessions in batches.

- **On demand** (the default): only the team top and, under a CEO, each team head start now. Leads and workers show
  as **not yet**. Each one starts, fresh and briefed, the first time its boss messages it with `team_message`.
- **All at Create**: everyone starts now.

Each batch starts, waits until the sessions are ready, and then the next batch follows 5 seconds later. The batch size
is 3 by default. Both options are in **Settings → Workers**.

#### `team_message` and `SendMessage`

| Tool | Use it for | Why |
|---|---|---|
| `team_message` | A boss messaging its own reports | It starts a member that has not started yet, or reopens one that was closed, and then delivers. It addresses the member by session id, so it never reaches a same-named session of another project or a Remote Control copy. |
| `SendMessage` | A worker reporting to its boss, and heads and leads talking to each other | It is Claude Code's own tool. It only knows sessions that are running now. |

The mod adds a note to the `SendMessage` description that says when to use `team_message` instead. For roster members,
`team_message` is listed up front, not behind ToolSearch.

#### Messaging a whole team

In your own session, type `@<team name>` and your message. The mod sends the message to that team's head and keeps
your session out of the conversation. A head on this computer with a known session id is addressed by that id.

To rename a team, type a new name in the team card's **Team name** field, or use `/team name <old> <new>`. The
`@` mention changes with it.

#### Where live status lives

Each member writes its own status file on its own computer:

```
~/.claude/team-orchestrator/<project key>/status/<name>.json
```

`~/.claude` is your Claude config folder (`CLAUDE_CONFIG_DIR` when set). The project key is the project path with
every character except letters and digits turned into `-`.

A member writes its status when a turn starts and ends, when it asks you a question, and on a 60-second heartbeat.
The file holds its state, model, effort, context use and window, its current task line, its last "clean", and its
count of leftover processes. Nobody reads other members' screens. Only the team top (or your own session, when it is
not on the roster) asks Orca whether tabs still exist, and only when someone has been silent for over 2 minutes. The
check runs at most every 2 minutes, and less often while Orca answers slowly.

#### Computers and "on PC-X"

Every member records its home computer (its computer name) at launch, adopt, reopen and identity re-attach.

- A member whose home is another computer shows dimmed on the roster, with **on PC-X**.
- This computer never reopens, closes, tab-checks or messages that member.
- `team_message` to it answers that its conversation lives on that computer. With your yes, `startHere: true` starts
  a fresh copy here, and this computer becomes its home.
- When `meta.json` records the team top on another computer, the team-top work here is off: writing the team files,
  auto-close and the queue. A toast names the computer that holds the top. The team top's session here asks you
  whether to take over, and applies your answer with `team_take_top`.

#### Identity and `member_claim`

A member stays recognised after `/clear`, `/rename` or a fresh `claude` in its tab. Each session compares three facts
with the roster: its Orca tab, its session id and its session name.

| Facts that match | Result |
|---|---|
| Tab, id and name | The member |
| Tab and id, new name (`/rename`) | The member. The roster, its reports, its role file and its status file take the new name. |
| Tab and name, new id (`/clear`) | The member. The roster takes the new id. |
| Id and name, another tab | The member if its old tab is gone; **on hold** if the old tab is still open |
| Tab only (a fresh `claude` in the tab) | The member, re-attached. Its next prompt tells it to read its role file. |
| Id only, or name only | **On hold** |
| Nothing | Not on the team. The guard leaves it alone. |

Outside Orca, the session registry (`~/.claude/sessions/`) stands in for the tab, but only beside an id or a name.
A `/rename` to another member's name is not followed.

A session **on hold** gets the strictest guard and no team tools, and writes no status under the member's name. The
mod warns the member's head and tells the team top to ask you at once, with three choices:

| Choice | Effect, applied by the team top with `member_claim` |
|---|---|
| This is X | The roster takes the session's id, tab and name as member X. |
| New member under X's boss | The session joins as a worker under that boss, with its own role file. |
| Reject | The session stays on hold, off the team. |

#### Adding members to a running team (0.5.17)

A new member is saved as **not yet**, with its role file. It starts, fresh and briefed, on its boss's first
`team_message`, like a member created at Launch. It joins a team that is already on the roster. Its name must be
unused across the whole project, because a name is how teammates reach a session. With no role given, the role is
"worker".

**From the panel.** **Team actions → People → New member…** asks for a name, a role, a boss, a model and an effort.
The boss starts on the team's head; you can pick any member of the team. Press **Add**. No approval is needed: you
are the one adding.

**From a session, with `member_add`.** With no boss given, the boss is the session that asks, when it is in that
team; otherwise it is the team's head.

| Who calls `member_add` | What happens |
|---|---|
| Your own session (not on the roster) | The member is added at once. |
| The team top | The top must ask you with AskUserQuestion first. The add counts only when that question was answered in the same turn. |
| A head or lead below the top | A **request**, saved as `requests/<id>.json` by `member_add` (members cannot write that folder by hand). The team top is told to ask you with AskUserQuestion, then applies your answer with `member_add { request, approve }`. Before it applies the request, it checks again that the member who asked is still on the roster and still allowed to ask. Nothing is added until then. |
| A worker | Refused. A worker asks its boss. |
| A session on hold | Refused, like every team tool. |

- **Purview.** A head or lead may add or request members only for its own team and every team whose chain of bosses
  leads up to it. A lead over two teams may request members for those two teams and no others. A request outside the
  purview is refused.
- **Approval.** Only the team top may apply a request. An approval counts only after an AskUserQuestion answered in
  the same turn. A decline needs no such answer. Either way, the member who asked is told the outcome.
- **When the top cannot be reached.** The request stays saved, and you get a toast with its id. Tell the top to apply
  it once you approve.

#### Launching under a team name that is taken (0.5.17)

A launch no longer replaces a team that is already on the roster. Nothing is launched and nobody is removed. From
`team_launch`, the answer offers two choices, and the session asks you which one you want. In the New team form,
**Launch** is refused and two buttons appear: **Add the new members to @team** and **Merge into @team**.

| Choice | `team_launch` with | What happens |
|---|---|---|
| Add | `ifExists: "add"` | Every launched member is a new member of the existing team, saved as **not yet** and started on its boss's first message. A taken name gets a number (`Worker-1` becomes `Worker-1-2`). |
| Merge | `ifExists: "merge"` | A launched member with the same name as a member of that team is that member, kept as it is. The rest join under their bosses. |

Either way, a launched member that would report to you joins under the existing team's head instead, because a team
has one top. Nobody already on the roster is changed or removed. You can also pick another team name.

Before 0.5.17, launching under an existing team name replaced that team's members on the roster.

`team_adopt` still works by team: adopting into a team name makes that team's members exactly the adopted sessions.
Other teams stay as they are.

### The panel

#### The band and the version pill

A band sits above the prompt in every session that has the mod. It starts with a filled pill,
`◆ Team Orchestrator v<version>`, in cyan with black text (reverse video when `NO_COLOR` is set). Beside it:

- a `▸` / `▾` button that opens and closes the panel (hotkey `t`)
- counts of idle, working and asking members
- the `@` names of the teams

`/team` also opens the panel. The panel header repeats the version: `◆ TEAM ORCHESTRATOR v<version>`. The version is
read from the installed `plugin.json`, so it always shows what this session has loaded.

The panel has three tabs: **Roster**, **New team** and **Settings**. Every setting is explained in
[Settings](#settings).

#### New team

With no team yet, the Roster tab shows a welcome screen with the quick starts.

| Quick start | Shape |
|---|---|
| Squad | A head and 3 workers |
| All-Purpose Team | A CEO, 2 team heads, 4 workers each |
| Tech Team | A CEO, 4 team heads (Dev, UI, Test, Security), 4 workers each |

| Field | What it sets |
|---|---|
| Team name | The team's name, which is also its `@` mention |
| Function | What the team is for, in a sentence. The head reads it as its goal. |
| Quick start | Squad, All-Purpose Team or Tech Team. Each fills the form, which stays editable. |
| Structure | **One team**, or **CEO over several teams** |
| Levels (one team) | 1 (head only), 2 (head and workers) or 3 (head, leads and workers) |
| Teams (with a CEO) | Team names, separated by commas. Each gets a head and its own workers. |
| Reports each / Workers each | 1 to 5 |
| Model and effort per level | Press a cell to choose. **Default** leaves the choice to Claude. |

A preview shows the tree and the number of sessions. Over 8 sessions it warns you to check your usage. **Launch**
starts the team, and the panel shows **Starting the team** while the first sessions start. **Interview me instead**
asks Claude to interview you and launch the team.

#### Layouts

| Layout | What you see |
|---|---|
| Stacked | One full-width team card per row |
| Side by side | As many cards per row as fit. On a 1920 × 1080 screen (about 160 to 210 columns), four teams show as a 2 × 2 grid. Below about 72 columns, cards stack. |
| Dock right | The panel moves to a pane beside the transcript, with cards packed like side by side. The pane docks only in the fullscreen layout and from 110 columns; otherwise it sits above the prompt. Closing the pane returns to Stacked. |

Each card picks the widest column set its width allows: wide, medium or narrow.

#### Roster columns

Each row has a tick box, a marker that switches Orca to that member's tab, and the name in the tree.

| Column | Shows | Notes |
|---|---|---|
| NAME | The member's name, coloured by level | Always shown |
| STATUS | The state, with a glyph | See below |
| CONTEXT | A bar and the percent of the context window used | Green under 50%, yellow under 80%, red above |
| MODEL | The model, without the `claude-` prefix | |
| EFFORT | The effort, coloured from low (cool) to max (hot) | |
| BRIEF | `✓ noted`, `… sent` or `- none` | Wide cards only |

A note after a row explains anything unusual, such as `on PC-X`, `not managed (codex)` or `short name used twice`.

| Status | Meaning |
|---|---|
| `●` idle | Waiting for work |
| `◐` working | In a turn |
| `◆` asking | Waiting for your answer |
| `◌` starting | Starting up |
| `·` not yet | On the roster, starts on its first message |
| `○` queued | Waiting for its batch at Launch |
| `○` offline | No status for 5 minutes of awake time |
| `–` closed | Closed by auto-close; a message reopens it |
| `✗` failed | Could not be started |
| `◌` away | Its home is another computer |
| `◇` external | Runs another CLI; not managed |

#### The org chart

The live chart above the cards follows each member's state. Press a name to switch to that member's tab.

The chart shows short names. **Team actions → Set short name…** sets one, exactly as you type it. An empty name
clears it. A member with no short name gets one worked out from its name, drawn dim. Two members with the same short
name both show it, marked `!`. Long labels are cut only when the chart does not fit.

#### Team actions

Each team card has a **Team actions** menu. Most actions work on the ticked rows.

| Group | Action | What it does |
|---|---|---|
| Select | All | Ticks every member of this team |
| | Workers | Ticks the members on the team's lowest level |
| People | New member… (0.5.17) | Adds a member that starts on its boss's first message. You pick a name, role, boss (the team's head by default), model and effort. See [Adding members](#adding-members-to-a-running-team-0517). |
| | Add member… | Puts an Orca tab that is already running onto this team, with a boss and a role |
| | Move selected here | Moves the ticked members to this team. Refused while someone left behind reports to them. |
| | Change boss… | Gives the ticked members a new boss in the same team |
| Sessions | Open selected | Switches Orca to the first ticked member's tab |
| | Rename / model / effort… | Renames the ticked members (prefix, base name, numbering) and changes model and effort. Idle sessions with a known id restart with `--resume`. Busy or adopted sessions get a label-only rename. |
| | Set short name… | Sets the org-chart label of one ticked member |
| | Brief team | Sends the team briefing into each member's tab. Shows how many are not briefed yet. |
| | Brief selected | Sends the briefing to the ticked members again |
| Remove | Selected… | Takes the ticked members off the roster, after you confirm |
| | Whole team… | Takes the whole team off the roster, after you confirm |

Removing changes only the roster. No tab is closed and no session is stopped. Below the cards: **Refresh**,
**Clear selection** and **Settings**.

### Tools the sessions can call

| Tool | What it does |
|---|---|
| `team_launch` | Launches a team as Orca tabs in the current workspace, members ordered boss first. Optional model, effort and short name per member. From 0.5.17, a taken team name needs `ifExists: "add"` or `"merge"`. |
| `team_adopt` | Puts sessions that are already running onto the roster, without launching anything. The named team's members become exactly the adopted sessions. Records which CLI each tab runs. |
| `team_message` | Messages a teammate on the roster. Starts or reopens it first when needed. `startHere: true`, only after your yes, starts a fresh copy of a member from another computer here. |
| `member_add` (0.5.17) | Adds a new member that starts on its boss's first message. From a head or lead below the top, it is a request within its purview, which you approve. The team top adds only after asking you in the same turn, and applies a request with `{ request, approve }`. |
| `member_move` | Moves one member to another team, under a given boss or that team's head. Refused while others report to the member. |
| `member_remove` | Takes one member off the roster. Closes no tab. |
| `team_remove` | Takes a whole team off the roster. Closes no tab. |
| `member_claim` | Team top only. Applies your answer about a session on hold: `is`, `new` or `reject`. |
| `team_take_top` | Applies your answer about moving the team top to this computer. Works only after an AskUserQuestion answered in the same turn. |

The full names start with `mcp__team-orchestrator__`. A session on hold is refused every team tool, with the reason.
A team tool never crashes. If something fails, it answers with a sentence that says what failed.

### Model, effort and reopening

#### Choosing a model and effort

- The New team form offers Default, Opus, Sonnet, Haiku and Fable, and efforts Default, Low, Medium, High, Extra
  high and Max. `team_launch` accepts any model name.
- An old short name such as `haiku-5-5` gets `claude-` back (`claude-haiku-5-5`). Aliases (`opus`, `sonnet`, `haiku`,
  `fable`) and every other name pass as typed, so a wrong name fails visibly at start. A name with `[1m]` is quoted.
- `default`, `keep` and an empty name pass no `--model`.
- A member started on Default keeps what it actually ran: after its first run, the roster records that model.
- The CONTEXT column uses the context window the member reports for itself.

#### Reopening

A closed member reopens when a message arrives for it.

- **Resume** (the default) starts `claude --resume` and keeps its conversation. **Fresh** starts a new session, which
  reads its role file again.
- It reopens in its own Orca workspace. If that workspace is gone or no longer holds the project, it opens in the
  current session's workspace, and the roster records that.
- It reopens with the model it last asked for in its transcript, as typed (including `[1m]` and gateway names). If
  there is none, it uses the roster's model.
- A member proved to have crashed always reopens with Resume.
- **Rename / model / effort…** restarts idle members with `--resume`. Model and effort left on "keep" stay as saved.

Members that run another CLI (Codex, Hermes and others) can be adopted. They show as **not managed**. The mod never
reopens, closes, briefs, messages or tab-checks them.

### Auto-close, the session cap and the queue

- A worker that told its boss "clean" and stayed idle for the set minutes is closed. Its tab closes first; only then
  is it marked closed.
- Members with reports, members ticked under **Never close**, and members of other computers are never closed.
- **Max open** caps how many of this computer's members are open. At the cap, the worker idle longest is closed to
  make room. If every worker is busy, the message waits in the queue.
- The queue holds one file per message in `.claude/team-orchestrator/queue/`. The team top's round delivers what has
  room. After 3 failed tries, an entry is marked failed and the sender's head is told. Finished entries are pruned
  after a day, and all entries after 7 days.

#### Housekeeping

When a worker reports to its boss, it is reminded to close the processes its own session started, stop unused
browser-automation servers, delete its scratch files and tell its boss "clean". When a head or lead hears from one of
its reports, it is reminded to check that report's leftovers. A plain "clean" reply does not trigger the reminder
again.

### Crashes and sleep

#### Sleep-aware clocks

Each session's 30-second round notes the time of each tick. A tick more than 3 minutes late means the computer slept
(or the session hung). That gap is kept for a day as a sleep window. Idle time, silence and the crash-check threshold
all leave out the time asleep. Waking up therefore closes nothing.

#### The crash check

The check runs only when a message is about to go to a member on this computer that has written no status for over
90 seconds. Nothing polls on a timer.

The mod looks up the member's session id in this computer's session registry, and checks each process it names: one
`Get-CimInstance` query on Windows, `ps -o args= -p <pid>` on macOS and Linux.

| Result | What happens |
|---|---|
| **Dead** (proved: its home is this computer, and no process still holds its session) | It is marked closed, reopened with `--resume`, and then sent the message. |
| **Alive but silent** (hung) | The message is queued. The sender is told the member looks hung. The team top is told once per member per hour. |
| **Any doubt** | Nothing is reopened. The message is queued and the sender is told why. |

A queued message for a hung or doubtful member is delivered when the member's status is fresh again. When the team
top finds that member's tab gone (closed by hand), it checks once more. Proved dead, the member is marked closed and
reopens for its message.

### Files and folders

#### In the project: `.claude/team-orchestrator/`

The mod adds this folder to the repository's `info/exclude`, so git never offers it for a commit.

| Path | Holds | Written by |
|---|---|---|
| `roster.json` | Teams, members, bosses, roles, levels, models, efforts, switches, home computers | The team top's session only |
| `settings.json` | The Workers settings | The team top's session only |
| `meta.json` | Schema version, writer's mod version, team top's computer | The team top's session |
| `changes/<time>-<id>.json` | One session's roster or settings change, waiting for the top | Any session's mod |
| `changes/applied.json` | The change files already folded in | The team top's session |
| `roles/<name>.md` | Each member's role file | The mod (top part) and you (notes part) |
| `queue/<time>-<id>.json` | One queued message and its state | Any session's mod; the top's round updates it |
| `queue/pruned.json` | The queue entries already pruned | The team top's session |
| `claims.json` | Sessions put on hold, and your decisions | The mod |
| `requests/<time>-<id>.json` | One request for a new member from a head or lead, and its state (asked, approved, declined) | The asking session's mod; the team top's when it decides (0.5.17) |
| `roster.json.bak` | A copy of the pre-0.5.0 roster, from the one-time move | The mod, once |

Older files are moved once: `.claude/team-orchestrator.json` becomes `roster.json` (the old path is left as a
pointer), and `queue.json` moves into `queue/` and is left as `[]`.

#### On each computer

| Path | Holds |
|---|---|
| `~/.claude/team-orchestrator/<project key>/status/<name>.json` | Each member's live status. Status files from older versions in the project are moved here once. |
| The mod's plugin store | What the mod last wrote for each member's switches, shared by every session on this computer |
| Claude Code's plugin options | The `orcaCommand` value |

The mod reads, but never writes, `~/.claude/sessions/` (the session registry) and the session transcripts. From a
transcript it takes only the title, the requested model, and the last answer's model, effort, context use and
working folder.

### Troubleshooting

| What you see | What to do |
|---|---|
| A toast: "Orca not found" or "did not run" | Set **Orca command** in `/config` to Orca's command-line tool or its full path, or leave it empty to detect it again. |
| The version pill shows an old version | Run `/reload-plugins` in that session. |
| A toast: the team files were written by a newer team-orchestrator | Update the mod and run `/reload-plugins` in that session. Its changes wait until then. |
| A toast: the team top runs on another computer | The team files are read-only here. Answer the team top's question, or keep the top where it is. |
| A member shows **not yet** | It starts on its boss's first `team_message`. |
| `SendMessage` says a name is unknown or ambiguous | Use `team_message` with the plain member name. |
| "Not sent: the roster has no session id for it yet" | Wait for the next refresh (30 seconds), then send again. |
| A member shows **offline** | It has written no status for 5 minutes. Look at its tab. A message to it runs the crash check. |
| "X looks hung; message queued" | Look at the member's tab. If it is stuck, close the tab. The member then reopens with its conversation and gets the message. |
| A toast: this session is on hold | The team top asks you who the session is. Answer, and the top applies it with `member_claim`. |
| "Blocked Agent" or "Blocked Write" | Switch on **Allow subagents** or **Allow writes** for that member, or type `#allow-subagent` or `#allow-write` in your next message to it. |
| "Blocked … team file" | Only the team top may change those files. Use the panel instead. |
| A toast: roster.json changed outside the mod | Someone edited the switches by hand. Check **Settings → Permissions**. |
| Dock right still sits above the prompt | Use the fullscreen layout and a window of at least 110 columns. |
| A removed member's tab is still open | Removing changes only the roster. Close the tab yourself. |

### Planned

- Members on other devices, reached through a messenger role (#72, #74).
- Approving new members through approved meeting minutes or plans, besides AskUserQuestion (map #2).
- Teams that mix Claude Code with other CLIs (#48 to #55).

### Changelog (0.5.x)

| Version | Change |
|---|---|
| 0.5.18 | Groundwork for teams across computers, not yet switched on: bundled encryption (sealed messages, a passphrase-locked join bundle, a strength meter that only warns) and device keys kept in each computer's own vault (DPAPI on Windows, Keychain on macOS, Secret Service on Linux, or an owner-only file outside synced folders). |
| 0.5.17 | New member… and `member_add`: new members start on their first message. Heads and leads may request members only within their purview, with your approval. Launching under a taken team name is refused and offers add or merge. |
| 0.5.16 | Sleep-aware clocks. A crash check at send time. Only members proved dead are reopened; hung or doubtful ones are queued. |
| 0.5.15 | Dock right packs cards like side by side. |
| 0.5.14 | Side by side fits two or more cards per row (2 × 2 at 1920 × 1080). |
| 0.5.13 | Model names pass as typed. Messages go by session id. Workspace check after `/cd` or a moved project. Members of other CLIs are not managed. Messages say "you". Built-in helper agents pass the guard. |
| 0.5.12 | One writer for the team files, with change files. One queue file per message. Status files move to each computer. Teams on two computers. |
| 0.5.11 | Team files locked to the team top. Link-safe scratch auto-approve. The Orca command fixes itself. Tests for helper grants. |
| 0.5.10 | Member identity survives `/clear`, `/rename` and a fresh `claude`. `member_claim`. Bulk restart keeps model and effort. |
| 0.5.09 | The title pill with the version in the band. |
| 0.5.08 | The installed version in the panel header. |
| 0.5.07 | `!` removed from the start text for bash and zsh. |
| 0.5.06 | Windows, macOS and Linux. The `orcaCommand` option. Scratch clean-up without asking. The roster keeps model and effort. |
| 0.5.05 | A valid model id on start and reopen. |
| 0.5.04 | Role files and the start-up system-prompt pointer. |
| 0.5.03 | Staged Create, on-demand members and `team_message`. |
| 0.5.02 | Auto-close closes the real tab and never duplicates a live worker. |
| 0.5.01 | Reopen in the member's own workspace. Allow toasts once per session. |
| 0.5.0 | Event-driven status, the team folder and worker auto-close. |

Tests: `claude plugin test team-orchestrator`.
