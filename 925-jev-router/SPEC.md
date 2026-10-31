# 925-jev-router

**Status:** SPEC frozen for M1 scope (31 Oct 2026).  
**Repo folder:** `925-jev-router/` in `herman925/925-cc-plugins`  
**Project-local config:** `.925-jev-router/` in the workspace (allowlist + Draft picker)  
**Scope:** Herman’s coding / Orca ADE path. Not the CiteReflex product brain.

Hostinger is today’s LiteLLM deploy home only. It is not a design lock. Draft, Apply, and read-back are gateway-agnostic (`project_id` → policy) wherever LiteLLM runs. This milestone does not deploy.

## What it is

Thin DIY LiteLLM pre-call hook. Not an OpenRouter `typesafe/jev-router` product dependency. Not a gargpratyush or prismhq drop-in.

LiteLLM stays the gateway. TypeSafe selects. LiteLLM executes through the existing provider config. No replacement gateway. No separate fleet controller.

| Path | Flow |
| --- | --- |
| Leader | Orca/Claude → LiteLLM → fixed large-model provider. No Jev. |
| Routed worker | Orca/Claude → LiteLLM sentinel hook → TypeSafe chooses a model → LiteLLM calls that model |

- **Decide:** TypeSafe System One direct. `Authorization: Bearer $TYPESAFE_API_KEY`, `POST https://api.typesafe.ai/v1/systemone`. Contract: closed [#162](https://github.com/herman925/925-cc-plugins/issues/162). M1 builds that body in memory and does not send it.
- **Execute:** Herman’s existing OpenAI-compatible and/or Claude-compatible APIs via LiteLLM. Hook attachment: closed [#163](https://github.com/herman925/925-cc-plugins/issues/163) (`CustomLogger.async_pre_call_hook` via `litellm_settings.callbacks`). M1 exports the hook function and does not register it on a live proxy.
- **Clients:** Orca-launched harnesses (for example Claude Code) via base URL + sentinel model id.
- **Sentinel:** working name `jev-router`. Final string is still open [#156](https://github.com/herman925/925-cc-plugins/issues/156). The sentinel must not appear in `candidates`. If a sentinel request does not resolve to an approved execute model, the hook errors. It must not leave the stub model in place.
- **Allowlist:** project-only `.925-jev-router/config.json`. Closed [#157](https://github.com/herman925/925-cc-plugins/issues/157). No credentials and no provider URLs in that file. Missing or invalid policy is a clear error and no execution. No user-global allowlist fallback.
- **Fail-open:** one System One retry, then `fallback` from the project policy. Selected model and fallback must both be in `candidates`. Presence in LiteLLM `model_list` is not approval. Closed [#161](https://github.com/herman925/925-cc-plugins/issues/161).
- **Picker:** Local Save writes a Draft. Explicit Apply produces an Applied record. Closed [#166](https://github.com/herman925/925-cc-plugins/issues/166). M1 HTML does Local Save only. Live Apply HTTP stays open [#168](https://github.com/herman925/925-cc-plugins/issues/168).
- **Secrets:** 1Password when available, otherwise the operator’s existing settings file. Never chat, never the allowlist file, never the picker HTML.

## Locked decisions

### Allowlist ([#157](https://github.com/herman925/925-cc-plugins/issues/157))

Filename `.925-jev-router/config.json`. One JSON object.

| Field | Required | Rule |
| --- | --- | --- |
| `schema_version` | yes | Integer `1`. Any other value is rejected. |
| `project_id` | yes | Project identity for Apply and sticky scope. |
| `candidates` | yes | Non-empty array of LiteLLM model aliases. The project approved list. |
| `fallback` | yes | Must be a member of `candidates`. Checked when the file is validated and again when a Draft is applied. |
| `default_worker_mode` | yes | `routed`, `per-session`, or `per-turn`. |
| `agents` | no | Map of per-agent overrides. A set model must be in `candidates`. `mode: "fixed"` requires that model and bypasses Jev for that agent. |

The fixed leader is a concrete model on the request. It is outside this file and bypasses Jev.

Forbidden in the file: credentials, API keys, provider URLs, and any unknown field. The sentinel string must not appear in `candidates`, `fallback`, or an agent model.

### Fail-open ([#161](https://github.com/herman925/925-cc-plugins/issues/161))

1. A returned choice is executed only when it is in the eligible subset of `candidates`.
2. Transient TypeSafe failure (network, 429, 529, or other 5xx): at most one retry, then the project `fallback` if that fallback is still eligible.
3. Non-transient rejection (including 400 and 401): no retry and no fall-open.
4. Invalid or missing Choice (`answers.model.choice`): do not execute it. Use the eligible project fallback, or error.
5. Empty eligible set, or a fallback that is no longer eligible: clear error. Never the first candidate. Never a model merely because it is on `model_list`.

M1 stub, from the proposed routing note on [#155](https://github.com/herman925/925-cc-plugins/issues/155) (not its own closed ticket): when the eligible set has one model, use it and do not call TypeSafe.

### Decide contract ([#162](https://github.com/herman925/925-cc-plugins/issues/162), [#165](https://github.com/herman925/925-cc-plugins/issues/165))

Request body the adapter builds:

- `model`: `jev-latest` (the Jev id, not an execute alias).
- `state.messages`: at most one user text, the credential-free excerpt. No `project_id` field and no session id field.
- `questions.model`: `type: "choice"`. `criteria` keys are the validated eligible subset only (each key ≤ 255 characters), not the wider `candidates` list and not LiteLLM `model_list`. There is no top-level allowlist field.

Chosen execute id: `answers.model.choice`. Confidence is recorded when present and is not treated as a quality proof.

Excerpt rule: at most 500 Unicode characters of user-visible task text, after credential redaction (keys, tokens, passwords, `.env`-style assignments including quoted and multiline values, JSON fields, outgoing payload fields, URLs with userinfo, `Bearer` values). Full prompts and repo dumps are out. The adapter reads the latest user message only. It does not copy request headers into `state`.

### Hook ([#163](https://github.com/herman925/925-cc-plugins/issues/163))

M1 `planPreCall` / `asyncPreCallHook`:

- Non-sentinel model: return the request unchanged. Do not load policy and do not call TypeSafe. This is the leader path.
- Sentinel: load `.925-jev-router/config.json` from an explicit project root, decide, set `data.model` to the approved alias.
- The stub does not walk parent directories and does not consult `process.cwd()`. How a live gateway learns the project root stays open [#159](https://github.com/herman925/925-cc-plugins/issues/159).
- `per-session` and `per-turn` are stored and validated. M1 does not cache a choice across calls, because turn and session identity are not defined yet. It does not advertise one HTTP request as a work turn.

### Draft and Applied ([#166](https://github.com/herman925/925-cc-plugins/issues/166), record shape from [#168](https://github.com/herman925/925-cc-plugins/issues/168))

Local Save = Draft. The saved document is the policy object (`schema_version`, `project_id`, `candidates`, `fallback`, `default_worker_mode`, optional `agents`). It has no revision and no hash.

Applied record, produced only by the in-memory `applyDraft` helper in tests:

| Field | Meaning |
| --- | --- |
| `status` | `applied` (local discriminator; Draft is `draft`) |
| `project_id` | From the policy |
| `revision` | Monotonic integer, starting at 1 |
| `policy_hash` | `sha256:` of the canonical policy JSON |
| `applied_at` | ISO-8601 timestamp supplied by the caller |
| `applied_by` | Short label. Not a token |
| `policy` | Re-validated policy |

`createMemoryGateway` stores that record in a `Map` and reads it back by `project_id`. `apply` and `read` each return a defensive copy. Mutating a returned record does not change the stored one. Unknown projects read as empty. This is the shape test. It is not an HTTP server.

Auth A versus Auth B is undecided ([#168](https://github.com/herman925/925-cc-plugins/issues/168)). Crabbie recommends a dedicated server-side control-plane credential later. M2 does not adopt either option. The offline handler uses a fake verifier and a synthetic token supplied by the test. It does not read a gateway admin credential, does not create a new one, and does not put one in HTML or browser storage. A new secret or permission stops the work and goes to Herman.

## M1 scaffold

| Piece | Where |
| --- | --- |
| Policy validation | `src/schema.mjs` |
| Fail-open selection | `src/fail-open.mjs` |
| Excerpt and System One body | `src/excerpt.mjs`, `src/typesafe.mjs` |
| Find `.925-jev-router/` and pre-call stub | `src/hook.mjs` |
| Draft → Applied records | `src/records.mjs` |
| Synthetic request runner | `src/harness.mjs` |
| Example project + Draft picker | `examples/project-a/.925-jev-router/` |

The picker button is Local Save. It downloads `config.json`. There is no Apply button and no network call.

## M2 offline control plane

`createMockControlPlane` handles the gateway-agnostic routes in process. Nothing listens on a port.

| Route | Result |
| --- | --- |
| `POST /jev/v1/projects/{project_id}/apply` | Re-validates the Draft, checks `policy_hash`, checks each candidate exists in the test's configured alias list, then stores the Applied record. |
| `GET /jev/v1/projects/{project_id}/applied` | Returns that record, or 404. |

The caller must present `Authorization: Bearer` plus the synthetic token passed into the fake verifier. A missing or wrong token is 401 and does not reveal whether a project exists. The token is not written into the Applied record, the picker, or browser storage. Alias existence is not approval: a name only on the configured list is not added to `candidates`.

`runSyntheticPreCall` wires three stages on that read-back policy: the hook classifies leader versus sentinel, the decision adapter builds the System One body from the eligible set, and execution rewrites `data.model`. A non-sentinel leader does not call the selector. A sentinel request with no agent id stays on the sentinel path. This in-process mock is not a real LiteLLM or TypeSafe test.

## M3 offline identity and stickiness

[#167](https://github.com/herman925/925-cc-plugins/issues/167) correlation is implemented in `src/request-context.mjs` and covered by `test/request-context.test.mjs`. The design record remains [docs/m2-request-context.md](docs/m2-request-context.md). The assertion map is [docs/m3-request-context.md](docs/m3-request-context.md).

The binding is authenticated caller, project, applied revision, session, and agent. Prompt mode adds the prompt id. Header names are matched case-insensitively. The binding agent is `X-Jev-Agent`. `X-Jev-Parent-Agent` is lineage only and does not replace the child, so sibling agents stay distinct. One prompt keeps its selection across tool-result calls and retries. A new prompt may select again, including onto the same model.

Same-key concurrent first requests share one in-flight selection and commit one pin. Each waiter revalidates that model against its own eligible set before execution. Different keys stay isolated. A failed selection leaves no pin. Before every fresh, shared, or cached execution, the harness validates the synthetic Applied policy, intersects the requested eligible set with that policy, and requires the header project and revision to match the Applied record. A cached model that is expired, omitted from that eligible set, or no longer eligible is dropped before execution. The header agent is the same id used for a fixed agent override. A conflicting fixture agent is rejected. Auxiliary or compaction traffic with no live pin returns `auxiliary_unpinned` and does not invent a leader. Identity fields reject control characters and the binding key is a JSON tuple. Committed pins and tracked flights each have their own cap of 64. A flight arms its own deadline timer, settles initiator and waiters without another request, and checks elapsed time again before commit. A late selector result cannot pin, and the selector call is not cancelled. An older flight's cleanup cannot drop a replacement. Both limits are injectable.

Those headers are correlation hints. `headersAuthorizeApply` is always false. They do not grant Apply. Auth A versus Auth B is still undecided. The hook file does not read these headers. The synthetic harness consults the store only when the fixture passes `headers` or `contextStore`. A non-sentinel model still bypasses that store.

## M4 local LiteLLM proxy

M4 runs pinned `litellm[proxy]==1.106.2` from PyPI inside a disposable project virtualenv (`.venv-m4`, not installed system-wide). The suite is `integration/litellm/`. It binds `127.0.0.1` only. The TypeSafe stub and the execute stub are local processes. They do not call `api.typesafe.ai` or a provider. Installing the package is not test traffic. How to create the venv and run the suite is [docs/m4-litellm-local-mock.md](docs/m4-litellm-local-mock.md).

`callback_bridge.py` implements `CustomLogger.async_pre_call_hook`. It posts the JSON-safe request to `hook_server.mjs`. That adapter calls `planPreCall` in `src/hook.mjs`, which is the function `asyncPreCallHook` delegates to, and the callback copies the returned model onto the proxy request. Allowlist, excerpt, and fail-open stay in the Node modules. The adapter loads `examples/project-a/.925-jev-router/config.json`, applies it with the existing in-process mock Apply, and passes the read-back policy as `context.policy`.

`config.yaml` registers sentinel `jev-router` with `api_base` `http://127.0.0.1:9/v1`, a closed port. `cheap-worker`, `strong-worker`, and `large-leader` point at the mock upstream. `config.nocallback.yaml` is the same list without the callback. Router retries are 0.

M3 stickiness is not on this path. `src/hook.mjs` does not read `X-Jev-*` headers, and the proxy bridge does not call `src/request-context.mjs`. Pins, shared flights, and prompt stickiness remain in-process only.

The suite calls `POST /v1/chat/completions` and `POST /v1/messages` (non-stream, stream, and tool-use plus tool-result). On LiteLLM 1.106.2, `/v1/messages` for an `openai/` deployment is translated to the OpenAI Responses API (`/v1/responses`) on the mock. `/anthropic/v1/messages` is not requested and is not claimed. This is not live smoke ([#160](https://github.com/herman925/925-cc-plugins/issues/160)).

## Non-goals

- CiteReflex SaaS product brain.
- Self-hosting Jev weights.
- Custom MCP for Grok Bot.
- Drop-in of gargpratyush/jev-router or stock prismhq/jev-router OpenRouter execute.
- Replacement gateway or fleet controller.
- Live provider traffic, live `api.typesafe.ai` calls, Hostinger deploy, credential creation. M4 is a disposable local proxy and loopback mocks only.

## Still open

[#156](https://github.com/herman925/925-cc-plugins/issues/156) sentinel string, [#158](https://github.com/herman925/925-cc-plugins/issues/158) picker delivery beyond this Draft shell, [#159](https://github.com/herman925/925-cc-plugins/issues/159) project discovery, [#160](https://github.com/herman925/925-cc-plugins/issues/160) v1 smoke criteria (M4 is the local mock, not that smoke), [#164](https://github.com/herman925/925-cc-plugins/issues/164) glossary and ADRs, [#167](https://github.com/herman925/925-cc-plugins/issues/167) live header smoke (offline binding is M3; the M4 proxy does not wire it), [#168](https://github.com/herman925/925-cc-plugins/issues/168) real Apply authentication. Map: [#155](https://github.com/herman925/925-cc-plugins/issues/155). The M2 routes are an offline stand-in for the #168 shape only.

## Smoke criteria

Not an M1 exit. Finalize under [#160](https://github.com/herman925/925-cc-plugins/issues/160): System One 200 with a choice inside the project allowlist; execute hits Herman’s base URL; fail-open uses the documented fallback; leader bypasses Jev.
