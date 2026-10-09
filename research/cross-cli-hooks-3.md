# Cross-CLI hooks, third pass: Grok build, Command Code, Amp, Goose, Antigravity, and Copilot re-checked

Research ticket: [#54](https://github.com/herman925/925-cc-plugins/issues/54) · map [#2](https://github.com/herman925/925-cc-plugins/issues/2) · first pass [#53](https://github.com/herman925/925-cc-plugins/issues/53).

This pass covers the five CLIs both prior passes left `unknown` or never reached — **Grok build, Command
Code CLI, Amp, Goose, Antigravity CLI** — and re-checks **GitHub Copilot CLI** against the sharpened test.
The method is unchanged: each cell comes from the vendor's own documentation or its own source. Where the
vendor open-sourced the harness, the struct that builds the hook payload was read directly, not inferred
from a doc page. A plugin, an MCP server or a config file does not decide a cell.

## The test, restated

- **STRONG (what the guard needs): a PER-PROMPT origin.** The hook is told, for *this* prompt, whether a
  person at the keyboard sent it, or a plugin / another session / an automated path did. This is the
  analogue of the mod's `origin.kind === 'composer'`.
- **WEAK (not sufficient): a SESSION-LEVEL distinction only** (interactive vs gateway vs cron vs
  unattended). It cannot tell a plugin's prompt from the person's inside one interactive session.

A cell that says **no** means the payload carries no such field and the architecture does not make the two
indistinguishable in the guard's favour. A cell that says `unknown` means the documentation and the source
do not state it either way, so the cell is not established. This pass promotes every `unknown` to a
verdict, because it reached source for each.

---

## The table

| CLI | (1) Refuse a call | (2) Read a file per call | (3) Prompt origin — **LEVEL** | (4) In-session at start | Evidence |
|---|---|---|---|---|---|
| **Grok build** (xAI, `grok`) | **Yes.** `PreToolUse` is "the only blocking event"; deny with `{"decision":"deny","reason":…}` or exit `2`. `UserPromptSubmit` can also **block a prompt** | **Yes.** A hook is a shell command or an HTTP endpoint — a fresh process per call | **NONE to the hook — but the HOST holds STRONG and does not forward it.** The payload `UserPromptSubmit { prompt: Option<String>, subagent_type }` carries **no origin field**. The host *does* classify every prompt: a closed `PromptOrigin` enum (`User`, `TaskCompleted`, `SubagentCompleted`, `ParentAgentMessage`, `ParentHumanMessage`, `WorkflowCompleted`, `NotificationDrain`, `GoalSummary`, `GoalClassifierNudge`, `SchedulerFired`, `PlanResume`) mapped to `InputAuthority::HumanIntent` for the person's own turn — and its prompt-gate refuses to enforce unless `policy.authority.is_human_intent() && !is_subagent`. That is per-prompt, closed, and used by the host itself — and **reaches no hook** | **Yes.** JSON under `~/.grok/hooks/*.json` or project `.grok/hooks/*.json`; `.claude/settings.json`, `.cursor/hooks.json`, `config.toml`, `managed_config.toml`, `requirements.toml` and plugins are read too. Project hooks need `/hooks-trust` or `--trust` | Docs: <https://docs.x.ai/build/features/hooks> · source `crates/codegen/xai-grok-hooks/src/event.rs`, `…/xai-grok-shell/src/session/mod.rs`, `…/session/acp_session_impl/hook_dispatch.rs` |
| **Command Code CLI** (`cmd`) | **Yes, on two APIs.** *Hooks*: `PreToolUse` denies the tool. *Mods*: `hooks.beforeToolCall` returns `{block: true, …}` | **Yes.** Hooks are shell scripts; a mod is in-process TypeScript. Either can read any file per call | **STRONG — by a delivery gate, not a named field.** The prior passes read only the Hooks API (events: `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart` — no prompt event) and concluded "no prompt event". The **Mods** API has the prompt hook: `hooks.transformInput({text})`, the doc's own label is "the mods' **UserPromptSubmit** hook", and it states *"Only real typed input is intercepted — automated turns, meta messages, image-carrying prompts, and slash commands never route through it."* So the hook is invoked **only** for a person's typed prompt: the host makes the per-prompt distinction and delivers the hook only on the person's side. A plugin's `{prompt}` command submits an **automated turn**, which never routes here — a forged `#allow-write` cannot reach the hook. Same security property as Qwen Code's `submitted_prompt`, reached by **withholding the call** rather than by a field. ⚠️ The Mods API is labelled **experimental** | **Yes.** Mods load at startup from `~/.commandcode/mods/*.ts`, project `.commandcode/mods/…`, `mods.paths`/`mods.sources`, or `--mod`; hooks from `.commandcode/settings.json` / `~/.commandcode/settings.json`. Project mods are trust-gated | Docs: <https://commandcode.ai/docs/mods> · <https://commandcode.ai/docs/hooks> |
| **Amp** (ampcode) | **Yes.** `tool.call` returns `{action:'allow'\|'reject-and-continue'\|'modify'\|'synthesize'}`; `reject-and-continue` blocks | **Yes.** In-process plugin (Bun), runs per call | **NONE — promoted from `unknown`.** The event map is `session.start`, `tool.call`, `tool.result`, `agent.start`, `agent.end`, `changes.prompt`. `agent.start` (the turn-start event) carries `AgentStartEvent { thread, message, messageID }` — "the user's prompt message" — with **no origin or actor field**. The nearest signals are (a) `amp.activeThread.current`, a **foreground/focus** observable ("the thread the user is focused on"), which cannot separate a plugin's `continue` on the active thread from the person's; and (b) Amp's own worked example tells user-turn from plugin-continue by **string-matching a marker in `event.message`** (`if (!event.message.includes(marker))`) — the *content-sniffing* anti-pattern OpenClaw's docs explicitly warn against. Neither is per-prompt provenance | **Yes.** Plugins load from `.amp/plugins/`, `~/.config/amp/plugins/` (or `$XDG_CONFIG_HOME`), personal and workspace repos; activation applies to interactive and `amp --execute` runs | Docs: <https://ampcode.com/docs/plugin-api> · <https://ampcode.com/docs/customize/plugins> |
| **Goose** (Block / aaif-goose) | **Yes.** `PreToolUse` blocks with exit `2` or `{"decision":"block","reason":…}`; `on_failure: block` denies on a failing hook | **Yes.** Command hook, fresh process per call (`sh -c`) | **NONE — promoted from `unknown`/`leaning no`, read from the struct.** The whole payload type is `HookContext` (`crates/goose/src/hooks/mod.rs`): fields `event`, `session_id`, `matcher_context`, `tool_call_id`, `tool_name`, `tool_input`, `tool_output`, `message`, `last_assistant_message`, `working_dir`, `decision`, `policy_evaluated`, `blocked_by`, `reason`. On `UserPromptSubmit` only `message` (and `matcher_context`) is filled, by `.with_message(...)`. **There is no origin, actor, source or provenance field in the struct, and no timestamp / `is_user` either.** The event is emitted from `crates/goose/src/agents/state_machine/ops_steer.rs` and `session.rs`. So the payload carries `event` + `session_id` + `matcher_context` + `message`, and nothing marks who submitted | **Yes.** Plugin hooks load from `~/.agents/plugins/<name>/hooks/hooks.json` or `<project>/.agents/plugins/…`, discovered at startup | Docs: <https://goose-docs.ai/docs/guides/context-engineering/hooks> · source `crates/goose/src/hooks/mod.rs`, `…/agents/state_machine/ops_steer.rs` |
| **Antigravity CLI** (Google) | **Yes.** `PreToolUse` returns `decision: allow / deny / ask / force_ask / deny_unless_prior_grant`; a single `deny` hard-blocks | **Yes.** Command hook, fresh process per call | **NONE — promoted from `unknown`.** The documented input contract enumerates every field per event and none is an origin, and **there is no prompt event at all**. Common fields: `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`. `PreToolUse` adds `toolCall{name,args}` + `stepIdx`; `PreInvocation` adds `invocationNum` + `initialNumSteps`; `Stop` adds `executionNum`, `terminationReason`, `fullyIdle`. `PreInvocation`'s `injectSteps` (`userMessage` / `ephemeralMessage`) is a **write** channel — the hook adds a message — not the origin of an incoming one | **Yes.** `hooks.json` loads from workspace `.agents/hooks.json`, global `~/.gemini/config/hooks.json` (or `settings.json`), or a plugin's `hooks.json`; `/hooks` re-reads | Docs: <https://antigravity.google/docs/hooks> |
| **GitHub Copilot CLI** *(re-check)* | **Yes.** `preToolUse` returns `permissionDecision: "allow"\|"deny"\|"ask"`; a command `preToolUse` hook is **fail-closed** on crash or any non-zero exit (**only timeouts fail-open**); HTTP `preToolUse` is fail-open. Policy hooks load first and cannot be disabled | **Yes.** Command hook (`bash`/`powershell`/`command`/`exec`), fresh process per call | **NONE — re-confirmed from the payload block.** `userPromptSubmitted` input is `{sessionId, timestamp, cwd, prompt}` (camelCase) or `{hook_event_name, session_id, timestamp, cwd, prompt}` (VS Code shape). **No origin.** `userPromptTransformed` adds `transformedPrompt` (the model-facing text) and `modifiedTransformedPrompt` — again no origin. `modifiedPrompt` is honoured **only by SDK programmatic hooks**; command and HTTP config-file `userPromptSubmitted` hooks have their output dropped | **Yes.** Policy (`/etc/github-copilot/policy.d/`, registry) → repo `.github/hooks/*.json` → user `~/.copilot/hooks/` → inline `settings.json` → plugin `hooks.json`; all are combined | Docs: <https://docs.github.com/en/copilot/reference/hooks-reference> |

Legend for (3): **STRONG** = the host makes a per-prompt person-vs-programmatic distinction that reaches the
hook — either as a named field (Qwen Code `submitted_prompt`, OpenClaw `inputProvenance.kind`) or as a
delivery gate (Command Code `transformInput`). **WEAK** = a session-level distinction only. **NONE** = the
payload carries no such field and the host does not otherwise reach the hook with one. **unknown** = not
established.

**Which hook API each check rests on (asked for Copilot, stated for all).** For Copilot the (1) cell rests on
the `preToolUse` event (both the camelCase `preToolUse` and the PascalCase `PreToolUse` with Claude-format
matchers); the (3) cell rests on the `userPromptSubmitted` payload block. For Grok, (1) rests on
`PreToolUse`; (3) rests on the `HookPayload::UserPromptSubmit` variant and the host's
`should_enforce_prompt_block` gate. For Command Code, (1) rests on the Hooks API's `PreToolUse` **and** the
Mods API's `beforeToolCall`; (3) rests on the Mods API's `transformInput`. For Goose, (1) rests on
`PreToolUse`; (3) rests on the `HookContext` struct. For Amp, (1) rests on `tool.call`; (3) rests on
`AgentStartEvent`. For Antigravity, (1) rests on `PreToolUse`; (3) rests on the enumerated common +
per-event input field lists.

---

## What each failing row HAS, and what is EXACTLY MISSING

A bare "fails (3)" hides the mechanism. Each row below names the signal the vendor already keeps, so the
gap's shape is visible.

- **Grok build — field-and-plumbing gap, exactly the Hermes shape.** It has a **closed, per-prompt origin**
  (`PromptOrigin`, an 11-variant enum) and a **derived authority** (`InputAuthority::HumanIntent`). It uses
  that origin to gate its own prompt block (`should_enforce_prompt_block` → `is_human_intent() && !is_subagent`),
  and the docs state the same: *"Only a prompt you typed can be blocked: auto-wake turns … and subagent
  sessions run the hook observe-only."* **What is missing is the forward, not the signal:** the
  `HookPayload::UserPromptSubmit` variant carries only `prompt` and `subagent_type`; `PromptOrigin` and
  `InputAuthority` appear in no hook payload. A vendor could close it by adding one field. This is the same
  lesson Codex taught one field earlier, and the same one Hermes taught: the test is *does the vendor
  **deliver** who typed the prompt to a hook*, not *does the vendor know*.
- **Amp — capability gap, and the ecosystem's own workaround is the anti-pattern.** It has a blocking
  pre-tool hook and a turn-start event, but `AgentStartEvent` exposes only `{thread, message, messageID}`.
  The nearest thing to an origin is `agent.activeThread` (foreground vs background) — a **focus** signal,
  not provenance — and Amp's own documented idiom for user-vs-plugin is to **string-match a marker in the
  prompt text**, which is exactly what OpenClaw warns against. Nothing in the payload marks the submitter.
- **Goose — capability gap, read from the struct.** It has a rich blocking `PreToolUse` and a broad event
  set, and its `HookContext` is deliberately minimal. It carries `event` and `session_id` (session-level
  only, WEAK at best) but **no per-prompt origin**: the struct has no `origin`, `source`, `actor`, `is_user`
  or `timestamp` field. The whole field list is above.
- **Antigravity CLI — capability gap.** It has a fine-grained blocking `PreToolUse` (`deny`, `force_ask`,
  `deny_unless_prior_grant`) but **no prompt event exists** to carry an origin, and the documented input
  fields for every event are ids, paths, a model name, a tool call and step indices. Nothing about who
  submitted.
- **GitHub Copilot CLI — capability gap.** It has `userPromptSubmitted` (the event the guard would read) and
  `userPromptTransformed`, and the runtime transforms the prompt — but neither payload carries an origin.
  `modifiedPrompt` shows the runtime *knows* it is mutating the prompt, yet the origin is still withheld.

---

## Correction and extension owed to the prior passes

1. **Command Code is not a negative — it is a third pass, and it must be recorded as one.** [#53](https://github.com/herman925/925-cc-plugins/issues/53)
   recorded "No — and there is no prompt event" (events are `PreToolUse`, `PostToolUse`, `Stop`,
   `SessionStart` only). That read the **Hooks** API. Command Code also ships a **Mods** API whose
   `transformInput` is its UserPromptSubmit hook, and the docs state it fires **only for real typed input** —
   automated turns, meta messages, image-carrying prompts and slash commands never route through it. That is
   a **per-prompt provenance distinction that reaches the hook.** So the pass list is **not two, it is three**
   — Qwen Code, OpenClaw, and Command Code — *provided* the guard accepts a **delivery-gated** origin as
   equivalent to a named origin field. That is a design call, put to the user, not applied here. Caveats to
   weigh: the Mods API is labelled **experimental**, and the grant-capture keys on "the hook ran" rather than
   on reading a field.
2. **Grok's (3) is `no`, but the number was right for the wrong reason.** [#54](https://github.com/herman925/925-cc-plugins/issues/54)
   marked Grok `no` from the payload. This pass adds the mechanism: the host **has** per-prompt human-intent
   and does not forward it. Grok belongs beside Hermes as a *field-and-plumbing gap*, not a capability gap.
3. **Amp and Goose and Antigravity move from `unknown` to `no`.** Each was left unestablished by both prior
   passes; this pass reached the payload struct (Goose, from source) or the full documented field list
   (Amp, Antigravity), so the cell is now established rather than inferred. Where evidence is a doc
   enumeration rather than a closed machine schema (Antigravity), that is stated in the cell.
4. **Copilot re-confirmed `no`,** and the (1)/(3) hook APIs it rests on are named above.

## What this decides for [#52](https://github.com/herman925/925-cc-plugins/issues/52)

- **Requirement (1) is universal among these six; (3) is still the boundary.** All six block a call and read
  a file per call. Only **Command Code** reaches the hook with a per-prompt person-vs-programmatic
  distinction, and it does so by **withholding the call**, not by a field — a distinct third shape of STRONG
  that the record must name, because the guard's implementation differs from reading `submitted_prompt`.
- **The destination, if the user accepts delivery-gated origin, is three named CLIs, not two:**
  Qwen Code, OpenClaw, and Command Code. If the user rules that only a **named** origin field qualifies, the
  destination stays two and Command Code joins Codex and Grok as "has the signal, does not deliver it" — the
  difference between Command Code and Grok being that Command Code's delivery gate is enforceable today while
  Grok's origin is entirely internal.
- **The sharpest new lesson from this pass:** there are now three *shapes* of STRONG (a named field · a closed
  enum · a delivery gate) and two *shapes* of near-miss (a host that knows the origin but forwards nothing —
  Grok, Hermes — and a host that transforms the prompt but forwards no origin — Copilot). Recording only
  pass/fail would have hidden both.

---

Method: each cell read from the vendor's own documentation or its own source on 2026-10-09. Where the
harness is open source, the payload struct was read directly (`xai-org/grok-build` →
`crates/codegen/xai-grok-hooks/src/event.rs` and `crates/codegen/xai-grok-shell/src/session/…`;
`aaif-goose/goose` → `crates/goose/src/hooks/mod.rs`). No cell rests on a local probe. Cells not established
from documentation or source are marked `unknown`, not inferred.