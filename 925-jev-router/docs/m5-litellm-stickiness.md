# M5 local proxy stickiness

The M3 store in `src/request-context.mjs` is unchanged. `hook_server.mjs` calls it around `planPreCall`. `planPreCall` still does not parse headers. The proxy callback copies only these native headers from the incoming request:

| Header | Binding field |
| --- | --- |
| `x-claude-code-session-id` | session |
| `x-claude-code-agent-id` | agent (the child) |
| `x-claude-code-parent-agent-id` | parent lineage |
| `x-claude-code-prompt-id` | prompt, when the Applied mode is `per-turn` |

Caller, project, and revision come from the Applied mock record: `applied_by`, `project_id`, and `revision`. A client `X-Jev-*` header is not copied and cannot choose those fields. `headersAuthorizeApply()` stays false. Re-apply still uses the synthetic mock bearer on the loopback hook, not the proxy client.

The effective mode is the child agent's validated `mode` when that agent declares `fixed`, `routed`, `per-session`, or `per-turn`. Otherwise it is `default_worker_mode`. `fixed` never enters the pin store, including when the default is `routed`. The routed path still passes that child agent into `planPreCall`. `per-turn` includes the prompt id in the pin. `per-session` does not, so a later prompt id reuses the pin. `routed` does not pin. The example project stays `routed`, so the M4 requests, which send no native headers, still select on every call. A `per-session` or `per-turn` request with no native identity returns `binding_incomplete` and does not call TypeSafe.

Chat completions and `/v1/messages` both run the same adapter. A tool-result continuation that repeats the native ids reuses the pin. Sibling agents that share a parent do not. `large-leader` never writes a pin. Fixed agent `reviewer` resolves to `strong-worker` with zero TypeSafe calls and does not pin. The parent id is not that override.

Two concurrent requests for one binding share one TypeSafe call. Each request captures its eligible list at entry. That list is the Applied candidates unless the loopback hook `/control` sets an eligible fixture. The captured list is intersected with the current Applied candidates before planning, before a replan, for a fixed agent, for fallback, and before execution. A fixture of only `strong-worker` does not offer `cheap-worker` to TypeSafe and does not execute it. One remaining model is used directly, with no decision call. A fixed model outside that intersection is refused. The proxy client cannot set the fixture. A later fixture change does not rewrite an in-flight initiator's captured list. Before a selection is returned for execution, the adapter reads the current Applied revision again. If that revision dropped the chosen alias, the call is replanned against the intersection with the new policy, or refused. A delayed cheap decision therefore does not execute `cheap-worker` after Apply leaves only `strong-worker`, for the initiator and for a waiter that joined the same flight. A replan does not add a candidate the captured fixture excluded. A new Apply also changes the revision, so the next request does not reuse the previous pin. A flight deadline returns `admission_expired` without another request, and the late selector result does not pin. A non-transient TypeSafe failure leaves no pin.

## Not claimed

These headers are synthetic fixtures on the local proxy. This is not a capture from a live Claude client, and it does not show that Claude Code emits them to this gateway. LiteLLM's cleaned header map keeps one value per name, so a duplicated wire header is not visible as two values. The adapter rejects a list of distinct values when it receives one. `/anthropic/v1/messages` was not requested. Auth B's offline mock-key proof is [auth-b-mock-key.md](auth-b-mock-key.md). Deployment match for the decide path is unverified.
