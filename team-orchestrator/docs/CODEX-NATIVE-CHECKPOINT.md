# Codex native integration checkpoint — 2026-11-02

The user selected native Codex–Claude coordination with Orca hosting the first increment, without an Orca plugin panel dependency. Keep independent operation as another host-adapter route. The accepted direction and unresolved details are in [host-adaptive coordination #179](https://github.com/herman925/925-cc-plugins/issues/179). This checkpoint is technical reconnaissance, not completed mixed-team integration.

## Verified locally

- Installed CLI: Codex **0.166.0**; current Orca reports **1.4.242**. The current native terminal identifies Codex, its exact project/context and transport incarnation.
- Codex reports native hooks enabled. The official [hook documentation](https://learn.chatgpt.com/docs/hooks) describes tool interception, supported deny responses, tool-path limitations and failure behavior. UserPromptSubmit documents prompt/turn fields but no trusted human-vs-peer provenance field. A prompt string alone must not activate typed grants.
- An isolated Codex app-server with a new temporary CODEX_HOME successfully initialized, created an ephemeral thread, connected a fixture MCP server and invoked its no-effect tool via the native `mcpServer/tool/call` method. **No model turn was submitted.**
- The fixture server received `_meta.threadId` equal to the actual newly created thread ID, outside the model-facing arguments object. Default MCP environment filtering passed no CODEX_/ORCA_ variables to the fixture server. Do not assume the MCP process inherits the terminal context or identify a caller from arbitrary tool arguments.

The probe used a native app-server client request, not a model-generated call; its metadata is a candidate integration input, not complete caller authentication. App-server clients can supply metadata, and a genuine Codex process can have multiple threads. The production adapter still needs positive native host/session/project evidence and guard verification before any authoritative operation. No proof was weakened and no approvals were granted by this probe.

The [official app-server reference](https://learn.chatgpt.com/docs/app-server) and the installed binary's generated JSON schemas were checked. Dynamic tools exist but are experimental; this checkpoint does not select them as the product interface.

## What must be built and proved next

1. Native Codex identity and guard integration, preserving the existing permission rules and rejecting unavailable or contradictory proof.
2. Access to the same typed team operations and authoritative shared inbox, with per-operation schemas and no model-supplied actor/approval/path/SQL.
3. Verified cross-provider wake-up and read/seen recovery, keeping an uncertain effect on its original operation identity rather than changing transport and duplicating work.
4. Mixed provider roster/binding consistency and exact supported scope: existing-session attachment versus automatic launch is a pending product choice.
5. A bounded Codex–Claude task flow with explicit worker outcome and separate head acceptance. Claude credit availability still limits an independent live-model run.

The current production verifier and wake path remain Claude-specific. This probe does not make a Codex session an admitted or guarded team member. The prior local lifecycle, replay/restart and model-review gaps remain visible in [the roadmap](../../docs/roadmap-2026-11-02.md).

No real project team database, global configuration or installed plugin was changed. Fixture code and selected evidence are in [codex-native-probe](../../shared/team-store/validation/codex-native-probe). The owned app-server used a temporary home and stdin/stdout; the reproduction scripts do not start a model turn or modify a store. They are validation fixtures, not a shipped team server.

To reproduce from the repository root, run `node shared/team-store/validation/codex-native-probe/probe.mjs <new-absolute-temporary-directory> <absolute-path-to-codex-executable>`. Supply the installed native executable, not a shell shim. The fixture creates its temporary home, writes selected results to evidence.json and retains its own stderr log locally. Check that error is absent, modelTurnsStarted is 0 and the received metadata threadId equals the newly created threadId. Both fixture modules also pass `node --check`.
