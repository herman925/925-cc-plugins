# Native review delivery and completion

Branch: `fix/codex-review-delivery-honesty`. PR #199 remains open on
`feat/worker-runtime-readiness`; this change does not merge or alter it.

## Observed failure

Affected conversation: `01a18fc1-a164-76b0-b83d-5421ca7db4a9`, terminal
`term_5973b514-516d-4689-a14d-c91aea019482`, native Codex PID 59312,
MCP child 73968. Its active immutable runtime remains `691b3a62…c7b18a`.
Effective granular policy enables MCP elicitation and retains
`danger-full-access` execution. The earlier automatic-decline problem is distinct.

The read-only native provider log and transcript establish this timeline (UTC):

| Time | Evidence |
| --- | --- |
| 20:50:21.775 | `shared_team_manage` starts the recovery rebind. |
| 20:53:30.192 | Tool completion records `API_REVIEW_UNAVAILABLE`. Status subsequently reports a 180,003 ms failed elicitation wait. |
| 21:14:43.307 | The same native Codex process dispatches `ResolveElicitation`, request `codex-mcp-elicitation-0`, decision `Accept`. |

The native input arrived about 21 minutes after the tool had failed. This is
evidence that input reached Codex, not proof of `confirm:true` or a committed
rebind. The original MCP wire request ID and returned content were not logged.
The operation `recovery-rebind-01a18fc1-aefcab07-20261107` reconciles as unknown;
the binding remains stale. No retry or database edit was performed.

Machine-readable evidence: [affected-review-timeline.json](codex-review-delivery-20261107/affected-review-timeline.json).

## Actual path and defect

This is Orca's terminal surface, not its structured chat app-server surface:

`Orca saved-session launch -> Codex 0.166.0 TUI -> direct child MCP stdio`

`MCP elicitation/create -> Codex form overlay -> person -> ResolveElicitation -> MCP JSON-RPC response`

Orca owns terminal rendering and input transport. Codex owns the elicitation
overlay and MCP response forwarding. The process command line identifies both
the normal Orca terminal handle and the direct immutable MCP child.

The version-matched official client source shows that elicitation pauses tool
timeout progress, while the TUI forwards typed field content on submission.
Our MCP server independently deleted the pending request at 180 seconds without
cancelling the client request. Codex could keep the form open after the server
had already refused the operation. A late reply then had no waiter. The old
server also answered unmatched JSON-RPC responses with a method error, and
status incorrectly counted rejected waits as human-paced replies.

Official source, tag `rust-v0.166.0`:

- [Elicitation pause service](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/src/elicitation.rs)
- [Native TUI submission](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/tui/src/bottom_pane/mcp_server_elicitation.rs)
- [MCP response and cancellation handling](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/rmcp-client/src/elicitation_client_service.rs)

Hashes of the inspected source are in `native-client-source.json`. This source
explains the mechanism; it does not replace the live evidence or attest visibility.
The historical terminal buffer alone also does not establish foreground delivery.

## Correction and approval boundary

- Human review has no server deadline by default, matching Codex's paused review.
- Explicit deadlines and parent cancellations reject the waiter before notifying
  the client, preventing even a racing late acceptance from authorizing effects.
- Disconnects still refuse; late/unmatched responses are ignored and traced.
- Stderr correlation records request ID, parent tool request ID, tool name,
  outcome and elapsed time. It excludes proposal data and form response content.
- Failed waits have their own counter and cannot count as a human-paced reply.
- Native `action:accept` plus boolean `confirm:true`, fresh caller/target checks
  and transactional generation checks remain necessary for management effects.
  Restricted stale recovery and denials for unrelated effects remain intact.

No hooks were disabled, permissions weakened, native forms answered by automation,
or team/Orca database records edited.

## Validation and installation

Three full validation passes each report 302 tests: 285 passed, zero failed,
17 skipped (unconfigured PostgreSQL / unavailable Docker). They use the actual
installed native Codex configuration writer. Evidence is under
`codex-review-delivery-20261107/pass[123]-tests.*`.

Additional regressions cover a pending review after 25 simulated minutes,
explicit cancellation and a racing late acceptance producing zero effects,
readable keepalives while waiting, rejected-wait diagnostics and existing
management approval/refusal behavior with `launchWorkers:true`.

The 52-file runtime was packaged, parity checked, then installed through normal
`setup.mjs preview` and `setup.mjs apply`. Receipt:

```
runtimeDigest: 5c33808fdc730c3db8397326522f45e73613532221a6b892b94d7cf8bd2283d5
serverHash: 4dbec62505ccce63e82f7e592380befebbabe1608a97e17241e9a61ae15bc550
guardHash: 38f9eec9a75d47aab7a00f0d159ea3f9fdbf182cdd9bb7ebfca4a1cf91a96394
```

Setup reports unchanged hook configuration, no native hook review required,
no global configuration or team-store changes, and reconnect required.
It does not grant or attest hook trust.

A fresh normal Orca terminal runs native Codex PID 14480 and MCP child 20060 from
that exact runtime directory. Its effective turn preserves the granular policy
and execution profile. See `review-fresh-hosted.json`.

The disposable transport test is conversation
`01a1b2d3-22a7-7f83-9592-a5bec21ebf71`, terminal
`term_4468a4c6-446f-4243-b9c3-75ce599395cb`. It calls only status and the
draft-only interview. The person allowed the tool once and confirmed leaving
the resulting menu open. The emitted live MCP request is
`925-to-review-c15432d6-3dd5-45e0-a5fa-bf1863694651`, parent request 6,
at `2026-11-06T21:49:32.334Z`, with `timeoutMs:null`. The same ID's response was
received at `21:50:39.267Z`, after 66,933 ms. The native tool returned
`draftOnly:true`, action `accept`, and draft selection `meeting`. No management
call followed. See `fresh-native-wire.json`. No automated form input was sent.

After verifying the test was idle, `/exit` ended PID 14480 and its MCP child.
Normal `setup.mjs resume` admitted the same saved conversation into terminal
`term_f6e5dbab-a874-46c0-8878-79e1410f6fe7`, incarnation
`ade94f13-6384-4068-a384-841b01e51b5f`. Native Codex PID 48768 and MCP child
68580 run the same corrected digest. The resumed turn again reports granular MCP
confirmation and `danger-full-access`; see `review-resume-hosted.json`.

The resumed request `925-to-review-951a00a7-e082-408c-8c5b-42da468b817f`
(parent request 5) was emitted at `2026-11-07T05:16:05.811Z` and its response
was received at `05:16:29.318Z`, after 23,507 ms. The native tool returned
`draftOnly:true`, action `accept`, draft selection `status`. See
`resume-native-wire.json`. This establishes native response forwarding after
normal resume, but the request completed before the former three-minute deadline.

An additional draft-only interview request in that same resumed process,
`925-to-review-0b192720-dca3-4b27-b262-6154f9a8cb76` (parent request 7),
was emitted at `2026-11-07T10:20:00.080Z`. Read-only observations found no response
and the draft menu still present in the terminal buffer after 93,817 ms and
210,399 ms. The latter exceeds the former 180,000 ms deadline. No automated
form inputs were sent. See `resume-long-wait.json`. The person was then asked
to submit the draft choice `status` to verify completion after the longer wait.

Pending acceptance: capture that human response, then separately activate and
review recovery in the affected conversation.
The receipt alone does not establish those outcomes. The affected process has
not been restarted during this investigation; its successful rebind and normal
access remain unverified.
