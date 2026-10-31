# Auth B offline mock key

Status: offline proof on LiteLLM 1.106.2 with mocked key rows. No dashboard key, no Vault item, no gateway change, no deploy. [#168](https://github.com/herman925/925-cc-plugins/issues/168) is not closed.

Herman's preferred Apply shape is a dedicated virtual key managed in the LiteLLM dashboard (native key), checked by the thin adapter in `integration/litellm/auth_b_gate.py`. Apply is `POST /jev/v1/projects/{project_id}/apply`. Read-back is `GET /jev/v1/projects/{project_id}/applied`. There is no separate Jev key UI and no global `custom_auth`.

Auth B authorizes Jev settings routes. It is not the credential for the decide call.

## Decide inventory

Deployment match: **unverified**. REUSE_OK is revoked. File and module names are not a live route.

### In-repo decide contract (this repo only)

`src/typesafe.mjs` and [SPEC.md](../SPEC.md) lock the new-repo decide contract:

- `POST https://api.typesafe.ai/v1/systemone`
- `Authorization: Bearer` plus the env name `TYPESAFE_API_KEY`
- path constant `SYSTEM_ONE_PATH` = `/v1/systemone`
- body model `jev-latest` (`JEV_DECIDE_MODEL`), which is not a LiteLLM execute alias

That contract is not Herman's deployed Jev API. This pack does not add a second decide client. In-repo selection stays `planPreCall` in `src/hook.mjs`, which builds the body with `buildSystemOneBody` and calls the injected transport.

The loopback adapter in `integration/litellm/hook_server.mjs` posts to `${JEV_TYPESAFE_BASE}/v1/systemone` after `assertLoopbackBase` (literal `127.0.0.1` or `::1` only). The request sets `content-type` and does not set `Authorization`. Redirects are `manual`. `integration/litellm/mock_typesafe.py` implements that path for tests and does not check a credential. The M4 suite removes `TYPESAFE_API_KEY` from the proxy environment before launch. This document does not read or print that variable.

`integration/litellm/config.yaml` is a local mock `model_list`: `jev-router`, `cheap-worker`, `strong-worker`, `large-leader`. Upstream `api_base` is the env name `JEV_MOCK_UPSTREAM_BASE`. That file is not a deployed gateway config.

### Ops notes (not live proof)

These notes are not in this repo. Live VPS config was not read (Hostinger timeout; no box SSH). They are cited only as notes:

- about 15 Oct `endpoints.md`
- about 31 Oct `gateway-facts.md`

Those notes describe a different public path from the in-repo contract: `https://api.hjc925.cloud` `POST /v1/systemone`, reached via jev-gateway to OpenRouter. The caller-auth name they use is the LiteLLM key name `925LLM_API_KEY`. No value for that name is recorded here.

Until a deployed gateway config is read and names the live alias, endpoint, and auth, the in-repo System One path and those ops notes stay unmatched.

### Decision payload

`buildSystemOneBody` sends `model: jev-latest`, at most one user message, and `questions.model` with `type: choice`. Criteria keys are the eligible subset only. The body has no `project_id`, no session id, and no request headers. The choice is `answers.model.choice`. Confidence is stored and is not a quality proof.

The excerpt helper is still named `credentialFreeExcerpt`. It is best-effort redaction with a bounded pattern list and a 500-character cap. That is not a guarantee that the text is credential-free.

### Two different authorizations

| Call | What this repo does | What it is not |
| --- | --- | --- |
| Decide | In-repo contract names `api.typesafe.ai` and env name `TYPESAFE_API_KEY`. The loopback transport sends no `Authorization`. | Not Auth B. Not proof of the deployed Jev API. |
| Jev Apply / read-back | Mock Apply still uses its own synthetic bearer. Auth B proof uses a mocked LiteLLM virtual key on the exact `/apply` and `/applied` paths. | Not the decide credential. Identity headers do not grant Apply. |

## Functions the tests actually call

LiteLLM 1.106.2, imported from `.venv-m4`. The store's `get_data` serves `combined_view` rows keyed by `hash_token`. The row's `token` field is a public id such as `tok-scoped-orca`.

| Function | How the suite uses it |
| --- | --- |
| `litellm.proxy._types.hash_token` | `authorize` hashes an `sk-` fixture before lookup. The raw bearer is not logged. |
| `litellm.proxy.auth.auth_checks.get_key_object` | Lookup against the mock store. A miss raises `ProxyException` (`token_not_found_in_db`). The metrics wrapper then imports Prisma, which this venv does not have, so `ModuleNotFoundError` propagates with that `ProxyException` on `__context__`. The adapter still treats that miss as invalid. A dependency error from `get_data` is not a miss: `authorize` returns `rejected` / `unexpected-error` and does not log the exception text. |
| `litellm.proxy.auth.resolvers.store.IdentityStore.resolve` | Called after `get_key_object` on the same cache. A hit projects the principal. A miss raises `KeyNotFoundError`. |
| `litellm.proxy.auth.user_api_key_auth.user_api_key_auth_builder` | Non-`sk-` fixtures only. The builder rejects them before `get_data` with a masked key (`not-****-key`) and `expected to start with 'sk-'`. |
| `litellm.proxy.auth.user_api_key_auth.validate_resolved_virtual_key` | Called for every resolved key, with an empty `api_key` argument so the raw bearer is not passed in. For that call the adapter installs a duck-typed prisma client whose user, team, and project reads return no row, then restores the previous client. A returned `UserAPIKeyAuth` is the only success. `blocked is True` is `revoked` (`key-blocked`). `expires` before now raises `ProxyException` type `expired_key` (`Authentication Error - Expired Key`) and the adapter denies `expired` / `expired-key` before route checks. Other `ProxyException`, `HTTPException`, and `BudgetExceededError` results are `rejected` / `native-denial`. Any other exception, including a project-table `RuntimeError`, is `rejected` / `unexpected-error`. The exception text is not logged. |
| `litellm.proxy.auth.route_checks.RouteChecks.should_call_route` | Allow or `HTTPException` 403 `Virtual key is not allowed to call this route` for a non-empty `allowed_routes`. An empty list or `None` returns true here (fail open). A parent prefix such as `/jev/v1/projects/orca-ade-example` also returns true for `.../apply`. |
| `litellm.proxy.auth.route_checks.RouteChecks.check_route_access` | Called when `allowed_routes` is missing or empty, and again for a Jev control path that `should_call_route` allowed. An empty collection returns false (`scope_missing`). A Jev control path must also be an exact member of `allowed_routes`. A parent prefix and a `.../*` wildcard fail that membership (`exact-grant`). A `permissions` dict does not grant a route. Inference routes stay on `should_call_route` so `llm_api_routes` is not false-denied. |
| `RouteChecks.is_virtual_key_allowed_to_call_route` | The test calls it directly with `allowed_routes=None` and records the fail-open `True`. |
| `RouteChecks._route_matches_allowed_route` | The test calls it on the raw path. `.../applied/../apply` matches a grant of `.../applied`. `.../apply/extra` matches a grant of `.../apply`. A parent prefix matches both siblings. The gate does not treat that parent prefix as an Apply grant. |
| `handle_key_type` | The test builds inference-only `["llm_api_routes"]` and read-only `["info_routes"]` from `GenerateKeyRequest`. |

`get_key_object` re-validates with `model_dump(exclude_none=True)`, so a stored `allowed_routes=None` becomes the schema default `[]`. Both values fail open inside `is_virtual_key_allowed_to_call_route`. The adapter denies both.

Jev control must be exactly `/jev/v1/projects/{id}/applied` or `/jev/v1/projects/{id}/apply`. Canonicalization rejects backslash, NUL, whitespace, query, fragment, empty segments, `.`, `..`, and a second `%` decode (`%252e` → `.`). Those paths are not passed to `should_call_route`. An extra segment is passed to `should_call_route` and can prefix-match, then the adapter still denies it (`exact-shape`). After a native allow, the requested path must be an exact string in `allowed_routes` and `check_route_access` must be true (`exact-grant`). `key.project_id` must equal the path's project segment (`project-binding`). A key bound to `orca-ade-example` with an explicit grant of another project's apply path is denied. A missing `project_id` on a Jev control route is denied. `POST` is required for apply and `GET` for read-back.

`dispatch_control` calls `createMockControlPlane` through `mock_apply_bridge.mjs` only after `authorize` allows that control route. The bridge supplies the handler's existing synthetic verifier. A denied Apply or read-back does not call the bridge, so the stored revision does not change. A valid scoped Apply then read-back returns revision 1, a later denial leaves that revision, and a second valid Apply returns revision 2.

`policyHash` runs inside the bridge. An empty policy object throws before the handler's own catch. The bridge returns that as status 400 with `error` and `message`, and the Node process stays up, so the previous revision remains and the next valid Apply still advances it. A lookup-stage dependency error never reaches the bridge.

Scoped fixture routes are the two exact sibling paths plus `llm_api_routes`. That key accepts apply, read-back, `/v1/chat/completions`, and `/v1/messages`, and denies `/key/generate`, `/team/new`, `/user/new`, another project, and the neighbor project id `orca-ade-example-evil`.

Logs from `jev.auth_b` are `decision` plus `token_id`, `user_id`, `project_id`, `team_id`, `allowed_routes`, `blocked`, and `permissions`. They do not include the raw bearer, the synthetic verifier, validator exception text, or lookup-stage exception text.

## Not done

- No live virtual key and no dashboard configuration.
- No Vault item and no move of existing provider credentials.
- No `custom_auth` and no Jev key UI.
- No second decide client.
- No live probe with user content.
- Model rewrite on the local mock is not live gateway execution. M5 headers are synthetic fixtures, not a Claude capture. `/anthropic/v1/messages` was not requested.

## Open

Deployed alias, endpoint, and auth are still unverified. Reconciling `api.typesafe.ai` / `TYPESAFE_API_KEY` with the ops-note host `api.hjc925.cloud` / key name `925LLM_API_KEY` needs a deployed config read. This pack does not mint either credential.

Whether production should also deny an empty `allowed_routes` list, given LiteLLM's fail-open, is a product choice. This pack denies it.

How the thin adapter will receive the dashboard virtual key without a new Vault item is not decided here.

Whether a Jev wildcard grant should ever be an Apply grant is a product choice. This pack requires exact path membership, so `/jev/v1/projects/{id}/*` does not permit Apply. Whether those control routes should later be a LiteLLM route group is also open. This pack uses the exact path strings.
