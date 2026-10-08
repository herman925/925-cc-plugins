# Cross-CLI capability facts

Research ticket: #42 on the team-orchestrator map (#2).
Measured: 2026-10-09. Host runtime: Orca CLI 1.4.221 on a Windows host.
Every cell below carries the raw observation behind it. A cell the runtime could not answer says `unknown`.

## 1. Question

Which candidate agent CLIs can the host runtime start, address, observe for liveness and turn state, and
interrupt — and by what mechanism? This note answers that with measurements, so the cross-CLI membership
ticket can draw its required-versus-degraded line against facts.

## 2. How to read this

- "Orca" is the host runtime in this environment. Two surfaces matter: `orca terminal ...` (one PTY per tab)
  and `orca orchestration ...` (supervised Runs, Tasks, Dispatches).
- Observation splits in two. **PTY-level** observation needs no cooperation from the agent inside the
  terminal. **Adapter-level** observation needs the runtime to recognise the CLI; it is richer, but it is
  not universal.
- A cell marked *inference* generalises from the CLIs measured to CLIs not measured. Nothing here claims a
  measurement for a CLI that was not run.

## 3. Start and keep-alive

`orca terminal create --worktree <path:...> --title <t> --command "<cli>" --json` starts any CLI in a
persistent Orca PTY. It returns `handle`, `ptyId`, `tabId`, `paneKey`, `worktreeId`, `incarnationId`.

Raw: a Claude terminal create returned `"ok": true`, `"handle": "term_<uuid>"`,
`"incarnationId": "<uuid>"`, `"surface": "visible"`.

The runtime keeps the PTY alive under its own ownership, not the CLI's. Measured: a CLI (codex) that
restarted itself mid-session dropped to a plain shell, and the terminal stayed `connected: true`. So
keep-alive of the *terminal* is independent of the *agent* inside it.

There is also a fixed-list launcher: `orca worktree create --agent <id>` and
`orca orchestration worker-start --agent <id>`. `worker-start --help` names the accepted ids:
`claude, codex, cursor, antigravity, muse, zcode, opencode, opencode2`.

**Finding:** start-by-command is open to any CLI; start-by-agent-id is a fixed list. A capability-driven
membership rule can use the first and must not depend on the second.

## 4. Identity once running

`terminal list --json` and `terminal show --json` return `agentIdentity` (a string or `null`).

Measured values:
- `claude`, `codex`, `opencode`, `gemini`, `hermes` -> the string.
- a plain shell and a Python REPL -> `null`.

Raw (show, one live terminal):
`"agentIdentity": "claude", "connected": true, "orphaned": false, "writable": true, "agentWait": null`.
Raw (show, a Python REPL): `"agentIdentity": null`.

**Finding:** identity is *recognition of the running process*, not a record of what was launched. An
unrecognised CLI keeps a terminal and a handle, and has `agentIdentity: null`.

Note: the ticket's summary spelled one field `orphan`; the runtime spells it `orphaned`.

## 5. A stable handle

Every terminal carries a runtime-issued `handle` of the form `term_<uuid>`. It is independent of the agent's
own session model. `read`, `send`, `show`, `wait`, `switch`, `close`, `rename` all accept it.

**Caveat, measured:** the tab *title* is owned by the CLI, not by the runtime.
`terminal rename --title "WF42-RENAMED"` returned `"ok": true`, but a Claude tab and a shell tab kept their
CLI-set titles; a codex tab renamed *itself* to a task-derived name. So a title is not a stable address. A
handle is.

`paneKey` (`<tabId>:<leafId>`) and `incarnationId` distinguish a relaunched process on the same tab.

## 6. Liveness

Two independent, PTY-level signals:
- `show --json` -> `connected` (bool), `orphaned` (bool), `writable` (bool). Live CLI:
  `connected: true, orphaned: false`. Exited terminal: `connected: false, orphaned: true, writable: false`.
- `terminal wait --for exit` ->
  `{"condition":"exit","satisfied":true,"status":"exited","exitCode":0,"exitCause":{"kind":"exited","exitCode":0}}`.

`worktree ps --json` also carries a per-worktree `status` (`working` / `active` / `inactive`) and
`liveTerminalCount`.

None of these needs cooperation.

## 7. Turn state (idle vs working) — the split

Three mechanisms exist. They do not cover every CLI.

1. **Agent graph** — `orca worktree ps --json` returns an `agents[]` per worktree with `agentType`, `state`,
   `toolName`, `mainAgent.{state,stateStartedAt}`, `interrupted`, `prompt`.
   Measured for claude: a live `done` -> `working` -> `done` transition; `toolName` values `Bash`, `Grep`,
   `PowerShell`, `SendMessage`; and `state: "waiting"` when `toolName: "AskUserQuestion"`.
   Measured for codex and opencode: **no row at all**, even while the CLI worked. A plain shell and a Python
   REPL also produced no row.
   **Finding:** the agent graph is Claude-only in this build.

2. **Send receipt** — `terminal send --text ... --enter --wait-submit <s> --json` returns an additive `stages`
   list, plus a `provider`/`observation` pair.
   Measured: claude -> `stages: ["input_accepted","turn_started"], provider: "claude", observation: "supported"`.
   codex -> the same shape, `provider: "codex"`.
   Measured: opencode -> `stages: ["input_accepted"], provider: "unsupported", observation: "unsupported"`.
   A plain shell and a Python REPL -> the same `input_accepted`-only shape.
   **Finding:** the runtime can prove a turn *started* for claude and codex. For opencode and unrecognised
   CLIs it proves only that input was accepted.

3. **`terminal wait --for tui-idle`** — measured reliable at CLI **startup** (claude, codex and gemini each
   returned `satisfied: true` after launch). Measured **unreliable for turn end**: after a real Claude turn
   finished, with the screen back at the idle prompt, `wait --for tui-idle` returned `timeout` on repeated
   attempts.
   **Finding:** treat `tui-idle` as a readiness primitive, not a dependable idle/turn-end primitive.

## 8. Interrupt vs stop

- **Interrupt:** `orca terminal send --interrupt` writes an interrupt-style input (measured
  `"bytesWritten": 1`). Its receipt is the *plain direct-input* shape (`handle`, `accepted`, `bytesWritten`)
  — **no `stages`, no `turn_started`**. Claude's screen showed "Stopped" after it. No receipt field proves
  "interrupt" rather than "ordinary input", and whether a given CLI honours the byte is CLI-specific
  (`unknown` outside Claude).
- **Stop:** `orca terminal close --terminal <handle>` tears the terminal down. Measured: after close, `show`
  reports `connected: false, orphaned: true`.
- At the orchestration layer a stop is explicit and supervised: `worker-stop` fences a Dispatch and stops its
  worker; `worker-abandon` fences *without* claiming the process stopped. That is the closest the runtime
  comes to a formal interrupt-versus-stop distinction, and it applies only to orchestration-managed workers
  (documented by the bundled orchestration skill; not run in this probe).

**Finding:** soft interrupt and hard stop are different commands, but Orca gives no distinct receipt for
"interrupt"; and a stop is only *provable* at the orchestration layer (`worker-stop` versus `worker-abandon`).

## 9. Observation without the CLI's cooperation

- **Cooperation-free (PTY-level):** `terminal read --screen --json` returns the rendered screen
  (`source: "screen"`). It worked for claude, codex, gemini, a shell and a Python REPL alike. `connected` /
  `orphaned` and `wait --for exit` are also PTY-level.
- **Needs an adapter:** the agent graph (`worktree ps` rows) and the send `turn_started` stage. These are
  `supported` only for the CLIs the runtime recognises with an adapter (here claude and codex).

The plugin under study already reads the screen as its fallback path and parses it into
`working` / `asking` / `idle`. That path is cooperation-free and stays available to any CLI.

## 10. Per-CLI capability table

| CLI | Start + keep alive | Identify | Stable handle | Liveness | Turn state (idle vs working) | Interrupt | Observe w/o cooperation |
|---|---|---|---|---|---|---|---|
| Claude Code | yes — `terminal create --command claude` | `agentIdentity: "claude"` | `handle` (title is NOT stable) | `connected`/`orphaned`; `wait --for exit` | **full**: agent graph `state`+`toolName`+`interrupted`; send `turn_started` | `send --interrupt`; screen showed "Stopped"; receipt not distinct | yes — `read --screen` |
| Codex | yes — `--command codex` | `agentIdentity: "codex"` | `handle` | `connected`/`orphaned` | **partial**: send `turn_started` (`provider: "codex"`); **no agent-graph row** | `send --interrupt`; CLI honour `unknown` | yes — `read --screen` |
| OpenCode | yes — `--command opencode` | `agentIdentity: "opencode"` | `handle` | `connected`/`orphaned` | **none** from the runtime: send gives `input_accepted` only (`provider: "unsupported"`); no graph row | `send --interrupt`; CLI honour `unknown` | yes — `read --screen` |
| Gemini CLI | yes — `--command gemini` | `agentIdentity: "gemini"` | `handle` | `connected`/`orphaned` | **unknown** — send gave `input_accepted` only; the probe was blocked at the CLI's auth prompt, so this is understated | `send --interrupt`; CLI honour `unknown` | yes — `read --screen` |
| Any CLI with no adapter (measured: Python REPL, plain shell) | yes — `--command <cli>` | `agentIdentity: null` | `handle` | `connected`/`orphaned`; `wait --for exit` | **none** from the runtime: `input_accepted` only; no graph row | `send --interrupt` is sent; **unknown** whether the CLI honours it | yes — `read --screen` |
| Cursor, Antigravity, Muse, ZCode | **unknown** — named as Orca agent ids by `worker-start --help`, not installed on this host, not run | unknown | unknown | unknown | unknown | unknown | unknown |

## 11. Observations vs inferences

**Observed** (raw output on this host): start/keep-alive by command for claude, codex, opencode, gemini and
two non-agent programs; `agentIdentity` recognition for those five plus `hermes`; handle addressability;
`connected`/`orphaned`; `wait --for exit`; the agent-graph rows for claude and their absence for
codex/opencode/non-agents; the send `stages`/`provider`/`observation` for claude, codex, opencode and
non-agents; the `send --interrupt` receipt shape; `wait --for tui-idle` at startup and after turn end; and
the rename behaviour.

**Inferred** (marked, not measured):
- Any CLI the runtime has no adapter for behaves like the Python REPL and the plain shell:
  `agentIdentity: null`, `input_accepted`-only send, no agent-graph row, screen still readable.
- The agent graph is Claude-only in this build; a later build may add adapters for other CLIs — not observed
  here.

## 12. Unknowns the runtime cannot answer

- Whether a given CLI honours `--interrupt` (only Claude showed the effect).
- Turn state for gemini (the probe stopped at auth).
- Any fact for Cursor, Antigravity, Muse, ZCode (not installed, not run).
- Whether the agent graph can hold any `agentType` other than `claude` (none observed on this host).