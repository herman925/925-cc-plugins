# Optional managed lead for a new team

Inspect native status first. Offer this mode only when `actions.managedLead.launchProviders` includes the selected head CLI. This is an explicit alternative during **new team creation**; never convert, move, resume or replace an existing conversation to provide it.

Explain the choice through the native question interface: keep the current conversation as lead, or create a separate dispatcher-owned lead. The latter makes both head and worker inbox input possible without a terminal watcher in each session. The current conversation stays a viewer/controller. It does not become a second task head.

If the client's ordinary question tool is unavailable, `shared_team_interview` with `step: "lead"` provides the native multiple-choice draft. Only an actual selection of “Create a separate managed lead” adds `managedLead: true`; a pending or cancelled form adds nothing.

Use `createFreshTeam` with `managedLead: true`, the selected Claude/Codex top member, and the reviewed purpose/official role. The ordinary native creation confirmation shows the choice and its limitations. Creation does not start a process. A separate `shared_team_launch` review lists the exact head/workers and the owned execution route, including when the viewer runs in Orca. Claude requires its optional component first.

The lead receives the four coordination tools plus `shared_team_manage`, `shared_team_launch`, `shared_team_sessions`, `shared_team_worker_review` and `shared_team_interview`. Extra tools can **request** real native review. They confer no controller approval, file writes, subagents or sandbox change. The current project execution settings remain in force.

After a normal reviewed launch the lead must verify native binding, official role and the exact readiness receipt. It can then coordinate the reviewed purpose through current assignments and separate head acceptance. Its initial management approval, if needed, is a new native proposal scoped to that lead's own conversation.

As the approving controller, inspect that exact lead's pending request through `shared_team_worker_review`. Review opens the complete original proposal in the person's native interface. Tool arguments never carry an answer. Preserve its launch, request and operation IDs and reconcile uncertain submissions. This viewing path neither impersonates the lead nor transfers your approval. Worker questions still travel through the approved top lead; the controller viewer cannot directly clear worker questions.

The lead's own controller request can be pending while it is already bound and Ready. Do not describe it as approved, answer it yourself, close it on a timeout or start another lead. Existing external leads remain on their current route. Human consent and full mixed-team acceptance must be reported separately from disposable native fixtures.
