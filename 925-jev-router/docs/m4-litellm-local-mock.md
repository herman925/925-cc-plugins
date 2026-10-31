# M4 local LiteLLM mock

Disposable proxy on `127.0.0.1`. Pinned `litellm[proxy]==1.106.2` from PyPI, installed only inside `925-jev-router/.venv-m4`. The venv is gitignored. This is not a system install, not a live gateway, and not a call to `api.typesafe.ai` or a provider. Downloading the package is not test traffic.

## Create the venv and run the suite

From `925-jev-router/`:

```bash
python3 -m venv .venv-m4
.venv-m4/bin/pip install --index-url https://pypi.org/simple -r requirements-m4.txt
.venv-m4/bin/python integration/litellm/test_m4_proxy.py
```

If `python3 -m venv` cannot find `ensurepip`, the host needs the matching `python3-venv` package. That package is the stdlib venv module. It is not LiteLLM.

The offline Node suite stays:

```bash
node --test test/*.test.mjs
```

`npm test` runs that Node suite. `npm run test:m4` runs the proxy suite with the venv interpreter.

## What the suite starts

All listeners are `127.0.0.1`.

| Process | Role |
| --- | --- |
| `mock_typesafe.py` | `POST /v1/systemone`. Modes: `choice`, `bad-choice`, `transient` (HTTP 503). |
| `mock_upstream.py` | OpenAI chat completions and Responses API. Records every execution. `mid-stream-fail` writes one chunk and closes. |
| `hook_server.mjs` | Loads the example project, applies it with the existing in-process mock Apply, and calls `planPreCall`. |
| `litellm --config config.yaml` | Proxy with the callback. |
| `litellm --config config.nocallback.yaml` | Same deployments, no callback. Started by the inert-sentinel test. |

`planPreCall` in `src/hook.mjs` is the function `asyncPreCallHook` delegates to. `callback_bridge.py` posts the request to the Node adapter and copies the returned model onto the proxy dict. It does not choose a model.

The Applied policy is the read-back of `examples/project-a/.925-jev-router/config.json`: candidates `cheap-worker` and `strong-worker`, fallback `strong-worker`. `large-leader` is a gateway alias and is not a candidate.

`jev-router` is on `model_list` so the proxy accepts the name far enough for the callback to run. Its `api_base` is `http://127.0.0.1:9/v1`, a closed port. `cheap-worker`, `strong-worker`, and `large-leader` use `JEV_MOCK_UPSTREAM_BASE`. `num_retries` is 0, including the router retry policy.

Credentials in the config are synthetic labels used only by this suite (`synthetic-jev-m4-proxy-key`, `synthetic-upstream-test-key`, `synthetic-inert-not-a-real-key`). The mock Apply token is the existing `synthetic-jev-test-token`.

## Resolved versions

Recorded from `.venv-m4` after `pip install --index-url https://pypi.org/simple -r requirements-m4.txt`. The same list is `integration/litellm/resolved-versions.txt`. Interpreter: Python 3.12. Node suite: Node v22.23.4.

| Package | Version |
| --- | --- |
| litellm | 1.106.2 |
| litellm-proxy-extras | 0.4.108 |
| litellm-enterprise | 0.1.76.post1 |
| fastapi | 0.162.0 |
| starlette | 1.10.0 |
| uvicorn | 0.54.0 |
| httpx | 0.28.1 |
| openai | 2.54.0 |
| pydantic | 2.14.2 |
| PyYAML | 6.0.3 |

`litellm.__version__` is not defined on this build. The version above is `importlib.metadata.version("litellm")`.

## Route assertions

Suite result: 9 tests, 9 pass, 0 fail. The Node suite remains 63 pass, 0 fail.

| Test | Client route | What it proved |
| --- | --- | --- |
| `test_01_chat_completions_rewrites_choice` | `POST /v1/chat/completions`, model `jev-router` | One upstream execution of `cheap-worker`. One TypeSafe call. Criteria keys are exactly `cheap-worker` and `strong-worker`. `state` has no `project_id`. Decision `typesafe-choice`. |
| `test_02_leader_makes_zero_selector_calls` | `POST /v1/chat/completions`, model `large-leader` | Selector calls 0. TypeSafe calls 0. One upstream execution of `large-leader`. Decision `leader-bypass`. |
| `test_03_fail_open_after_two_transient_failures` | `POST /v1/chat/completions`, stub returns 503 twice | One upstream execution of `strong-worker` (the project fallback). Selector calls 2. Decision `fallback-after-retry`. |
| `test_03b_invalid_choice_uses_eligible_fallback` | `POST /v1/chat/completions`, stub returns an ineligible choice | One upstream execution of `strong-worker`, not `cheap-worker`. One TypeSafe call. Decision `fallback-invalid-choice`. |
| `test_04_messages_non_stream` | `POST /v1/messages`, `stream` omitted | HTTP 200 and an Anthropic-shaped message. One upstream execution of `cheap-worker`. |
| `test_05_messages_stream` | `POST /v1/messages`, `stream: true` | HTTP 200 with SSE `event:` or `data:`. One upstream stream execution, bytes sent, selector calls 1, model `cheap-worker`. |
| `test_06_messages_tools_preserved` | `POST /v1/messages` with tool `lookup`, `tool_use`, and `tool_result` | The Node return still contains `lookup` and `tool_result`, and the model is `cheap-worker`. The mock request body contains both strings. |
| `test_07_no_blind_retry_after_stream_starts` | `POST /v1/chat/completions`, `stream: true`, mock closes after one chunk | Upstream executions stay 1. The recorded call is a stream and sent bytes. The client body has no `[DONE]`. Selector calls stay 1. |
| `test_08_callback_disabled_makes_zero_upstream_calls` | `POST /v1/chat/completions` on the no-callback proxy, model `jev-router` | HTTP status 400 or higher, body is an error and not `synthetic-ok`. Mock execution count unchanged. Node hook request count unchanged. |

`/anthropic/v1/messages` was not requested.

On LiteLLM 1.106.2, `/v1/messages` for an `openai/` deployment is translated to `POST /v1/responses` on the mock. Chat completions stay on `/v1/chat/completions`. The mock implements both. The recorded model alias is the execute proof.

## Limitations

- M3 stickiness is not wired into the proxy. `src/hook.mjs` does not read `X-Jev-*` headers. `hook_server.mjs` does not import `src/request-context.mjs`. Pins, shared in-flight selection, and prompt stickiness exist only on the in-process harness.
- A rewritten model on the mock is not a live provider call. A fresh mock Apply read-back is not live Auth A/B.
- The sentinel is inert because its configured base is a closed loopback port, not because the name is absent from `model_list`.
- This does not satisfy live smoke (#160).
