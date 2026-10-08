# Cross-CLI team state: one format, or per-CLI projections?

Research ticket: [#46](https://github.com/herman925/925-cc-plugins/issues/46) · map [#2](https://github.com/herman925/925-cc-plugins/issues/2).
Read from the code at `team-orchestrator/` (v0.5.04): `README.md`, `types/index.d.ts`, and
`hooks/{register.tsx,status.ts,housekeeping.ts,roles.ts,layout.ts,guard.ts}`.

**Verdict short.** The on-disk *shape* (a JSON roster plus one status file per member) is CLI-agnostic.
The *values* are not. Several fields are sourced from a Claude Code-specific mechanism, and the live
half of the record only exists because a hook runs inside the session. A genuinely common, mutually
trusted format is not achievable in this design. The honest answer is a **coordinator-owned canonical
state with a per-CLI projection** written by an adapter that runs inside each CLI.

---

## 1. What is actually persisted

The team state lives in `<project>/.claude/team-orchestrator/` (git-excluded). There is **no tracker
yet** — the tracker layer is 0.5.1 and is not in this tree; the "roster and tracker" of the ticket is,
today, `roster.json` (structure) and `status/<name>.json` (live per-member status).

| File | Written by | Scope |
|---|---|---|
| `roster.json` | any session that calls `share()` — the launch path, the poller's `refresh()`, and `deliver`/`remove`/`move`/`setShort`/`changeBoss`/`addMember`/`closeMember`/`reopen`/`briefTeam`/`applyBulk` | whole file, last writer wins |
| `status/<name>.json` | exactly one session: the member's own | one member |
| `settings.json` | whoever changes Settings | whole team |
| `queue.json` | `deliver`/`monitor` | whole team |
| `roles/<name>.md` | the mod (`writeRoles`), from the roster | one member |

## 2. Field-by-field classification

Legend:
**(a)** CLI-agnostic data — a plain value with no CLI provenance.
**(b)** sourced from a CLI-specific mechanism — a session id, a transcript, a name-addressed message
channel, a process scan of that CLI's binary.
**(c)** only exists because a hook runs inside the session — the field is produced by an in-session
event (`turn.start`/`turn.complete`/heartbeat/tool hooks) or by the CLI's plugin API (`$.fs.write`,
`$.session.id()`), so a CLI with no such hook contract cannot produce it at all.

### `roster.json` — `Member` (`types/index.d.ts`, STRUCT list at `register.tsx:259`)

| Field | Class | Why |
|---|---|---|
| `team` | a | a label |
| `name` | a | a label; uniqueness is enforced by the plugin itself |
| `role` | a | free text |
| `level` | a | derived from the reporting line |
| `boss` | a | a member name or `user` |
| `short` | a | a display label |
| `statusFile` | a | a relative path string |
| `pending` | a | a lifecycle flag |
| `handle` | b | an **Orca** terminal handle (`term_…`). Host-runtime, not the CLI — agnostic of *which* CLI runs in the tab |
| `worktree` | b | an **Orca** worktree id. Host-runtime, not the CLI |
| `address` | b | "the session name **SendMessage** addresses it by" (`index.d.ts:22`). SendMessage is Claude Code's native agent messaging |
| `sessionId` | b | a Claude Code session id (uuid v4), passed as `claude --session-id` / `--resume` (`register.tsx:120,336`) |
| `allowAgent` | c | a boolean the person set; **its only meaning is that the guard hook refuses the `Agent` tool in-session**. Data is agnostic; enforcement is not |
| `allowWrite` | c | same, for `Write`/`Edit`/`NotebookEdit` |
| `briefed` | c | set by the coordinator after it drives the session to `tui-idle` and types the briefing into the tab |
| `noted` | c | for a status-file member it is hard-coded `true` (`register.tsx:911`); otherwise it is scraped off the rendered TUI (`/●\s*Noted/`, same line) |

### `status/<name>.json` — `Status` (`status.ts:10`)

| Field | Class | Why |
|---|---|---|
| `name` | a | a label |
| `sessionId` | b | Claude session id, from `$.session.id()` |
| `state` | c | written by the member's own hooks (`turn.start`→`working`, `turn.complete`→`idle`, `AskUserQuestion`→`asking`); the one cross-writer is the top marking a member `closed` |
| `turnStart`, `turnEnd` | c | the session's own `turn.start` / `turn.complete` events |
| `heartbeat` | c | a 60 s timer inside the session (`register.tsx:1293`). The whole liveness signal assumes the mod runs in-session |
| `model` | b | from the last assistant line of the Claude transcript (`lastStats`), else the status-line screen scrape |
| `effort` | b | same source; "effort" is a Claude-Code notion |
| `ctx` | b | context percent from the transcript's `usage`, with the measured `[1m]`-window caveat (below) |
| `task` | c | from Clean View's `plan_steps` / `report_progress` plugin tools, or the boss's message body |
| `lastClean` | c | set when the member's own `SendMessage` to its boss is recognised as a "clean" confirmation |
| `leftover` | b | a Windows/PowerShell scan for processes owned by the `claude.exe` whose command line carries the session id (`countLeftovers`, `register.tsx:597`) — OS- *and* CLI-specific |
| `countedAt` | c | bookkeeping for that scan |

### `settings.json` (`status.ts:32`) and `queue.json` (`register.tsx:671`)

| Field | Class | Why |
|---|---|---|
| `autoClose`, `idleMinutes`, `exempt`, `maxOpen`, `launch`, `batch` | a | plain config |
| `reopen` (`resume`\|`fresh`) | a as data | but `resume` means `claude --resume`: a CLI with no resumable session cannot honour it |
| `to`, `from`, `message`, `at` | a | plain queue entries — though **delivery** goes through `SendMessage`/`team_message`, which is Claude-specific |

### `roles/<name>.md`

A plain markdown file, CLI-agnostic as a file — but its generated body names `SendMessage`,
`team_message`, `~/.claude/…`, and the pointer is injected with `--append-system-prompt`
(`register.tsx:337`), a Claude Code launch flag.

## 3. Answers to the ticket's four questions

**Is the format tied to one CLI's session model?**
The schema is not; the *mechanisms* are. `sessionId`, `model`, `effort`, `ctx`, `leftover`, `address`
and `noted` all come from Claude-specific machinery, and every live field (`state`, `heartbeat`,
`turnStart`/`turnEnd`, `task`, `lastClean`, and the `allow*` enforcement) exists only because a plugin
hook runs inside the session.

**Can a non-Claude member read the roster and tracker, or only receive pushes?**
Read: possibly — `roster.json` is a plain file, so any CLI that reads files can read it. But nothing
*points* a non-Claude CLI at it: the pointer arrives via `--append-system-prompt` and the briefing is
typed into the tab by the coordinator. Write: no — a status file is written only through the plugin's
`$.fs.write` inside a session, so a CLI without Claude's plugin/hook API cannot produce one at all.
Receive: yes — the coordinator can always type into an Orca tab (`orca terminal send`).

**Can a different CLI's write be trusted, given the transcript caveat?**
The caveat is confirmed in code: `lastStats` guesses the window as 1M only if the id ends `[1m]` or if
`used > 200000`, else 200k (`register.tsx:471`) — so `ctx` is an estimate that is wrong for a 1M
session below 200k tokens. More generally, the coordinator never *verifies* a status file; it reads a
**self-report**. A different CLI writing the same schema would be trusted on the same self-report
basis, while the fields it cannot populate (Claude model-id shape, transcript path, `claude.exe` scan)
would be absent or guessed. Trust is only as good as the writer, and the measured caveat shows the
Claude source is already unreliable for window size.

**Common format, or coordinator-owned + projections?**
Coordinator-owned + projections. The CLI-agnostic spine can live in one coordinator-owned file; every
field with CLI provenance, and every field produced in-session, must be a projection written by an
adapter inside that CLI.

## 4. What would settle the undecided parts

1. **Non-Claude CLI capabilities** — for a candidate CLI, evidence of (i) a stable session id,
   (ii) a resumable session, (iii) a transcript or equivalent carrying model + context window,
   (iv) an in-session hook API equivalent to `on('turn.*')` + `$.fs.write`, (v) a name-addressed
   peer-message channel. Source: that CLI's own hook/plugin docs, plus one spike that starts it under
   Orca and reads back one status file it wrote itself.
2. **Addressing** — whether Orca can address a non-Claude session by name (`orca terminal list`/`send`
   against a non-Claude tab), and whether that CLI has a native peer channel to replace `SendMessage`.
3. **Context window** — whether any CLI exposes a true window (the map already relies on
   `$.session.usage()` returning `{tokens, window, percent}`; confirm the same for each non-Claude CLI).
   Until then `ctx` stays an estimate and must be labelled as one.

---

Method: field inventory taken from the `STRUCT` list and the `Status` / `TeamSettings` / `Queued`
types, then traced to each field's writer in `register.tsx`. Classification is this reading of the
code; no behaviour was run to produce it.
