# Codex active-client coordination

Release: **team-orchestration-925 0.1.7**. Shared schema **8** and Mod **0.5.57** remain compatible. No schema upgrade is needed for this increment.

## Behavior

The Codex stdio MCP adapter owns a periodic observer. A successful native caller verification activates it; subsequent passes repeat native parent/thread/Orca identity verification and obtain current member, binding and configuration generations through `inspectCaller`. A bound member runs the existing `observeDeadlines` and `prepareDeliveries` operations. The observer does not create stores, approve controllers, bind members, read inbox messages or acknowledge notifications.

The first periodic pass starts after 30 seconds. Confirmed management/member mutations queue an earlier pass without waiting for native notification delivery. Only one pass can run at a time. The timer is unreferenced and is cancelled on transport EOF; shutdown drains any pass already in progress. No daemon remains after the client disconnects. Reconnection requires a fresh verified tool call and catches up through existing deadline/replay state.

Native identity changes and stale bindings suspend the loop until fresh verification. Missing stores and unbound callers wait without creating data. Other failures remain visible in `shared_team_status.observation.lastError` and retry on the next interval. A resumed member still needs the normal reviewed reconnect when its native binding is stale; observer activation does not supply that approval.

If a database commit reply is lost, the running observer retains the exact pending operation and reconciles it before sending attention or retrying that request. This pending map is scoped to the verified MCP process; after process loss, shared outstanding state and the configured replay interval provide catch-up. Attention pointers may repeat; they are not message reads, permission grants or task execution.

The native wake path now permits notifications addressed to the caller's own verified conversation, so a head can receive its deadline notices. It still verifies each destination's machine, provider, terminal and incarnation. The effect is an Orca orchestration mailbox pointer. It does not prove the destination model started a turn or saw the pointer.

## Validation

1. Focused SQLite behavior tests cover missed pickup return exactly once, recipient-owned notice/read state, replay timing, lost committed reply recovery, configuration edits during recovery, single-flight passes, draining shutdown, timer-only observation, native identity suspension, adapter integration, unbound callers and missing-store refusal. New behaviors were introduced with failing tests before their implementation; existing lifecycle rules were also exercised directly through the real API and database.
2. Final minimum Node **22.13.0**, SQLite and real PostgreSQL **18.6**: **408 passed, 0 failed, 0 skipped**. The disposable PostgreSQL instance was stopped afterwards. The first broad run passed 407 tests and found one stale setup-test release literal (`0.1.6` instead of `0.1.7`); the assertion now reads the package manifest. No observer/lifecycle failure was found in that run. Syntax checks and `git diff --check` also pass.
3. Native Codex **0.166.0** plugin install, seven-skill discovery through its real app-server, update and removal pass in temporary consumers. The pinned npx copy route also passes. These probes start **zero model turns**. Deterministic packaging checks compare all **46** runtime files in both packages.

Native parent/host and notification boundaries are substituted in the observer database tests. The separate native identity tests exercise a local authenticated host fixture and refusal cases. Neither establishes real mixed-model task/meeting acceptance, installed hook trust, whole-Orca restart behavior or automatic model wake. The unchanged Mod UI suite is not repeated for this Codex-only increment.

## Remaining launch increment

Automatic Codex worker launch is **not included**. The user has authorized developing it, while the interactive choice of launch-approval scope remains pending. Existing controller approval alone does not grant permission to launch workers.

Technical investigation confirmed that the installed native Codex fresh-session CLI has no Claude-style `--session-id`. The existing immutable launch reservation assumes a preselected Claude conversation ID. Codex launch therefore needs verified native launch/attachment evidence and a compatible durable contract; it must not manufacture a conversation ID, bind by title, bypass capacity, retry an uncertain native start or silently replace a session. Keep the common shared store/lifecycle and Orca host adapter; standalone operation and Hermes remain later work.

No CEO handoff, real-project team write, installed configuration change or controller/worker launch was performed for this increment.
