# M3 request context

Status: implemented offline in `src/request-context.mjs`. The harness consults it only when a fixture passes `headers` or `contextStore`. This is synthetic correlation for [#167](https://github.com/herman925/925-cc-plugins/issues/167). It is not Auth A or Auth B, and it is not a Claude or LiteLLM client. [#168](https://github.com/herman925/925-cc-plugins/issues/168) stays with Herman.

The M2 design record is [m2-request-context.md](m2-request-context.md).

## Concurrency correction

The M2 map planned `concurrent initial requests do not share a selection`. That wording is withdrawn. Same binding-key concurrent first requests share one in-flight selection and commit one binding. Different keys stay isolated. A second selector is not invented for the same key.

## Cache lifetime

`PIN_TTL_MS` is 15 minutes, measured from commit. A cache read refreshes eviction order and does not extend that deadline. Committed pins and tracked flights have separate caps, each `CACHE_LIMIT` (64). A full pin cache drops the oldest pin. A full flight table refuses a new key with `admission_rejected`. A same-key waiter still joins the one flight. The two caps do not add up to a shared total of 64.

`inflightDeadlineMs` defaults to the pin TTL. Each flight arms its own timer. When `now()` is past the deadline, that timer settles the initiator and every waiter and releases that flight's slot. No other request is required. Commit checks the elapsed time again, so a late success or rejection cannot pin. The timer does not cancel the selector call. Cleanup deletes a flight only when the map still holds that same flight object, so an older timer cannot drop a replacement. Both limits are arguments to `createRequestContext`. An expired pin, a pin whose model is absent from the caller's eligible list, and a call that omits `eligible` are dropped before execution. A shared waiter applies that check to its own eligible list. The revoked model is not returned.

The harness intersects `fixture.eligible` with the validated Applied `candidates` before fresh, shared, and cached execution. Header `x-jev-project` and `x-jev-revision` must match that Applied project and revision. A stale eligible list cannot keep a model the current policy removed.

## Binding

Header names are lowercased. String values are trimmed. One-element arrays are accepted. Two different values for the same header are `binding_conflict`.

| Header | Use |
| --- | --- |
| `x-jev-caller` | Authenticated caller. Synthetic correlation only. `Authorization` is not this field. |
| `x-jev-project` | Project |
| `x-jev-revision` | Applied revision |
| `x-jev-session` | Session |
| `x-jev-agent` | Agent id used for the binding and for fixed overrides |
| `x-jev-parent-agent` | Parent lineage. Kept on the result. Does not replace `x-jev-agent`. |
| `x-jev-prompt` | Prompt id. Included only when prompt mode is on (the default). |
| `x-jev-traffic` | `auxiliary` or `compaction` reuse a live pin and do not select. `tool-result` and `retry` are ordinary sticky traffic. |

A blank or missing required field is `binding_incomplete`. A missing agent stays incomplete when only a parent id is present. Neither that nor a conflict creates a pin or calls the selector. Control characters in an identity field are `binding_conflict`. The binding key is `JSON.stringify` of the tuple, so embedded quotes and commas cannot alias another caller or project. Prompt mode is on by default. Turning it off drops the prompt id from the key so later prompts share the session binding.

Auxiliary or compaction traffic before any live pin returns `auxiliary_unpinned` with `model: null`. The selector is not called, and the result is not `large-leader`.

`headersAuthorizeApply()` is always false. The mock Apply route still requires its own synthetic bearer.

## Expected client facts (not wire evidence)

Claude Code prompt-id support used here is documented for 2.1.310, which is newer than the 2.1.283 minimum. A custom base URL is expected to need `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`. That is documented client behavior, not evidence from this repo.

Real LiteLLM tests against 1.106.2 may use `/v1/messages`. Do not treat that as `/anthropic/v1/messages`. The in-process JavaScript harness is not a LiteLLM test. The local proxy wiring is [m5-litellm-stickiness.md](m5-litellm-stickiness.md).

## Assertion map

| #167 bullet | Assertion | Test | Kind |
| --- | --- | --- | --- |
| Normalize header names | Canonical names compare equal when the wire spelling differs only by case. | `test/request-context.test.mjs` `normalizes header names case-insensitively` | Implemented |
| Binding isolates caller, project, applied revision, session, and agent | A selection stored for one tuple is not reused for a different caller, project, revision, session, or agent. | `test/request-context.test.mjs` `isolates bindings across caller, project, revision, session, and agent` | Implemented |
| Prompt mode adds prompt id | Prompt-scoped mode includes the prompt id in the binding. With prompt mode off, the prompt id is not part of the key. | `test/request-context.test.mjs` `prompt mode adds the prompt id to the binding` | Implemented |
| Revalidate eligibility before execution | After a new Apply removes a candidate, the next execution does not use that candidate. A cached model that leaves the eligible set is dropped before execution. A shared waiter rechecks its own eligible set. The harness intersects eligibility with the current Applied policy. | `test/wire.test.mjs` `a later apply changes the policy the next execution revalidates`; `test/request-context.test.mjs` `an ineligible cached model is revoked before execution`; `a shared waiter revalidates eligibility before execution`; `execution intersects eligibility with the applied policy` | Implemented |
| Fixed leader bypasses selection | Non-sentinel `large-leader` is unchanged and the selector call count is 0. Headers do not write a worker pin. | `test/wire.test.mjs` `fixed leader is pinned and does not call the selector`; `test/hook.test.mjs` `leader calls bypass Jev and do not read a missing project`; `test/request-context.test.mjs` `a sentinel with incomplete identity is not the leader path` | Implemented |
| Missing agent id is not leader proof | Sentinel request with no agent id, and no identity headers, still calls the selector once and does not take `leader-bypass`. Incomplete identity headers are `binding_incomplete`, not the leader path. | `test/wire.test.mjs` `a missing agent id does not turn sentinel work into the leader path`; `test/request-context.test.mjs` `a sentinel with incomplete identity is not the leader path` | Implemented |
| One prompt covers tool results and retries | Later tool-result and retry calls in the same prompt keep the selection and the agent id. | `test/request-context.test.mjs` `one prompt keeps the selection across tool results and retries` | Implemented |
| Keep agent id; prompt ids may span subagents | The binding keeps the child agent id. The parent is lineage and stays on the result. Sibling agents that share a parent and a prompt do not share a pin. The same child and prompt still does. | `test/request-context.test.mjs` `prompt ids may span subagents without dropping the agent id` | Implemented |
| New prompt may select again | A new prompt id may call the selector again. The model may stay the same. | `test/request-context.test.mjs` `a new prompt may select again without requiring a different model` | Implemented |
| Missing, blank, or conflicting ids | Explicit error, then a conservative pin for a complete key. No silent per-request model switch. A bearer header is not a caller id. | `test/request-context.test.mjs` `missing blank or conflicting ids pin or error` | Implemented |
| Headers are correlation hints, not authorization | Identity headers must not grant Apply. `headersAuthorizeApply` stays false even when a bearer string is present. | `test/request-context.test.mjs` `identity headers do not authorize apply`. Mock Apply auth remains `test/mock-apply.test.mjs`. | Implemented |
| Cross-agent, session, caller, and project isolation | Same as the binding-isolation row. | `test/request-context.test.mjs` `isolates bindings across caller, project, revision, session, and agent` | Implemented |
| Policy changes | Same as the revalidate row. Downstream model is the project fallback, not the removed candidate. | `test/wire.test.mjs` `a later apply changes the policy the next execution revalidates` | Implemented |
| Concurrent initial requests | Corrected. Two first requests for the same binding share one selection and one pin. Two different sessions do not. | `test/request-context.test.mjs` `concurrent requests for one binding share one selection` | Implemented. Replaces the withdrawn M2 title `concurrent initial requests do not share a selection`. |
| Case-insensitive headers | Same as normalize-header-names. | `test/request-context.test.mjs` `normalizes header names case-insensitively` | Implemented |
| Auxiliary and compaction traffic | With a live pin, compaction or auxiliary calls do not start a new selection. With no pin, the result is `auxiliary_unpinned` and the model is null. | `test/request-context.test.mjs` `auxiliary and compaction traffic keep the pin`; `test/request-context.test.mjs` `auxiliary traffic before a pin does not invent a leader` | Implemented |
| Failed flight | A thrown selection leaves no pin and the next request may select. | `test/request-context.test.mjs` `a failed selection does not leave a pin` | Implemented |
| Bounded cache and lifetime | Default lifetime is 15 minutes. Pins and tracked flights each have a cap of 64. A flight timer settles initiator and waiters with no other request. Late success or rejection cannot commit. A replacement flight survives the old cleanup. | `test/request-context.test.mjs` `the pin cache is bounded and expires`; `in-flight admission is bounded and expired flights do not commit`; `an overdue selector expires without another request`; `a deadline timer settles the flight and a replacement survives` | Implemented |
| Fixed agent uses one identity | Header agent and a fixed override are the same id. A conflicting fixture agent is rejected. The parent id does not take the child's override. | `test/request-context.test.mjs` `a fixed agent override uses the validated header identity` | Implemented |
| Safe binding keys | Control characters are rejected. JSON tuple keys do not collide when a delimiter join would. | `test/request-context.test.mjs` `identity keys reject controls and do not collide` | Implemented |
| Record downstream model and selector call count | Wire result exposes `execution.model` and `selectorCalls`. A second call on the same prompt reports selector call count 0 and the pinned model. | `test/wire.test.mjs` `hook, decision adapter, and execution rewrite use the read-back policy` and `fixed leader is pinned and does not call the selector`; `test/request-context.test.mjs` `harness records the downstream model and selector call count` | Implemented |

## Not claimed

Rewriting `data.model` in the harness is not downstream network execution. Dropping an ineligible cached model is not a live gateway cache purge. No real Claude, LiteLLM, or TypeSafe call is made here.

A selector that already started is not cancelled when its deadline passes. The flight timer still settles the initiator and waiters, frees that flight's slot, and refuses the late result. The selector call itself may continue. That leftover work is the remaining in-flight risk.
