# Schema 9: native-reviewed Codex worker plans

Release pair: **Mod 0.5.58 / team-orchestration-925 0.1.8**. This is a shared-runtime/CLI increment hosted by Orca, not an Orca plugin panel or an independent host. No active Claude session or Mod process is required for the Codex workflow.

## Accepted approval scope

On 2026-11-06 Herman selected **approve one specific launch plan**. Its listed workers may start automatically as capacity opens. The approval is not a standing team permission and does not approve future workers. Member/role changes require a fresh native review. Controller approval, draft interviews and model-provided arguments do not approve a launch.

`shared_team_launch` presents that form and commits `approveLaunchPlan` through a private API factory callback. Its exact operation ID/request can be reconciled after a lost reply without another approval or a duplicate reservation. New controllers cannot claim another controller's reservations. Revoked approvals cannot claim new starts.

Only active, unbound local Codex workers at the controller's exact project/machine/context are eligible. Current worker, official-role and advisory-note generations are recorded. The native review includes the selected workers' actual roles, model/effort and standing switches. A re-reviewed queued reservation keeps its launch identity; an already claimed/bound start cannot be replaced by another plan.

## Durable startup sequence

1. Commit the reviewed plan and all selected queued reservations atomically. No native process starts during review.
2. Win a fresh conditional queued-to-claimed transition. Bindings and uncertain starts consume the shared machine/team capacity. A full team queues; no session is evicted or auto-closed. Connecting a queued worker prevents its old launch, and a competing connection to a claimed worker is refused.
3. Write a private startup profile outside the project, pinning the project UUID, launch, member and selected engine. PostgreSQL workers carry the same explicit database selection and driver location; they never fall back to SQLite. Create an **empty** native terminal without switching focus. Verify its local project/context/incarnation against the native host receipt. A creation result that names an existing terminal is refused.
4. Commit that exact terminal target. Only the adapter's own native creation receipt can pass the private verifier. No model-facing operation accepts target proof, SQL or shell commands.
5. Attempt the safely quoted fixed Codex bootstrap command once. It preserves ordinary native user settings and inherits the configured hook. `--no-daemon` keeps this terminal's native process/environment for identity verification. The MCP executable/runtime scope is fixed by the trusted launcher. A terminal-input receipt means input acceptance, not a confirmed model turn.
6. Before the child's first adapter operation or permission-hook decision, verify its real native Codex parent, thread-writer lock and Orca identity. Match its pinned store/member and reserved terminal, then self-bind. Missing or mismatched store/target stays denied; it cannot take the ordinary unbound-session allowance. Invalid startup configuration keeps an MCP diagnostic server registered so its hook still returns a valid deny. A changed bound-worker incarnation requires reviewed reconnect. Codex's conversation ID is assigned by Codex; none is invented or substituted by a reservation UUID. The child must inspect its official role, read its own inbox and verify an admitted assignment before task work.

The connected observer processes only existing reviewed plans, including for an approved controller that is not a bound member. It retries queued capacity checks every 30 seconds, not external starts. Claude's existing launch pump skips Codex reservations; both clients share the same capacity/state rules. `inspectConfiguration` exposes plan history, launch states and recorded targets.

## Schema and transition guards

`launch_plans` records immutable approval scope and review data. `launch_plan_members` records the reviewed member/role generations, and `launch_targets` records immutable native terminal identity. Update/delete/replacement guards protect those rows on SQLite and PostgreSQL. Approval timestamps are safe integers and ordered uniquely so the latest explicit review of a queued reservation is unambiguous.

`member_launches.conversation_id` can be NULL while Codex is queued/claimed. Its only change is NULL to the actual verified conversation in the claimed-to-bound transition. Existing Claude reservations keep their preallocated native conversation IDs. A bound row requires a conversation, transitions remain generation-checked, and old identities cannot be rewritten.

## Explicit upgrade and recovery

Existing schema 5/6/7/8 stores require an explicit backed-up update to 9. Normal opening, status and installation never migrate data. Codex has `shared_team_upgrade`; the Mod retains its scoped native Update workspace action. A lost upgrade reply reconciles the same migration ID. Backups preserve the full prior schema/data, including existing Claude launch IDs and meeting history. Old-schema guards remain read-only until update. Other clients must update before ordinary API use against schema 9.

After an uncertain claim or any uncertain native effect, keep the claimed slot. Do not repeat creation or startup, invent a terminal match from its title, or silently free capacity. A target commit with a lost response may leave an empty terminal; a lost input response may already have started the child. Inspect authoritative state and the native terminal. Automatic repair/restart/replacement of claimed or uncertain starts remains outside this increment.

## Packaging and diagnostics

The project MCP configuration now points to an immutable private runtime snapshot under the machine's owned installation directory. Removing a plugin cache cannot delete that configured runtime. Setup preserves native per-tool approval settings, refuses changed snapshots, retains old snapshots and keeps private recovery backups. Applying a new snapshot requires reconnecting; it never grants hook trust or upgrades a database.

Hook failures stay denied and report curated API/store diagnostics. Windows process/thread inspection failures are classified without echoing commands or environment data. Observer status retains `lastFailure` across a fresh activation so that retry does not erase the last diagnostic. Temporary configuration/probe subprocesses do not inherit the acting Orca conversation identity. The observed intermittent native refusal in the old running client is not claimed fixed merely by these changes. Real model-turn, installed positive hook enforcement, mixed-task/meeting and whole-Orca restart acceptance remain separate from fixture and zero-model tests.

See [validation](VALIDATION-CODEX-LAUNCH.md) for current measured results and limits.
