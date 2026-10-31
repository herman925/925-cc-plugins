# Checklist

Command, from `925-jev-router/`:

```bash
node --test test/*.test.mjs
```

Result: 63 tests, 63 pass, 0 fail (Node v22.23.4). No network. The previous 40 M2 tests remain in this run. `test/request-context.test.mjs` is 23.

M4 command, from `925-jev-router/`, with `.venv-m4` already installed from `requirements-m4.txt`:

```bash
.venv-m4/bin/python integration/litellm/test_m4_proxy.py
```

Result: 9 tests, 9 pass, 0 fail (Python 3.12, LiteLLM 1.106.2). Loopback only. The Node suite above is unchanged.

| Criterion | What was checked | Result |
| --- | --- | --- |
| SPEC freeze | `SPEC.md` records the closed locks from #157, #161, #162, #163, #165, #166, plus the #168 record shape. Hostinger is named as today’s home only. | Present |
| Allowlist schema | `test/schema.test.mjs` loads the example `.925-jev-router/config.json` and rejects bad schema, empty candidates, sentinel aliases, fallback outside `candidates`, agent models outside `candidates`, credentials, provider URLs, unknown fields, missing files, invalid JSON, and parent-directory discovery. | Pass |
| Fail-open | `test/fail-open.test.mjs` executes an approved choice, refuses a `model_list`-only model, retries a transient failure once, then uses the project fallback, refuses non-transient auth failure, and errors instead of picking the first candidate. | Pass |
| Hook stub | `test/hook.test.mjs` bypasses Jev for a non-sentinel model, finds `examples/project-a/.925-jev-router/`, rewrites the sentinel to the synthetic choice, bypasses TypeSafe for a fixed agent, and errors when no eligible fallback remains. The original request keeps `model: jev-router` on that error. The decide payload's `criteria` object is exactly `{ mid-worker, cheap-worker }` when that is the eligible set, and it omits the other candidate plus `model_list`. | Pass |
| TypeSafe excerpt | `test/excerpt.test.mjs` redacts a constructed key, a password assignment, an env assignment, JSON `api_key` values, quoted values with spaces, multiline `API_TOKEN` values, a quoted Authorization payload, an unquoted `Authorization: Bearer` header, a quoted multiline `Authorization: "Bearer …"` value, and single-quoted `{'password': ...}` JSON. Those secrets are absent from the excerpt and from `buildSystemOneBody().state.messages`. Each excerpt stays within 500 characters. A direct `buildSystemOneBody` call with an eligible subset emits that exact criteria object and rejects a `model_list`-only name. | Pass |
| Draft-only picker | `test/picker.test.mjs` builds a Draft from the form helper, re-validates it with the schema, rejects a sentinel and a provider URL, and reads `picker.html` for Local Save, no Apply button, and no gateway call or token field. A headless Chrome click on Local Save downloaded `config.json` and showed that Draft in the preview. Putting `jev-router` in candidates cleared the preview and showed the sentinel error. | Pass |
| Draft → Applied shape | `test/records.test.mjs` applies a Draft twice on an in-memory map. Revisions are 1 then 2, `policy_hash` is stable, a policy change changes the hash, read-back returns the latest record, and a credential-shaped `applied_by` is rejected. Mutating the apply return (including `revision` and nested `agents`) and mutating the read return leaves the next read unchanged, and the following apply is revision 2. | Pass |
| Synthetic harness | `test/harness.test.mjs` drives two in-memory transport failures and lands on `strong-worker` from the fixture, not on `model_list`. A synthetic 401 rejects. | Pass |
| M2 mock Apply / read-back | `test/mock-apply.test.mjs` posts and reads `/jev/v1/projects/{id}/...` in process. Missing and wrong bearer values are 401. The stored record survives a bad hash, an unknown alias, and a path/policy mismatch. The response copy can be mutated without changing the next read. The synthetic token is not in the record. String `"null"`, a scalar, and an array return 400 `apply_shape` and leave the stored revision unchanged. An alias that only exists on the configured list is not added to `candidates`. | Pass |
| M2 hook wire | `test/wire.test.mjs` applies, reads back, then runs hook → decision → execution rewrite. `large-leader` stays pinned with selector call count 0. A sentinel choice rewrites the model and records one selector call. No agent id still selects. A second apply that drops `cheap-worker` makes the next execution use `strong-worker`. | Pass |
| #167 interface | [docs/m2-request-context.md](docs/m2-request-context.md) records the binding rules. [docs/m3-request-context.md](docs/m3-request-context.md) maps each Planned row to an offline test. | Implemented offline |
| M3 request context | `test/request-context.test.mjs` covers case-insensitive headers, binding isolation, prompt stickiness, child agent id with parent lineage, missing/blank/conflict errors, control-character rejection, a conservative pin, shared in-flight selection with per-waiter eligibility, auxiliary traffic, failed-flight cleanup, policy intersection, applied project/revision match, fixed-agent identity, cached-model revocation, separate 64-pin and 64-flight caps, a flight timer that settles with no other request, late results that cannot commit, replacement survival, and harness `execution.model` plus `selectorCalls`. Identity headers do not grant Apply. | Pass |
| M4 chat rewrite | `integration/litellm/test_m4_proxy.py` posts `/v1/chat/completions` with `jev-router`. The mock upstream records one execution of `cheap-worker`. The TypeSafe stub is called once. Criteria keys are exactly `cheap-worker` and `strong-worker`. | Pass |
| M4 leader | The same suite posts `large-leader`. Selector calls and TypeSafe calls stay 0. One upstream execution uses `large-leader`. | Pass |
| M4 fail-open | Two stub 503s rewrite to `strong-worker` with two selector calls and one upstream execution. An ineligible choice uses the same eligible fallback, not `cheap-worker`. | Pass |
| M4 `/v1/messages` | Non-stream, stream, and a tool-use plus tool-result history all rewrite to `cheap-worker`. The hook return still carries `lookup` and `tool_result`. The mock body does too. LiteLLM 1.106.2 delivers those executions to the mock `/v1/responses` path. `/anthropic/v1/messages` was not called. | Pass |
| M4 sentinel inert | A second proxy loaded from `config.nocallback.yaml` returns an error for `jev-router`. The mock upstream execution count does not change, and the Node hook receives no request. | Pass |
| M4 no blind retry | After the mock emits one stream chunk and closes, the upstream execution count stays 1 and the client body has no `[DONE]`. | Pass |

Not done, on purpose: live provider traffic, live `api.typesafe.ai`, Auth A/B choice, live header smoke (#167), wiring M3 stickiness through the proxy, new credentials, deploy. M4 does not claim `/anthropic/v1/messages`.
