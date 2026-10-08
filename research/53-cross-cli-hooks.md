# Cross-CLI hooks: which CLIs can carry the guard?

Research ticket: [#53](https://github.com/herman925/925-cc-plugins/issues/53) · map [#2](https://github.com/herman925/925-cc-plugins/issues/2) · blocked issue [#52](https://github.com/herman925/925-cc-plugins/issues/52).

Read from this tree: `team-orchestrator/README.md` (guard section), `team-orchestrator/hooks/guard.ts`,
`team-orchestrator/hooks/register.tsx`, `team-orchestrator/hooks/hooks.json`, `team-orchestrator/types/index.d.ts`,
and the map [#2](https://github.com/herman925/925-cc-plugins/issues/2) with its decision list.

**Method.** Each cell comes from the CLI's own documentation or its own source. The public documentation
and the published JSON schemas are the primary sources. A local probe (`--help`, `--version`, config
folders) only fixes what is installed here; it does not decide a cell. Where nothing could be established,
the cell says `unknown`. The four requirements are quoted from the ticket:

1. **See every tool call before it runs, and refuse it.** Observe-only is not a guard.
2. **Read a file (the roster) on every call.**
3. **Distinguish what the person typed from what a plugin or another session submitted.** Without this,
   the one-turn grant is forgeable and there is no guard.
4. **Run inside every member's session**, and be told to load at session start.

---

## Verdict short

- **Requirement (3) is the one that decides the destination, and one non-Claude CLI meets it: Qwen Code.**
  Its `UserPromptSubmit` hook carries a `submitted_prompt` field that exists only when the composer
  captured the person's own text; the field is absent for machine-generated input, and the docs tell hook
  authors not to fall back to it. That is a direct analogue of this mod's `origin.kind === 'composer'`.
- **The three CLIs the ticket named — Codex, OpenCode, Gemini CLI — cannot satisfy (3).** Each has a
  blocking pre-tool hook (so (1) passes), but none gives a hook any field that marks the origin of a
  prompt. Codex is the sharpest: its published `UserPromptSubmit` input schema is exhaustive
  (`additionalProperties: false`) and lists no origin field at all. Gemini CLI's `BeforeAgent` gets a bare
  `prompt` string. OpenCode is client/server, so the TUI and a plugin submit through the same `user`
  message path and the plugin API exposes no origin. **Under the rule in [#41](https://github.com/herman925/925-cc-plugins/issues/41)
  Q3, this alone disqualifies them as guardable members.**
- **A blocking pre-tool hook is now common.** Codex, Gemini CLI, Antigravity CLI, Cursor CLI, Amp,
  OpenCode, Cline, Goose, GitHub Copilot CLI and Qwen Code all ship a hook that runs before a tool call
  and can refuse it. Requirement (1) is no longer the boundary. Requirement (3) is.
- **Three CLIs have no tool-interception API at all and fix the lower boundary:** Kilo Code, Continue,
  and Aider. They are named in the Negatives section.

---

## The table

One row per CLI. Four columns, one per requirement. Cell = the answer plus its evidence.

| CLI | API (name) | (1) Refuse a call? | (2) Read a file per call? | (3) Typed vs programmatic? | (4) Load at session start? | Verdict |
|---|---|---|---|---|---|---|
| **Claude Code** (baseline) | Hooks (`settings.json`, plugin `hooks/hooks.json`) + the in-process plugin API (`on('tool.call')`) | **Yes.** `tool.call` returns `{ deny }` for the `Agent`/`Write`/`Edit`/`NotebookEdit` tools. `register.tsx:1342-1346`, `guard.ts:62-82` | **Yes.** `pull($)` + `readMembers($)` run on every call (`register.tsx:761-764`) | **Yes.** `grantsFrom(e.origin, e.text)` returns `undefined` unless `origin.kind === 'composer'` (`guard.ts:29-32`, `register.tsx:1464,1481`) | **Yes.** Plugin auto-loads from the marketplace; SessionStart/plugin init runs per session | Reference — the design the destination must match |
| **Codex** (OpenAI) | Hooks, `.codex/hooks.json` / `~/.codex/hooks.json`; events incl. `PreToolUse`, `UserPromptSubmit`, `SessionStart` | **Yes.** `PreToolUse` returns `{ "decision": "block" }` or `hookSpecificOutput.permissionDecision: "deny"`, or exit `2` | **Yes.** A command hook is a fresh process each call, so it can read any file | **No.** The published `user-prompt-submit.command.input.schema.json` requires `[cwd, hook_event_name, model, permission_mode, prompt, session_id, transcript_path, turn_id]` and sets `additionalProperties: false` — no origin field. `exec`/app-server submits are not distinguished | **Yes.** Hooks load from config; `SessionStart` event exists (managed switch can pin it) | **(3) disqualifies it** |
| **OpenCode** (anomalyco) | Plugin API (JS/TS, in-process). Hook `tool.execute.before`; `chat.message` | **Yes.** `tool.execute.before` throws an `Error` to block the call (`opencode.ai/docs/plugins`, `.env protection` example) | **Yes.** The plugin function runs per call and JS can read a file | **No.** Client/server: the TUI and a plugin both submit down the same `user` message path. `chat.message` input is `{sessionID, agent, model, messageID, variant}` — no origin (`packages/plugin/src/index.ts`). `Session.Inbox.User` vs `Session.Inbox.Synthetic` marks auto-continue/summary, **not** person vs plugin | **Yes.** Plugins auto-load from `.opencode/plugins/` or config; also a SessionStart-equivalent via `session.created` | **(3) disqualifies it** |
| **Gemini CLI** (Google) | Hooks in `settings.json`; events incl. `BeforeTool`, `BeforeAgent`, `SessionStart` | **Yes.** `BeforeTool` returns `{ "decision": "deny", "reason": ... }` or exit `2` | **Yes.** A command hook is a fresh process each call | **No.** `BeforeAgent` input is `prompt` (string) plus base fields `[session_id, transcript_path, cwd, hook_event_name, timestamp]` — no origin. Headless `-p` fires the same hook with no marker | **Yes.** `settings.json` loads at start; `SessionStart` event exists | **(3) disqualifies it.** (Also: replaced by Antigravity CLI on 2026-06-18) |
| **Antigravity CLI** (Google, successor) | Hooks, `.agents/hooks.json` / `~/.gemini/config/hooks.json`; events `PreToolUse`, `PreInvocation`, `Stop` | **Yes.** `PreToolUse` returns a deny decision; a single deny blocks the whole operation | **Yes.** A command hook is a fresh process each call | **unknown.** The documented fields are `toolCall{name,args}`, `stepIdx`, `invocationNum`, `initialNumSteps`, and common `conversationId, workspacePaths, transcriptPath, artifactDirectoryPath, modelName`. No prompt-source or actor field is documented | **Yes.** Hooks load from workspace/global/plugin `hooks.json` at start | **(3) unknown — not established** |
| **Cursor CLI** (`cursor-agent`) | Hooks, `.cursor/hooks.json` / `~/.cursor/hooks.json` | **Partly.** `preToolUse`/`beforeShellExecution` can return `permission: "deny"` or exit `2`. **Caveat:** the CLI has partial hook parity — `beforeSubmitPrompt` is not emitted in `-p`/`--print` mode | **Yes.** A command hook is a fresh process each call | **No / unknown.** No documented origin field. The common input carries `conversation_id, generation_id, model, hook_event_name, cursor_version, workspace_roots, user_email, transcript_path` — no typed-vs-programmatic marker | **Partly.** `sessionStart` fires in the CLI; hooks load per workspace | **(3) not met; CLI hook coverage also incomplete** |
| **Amp** (ampcode) | Plugin API (TS/JS, in-process, Bun). Events `tool.call`, `agent.start`, `agent.end` | **Yes.** `tool.call` returns `{ action: 'reject-and-continue' }` (or `'allow'`, `'modify'`, `'synthesize'`) | **Yes.** The plugin runs per call and JS can read a file | **unknown.** `agent.start` receives `event.message`; the plugin reference documents no origin or actor field for the turn | **Yes.** Plugins load from `.amp/plugins/` or `~/.config/amp/plugins/`; `session.start` event exists | **(3) unknown — not established** |
| **Goose** (aaif-goose) | Hooks, plugin `hooks/hooks.json`; events `PreToolUse`, `UserPromptSubmit`, `SessionStart`, … | **Yes.** A `PreToolUse` hook exits `2` or prints `{"decision":"block","reason":...}` | **Yes.** A command hook is a fresh process each call | **unknown.** The `UserPromptSubmit` payload has `matcher_context`/`message` (the prompt text). No origin field is documented | **Yes.** Plugin hooks load from `~/.agents/plugins/` or `<project>/.agents/plugins/`; `SessionStart` event exists | **(3) unknown — not established** |
| **GitHub Copilot CLI** | Hooks, `.github/hooks/*.json`; events `preToolUse`, `userPromptSubmitted`, `sessionStart` | **Yes.** `preToolUse` returns `permissionDecision: "deny"`; command hooks are fail-closed on error | **Yes.** A command hook is a fresh process each call | **No.** `userPromptSubmitted` input is `{sessionId, timestamp, cwd, prompt}` (camelCase) or `{hook_event_name, session_id, timestamp, cwd, prompt}` — no origin. `modifiedPrompt` is honored only by SDK programmatic hooks | **Yes.** Hooks load from the repo config at start; root-owned policy hooks cannot be disabled by a user setting | **(3) disqualifies it** |
| **Cline** | Hooks (v3.36+), `.clinerules/hooks/` or `.cline/hooks/`; events `PreToolUse`, `UserPromptSubmit`, … | **Yes.** A `PreToolUse` hook prints `{"cancel": true}` to block | **Yes.** A command hook is a fresh process each call | **No.** Hook base fields are `{clineVersion, hookName, timestamp, taskId, workspaceRoots, userId}` plus the prompt for `UserPromptSubmit`. No origin field | **Yes.** Hooks load from the workspace or global hooks folder; Enable Hooks is a feature setting | **(3) disqualifies it.** Hooks are macOS/Linux only |
| **Qwen Code** (QwenLM) | Hooks in `settings.json`; events `PreToolUse`, `UserPromptSubmit`, `SessionStart`, … | **Yes.** `PreToolUse` returns `decision: "block"` / `hookSpecificOutput.permissionDecision: "deny"` or exit `2` | **Yes.** A command hook is a fresh process each call | **Yes.** `UserPromptSubmit` carries `submitted_prompt` — the composer text captured at the submission boundary. It is present only when provenance is complete and is absent for model-bound or machine-generated input; the docs say "Do not silently fall back from `submitted_prompt` to `prompt` when source provenance is required" | **Yes.** Hooks load from user/workspace/system `settings.json` at start; `/hooks` re-reads them | **Only non-Claude CLI that meets all four** |
| **Kilo Code** | — none — | **No.** No pre-tool hook exists. Kilo diverged before Cline added `PreToolUse` (upstream issue #7859 open) | n/a | n/a | n/a | **Not guardable — no hook API** |
| **Continue** | — none documented — | **No.** Continue documents no hooks page at all (independent 12-CLI survey, 2026-10-03) | n/a | n/a | n/a | **Not guardable — no hook API** |
| **Aider** | — none — | **No.** Aider has no hook/plugin API for tool calls; tool-call support is itself an open request (#2672) | n/a | n/a | n/a | **Not guardable — no hook API** |

Legend for (3): **Yes** = a hook receives a field that marks the person's own typed/submitted text and that
field is absent or different for programmatic input. **No** = the hook input schema is exhaustive and
carries no such field, or the CLI's own architecture makes the two indistinguishable. **unknown** = the
documentation and source do not state it either way, so the cell is not established.

---

## Evidence per CLI

### Claude Code (baseline, the mod's own host)

- The guard reads the roster on every call: `guard.ts:761-764` calls `pull($)` then `readMembers($)`
  inside `guard()`, which is bound to each tool.
- The guard refuses: `register.tsx:1341-1346` binds `on('tool.call', {tool})` for `Agent`, `Write`, `Edit`,
  `NotebookEdit` and returns `{ deny }` when `judge()` says so; the refusal text is returned to the model.
- The origin check: `guard.ts:29-32` — `grantsFrom()` returns `undefined` unless `origin.kind === 'composer'`.
  `register.tsx:1464,1481` — a prompt counts only when its origin is the person (`composer`), or when a
  plugin submits as the person (`asUser`). A prompt from another session or a plugin allows nothing.
- Source in this tree: `team-orchestrator/hooks/guard.ts`, `team-orchestrator/hooks/register.tsx`,
  `team-orchestrator/hooks/hooks.json` (`{ "modules": ["./register.tsx"] }`).

### Codex — the schema decides it

- Docs: <https://learn.chatgpt.com/docs/hooks>. Events include `PreToolUse`, `UserPromptSubmit`,
  `SessionStart`, `Stop`; `PreToolUse` denies with `{"decision":"block"}` or
  `hookSpecificOutput.permissionDecision: "deny"`, or exit `2`.
- Source (the load-bearing cell): the published input schema
  `codex-rs/hooks/schema/generated/user-prompt-submit.command.input.schema.json` on the `main` branch.
  It lists `additionalProperties: false`, `title: "user-prompt-submit.command.input"`, and a required
  set of `[cwd, hook_event_name, model, permission_mode, prompt, session_id, transcript_path, turn_id]`.
  **There is no origin, actor, source or composer field.** The `prompt` field is "User prompt that's about
  to be sent" with no provenance.
- Corroboration: the `PreToolUse` input schema (`pre-tool-use.command.input.schema.json`) adds only
  `tool_name`, `tool_input`, `tool_use_id`; the `SessionStart` schema has `source` but that is the start
  kind (`startup`/`resume`/`clear`/`compact`/`fork`), not a prompt origin.
- Consequence: a `codex exec`, an app-server submit, or a plugin-driven prompt is indistinguishable from a
  typed one at the hook. A one-turn `#allow-write` grant would be forgeable by any programmatic submitter.

### OpenCode — client/server erases the origin

- Docs: <https://opencode.ai/docs/plugins>. `tool.execute.before` throws an `Error` to block a call; the
  `.env protection` example does exactly this.
- Source: `packages/plugin/src/index.ts` (the plugin type surface) — `chat.message` input is
  `{ sessionID, agent?, model?, messageID?, variant? }`. No origin.
- Architecture: OpenCode starts a server and a TUI client; both call the same session/prompt path
  (`opencode.ai/docs/server`). The V2 API exposes `Session.Inbox.User` and `Session.Inbox.Synthetic`;
  `synthetic` marks auto-continue/summary/tool-result echoes (`Session.Inbox.SyntheticPayload`), not the
  difference between a person's Enter and a plugin's `session.prompt`.
- Corroboration: open feature request #30434 notes `chat.message` fires before the LLM and cannot even
  block; the message content can be mutated but not cancelled. A plugin-submitted "user" message is the
  same object the TUI produces.

### Gemini CLI — a bare prompt string

- Docs: <https://geminicli.com/docs/hooks/reference>. `BeforeTool` denies with `{"decision":"deny"}` or
  exit `2`. `BeforeAgent` "Input Fields: `prompt` (string) The original text submitted by the user"; the
  base input is `{session_id, transcript_path, cwd, hook_event_name, timestamp}`. No origin.
- Note: the site banner states Gemini CLI is replaced by Antigravity CLI on 2026-06-18.

### Antigravity CLI

- Docs: <https://antigravity.google/docs/hooks>. `PreToolUse` runs before a tool and a single deny blocks
  the whole operation ("veto-power"). Common input: `conversationId, workspacePaths, transcriptPath,
  artifactDirectoryPath, modelName`; `PreToolUse` adds `toolCall{name,args}` and `stepIdx`;
  `PreInvocation` adds `invocationNum`/`initialNumSteps`. No prompt-source field is documented, so (3) is
  `unknown`, not No — the manual shows no origin, but it also does not promise one.

### Cursor CLI

- Docs: <https://cursor.com/docs/hooks>. `preToolUse`, `beforeShellExecution` etc. return
  `permission: "allow" | "deny" | "ask"`; exit `2` blocks. Common input fields listed are
  `conversation_id, generation_id, model, model_params, hook_event_name, cursor_version, workspace_roots,
  user_email, transcript_path`. No typed-vs-programmatic marker.
- Caveat from the vendor's own forum: in the CLI, `beforeSubmitPrompt`, `afterAgentResponse` and `stop`
  are **not** emitted in `-p`/`--print` mode; the CLI has only partial hook parity with the IDE.

### Amp

- Docs: <https://ampcode.com/docs/plugin-api> and `/docs/customize/plugins`. `tool.call` returns
  `{ action: 'allow' | 'reject-and-continue' | 'modify' | 'synthesize' }`; `reject-and-continue` blocks.
  The `agent.start` event receives `event.message`. No origin/actor field is documented for the turn, so
  (3) is `unknown`.

### Goose

- Docs: <https://goose-docs.ai/docs/guides/context-engineering/hooks>. `PreToolUse` blocks with exit `2`
  or `{"decision":"block","reason":...}`; `on_failure: block` makes a failing hook deny too.
  `UserPromptSubmit` payload fields are `event, session_id, matcher_context, message` — the prompt text
  and the matcher string. No origin field, so (3) is `unknown`.

### GitHub Copilot CLI

- Docs: <https://docs.github.com/en/copilot/reference/hooks-reference>. `preToolUse` returns
  `permissionDecision: "deny"`; command hooks are fail-closed on a crash or non-zero exit (a timeout is
  fail-open). `userPromptSubmitted` input is `{sessionId, timestamp, cwd, prompt}`. No origin. The
  `modifiedPrompt` output is honored "only by SDK programmatic hooks" — which itself notes that the CLI
  path and the SDK path differ, but neither carries an origin marker.

### Cline

- Docs: <https://cline.bot/blog/cline-v3-36-hooks>. `PreToolUse` returns `{"cancel": true}` to block.
  Hook base fields: `{clineVersion, hookName, timestamp, taskId, workspaceRoots, userId}` plus
  hook-specific data; `UserPromptSubmit` receives the prompt text. No origin field. Hooks are macOS/Linux
  only.

### Qwen Code — the one that meets (3)

- Docs: <https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md>.
  `PreToolUse` blocks with `decision: "block"` / `hookSpecificOutput.permissionDecision: "deny"` or
  exit `2`. Hooks load from user/workspace/system `settings.json` at start; `/hooks` re-reads them.
- The origin field: `UserPromptSubmit` provides **`submitted_prompt`**, "the original composer text at its
  submission boundary". The docs state:
  - "Web Shell provides the original composer text at its submission boundary. Realtime voice handoffs do
    not declare provenance … Other ACP/daemon SDK clients can opt in per request."
  - "On the core/headless path, `prompt` can include generated or expanded content rather than original
    user input … Do not silently fall back from `submitted_prompt` to `prompt` when source provenance is
    required."
  - The worked example reads `submitted_prompt` and comments: "Do not mistake model-bound or
    machine-generated content for raw input" — and exits without acting when the field is absent.
- This is the same shape as this mod's rule: a grant counts only from text the person submitted, and a
  programmatic or plugin submit does not carry it.

---

## Negatives (a CLI with no such API is worth naming)

| CLI | Result | Evidence |
|---|---|---|
| **Kilo Code** (installed: `@kilocode/cli`) | No pre-tool hook at all | Upstream request #7859 (open) states Kilo "has no hook mechanism for running custom scripts before tool execution"; it diverged before Cline added `PreToolUse` in v3.36. A fork of a CLI that has the hook is not the same as having it |
| **Continue** (installed) | No hooks page | The 2026-10-03 12-CLI survey checked Continue and excluded it: "its documentation index lists no hooks page." No tool-interception API is documented |
| **Aider** | No tool-call hook API | Aider has no plugin/hook surface for tool calls; tool/function-call support is itself an open feature request (#2672) |

An MCP server does not change any of these rows. MCP is a tool **provider**; it does not see or refuse
another tool's call, and it cannot read the origin of a prompt. It satisfies neither (1) nor (3).

---

## What this decides for [#52](https://github.com/herman925/925-cc-plugins/issues/52)

- **Guardability is still a per-session hook**, and it is still rare in the exact shape the guard needs.
  Requirement (1) is widely met; requirement (3) is not.
- **The set of CLIs that could be guarded by this design is small but not empty: it contains Qwen Code,
  and it contains `unknown`s that a spike could promote (Antigravity CLI, Amp, Goose).** It does **not**
  contain Codex, OpenCode, Gemini CLI, Copilot CLI, Cline or Cursor CLI today, because none of them gives
  a hook a prompt-origin field.
- **The sharpest test for any new candidate is (3), not "does it have hooks".** Ask one question: does a
  hook receive a field that is present for the person's own submitted text and absent or different for a
  programmatic submit? If the answer is no or unknown, the CLI is not guardable, and by
  [#41](https://github.com/herman925/925-cc-plugins/issues/41) Q3 it cannot be a member.
- **A guard enforced from outside the member** (the alternative [#52](https://github.com/herman925/925-cc-plugins/issues/52)
  raises) is not a substitute for (3). The runtime can refuse at the team layer, but it cannot tell a typed
  `#allow-write` from a forged one, so the one-turn grant would still be forgeable unless the CLI marks
  the origin. That is why (3) is the load-bearing cell and why this ticket was the hinge.

---

Method: each cell read from the CLI's own documentation or published schema, on 2026-10-09. Local probes
(`codex --version` → `codex-cli 0.161.0`; `gemini --version`; `opencode-ai 1.18.35`; `@kilocode/cli 7.8.3`)
established only what is installed; no cell rests on a probe. Cells that could not be established from
documentation or source are marked `unknown`, not inferred.