# Worker runtime access and readiness

Status: **scope accepted, implementation in progress, 2026-11-06**. Herman selected A: one native launch review includes the listed workers and their team-tool access. This design choice is not a live permission grant; actual access still requires the concrete native review.

## Problem measured in the live acceptance

Codex 0.1.9 successfully reviewed a worker launch plan, created one native worker conversation and bound it through the recorded terminal. The head then admitted a task while the worker was still establishing access to its team tools. The worker reached a native MCP consent prompt. After a Full Access selection, its native runtime reported `approval policy is never` and rejected `shared_inbox_seen`. The pickup deadline expired and correctly returned the assignment before task work.

The launch and binding are real successes. Task execution and separate head acceptance are not established. Binding proves identity; it does not prove usable tools. The permission-mode workaround proposed during the test is superseded by this design work.

## Intended product flow

```text
Create/edit team
      |
Review workers and team-tool access
      |
Queued for capacity -> Starting -> Connected / checking team tools
                                          |
                              +-----------+-----------+
                              |                       |
                            Ready             Setup needs attention
                              |                       |
                        Admit task             Explain the blocker
                              |                Keep the same worker
                       Start pickup clock      No task clock yet
```

The review must describe the real effect in ordinary language: the selected worker may use Team Orchestrator's inbox, tasks and meetings within its assigned role. It does not receive controller approval, permission to manage the team, another member's identity, shell/filesystem grants or subagent grants. Worker outcomes and head acceptance remain separate.

The UI shows **Queued**, **Starting**, **Checking team tools**, **Ready**, or **Setup needs attention**, plus a compact reason/action when blocked. Identity/binding remains independently inspectable. No hidden menu or manual permission-preset discovery is a prerequisite for normal team creation.

## Accepted authorization scope

Herman selected A through the native multiple-choice design question:

**A — specific reviewed launch plan (recommended).** The launch review includes the exact worker tool-access bundle. Its durable approval applies only to the listed workers and their verified execution homes. New workers, a wider tool bundle, or a different runtime scope need another review. This follows the already selected one-plan launch policy.

The alternative of granting a standing project-wide worker-tool policy was not selected. Remembering shared workspace mode does not grant worker tool access.

Neither choice is an instruction to change a current permission mode. Draft answers settle product design; actual access changes still use a concrete native review.

## Durable access contract

- Record the reviewed bundle/version and scope in authoritative shared state. An immutable approval record must distinguish old process-only launch approvals from approvals that include team-tool access. Existing approval receipts never acquire new meaning retroactively.
- Fix the bundle in trusted client code. Candidate model-facing tools are `shared_team_status`, `shared_inbox_read`, `shared_inbox_seen`, and `shared_team`. The shared API continues to enforce the actual member's role, task ownership, generations and head/controller boundaries for every command. Native management, launch and workspace-upgrade tools are outside the worker bundle.
- Configure only the named Team Orchestrator server/tools, after the corresponding native review. Keep unrelated servers, the person's filesystem/sandbox selection, exec policy and subagent rules intact. Do not use a global Full Access/never toggle as the worker integration strategy.
- Use Codex's supported per-server/per-tool approval settings rather than relabeling mutable tools as read-only or bypassing native review. The [official configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) exposes MCP tool policies separately from the global approval policy. Verify the exact behavior on the installed native CLI as well as in fixtures.
- Preserve the approved access profile on verified same-conversation resume. A wider scope or changed execution/binding invalidates readiness and requires the appropriate reviewed reconnect/setup. Neither a restart nor a cached receipt grants new access.
- Existing running workers need an explicit adoption path. Do not close, replace, relaunch or silently change the permissions of the live acceptance worker to make a test pass. Claimed/uncertain startup effects are still never replayed.

## Readiness contract

Readiness is separate from launch/binding. Tie it to the current member, binding generation, verified native execution, reviewed access bundle and current store. A stale connection cannot mark a successor ready or clear its state on shutdown.

Before a launched worker is eligible for assignment, require an end-to-end bootstrap handshake through the actual model-facing tools. Include successful status/team inspection, own inbox read, and confirmation of a dedicated bootstrap receipt. The bootstrap is a control notification, not an assignment: it creates no task result or pickup/task deadline. Only the worker confirms its own receipt. A head inspecting it cannot stand in for the worker.

The exact persistent records and native attestation must be specified before coding. A claimed capability, model-supplied `ready: true`, terminal-input acceptance, or a binding row alone is insufficient. Any readiness lease/epoch must state what it proves and its limits; later native permission changes can still block an operation and must be surfaced rather than hidden by a permanent ready flag.

Enforce readiness in the common admission transaction for the covered workers on **both SQLite and PostgreSQL**. Refuse `admitAssignment` (and retry to an unready target) before inserting task/assignment/delivery rows or starting a pickup clock. Keep an unready worker connected and consuming its normal capacity; do not evict or duplicate it. Head-side queued intent is distinct from an admitted assignment.

## Existing acceptance state

The real project is schema 9. The Codex head is connected, the Codex worker is connected through one reviewed launch, and the Claude acceptance member remains unbound. The original task has returned for `pickup_expired`; no result was accepted. Preserve its history. A subsequent task attempt can begin only after the access/readiness design is implemented, reviewed and verified; never rewrite the expired attempt to hide the setup delay.

## Implementation and acceptance slices

1. Settle A/B and specify the versioned consent, bootstrap and readiness records/API, compatibility and explicit backed-up migration if required.
2. Implement native review/readback and scoped Codex configuration, including cancellation, old-plan refusal, changed-policy refusal and resume behavior. Test the installed native CLI; do not infer approval semantics from the setting's name.
3. Implement bootstrap and common transactional admission/retry gates. Test recipient-only confirmation, stale execution/binding, missing tools, shutdown races, blocked setup, no premature deadline, and capacity preservation on both engines.
4. Expose readiness and a normal setup/adoption action in Codex status/skills and the Mod workspace. Do not require the user to learn MCP internals to create a team.
5. Run at least three passes, then one real reviewed worker through bootstrap, task pickup, explicit outcome, refused self-acceptance and separate head acceptance. Test Full Access with the explicitly reviewed team-tool policy, so the exact observed failure is covered. Report installed hook enforcement separately from API/readiness tests.

The independent-host and Hermes routes remain roadmap options. This change continues to use the Orca-hosted shared runtime; it is not a new Orca plugin or a second team store.

## Implementation checkpoint

The accepted plan-scoped policy and preliminary schema/readiness code are preserved on `feat/worker-runtime-readiness`; they are not released or applied to the real schema-9 project. The first launch-policy behavior tests passed after failing on the previous launcher.

Implementation then hit a separate live guard defect: public regression-test edits were rejected based on identifiers or mock data in their contents, even with the head's explicitly approved standing write setting. The public-source guard repair is an isolated prerequisite, with its own negative/external-path tests and normal versioned update. It does not grant the live worker new tool access or hot-patch an installed runtime. The readiness work resumes after that repaired guard is loaded.

The live worker is idle after reporting no task work. Its failed acknowledgement and expired assignment are retained. Its repeated incomplete `askQuestion` calls also exposed a usability gap: operation-specific required arguments and a setup-blocker status path must be explicit. Include that in the readiness workflow so reporting a setup problem does not require inventing an active task endpoint or repeatedly guessing API fields.
