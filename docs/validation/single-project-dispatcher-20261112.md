# Single local dispatcher — 2026-11-12

Herman selected one small dispatcher, instead of a polling terminal in every session. The candidate implements **one scheduling process per project per computer**, shared by the Claude Mod and Codex MCP receivers. It starts on demand and exits after 90 seconds with no connected receiver or unresolved pass. It adds no model, account, database engine or project-store schema.

## Responsibilities

```text
Claude native receiver ─┐                      ┌─ Orca native delivery
                       ├─ project dispatcher ─┤
Codex MCP receiver ────┘                      └─ owned provider connection
          │
          └─ authenticates its own API calls against the existing team store
```

The dispatcher owns cadence and serialization. It holds no provider credentials, controller approval, message bodies or team-store connection. Its IPC accepts scheduling/status/completion frames, never a shell command or a model-selected prompt. Every actual pass runs through an independently authenticated receiver and the existing typed API. The recipient still reads and acknowledges its own inbox. Input acceptance, turn start, inbox read, assignment pickup and outcome acceptance remain separate facts.

Codex reuses its MCP process as the receiver. The Mod opens a bounded direct hook child for native-parent verification; it receives IPC passes rather than polling the database. Its existing UI refresh renews that connection. These are receiver processes, not extra background terminal windows. The project dispatcher has the only coordination interval. Provider readiness heartbeats and ordinary UI redraw timers have separate existing purposes.

With a healthy head, one pass can prepare every sender's mail. Without the head, workers receive separate sender-scope passes: the API intentionally prevents a worker from reserving another worker's messages. Only a head's successful pass suppresses redundant team-wide checks. This preserves worker-to-lead replies and meeting notifications without inventing daemon authority.

## Failure handling

- Local IPC elects one owner; connection authentication uses a private machine-local token. Storage and helper entrypoints are protected by both client guards.
- A durable outstanding pass precedes dispatch. A slow or disconnected callback does not release its slot merely because a timeout elapsed; status becomes needs-attention.
- Exact receiver completion, a durable completion receipt, or known owner-process exit can settle the scheduler slot. A saved but undelivered grant is retired by its exact reconnecting receiver without executing it.
- Closing/changing a receiver scope cannot leave a live MCP process holding the scheduler forever. Completion writes coalesce, including concurrent callback/close paths on Windows.
- Receivers recheck the current native identity and shared authority. A disconnected pass cannot continue to authorize new API operations.
- Implementations must match at connection time. An older live dispatcher reports update-required; a client never kills or silently replaces it. Ordinary tools and manual inbox access remain available.
- A stale retained Unix socket is not automatically unlinked using an old PID file. That case needs explicit local repair; Windows named-pipe exit/restart is tested.
- Existing wake journals preserve request identity and uncertainty. The direct owned transport claims each pointer once and never assumes a provider message ID deduplicates `turn/start`. Unknown effects stay unresolved rather than being resubmitted.

## Orca and independent operation

The **scheduler itself does not require Orca**. Current shipped-client identity/onboarding still does. The Orca terminal delivery route remains blocked on installed hosts lacking the target fence described in the [maintainer contract](orca-fenced-inbox-wake-handoff-20261112.md). This is a limitation of that terminal route, not proof that every Orca interface needs a host change. Existing structured `agentSession.send` is a separate candidate route and has not been integrated into the shared terminal bindings here.

The direct transport accepts an already owned provider connection. Codex uses its official `app-server` thread/read and turn/start interface; Claude uses a long-lived SDK streaming input and matching user-message replay. These adapters neither discover nor take over an open conversation. The launcher must supply the verified owned connection and identity after its normal review. The fixed input only asks the recipient to check its own team identity/inbox.

**Not a completed standalone product:** native review UI, reviewed independent launch/binding/installation, relay between independently owned receivers, and a real Claude process acceptance remain unfinished. `actions.standalone` stays false. The direct transport is packaged library code, not a newly exposed skill or permission bypass. Do not ask users to launch it against their current conversations.

Primary interface references: [Codex app-server](https://learn.chatgpt.com/docs/app-server), [Claude streaming input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode), [Claude SDK user/replay messages](https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage).

## Validation and activation

Three verification passes completed:

1. **Common suite: 597 passed, 0 failed/cancelled/skipped**, using owned disposable PostgreSQL, SQLite, Node 22.13 and configured native setup checks. Owned PostgreSQL stopped successfully. Final source log: `%TEMP%/team-completion-pg-wI9ui6/suite.tap`; SHA256 `73ADD7C2AD9F7C9370801501C309D633C1A10B39E11A193D8746C2D5B3AD930C`. The previous green pass (`team-completion-pg-scJwda`, SHA256 `A1267C47E31B19AB195ECD9058CB042B98724C6A876B977A3DB1C8BC0073586A`) also passed 597/597.
2. **Mod SDK: 472 passed, 0 failed**, 48 files. Log: `%TEMP%/team-single-dispatch-sdk-final2.log`; SHA256 `847E01A7403BA83081490F49BBBE146A5DA3FA81B6CF757AC6BFFA53A03C9F9E`. Replacing eight legacy pump tests with six receiver tests accounts for the two-test difference from the previous 474 baseline.
3. **Real owned Codex app-server: passed under Node 22.13**, deterministic loopback model through the actual project dispatcher, exactly one model request, same saved request/native turn on repeat, zero Orca calls, zero answered approvals and zero real team-store mutations. Evidence: `%TEMP%/team-single-dispatch-native-H6Q1Jx/evidence.json`; SHA256 `AAF6FCC6937551BC04E5696216017CE7DEA96691CB8FB25C46E3662B03712FD1`.

The 19 dispatcher/owned-transport checks also passed a separate repeat in `%TEMP%/team-single-dispatch-repeat.tap`. The final focused observer/adapter/dispatcher/owned-transport check passed 39/39 (`%TEMP%/team-single-dispatch-final-focus.tap`, SHA256 `4B8DC2EC7AC061A774D2FA2DA4D1CE6B572BA2D2B7FB5262C06301634723B199`), including the final background-error containment and public-source guard checks. Packaging check verified 68 byte-matching files in both targets. The native fixture proves transport, not live team lifecycle acceptance; Claude's adapter currently has contract fixtures only.

Intermediate failures were retained, not reported as green: the first SDK attempt had a malformed test helper, then passed after correction. The first broad run (`team-completion-pg-mqkG5r`) caught a real Windows concurrent completion-write race; writes now coalesce. A targeted restart check also caught a persisted-but-undelivered pass, now retired by the exact reconnecting receiver without execution. The final full green run supersedes those attempts.

The candidate remains Mod 0.5.62 / Codex 0.1.12 / schema 10, now **68 matching runtime files**. Nothing was installed, activated, upgraded or merged by this increment. No CiteReflex session was prompted, restarted, rebound or granted permissions. Earlier 64-file previews/digests are historical and do not describe this tree.
