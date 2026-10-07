# Research for ticket #34: can the plugin see a member's live subagents and their report_progress calls?

Date: 2026-10-07. Planning only: nothing here changes plugin code. Read-only sources; no live experiment was run.

Citation key
- **d.ts** = `claude-code.d.ts`, the plugin API declaration Claude Code 2.1.291 writes when the plugin-authoring skill loads (781,581 bytes; path `C:/Users/hkkchan/AppData/Local/Temp/claude/bundled-skills/2.1.291/7c3d9b5378177c332ac7026dda41c1e9/plugin-authoring/types/claude-code.d.ts`). Cited as `d.ts:LINE`.
- **TO** = `~/.claude/mods/team-orchestrator/hooks/` at commit f368722 or later. Cited `register.tsx:LINE`, `guard.ts:LINE`.
- **CV** = `~/.claude/mods/clean-view/hooks/clean-view.tsx`. Cited `clean-view.tsx:LINE`.
- "Declared" = the d.ts says it. "Live-verified" = seen in a running session. Nothing below is live-verified except the one item marked so.

## Summary

| | Question | Answer |
|---|---|---|
| a | Member's own plugin sees each Agent call's description, model, start, end, error? | **Yes** (declared) |
| b | Match a subagent's `report_progress` to its Agent call by agentId? | **Yes for the match; no for the meter today**: Clean View's hook must change |
| c | Count live subagents per member and deny over the limit? | **Yes** (declared); needs one extra guard for parallel calls |
| d | Enforce the subagent model? | **Yes** at the `agent.spawn` event; keep the model name in the prompt too |
| e | Get per-subagent state to a dock in another session? | **Yes, by a small per-member file**; not by `$.store` |
| f | Cheapest reliable design | A, below |

Decisions 8 to 11 stand. Decision 10's meter needs a change to Clean View (item b); everything else fits.

## (a) What the member's own plugin sees of an Agent call

Answer: yes. A plugin hooks four places, all declared.

1. The Agent tool's call. `tool.call` for tool `Agent` carries `description`, `prompt`, `subagent_type`, `model` ("sonnet" | "opus" | "haiku" | "fable"), `name`, `isolation` (d.ts:15513-15531). `tool.call`'s input is the tool call plus the loop it ran in (`ToolCallInput = ToolCallEnvelope & AgentLoop`, d.ts:12329). TO already hooks it: `on('tool.call', { tool: AGENT_TOOL })` (register.tsx:1005-1009).
2. The spawn itself, event `agent.spawn`: "Fires when the Agent tool is about to start a subagent, everything decided and its model not yet resolved" (d.ts:4011-4021). Input has `tool_use_id`, `prompt`, `description`, `subagentType`, `model` (as given), `parentModel`, `parentAgentId`, `background`, `fork`, `name`, `cwd` (d.ts:261-352). Result is `{ model, agentId }` (resolved id, and the new subagent's id) or `{ deny }` (d.ts:367-396).
3. The end. Three signals: (i) the Agent tool's result at `tool.call` (foreground): `agentId`, `resolvedModel`, `modelsUsed`, `totalDurationMs`, `totalTokens`, `usage`, `toolStats`, `status: "completed"` (d.ts:16318-16376); a background launch answers early with `status: "async_launched"`, `agentId`, `description`, `resolvedModel`, `outputFile` (d.ts:16382-16398); (ii) `turn.complete` carries the subagent's `agentId`, with `reason` `answer | aborted | refusal | error`, `durationMs` and `usage` (d.ts:12908-12915 for agentId; the reason type, `answer | aborted | refusal | error`, d.ts:12938); (iii) the settings-hook event `classic.SubagentStop` with `agent_id`, `agent_type`, `last_assistant_message` (d.ts:11909-11927), and `classic.SubagentStart` with `agent_id`, `agent_type` (d.ts:11903-11908).
4. A list. `$.agent.list()` returns every agent of the session: `id`, `description`, `type`, `status` (`pending | running | waiting | idle | completed | failed | killed`, d.ts:500), `parentId`, `spawnedBy`, `name` (d.ts:125-192, call at d.ts:3111-3118).

What is NOT declared: a start time or an end time on `AgentInfo`. The plugin stamps them itself with `$.clock.now()` at `agent.spawn` and at the end signal.

Error: `turn.complete.reason === 'error'` (or `aborted`/`refusal`) for that `agentId`, or `$.agent.list()` status `failed`/`killed`. A subagent that ends normally is `completed`.

Evidence a member's plugin already sees Agent calls: in this very session the TO guard answered my own Agent call with "Blocked Agent: General-Worker-2 has no subagent permission" (guard.ts:69; seen 2026-10-07). **Live-verified, for the tool.call route only.**

## (b) Matching `report_progress` to its subagent

Answer: the match works; the meter does not yet.

- Every event inside a subagent's loop carries that subagent's `agentId` ("Which model loop an event happened in", d.ts:194-205; "Every hook sees a subagent's turn", d.ts:12911-12913). So a `tool.call` hook on `mcp__clean-view__report_progress` sees `e.agentId` (= the subagent) plus `task` and `percent`. `$.agent.list()` then gives that `id`'s `description` and `parentId`. That is the per-subagent identity.
- **Problem 1, in Clean View.** Its `report_progress` hook has no agentId check (clean-view.tsx:263-272). A subagent's report would overwrite the member's own checklist. Its gate does skip subagents (clean-view.tsx:287) and so does `turn.complete` (clean-view.tsx:344); this one hook was missed. Fix: return "Progress noted" for `e.agentId !== undefined` without touching the checklist.
- **Problem 2, who tells the subagent to report?** Clean View adds its rules through `prompt.compose` (clean-view.tsx:199-202), which builds the *session's* system prompt, not a subagent's. Two declared ways to tell a subagent: rewrite the Agent spawn's `prompt` (`agent.spawn`: "A rewrite is the prompt the subagent runs with", d.ts:261-275) or return `additionalContext` from `classic.SubagentStart` (d.ts:1318). UNVERIFIED which reaches the subagent in this build.
- **Problem 3, availability.** UNVERIFIED that `mcp__clean-view__*` tools exist inside a subagent. An agent type's `tools` list can limit it ("Left out: every tool the parent has", d.ts:424); built-in types are not documented.
- TO can observe the call without changing Clean View: a second `tool.call` hook on the same tool name that records `{agentId, task, percent}` and calls `next(e)`. Order between the two mods' hooks is not declared; observing does not depend on order.

## (c) Counting live subagents and denying over the limit

Answer: yes.

- Count: `$.agent.list()` entries with status `pending | running | waiting` and `type !== 'teammate'`, `parentId` absent (direct children of the main loop; decide whether nested count). The engine keeps the list, so a count taken inside the hook cannot drift from a counter the plugin forgot to decrement (d.ts:3112-3118: "until the engine drops its task: ... a subagent's later").
- Deny: `agent.spawn` returns `{ deny: "Subagent limit is N: wait for one to finish." }`; "the model sees the text as the Agent tool's error" (d.ts:391). It could also deny at `tool.call` for `Agent`, which is what TO does now with a boolean (guard.ts:61-71, register.tsx:1005-1009). `agent.spawn` is the better place: it fires only for spawns that will really start, for model calls and plugin calls alike (`$.agent.spawn` runs every hook, d.ts:3098-3110).
- A guard that throws is skipped and the subagent starts, so register it with `.catch(($, e, next) => next.called ? next(e) : { deny: ... })` (d.ts:4018-4021).
- Race: two Agent calls in one turn. UNVERIFIED whether their `agent.spawn` hooks run one after the other. Safe pattern: keep a module counter `reserved` incremented synchronously at the top of the hook (before any `await`), decremented when the agent appears in `list()`, when the spawn is denied, and on any end signal; deny when `listed + reserved >= N`.
- Background subagents outlive the turn: the list still shows them `running`/`waiting`, so they count (d.ts:500 doc: `waiting` "in a background subagent, on an Agent call alone").
- Restart/reload: `list()` is empty after a restart; the count restarts at 0, which is correct. Anything the plugin kept in a file (see e) must have an `updatedAt` and be ignored when stale.

## (d) Enforcing the subagent model

Answer: yes, at `agent.spawn`.

- `model` is in the event's input and a hook "sets this to pick the subagent's model" by `next({ ...e, model })`; an alias resolves like the tool parameter (d.ts:4011-4017; the `model` field and its doc, d.ts:289-297). The result reports the resolved model (`AgentSpawnResult.model`, d.ts:372) and the finished Agent result has `resolvedModel` and `modelsUsed` (d.ts:16318-16376). A plugin can therefore check after the fact: write `result.model` to the member's file and flag a mismatch.
- Herman's past finding: a parameter alone once ran agents on the wrong model. That concerned the Agent tool's `model` parameter. `agent.spawn` is the later step where "its model [is] not yet resolved", so a rewrite there should win over the parameter. UNVERIFIED in a live session. Keep the model name in the prompt text as well (cheap defence), and treat `AgentSpawnResult.model` as the proof.
- Forks ignore `model` ("Ignored for forks", d.ts:295; `fork`, d.ts:328); the limit should either count forks too or forbid them.
- An agent type can carry its own `model` (`AgentSpec.model`, the `AgentSpec` type, d.ts:407); a registered type `team-orchestrator:worker` could pin it, but the spawn rewrite is simpler.

## (e) Getting state to a dock in another session

Answer: yes, with one small file per member.

What exists:
- TO's dock runs in one session and learns other members by polling: it reads each member's Orca terminal screen and parses status, model and context (register.tsx:588-625), plus the member's transcript when the screen lacks them (register.tsx:395-420; sidechain lines are skipped, register.tsx:409). Refresh is about 1 s.
- Structure is shared through `<project>/.claude/team-orchestrator.json`, written by `share()` and read by `pull()` (register.tsx:234-300). "Only the structure is saved (not live status)" (register.tsx:238).
- `$.store` is "This plugin's own key-value store, kept between sessions and hot reloads", "a JSON file of the plugin's own under the user's Claude Code configuration directory" (d.ts:3277-3282). So two sessions share one file. Whether `get` re-reads the file each time, and what two simultaneous `set`s do, is not declared: UNVERIFIED. Do not rely on it.
- `$.fs.write/read/exists/list` reach any absolute path, 4 MiB each (d.ts:3155-3170).

Proposed channel: each member's plugin writes `<root>/.claude/team-orchestrator/live/<team>-<member>.json` and the dock reads the folder on its 1 s refresh. One writer per file, so no write race. Content: `{ updatedAt, limit, model, running: [{ id, task, startedAt, pct?, model }], finished: { n, failed, seconds } }`. Write on `agent.spawn`, each end signal and each observed `report_progress` (rate-limit to ~1 write/s). A file older than a few seconds while the member's pane is alive means the plugin stopped (show "?" not a stale count). The folder is already inside the project's `.claude/` that TO writes git-exclude lines for (register.tsx:253-261).

Other channels considered and rejected: transcripts (a subagent's lines are sidechain, register.tsx:409; parsing 4 MiB files, register.tsx:369); screen scraping (no subagent data on the status line); SendMessage (costs a model turn).

## (f) Cheapest reliable design: A

1. **Member plugin, `agent.spawn` hook** (with `.catch` deny): count = `list()` active direct subagents + `reserved`; if `>= N` deny with the decision-9 text; else `next({ ...e, model: configuredModel, prompt: e.prompt + progressNote })` and record `{ id (after next), description, startedAt, model: result.model }`.
2. **End signals**: `classic.SubagentStop` and `turn.complete` with `agentId`; set `endedAt`, `ok = reason === 'answer'`.
3. **Meter**: a TO hook on `mcp__clean-view__report_progress` records `{agentId, task, percent}`; Clean View's hook gets one line to ignore `agentId !== undefined`.
4. **Share**: the per-member live file above.
5. **Dock**: child boxes from the file; fold 5 s after the last finish into "✓ N subagents finished in Xm Ys (K failed)" kept until the member's next `turn.start` (main loop, no agentId).

Failure modes and answers
- Hook skipped or throws: `.catch` denies (limit) or lets the spawn through (display only).
- Parallel spawns: `reserved` counter (see c).
- Subagent never calls `report_progress`: show the slow sweep (decision 10 already says so).
- File stale after a crash: `updatedAt` check.
- Wrong model: `result.model` mismatch is logged and shown.
- Teammates (`type: 'teammate'`) are not subagents: exclude them from the count.

## Does this break decisions 8 to 11?

No decision breaks. Two consequences for the plan:
- **Decision 10 (meter)** needs a one-line fix to Clean View (item b, problem 1) and a way to tell the subagent to report (rewrite the spawn prompt, or `SubagentStart` context). Until then every subagent shows the sweep.
- **Decision 8 (limit and model)** moves from the `tool.call` guard to the `agent.spawn` event; the "Allow subagents" on/off becomes a number in the same place the boolean sits (guard.ts:61-71).

## UNVERIFIED, and the smallest live experiment that settles each

One throwaway mod `probe` (hooks on `agent.spawn`, `classic.SubagentStart`, `classic.SubagentStop`, `turn.complete`, and a `tool.call` on `mcp__clean-view__report_progress`, each logging `agentId`, `description`, `model`, `$.agent.list()` to a file), then ask a session to launch three parallel Agent calls and one that calls `report_progress`:
1. `agent.spawn` fires for model-initiated Agent calls; a `model` rewrite wins over the tool's `model` parameter; `{deny}` reaches the model as the tool error.
2. Parallel spawns: are the hooks sequential, and what does `list()` show between them?
3. `mcp__clean-view__*` tools exist inside a subagent and arrive with `e.agentId`.
4. Whether `classic.SubagentStart` `additionalContext` or a rewritten spawn `prompt` reaches the subagent.
5. How long `list()` keeps an ended subagent ("seconds after", d.ts:3112).
6. `$.store` between two live sessions: a re-read per `get`? (Only if the file channel is dropped.)
