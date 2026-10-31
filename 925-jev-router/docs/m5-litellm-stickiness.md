# M5 local proxy stickiness

The M3 store in `src/request-context.mjs` is unchanged. `hook_server.mjs` calls it around `planPreCall`. `planPreCall` still does not parse headers. The proxy callback copies only these native headers from the incoming request:

| Header | Binding field |
| --- | --- |
| `x-claude-code-session-id` | session |
| `x-claude-code-agent-id` | agent (the child) |
| `x-claude-code-parent-agent-id` | parent lineage |
| `x-claude-code-prompt-id` | prompt, when the Applied mode is `per-turn` |

Caller, project, and revision come from the Applied mock record: `applied_by`, `project_id`, and `revision`. A client `X-Jev-*` header is not copied and cannot choose those fields. `headersAuthorizeApply()` stays false. Re-apply still uses the synthetic mock bearer on the loopback hook, not the proxy client.

`per-turn` includes the prompt id in the pin. `per-session` does not, so a later prompt id reuses the pin. `routed` does not pin. The example project stays `routed`, so the M4 requests, which send no native headers, still select on every call. A `per-session` or `per-turn` request with no native identity returns `binding_incomplete` and does not call TypeSafe.

Chat completions and `/v1/messages` both run the same adapter. A tool-result continuation that repeats the native ids reuses the pin. Sibling agents that share a parent do not. `large-leader` never writes a pin. Fixed agent `reviewer` resolves to `strong-worker` with zero TypeSafe calls. The parent id is not that override.

Two concurrent requests for one binding share one TypeSafe call. The waiter checks the eligible list captured for its own request. That list is the Applied candidates unless the loopback hook `/control` sets an eligible override. The proxy client cannot set it. A new Apply changes the revision, so the next request does not reuse the previous pin. A flight deadline returns `admission_expired` without another request, and the late selector result does not pin. A non-transient TypeSafe failure leaves no pin.

## Not claimed

These headers are synthetic fixtures on the local proxy. This is not a capture from a live Claude client, and it does not show that Claude Code emits them to this gateway. LiteLLM's cleaned header map keeps one value per name, so a duplicated wire header is not visible as two values. The adapter rejects a list of distinct values when it receives one. `/anthropic/v1/messages` was not requested. Auth A versus Auth B is unchanged.
