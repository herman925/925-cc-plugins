# Orca maintainer handoff: fenced inbox wake-up

## Requested boundary

Team Orchestrator can coordinate Claude and Codex using one project store. It needs to submit a fixed inbox-check prompt to an already connected, idle recipient without racing a terminal/session replacement. The person selected **prepare the host contract and maintainer handoff; block automatic sends on hosts without the fence**. No installed Orca file was changed. No live worker was prompted or restarted.

The proposed capability and receipt method below are **new requirements, not claims about APIs already shipped by Orca**.

## Evidence in the installed build

Read-only inspection found:

- `out/shared/rpc-contract/terminal-unary-params.js`: `TerminalHandle` includes optional `expectedIncarnationId`; `TerminalSend` extends it.
- `out/main/chunks/orcad-retained-source-Dw6Zuc5z.js`: the `terminal.send` handler forwards text/Enter and native request IDs but does not read this expected-incarnation field. The source symbols include `sendTerminalAgentPrompt`, `getTerminalPromptRequestBinding`, `beforeWrite`, `markMutationEffectPossible` and `recordMutationReceipt`.
- The current handler may choose its direct-send branch when the target is no longer recognized as a running prompt agent. For an automatic inbox wake, raw-terminal fallback must be forbidden.
- Existing native request IDs fence retries after first admission, but do not themselves express the caller's expected first-send target.
- Current runtime `6af79682-e7aa-4493-82fc-0dde2119f78f` advertises neither the proposed fence capability nor a prompt journal identity. This was a read-only status observation; no send was used as a probe.

These are compiled-build references for locating the source equivalents, not instructions to edit installed bundles.

## Capability admission

Advertise `terminal.fenced-prompt-delivery.v1` **only after every guarantee below is implemented and tested**. Keep `terminal.prompt-delivery.v1` as a separate prerequisite.

Include `runtime.promptDeliveryJournalId`: a nonempty durable identifier for the native prompt-mutation journal. It survives normal app/process restarts. A new/missing/replaced journal gets a different identity and cannot claim continuity with the old one. Version numbers, flags or the presence of a schema field are not sufficient capability proof.

Both providers need native identity evidence while idle. `terminal.show` plus `session.tabs.list` must continue to prove exact context, execution host, native terminal incarnation, provider and provider conversation. A missing provider conversation must remain unverified; neither the orchestrator nor host may infer it from a title, model, last-used process or a copied conversation ID.

## Fenced `terminal.send`

The private client submits the existing guarded agent-prompt operation with these additions:

```json
{
  "terminal": "<handle>",
  "text": "<fixed inbox-check prompt>",
  "enter": true,
  "agentPrompt": true,
  "expectedBinding": {
    "terminalHandle": "<handle>",
    "worktreeId": "<exact context>",
    "executionHostId": "local",
    "provider": "claude or codex",
    "conversationId": "<native provider conversation>",
    "incarnationId": "<native terminal incarnation>"
  },
  "bodyDigest": "<SHA256 of the exact text UTF-8 bytes>",
  "journalId": "<durable prompt journal identity>",
  "waitSubmitMs": 1000,
  "client": {"id": "team-orchestrator", "type": "desktop"}
}
```

The envelope uses the original `orchestrationRequestId`. The client creates and flushes it before the first effect; retries reuse the complete original payload, not a reconstructed prompt.

Required host behavior:

1. Validate the complete expected tuple and text digest. Refuse a wrong journal identity. Do not silently strip these fields or downgrade to raw PTY writes.
2. Serialize mutation admission by journal/request ID. Bind it immutably to its body and native target before any possible input. Concurrent repeats yield one logical input. A changed payload or target under the same ID refuses.
3. Bind the actual write to the exact native PTY/process ownership token. Repeat the expected-tuple check at the physical write boundary, including after asynchronous plugin hooks, queueing or permission waits. A handle lookup before an await is insufficient. Never re-resolve an old request onto a replacement process.
4. Require the intended provider conversation to remain current and recognized. Refuse shell/raw-input fallback, permissions/trust menus and unverified native identity. Never answer a menu or interrupt a working agent to deliver this prompt.
5. A native hook that rewrites the prompt must not silently change the request's saved payload identity. Refuse or record an explicit immutable reviewed rewrite contract; this client currently expects the original exact digest.
6. Return the existing supported native prompt receipt with exact request ID, process incarnation and distinct input/submission/turn-start stages. Acceptance is not proof of a started turn. Refusal and unknown delivery remain distinct.

## Read-only `terminal.promptReceipt`

Proposed parameters:

```json
{
  "requestId": "<original request ID>",
  "journalId": "<original journal identity>",
  "expectedBinding": {"terminalHandle":"...","worktreeId":"...","executionHostId":"local","provider":"codex","conversationId":"...","incarnationId":"..."},
  "bodyDigest": "<original text digest>"
}
```

Return `promptReceipt` containing the same `journalId`, `requestId`, `expectedBinding`, `bodyDigest`, and:

- `state`: `absent`, `accepted`, `refused` or `unknown`.
- `authoritative`: true only when the complete durable journal establishes this verdict. An incomplete/corrupt/missing history must return unknown; absence after history loss is not proof of no effect.
- `targetState`: `active`, `retired` or `unverified` for the exact requested native tuple. Retirement must prove that no queued input for that old target can later enter a replacement process. Idle, missing UI metadata and a timeout are not retirement evidence.
- `send`: for accepted requests, the exact native send/prompt receipt, with observation updated read-only where supported. A lookup never submits input or creates a new request.

For an authoritative absent request, echo the queried binding/digest after validating their shape and inspect that exact target. Across host restart the client only considers a same-ID submission after authoritative absence in the **same durable journal**. A different journal or unknown result stops for reconciliation.

## Required host tests

- Both Claude and Codex: idle exact recipient succeeds; busy/permission/trust/unverified targets do not receive raw input.
- Change provider, conversation, context, execution host or incarnation between preflight and the write boundary: zero input to the replacement. Repeat while a plugin hook or permission wait is pending.
- Concurrent same-ID sends, lost reply after acceptance, delayed reply and same-ID observation: one logical input, exact receipts.
- Reuse an ID with another body or target: refusal, zero extra input.
- Restart Orca with the same journal: lookup recovers accepted/refused/absent evidence without input. Replaced/lost journal never returns authoritative old absence.
- Native target retirement cannot redirect queued input. A new target is a new explicitly fenced attempt, not a retry onto a different process.
- Idle provider identity remains explicit; synthetic names/model labels never establish a conversation.

Client fixtures and regressions: `node --test shared/team-store/test/orca-wake.test.mjs shared/team-store/test/codex-native.test.mjs shared/team-store/test/mod-wake-store.test.mjs`. They are not a substitute for host tests or disposable real mixed-provider acceptance.

## Client-side behavior already prepared

Both sender adapters use one recipient-independent wake path; no older notification/session-send fallback remains for automatic wake. Current shared delivery/notice/meeting eligibility and binding are checked before sending. Binding-generation-only changes retain the original request. A different native target needs authoritative retirement of its predecessor; attempts are bounded. A recorded start without inbox progress becomes actionable rather than causing blind resubmission. Both leads see timestamped observations; stale observations are labelled. No wake grants task/write/controller authority or acknowledges another member's inbox.

No host implementation or release is claimed by this handoff. Keep the original terminal route blocked until the owning Orca host satisfies this contract, then reconnect the clients and perform disposable bidirectional live acceptance. The separately approved managed fallback below does not remove this primary-route requirement.

## Managed-orchestration fallback supplement

[Coordination fallback: managed orchestration without replacing the primary routes](https://github.com/herman925/925-cc-plugins/issues/205) retains this original plan and adds managed execution as a fallback. The current client route arbiter persists one backend selection per wake pointer before any effect; an unknown or accepted primary never triggers another backend. The shared store keeps task/read/acceptance authority.

The installed managed `send` handler is not a transparent substitute for terminal input. Its settled-Dispatch resolution can steer to a newer active follow-up even for message types that do not themselves start work. For continuing message types it can create follow-up work, reopen a saved execution or start fresh. A Dispatch address plus a client-side precheck is therefore insufficient proof of preserved execution. Changing the message type alone is insufficient too.

Before enrolling that adapter, demonstrate an admission contract that pins the exact reviewed native execution and forbids automatic follow-up, redirect, close/reopen or fresh start. A retired/settled/changed target must refuse before effects. For coordinator Run delivery, pin the expected consumer generation and native owner rather than assuming the Run address proves the current provider conversation. Enforce those conditions after asynchronous hooks/queueing and at native delivery. These are requirements, not new fields or capability names claimed to exist in the installed API.

Preserve native request/receipt identity and distinguish native mail acceptance from a started model turn, shared inbox read and admitted task pickup. Native request lookup's absent result can mean pruning and is not proof of no effect. Test finish/reassignment/follow-up races, role/owner changes, pending human prompts and host restart in both directions. Never use native worker_done as shared outcome acceptance.

An adapter without that proof remains unenrolled and the client reports fallback-setup-required. An already reviewed owned-provider receiver can satisfy its separate connection contract without pretending the generic Orca send route has been verified. No installed application file is patched by this supplement.
