# Independent native Codex and owned worker delivery — 2026-11-12

Candidate implementation on `feat/team-orchestrator-completion`, draft [shared completion work](https://github.com/herman925/925-cc-plugins/pull/204). Mod 0.5.62 / Codex 0.1.12 / schema 10, with 76 matching runtime files in both packages. This report advances the [host-adaptive coordination plan](https://github.com/herman925/925-cc-plugins/issues/179) under the accepted [managed fallback decision](https://github.com/herman925/925-cc-plugins/issues/205). Neither design ticket nor the broader implementation is closed by these tests.

## Implemented behavior

Independent setup verifies the native Codex executable, the sole OS thread-writer lock owner and the conversation's actual project. A separate read-only app-server calls `thread/read` with `includeTurns: false`; it never starts, resumes or loads the caller's thread. Codex 0.167.0 supplies a native thread ID to MCP, but no cwd or roots capability in the measured initialize/call exchange. The metadata inspector closes that project-proof gap. Every API call rechecks the native owner and project. A weaker, still OS-attested identity is used only to discover guard membership; a confirmed nonmember keeps ordinary tools if the optional inspector is unavailable, without gaining API authority.

Setup records an explicit host and stable context namespace. Partial Orca identity fails rather than silently choosing independence. A legacy installation without a recorded namespace cannot change host through setup; a changed Orca context requires a separate home-migration workflow. Preview/apply/reconnect, hook trust, schema upgrade and native controller/member reviews remain distinct.

One project dispatcher now owns native Codex worker pipes. The existing shared API still owns launch approval, capacity claims, target recording, binding, readiness, inbox state and task acceptance. The dispatcher owns no second roster or task engine. One specific reviewed launch plan grants its listed worker tool bundle. After an API claim, a durable native attempt precedes process creation. Preparation creates a thread without model input, verifies its actual PID/FILETIME and writer lock, and returns the exact target. The API records that target before one durable bootstrap turn starts. The worker then self-binds through native identity and completes status, official role, inbox and exact-receipt readiness checks.

Provider connections live in the project dispatcher, independently of the head's MCP socket. Idle owned workers receive canonical inbox-check pointers through the same private pipe; the recipient's own tools still perform the read/confirmation. Wake IDs are correlation identifiers, not assumed provider deduplication keys. Durable local claims prevent duplicate create/bootstrap/wake effects after lost replies. Owner loss, process replacement, stale identity, pending review and unknown outcomes never authorize a new execution or another route. An uncertain preparation retains its native process and pending review; a timeout does not close it. The dispatcher stays alive while it owns provider executions or unresolved preparations; an exited owner requires reconciliation rather than automatic replacement.

Native execution/approval settings come from the worker's project configuration. The runner synthesizes no unrestricted sandbox or `never` approval policy. Its runtime/Node paths must match the dispatcher package. Native process completion does not report a shared outcome or accept a task.

`shared_team_worker_review` lets only the current approved top head inspect or relay an exact owned worker MCP form or nonsecret native multiple-choice question. The tool's arguments cannot supply an answer. A real native form supplies the response; caller, launch, worker identity and original request are rechecked afterward. Cancellation and unknown responses preserve the original request. An implausibly fast decline remains delivery-unverified and is not forwarded as a human decision. Response claims/receipts permit reconciliation without a second answer. Unsupported command/file permission and secret-input requests remain pending, explicitly reported; the bridge does not invent an approval response for them.

## Validation

- Final common suite with SQLite and an owned real PostgreSQL, native config writer, Node 22.13: **652 passed, 0 failed, 0 cancelled, 0 skipped**. PostgreSQL stopped afterward. Full log: `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-bnuoQF/suite.tap`, SHA256 `40C06D3E4801A7EB1302FCEC4E19AD82D7A0363E85950FFD7423D537B5A98CEA`. Earlier advancing-tree passes were 650/650 at `team-completion-pg-2W2vcn/suite.tap` (SHA256 `4F6F080FDB770C43F1A04CF714E4DAB94C88AF2006D09565429C288A14820D6D`) and 651/651 at `team-completion-pg-m2f7pA/suite.tap` (SHA256 `9DE289BF8D5F62291AF1B6B2E87FED2B13DB81B731F0ADCA3496AC8597868AC6`). The final pass includes both the namespace-transition refusal and retained uncertain preparation.
- Mod SDK: **473 passed, 0 failed**, 48 files. `C:/Users/Herman/AppData/Local/Temp/team-independent-mod-sdk.log`, SHA256 `DAC3EC6A050DFC85343D6048800D22222F270CDFE4C3C7C7902C36A7CE2F73E0`.
- Final native setup checks including the namespace-transition refusal: **13 passed, 0 failed, 0 skipped**, Node 22.13. These also ran inside the final 652-test suite.
- Focused guard/identity/native review/RPC checks: **29 passed, 0 failed**; final owner/dispatcher checks: **19 passed, 0 failed**. They cover changed native ownership, ordinary nonmembers, strict member/pending-launch verification, exact recovery scope, no automatic human responses, native request cancellation, one-winner native effects, retained preparation/review, owner loss and unknown bootstrap replies. The real IPC test also drops a submitted request's reply and confirms no automatic resend or idle-owner exit.
- Both runtime packages: **76 matching files**. Final measured runtime digest in the disposable setup is `fec236a3c7189f06c89305b0ae5b569246f87568eb19fd3779279a904c1a7db4`.

## Real native fixtures and their limits

The [scope/setup fixture](independent-codex-runner-20261112/native-scope.json) uses real Codex 0.167.0 and Node 22.13 with a deterministic loopback model and separate temporary home/project. It verifies actual native parent/thread/project identity, production adapter status, ordinary nonmember guard access and a normal setup preview/apply only in that disposable project. Its metadata inspector reports the caller thread as `notLoaded`; exactly one original MCP initialization occurred, so inspection did not recursively load the thread or its tools. No team store was created.

The [owned worker fixture](independent-codex-runner-20261112/native-owned-worker.json) uses real Codex 0.167.0, the production project IPC/owner/MCP/API and an isolated SQLite team. Fixture-only approval callbacks and a synthetic head establish the test authority; **no real human form is answered**. It proves:

1. Preparing the native worker makes zero model calls; recording its target precedes bootstrap.
2. Its actual conversation self-binds at generation 1 and reaches Ready after its own role/inbox checks.
3. The head sends one real shared question; the owned worker reads and confirms its own actual inbox receipt.
4. Repeating the same native wake request returns the original request/turn receipt. Exactly nine synthetic model requests cover both bounded sequences, with no extra turn.
5. Native read-only execution and granular approval settings remain effective. No task is created or accepted by execution completion.

Retained final Node-22 fixture directories are `C:/Users/Herman/AppData/Local/Temp/team-independent-scope-GSyVoX` and `C:/Users/Herman/AppData/Local/Temp/team-owned-manager-native-06Ql9y`. The owned fixture also passed twice on the current Node and once on Node 22.13 before the final run. All used a local deterministic model: no paid model call, real-human approval, live team modification, installed-runtime activation or Orca send occurred.

Copied scope evidence SHA256: `158AC2E9D12E2CE66EF17B9398E9EE44BF918199E8C0D00EEFAD559BA1FC7071`. Copied owned-worker evidence SHA256: `65C396FC5D1A178AEBDEB13C2C3C97A0A380FB109DBADDB3D17C94D146AABA42`.

## Remaining work

The original Orca terminal fence remains a host dependency. Its managed-orchestration fallback still requires concrete exact-execution enrollment/delivery guarantees; the unsafe generic send/follow-up path is not enabled. No source checkout for the owning Orca application was available, and the installed application was not patched.

Independent Claude enrollment/ownership and real Claude/mixed-provider lifecycle acceptance remain open. Automatic input is available only to owned receivers: an already-open external head is not automatically adopted, so worker-to-that-head model turns still require a supported host transport or a manual inbox check. Independent top-head launch/adoption, safe idle existing-worker resume, complete permission-request UI and restart/recovery acceptance are not complete. This increment must not be described as fully two-way automation for arbitrary existing conversations.

Real human native launch/review acceptance, real task/outcome/head acceptance, mixed meetings/replay and whole-Orca restart remain separate acceptance work. Migration/hosted onboarding and the broader Wayfinder items are unchanged. Nothing was installed into or activated for Herman's real project; the candidate was not merged or released by this report.
