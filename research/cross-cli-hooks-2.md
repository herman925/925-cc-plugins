# Cross-CLI hooks, second pass: the CLIs the first pass did not test

Research ticket: [#54](https://github.com/herman925/925-cc-plugins/issues/54) · map [#2](https://github.com/herman925/925-cc-plugins/issues/2) ·
first pass [#53](https://github.com/herman925/925-cc-plugins/issues/53).

This pass covers the six CLIs [#54](https://github.com/herman925/925-cc-plugins/issues/54) names, re-checks the three [#53](https://github.com/herman925/925-cc-plugins/issues/53)
already tested, and re-checks the three [#53](https://github.com/herman925/925-cc-plugins/issues/53) left `unknown`. The method is unchanged:
each cell comes from the CLI's own documentation or source. A plugin, an MCP server or a config file
does not decide a cell.

## The test for (3), stated at two levels

Requirements (1) refuse a call and (2) read a file per call are now common. Requirement (3) is the
boundary, and it has two levels that are **not** the same answer.

- **STRONG (what the guard needs): a PER-PROMPT marker.** The hook is told, for this prompt, whether a
  person at the keyboard typed it, or a plugin / another session submitted it. This is the analogue of
  the mod's `origin.kind === 'composer'`.
- **WEAK (not sufficient): a SESSION-LEVEL distinction only** (interactive vs gateway vs cron vs
  unattended). It cannot tell a plugin's prompt from the person's inside an interactive session — which
  is the case that matters.

A cell that says `unknown` means the documentation and the source do not state it either way. A cell
that says `no` means the schema is exhaustive or the architecture makes the two indistinguishable.

---

## The table

| CLI | (1) Refuse a call | (2) Read a file per call | (3) Prompt origin — **LEVEL** | (4) In-session | Evidence |
|---|---|---|---|---|---|
| **Hermes** (Nous Research) | **Yes.** Plugin `pre_tool_call` returns `{"action":"block","message":…}` (or `approve`); a timed-out or raising `pre_tool_call` **fails closed**. `_dispatch_pre_tool_call_hooks` in `hermes_cli/plugins.py`; `VALID_HOOKS` set; shell hooks also accept exit `2` | **Yes.** Shell-script hooks carry a `matcher` and a first-use consent allowlist; a command hook is a fresh process per call and can read any file | **WEAK — session-level only.** `_no_user_can_answer()` (`tools/approval_context.py`) separates single-query (`-q`), cron, unattended-platform and interactive CLI. Hook payloads carry `platform` (`cli`/`gateway`/…) and a per-turn `session_id`/`turn_id`, but **no per-prompt origin field** on `pre_llm_call` (the `UserPromptSubmit` analogue) or `pre_tool_call`. A per-turn `turn_author` with `is_bot` does exist (`agent/turn_author.py`), but it is set only by the bot-to-bot dispatcher (`HERMES_TURN_AUTHOR`) and reaches memory providers — **not any hook** | **Yes.** Hooks run inside the session. Events include `on_session_start`, `pre_llm_call`, `pre_tool_call`, `post_tool_call`, `on_session_end`; the RAFT adapter maps these to Claude-style `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `Notification` | Read from the installed source (`hermes_cli/plugins.py`, `hermes_cli/hooks.py`, `agent/shell_hooks.py`, `agent/turn_context.py`, `agent/turn_author.py`, `tools/approval_context.py`). **(3) is session-level, not a per-prompt marker** |
| **Grok build** (xAI, `grok`) | **Yes.** `PreToolUse` is "the only blocking event"; deny with `{"decision":"deny"}` or exit `2`. Everything else — timeout, crash, malformed output — is **fail-open** | **Yes.** A hook is a shell command or an HTTP endpoint, fresh process per call | **No.** The event arrives as JSON on stdin with `hookEventName`, `sessionId`, `cwd`, `workspaceRoot`, and for tool events `toolName`/`toolInput`. `UserPromptSubmit` fires but its documented payload carries **no origin, actor or composer field** | **Yes.** Hooks are JSON under `~/.grok/hooks/*.json` or project `.grok/hooks/*.json`; `.claude/settings.json` and `.cursor/hooks.json` are read too. Project hooks need `/hooks-trust` or `--trust` | Docs: <https://docs.x.ai/build/features/hooks> |
| **MiniMax Code** (`mcode`) | **No documented hook API.** The gate is **permission modes** (Ask / Auto / Full access / Off), not a pre-tool hook | n/a | n/a | n/a | Its third-party plugin intake **explicitly refuses** the `hooks` manifest field and Hook JSON files; the plugin capabilities are Skill, MCP and App only. The community registry states "Hooks, custom Agents, Commands, LSP, Apps … are not advertised as current Agent Plugin capabilities." Docs: <https://agent.minimax.io/docs/code/agents/plugin-submission> · <https://github.com/MiniMax-AI/MiniMax-Code-Plugins> |
| **Devin CLI** (Cognition) | **Yes.** `PreToolUse` blocks (non-zero exit or `{"decision":"block"}`); `PermissionRequest` can also allow/deny | **Yes.** Command hook, fresh process per call | **No.** `UserPromptSubmit` stdin carries only `prompt`. Every payload carries `session_id` and a per-turn `prompt_id` ("rotated on every user prompt") — a **correlation id, not an origin**. No field marks who submitted | **Yes.** `.devin/hooks.v1.json`, `.devin/config.json`, user config; **also reads `.claude/settings*.json` and `~/.claude.json`** | Docs: <https://docs.devin.ai/cli/extensibility/hooks/overview> · `…/lifecycle-hooks` |
| **Command Code CLI** (`cmd`) | **Yes.** `PreToolUse` "denies the tool" | **Yes.** Hooks are shell scripts that read JSON on stdin and write JSON on stdout | **No — and there is no prompt event.** Events are `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart` only. Stdin common fields are `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`. No `UserPromptSubmit`, so no origin is even carried. Broader lifecycle is a "mod", not a hook | **Yes.** `.commandcode/settings.json` (project) or `~/.commandcode/settings.json` (user); hooks initialise on startup | Docs: <https://commandcode.ai/docs/hooks> |
| **OpenClaw** (OpenClaw Foundation) | **Yes.** `before_tool_call` returns `{block:true, blockReason?}` or `{requireApproval:…}`. It is a **fail-closed gate** (15 s default; a thrown error or timeout blocks). Trusted policies run first | **Yes.** Typed plugin handlers are in-process JS/TS and run per call, so they can read any file | **YES — STRONG (per-prompt origin).** `before_prompt_build` receives **`ctx.inputProvenance`**, "the host-classified origin of the turn's user-role input" on the embedded, CLI, Codex and Copilot prompt paths. **`kind` ∈ {`external_user`, `inter_session`, `internal_system`}**, with optional `originSessionId`, `sourceSessionKey`, `sourceChannel`, `sourceTool`. The docs **explicitly warn** that `ctx.trigger === "user"` is a run trigger, not an origin, and that `sessions_send` / `subagent_settle` / `subagent_announce` retain it — "use typed provenance to distinguish those inputs; do not parse prompt prefixes." **Fail-safe caveat:** the field is **optional**, and "absence does not prove human origin" — read absence as no-grant | **Yes.** `api.on("hook_name", …)` typed hooks run in-process; plugins load at startup (`activation.onStartup: true`) from `plugins.load.paths` or a plugin dir | Docs: <https://docs.openclaw.ai/plugins/hooks/prompt-and-session> · `…/plugins/hooks/tool-policy` · `…/plugins/hooks/reference`. Corroborated by security advisory **GHSA-w5c7-9qqw-6645** (fixed 2026.2.13), which added exactly this `inputProvenance` model with `kind: "inter_session"` |
| **GitHub Copilot CLI** *(re-check)* | **Yes.** `preToolUse` returns `permissionDecision:"deny"`; exit `2`, a crash and any other non-zero exit all **fail-closed** on `preToolUse` (only timeouts fail-open) | **Yes.** Command hook, fresh process per call | **No.** `userPromptSubmitted` input is `{sessionId, timestamp, cwd, prompt}` (camelCase) or `{hook_event_name, session_id, timestamp, cwd, prompt}` (VS Code shape) — no origin. `modifiedPrompt` is honoured **only by SDK programmatic hooks**. `userPromptTransformed` is mutation-only, no origin | **Yes.** Policy / repo `.github/hooks/*.json` / user `~/.copilot/hooks/` / plugin `hooks.json`; **policy hooks load first and cannot be disabled** | Docs: <https://docs.github.com/en/copilot/reference/hooks-reference>. **Confirms #53's `no`** |
| **Kilo Code** (`@kilocode/cli` 7.8.3) *(re-check — **#53 row is WRONG**)* | **Yes.** It **does** ship a plugin API (`@kilocode/plugin`) with `tool.execute.before`: "Intercept tool calls to mutate arguments, rewrite output, **or block** dangerous operations" | **Yes.** Plugin JS/TS modules run per call and can read files | **No.** Kilo's plugin API is an **OpenCode fork**: `chat.message` "fires when a new user message arrives" with metadata `{sessionID, agent, model, messageID, variant}` — no origin. Kilo's own migration guide says plainly: "Kilo has no shell-command, HTTP, MCP-tool, prompt, or agent hook types. Plugins are the answer" — and the plugin hook for `UserPromptSubmit` is `chat.message` | **Yes.** `.kilo/plugin/` (project) or `~/.config/kilo/plugin/` (global); auto-registered at startup | Docs: <https://kilo.ai/docs/automate/extending/plugins> · migration guide <https://kilo.ai/articles/claude-code-to-kilo-code-migration-guide>. **#53's "no tool-interception API at all" is stale:** it described the old Cline-lineage fork. Current Kilo is an OpenCode fork with a plugin API. It still fails (3) |
| **OpenCode** (anomalyco) *(re-check)* | **Yes.** `tool.execute.before` (v2: `ctx.tool.hook("execute.before")`); a thrown error fails the operation | **Yes.** The plugin runs per call | **No — re-confirmed.** The v2 beta adds `ctx.session.hook("prompt")` ("fires once per admitted input with the eventual inbox User `messageID`") but it carries **no provenance field**. The TUI and a plugin submit down the same `user` path; `chat.message` input is `{sessionID, agent, model, messageID, variant}` | **Yes.** Auto-loads from `.opencode/plugins/` or config; `session.created` is the session-start equivalent | Docs: <https://opencode.ai/v2/docs/build/plugins> · open issue #22831 (payload is "metadata only"). **Confirms #53's `no`** |
| **Antigravity CLI** (Google) *(was `unknown`)* | **Yes.** `PreToolUse` returns `decision: allow / deny / ask / force_ask / deny_unless_prior_grant`; **a crashed hook blocks the call (fail-closed by default)**; `{}` denies | **Yes.** Command hook, fresh process per call | **`unknown` — still not established.** The documented stdin is `toolCall{name,args}`, `stepIdx`, plus common fields `conversationId`, `workspacePaths`, `transcriptPath`, `artifactDirectoryPath`, `modelName`. The `PreInvocation` event exists but the manual documents **no prompt-source or actor field** | **Yes.** Hooks load from `hooks.json` (workspace / global / plugin) | Docs: <https://antigravity.google/docs/hooks> |
| **Amp** (ampcode) *(was `unknown`)* | **Yes.** `tool.call` returns `{action:'allow'|'reject-and-continue'|'modify'|'synthesize'}`; `reject-and-continue` blocks | **Yes.** In-process plugin runs per call | **`unknown` — still not established.** The plugin event map is `session.start`, `tool.call`, `tool.result`, `agent.start`, `agent.end`, `changes.prompt`. `agent.start` receives `event.message`; the reference documents **no origin or actor field** for the turn | **Yes.** Plugins load from `.amp/plugins/` or `~/.config/amp/plugins/`; `session.start` event exists | Docs: <https://ampcode.com/manual/plugin-api> |
| **Goose** (aaif-goose) *(was `unknown`)* | **Yes.** `PreToolUse` blocks with exit `2` or `{"decision":"block","reason":…}`; `on_failure: block` denies on a failing hook | **Yes.** Command hook, fresh process per call | **`unknown` — leaning no.** `UserPromptSubmit` payload is `{event, session_id, matcher_context, message}` — the prompt text and the matcher, **no origin field** documented | **Yes.** Plugin hooks load from `~/.agents/plugins/` or `<project>/.agents/plugins/`; `SessionStart` exists | Docs: <https://goose-docs.ai/docs/guides/context-engineering/hooks> |

Legend for (3): **STRONG** = a hook receives a field that marks the person's own submitted text, per
prompt, and is absent or different for a programmatic submit. **WEAK** = a session-level distinction
only. **No** = the schema carries no such field, or the architecture makes the two indistinguishable.
**unknown** = not established from documentation or source.

---

## The two CLIs that meet (3), and the level

- **Qwen Code** (from [#53](https://github.com/herman925/925-cc-plugins/issues/53)): `UserPromptSubmit` carries
  **`submitted_prompt`** — the composer's captured text, absent for machine-generated input. **STRONG.**
- **OpenClaw** (this pass): `before_prompt_build` carries **`ctx.inputProvenance.kind`**
  (`external_user` / `inter_session` / `internal_system`) plus source fields. **STRONG.**

Both are **optional** fields, and both docs say absence is not proof of human origin. The guard must
read **absence as no-grant** — that fails safe. For OpenClaw the docs state this for its own field:
"It is absent when the producer does not supply a classification, including ordinary human turns on
some paths. Absence does not prove human origin."

For both, the origin is available on the **prompt** event. The guard reads it there, records it for the
turn, and consults it at the **tool** event — the same shape the mod already uses with `composer`.

---

## Correction owed to #53

[#53](https://github.com/herman925/925-cc-plugins/issues/53)'s summary said *"Qwen Code is the only non-Claude CLI that meets
all four."* That was true **among the ten it tested**. It is read as a general claim, and **this pass
changes it**:

1. **OpenClaw also meets all four**, at the STRONG level for (3). So the set is not a singleton. The
   correct wording is: *among the CLIs tested so far, Qwen Code and OpenClaw pass; the rest fail (3) or
   have no interception API.*
2. **#53's Kilo Code row is wrong and must be corrected.** #53 recorded "no tool-interception API at
   all" (upstream #7859). That described the old Cline-lineage fork. Current Kilo (`Kilo-Org/kilocode`)
   is an OpenCode fork and **does** ship a plugin API whose `tool.execute.before` can block a call.
   Kilo therefore passes (1) and (2) and **fails (3)** — it is not a "no hook" negative.

So the record should be: **two** non-Claude CLIs meet all four; **Kilo Code** moves from the "no API"
negatives to the "has a hook, fails (3)" column.

---

## What this decides for [#52](https://github.com/herman925/925-cc-plugins/issues/52)

Requirement (3) is still the boundary, and it is still rare. (1) and (2) are widely met; only two CLIs
give a hook a per-prompt origin. The destination — *any CLI the runtime can start, address and observe
that can also run the guard* — therefore still admits very few members. It has widened by one
(OpenClaw), not by "any CLI". The user decides the wording.

---

Method: each cell read from the CLI's own documentation or published schema on 2026-10-09. Local probes
(`hermes --version`; `devin 3000.5.20`; `kilo 7.8.3`; `opencode-ai` present but its postinstall was not
run) fixed only what is installed here; **no cell rests on a probe**. Cells not established from
documentation or source are marked `unknown`, not inferred.
