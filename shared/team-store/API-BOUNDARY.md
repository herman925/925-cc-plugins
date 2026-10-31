# API boundary — implemented preview, acceptance pending

Status: the private typed API and opt-in fresh-team Mod source integration for #141 are implemented in schema 5. See [the implementation contract and remaining acceptance](SCHEMA-5.md). Installed clients have not been changed. Schema-4 independent verification is historical evidence, preserved separately; it does not cover this increment.

## Settled constraints

- Callers are authenticated separately from authorizing an operation. Supplied member names, role strings, terminal titles and `principalId` fields are not proof.
- The trusted client derives project, execution host, provider session and native terminal/context from its runtime, rather than model tool arguments. A contradictory, missing or stale binding refuses.
- Role and binding checks use current authoritative state. Admission does not grant Agent, file, shell or role permissions.
- Composer-origin `#allow-write` is one-turn and applies only to the existing tool classes. Persistent member toggles and protected-manager rules remain as implemented. The shared helper does not create a general file/command capability.
- Only typed domain operations are exposed. The model receives no raw SQL, arbitrary path, arbitrary callback, supplied authorization policy or caller-selected storage root.
- Stable operation identity, explicit expected generations, loud lease conflicts, writer fences and uncertain-commit reconciliation remain required.
- Worker completion and head acceptance are separate facts, as already defined by the glossary. A prose report is not a lifecycle transition.
- The Orca plugin continues to consume native Orca orchestration. This design does not introduce a second scheduling/lifecycle engine there.

## Current implementation facts

| Evidence | Consequence for integration |
| --- | --- |
| `team-orchestrator/hooks/register.tsx`: `readOnlyProjectScope`, `preflight`, `identifyNow` | Existing Mod proof checks native home, provider session, local registry, terminal, host and member binding. Reuse the verified facts, not display-name inference. |
| `register.tsx`: legacy `memberAdd` treats `!me` as the person's own session | Legacy behavior remains separate. New shared-store commands require explicit project/session controller approval, per A1 below. |
| `register.tsx`: `turnAsk.answered` tracks a successful question in the current turn | This does not bind a specific approval to a specific action payload. The new API must not treat an arbitrary answered question as universal consent. |
| `hooks/shared-store.tsx`: `sharedStoreProtection`; `register.tsx`: `guard` | The opt-in integration blocks literal raw store writes and private approval-ticket access, and reads shared member grants for existing manager/Agent rules. Shell parsing remains best effort; this is not OS isolation. |
| `shared/team-store/src/authority.mjs` | The foundation requires a synchronous client policy but deliberately does not authenticate a supplied principal. Public client code must supply that proof and policy. |
| `shared/team-store/src/store.mjs`: `attempt`; `src/api-domain.mjs` | Primitive client policy still runs before transactions. Typed API operations additionally validate current approval/member/binding/configuration generations under the common lease, after any lock wait. |
| `GLOSSARY.md`: task acceptance and execution attempt | A worker's explicit attempt outcome must not silently become its own head's acceptance. |

## Candidate typed slice

The first slice targets a newly created, explicitly opted-in scratch team. Existing teams/files are not migrated. Implemented operations cover controller approval, fresh-team creation, native member binding, inspection, assignment admission to a direct report, worker pickup verification, explicit attempt outcome reporting, and the head's separate acceptance decision. The permission matrix and storage additions are in [SCHEMA-5.md](SCHEMA-5.md); `api.d.mts` declares the request contract and runtime validation rejects extra fields.

Identity and authorization data are injected by the trusted client adapter. Request bodies contain domain identifiers and expected versions only. The backing adapter is a private dependency, not an unrestricted model-facing `execute` tool. Authentication proof is obtained outside write transactions; current shared role/binding generations must be checked under the lease without holding a transaction across host/network calls.

No external HTTP transport is selected by this internal module boundary. Publishing a remote helper is a separate scope decision.

## Decision interview

**A1 — outside-roster control authority: decided by Herman, option 1.**

One explicit user approval binds controller authority to this project and session. A new session needs fresh approval. Being absent from the team roster does not confer controller authority. This establishes an approved caller; existing operation-specific role, grant and approval requirements still apply.

**A2 — concurrent approved controllers: decided by Herman, keep both.**

Approving another controller session does not revoke prior separately approved sessions. Each retains its own project/session authority. The existing loud lease conflict guard serializes shared writes and identifies a competing holder; controller approval does not override it. This is implemented and covered by the API suite.

**A3 — resuming the same controller conversation: decided by Herman, retain after verification.**

Approval survives resuming the same verified conversation after an app restart on the same machine/project. Fresh native identity/binding verification is required; a matching display title or copied identifier is insufficient. A new conversation still requires approval under A1. Cross-project or cross-machine controller transfer was not granted by this answer. A new runtime incarnation must not retain stale transport/binding authority merely because controller approval persists.

Controller records and live native member bindings are implemented separately, with revocation and generation checks. Existing Mod behavior remains the default; the new source flow requires explicit preview opt-in and project/conversation controller approval.

**Question-tool workflow — confirmed by Herman.**

Use an actually exposed, permitted interactive question tool independently of `/grill-me`. Claude Code normally uses `AskUserQuestion`; Codex may expose blocking `request_user_input` or asynchronous `request_user_input_async`; Hermes Agent uses `clarify`. Discover a native/MCP equivalent if names differ. The blocking call returns the answer; an async opened/accepted result does not. Keep the turn open and wait for the actual async answer. Tool names and current-mode permission are runtime capabilities, not universal assumptions or proof of user authorization. These instructions have been added to the products' prompt guidance; they do not implement API actor authentication.

## Remaining acceptance and follow-up

1. Local checks and preview/host fixture repairs are complete; see [measured validation](VALIDATION-SCHEMA-5.md). The Mod sandbox rejects Node imports; source integration uses a private packaged Node subprocess with structured stdin, not HTTP or an additional persistent service.
2. The repaired browser suite also exposed and now covers a real existing-plugin pre-submission recovery race. All 35 browser cases and all three pinned-host checks pass. A passing fixture is not real native process or live lifecycle acceptance.
3. Herman was notified before each test handoff. Claude's final independent two-engine run passes 217 cases; the real source-Mod retry proves scoped scratch approval, native member bindings, strict role/brief-before-fixture order, worker outcome, separate head acceptance, coexistence of approved controllers and approval retention after a graceful same-conversation Claude process restart. A whole-Orca application restart remains untested. The Windows idle-caller repair uses exact direct-parent identity plus a fresh registry/OS process-creation match when Orca omits the provider projection; target binding still requires the explicit native association. See the measured validation for evidence and scope. Node 22.13.0 also passes the current SQLite suite locally; no installed runtime was replaced.
4. Existing-team migration, inbox/replay/schedulers, automatic task-window fencing, rejected-task recovery and gate application remain separate. The Orca plugin still consumes its native lifecycle and does not yet import the shared store.
