# Request context and header binding (design only)

Status: interface confirmation for M2. No header parser, no sticky cache, and no Claude or LiteLLM wire client is implemented. [#167](https://github.com/herman925/925-cc-plugins/issues/167) stays with Crabbie. [#168](https://github.com/herman925/925-cc-plugins/issues/168) auth A versus B is not chosen.

The hook still classifies a call only by the requested model id. It does not read session, agent, or prompt headers.

## Interface the later implementation must match

Normalize header names before use. A binding isolates authenticated caller, project, applied revision, session, and agent. Prompt-scoped mode adds a prompt id. Eligibility is revalidated before execution.

A fixed leader is a non-sentinel model. That path bypasses selection entirely. A missing agent id does not, by itself, prove the call is leader work.

One prompt includes the tool-result calls and retries that follow it. The agent id stays with that work. Prompt ids may span subagents. A new prompt may select again. The new selection does not have to be a different model.

Missing, blank, or conflicting ids produce an explicit conservative pin or a clear error. The router must not silently switch model on every HTTP request. Those headers are correlation hints. They are not authorization.

The control-plane `Authorization` bearer on the mock Apply route is a separate fake verifier. It is not a Claude identity header and it is not Auth A or Auth B.

## Expected client facts (not wire evidence)

Claude Code prompt-id support used here is documented for 2.1.310, which is newer than the 2.1.283 minimum. A custom base URL is expected to need `CLAUDE_CODE_GATEWAY_HINT_HEADERS=1`. That is documented client behavior, not evidence from this repo.

Real LiteLLM tests against 1.106.2 may use `/v1/messages`. Do not treat that as `/anthropic/v1/messages`. The in-process JavaScript harness is not a real LiteLLM test.

## Assertion map

| #167 bullet | Assertion | Test | Kind |
| --- | --- | --- | --- |
| Normalize header names | Canonical names compare equal when the wire spelling differs only by case. | `test/request-context.test.mjs` `normalizes header names case-insensitively` | Planned. Not implemented. |
| Binding isolates caller, project, applied revision, session, and agent | A selection stored for one tuple is not reused for a different caller, project, revision, session, or agent. | `test/request-context.test.mjs` `isolates bindings across caller, project, revision, session, and agent` | Planned. Not implemented. |
| Prompt mode adds prompt id | Prompt-scoped mode includes the prompt id in the binding. | `test/request-context.test.mjs` `prompt mode adds the prompt id to the binding` | Planned. Not implemented. |
| Revalidate eligibility before execution | After a new Apply removes a candidate, the next execution does not use that candidate. Criteria come from the read-back policy. | `test/wire.test.mjs` `a later apply changes the policy the next execution revalidates` | Offline. Implemented. |
| Fixed leader bypasses selection | Non-sentinel `large-leader` is unchanged and the selector call count is 0. | `test/wire.test.mjs` `fixed leader is pinned and does not call the selector`; also `test/hook.test.mjs` `leader calls bypass Jev and do not read a missing project` | Offline. Implemented. |
| Missing agent id is not leader proof | Sentinel request with no agent id still calls the selector once and does not take `leader-bypass`. | `test/wire.test.mjs` `a missing agent id does not turn sentinel work into the leader path` | Offline. Implemented. No header parser. |
| One prompt covers tool results and retries | Later tool-result calls in the same prompt keep the selection. | `test/request-context.test.mjs` `one prompt keeps the selection across tool results and retries` | Planned. Not implemented. |
| Keep agent id; prompt ids may span subagents | Subagent prompt ids do not drop the parent agent id. | `test/request-context.test.mjs` `prompt ids may span subagents without dropping the agent id` | Planned. Not implemented. |
| New prompt may select again | A new prompt id may call the selector again. The model may stay the same. | `test/request-context.test.mjs` `a new prompt may select again without requiring a different model` | Planned. Not implemented. |
| Missing, blank, or conflicting ids | Explicit pin or error. No silent per-request model switch. | `test/request-context.test.mjs` `missing blank or conflicting ids pin or error` | Planned. Not implemented. |
| Headers are correlation hints, not authorization | Identity headers must not grant Apply or change approval. | `test/request-context.test.mjs` `identity headers do not authorize apply` | Planned. Not implemented. Mock Apply auth is the separate bearer check in `test/mock-apply.test.mjs`. |
| Cross-agent, session, caller, and project isolation | Same as the binding-isolation row. | `test/request-context.test.mjs` `isolates bindings across caller, project, revision, session, and agent` | Planned. Not implemented. |
| Policy changes | Same as the revalidate row. Downstream model is the project fallback, not the removed candidate. | `test/wire.test.mjs` `a later apply changes the policy the next execution revalidates` | Offline. Implemented. |
| Concurrent initial requests | Two first requests for different bindings do not share a selection. | `test/request-context.test.mjs` `concurrent initial requests do not share a selection` | Planned. Not implemented. |
| Case-insensitive headers | Same as normalize-header-names. | `test/request-context.test.mjs` `normalizes header names case-insensitively` | Planned. Not implemented. |
| Auxiliary and compaction traffic | Compaction or auxiliary calls do not start a new selection or drop the pin. | `test/request-context.test.mjs` `auxiliary and compaction traffic keep the pin` | Planned. Not implemented. |
| Record downstream model and selector call count | Wire result exposes `execution.model` and `selectorCalls`. | `test/wire.test.mjs` `hook, decision adapter, and execution rewrite use the read-back policy` and `fixed leader is pinned and does not call the selector` | Offline. Implemented. |
