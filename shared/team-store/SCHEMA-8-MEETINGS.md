# Durable meetings — schema 8 / Mod 0.5.55

Meetings use the same project store, API authorization, writer lease and operation receipts as tasks. They work with SQLite and explicitly configured PostgreSQL. No Orca plugin installation or separate meeting engine is involved.

The native Mod workspace has a Meetings page, with Agenda, Discussion and Outputs tabs. The top head reviews an attendee/agenda draft before sending invitations. Creation requires an explicit `joined` or `all` start rule; no project default has been inferred from the unanswered product question. Each topic has its own required participants. Defaults are 25 lines per member across the meeting and two contribution rounds per participant/topic; the chair may add one round once. The creation panel and API can explicitly configure the initial limits within the bounded contract.

Only an invited, currently bound member can inspect or participate. Each member records its own safe checkpoint and joins or declines; no head operation can respond on its behalf. Joining does not stop or reassign its task. With `all`, every invitee must join before starting; a declined invitation keeps that policy waiting and the chair may cancel. With `joined`, the chair can start after joining; late invitees can join while the meeting remains open.

Contributions are immutable and attributed to the authenticated member. The chair can complete a topic only after its required members contribute, or explicitly defer it with a reason. Topic decisions and reviewed output contents cannot be overwritten or deleted. Generations and the shared transaction lock fence concurrent changes. A stale operation refreshes before trying a new operation id; an uncertain result reconciles the original id and exact request.

Minutes, owned actions, profile/handbook and role proposals are durable meeting outputs. The chair reviews each proposal separately. Acceptance records a meeting decision; it does **not** create an assignment, edit official instructions or grant any permission. Follow-up execution uses the normal task/configuration/approval APIs. Closing requires every topic to be discussed or deferred and at least one accepted minutes record. Cancellation retains the record, including unfinished topics and proposals.

Notifications are durable per recipient/generation, with only the latest pointer presented. Previewing and reserving a wake do not mark them read. Only the addressed member acknowledges them; a member's own subsequent meeting action also clears its own older pointers. Older pointers never return after the latest is acknowledged. Existing replay reservations rate-limit wake attempts. An unavailable target stays queued; a wake never counts as joining, reading, contributing or accepting work.

`inspectMeeting` returns the durable agenda, participants, transcript and outputs after a restart. `inspectTeam` lists only meetings to which the current member is invited. Controller approval by itself grants roster access, not meeting transcripts.

## Updating an existing store

The native **Update workspace** action explicitly upgrades schemas 5, 6 or 7 to 8 after writing a complete private backup and checking the store did not change during backup. A normal open never upgrades. Frozen contracts remain available for read-only guards. Old runtime writers refuse schema 8 rather than modifying it. Earlier JSON/Orca-plugin migration and versions 1–4 are outside this update.

## Validation boundary

See [three-pass validation](VALIDATION-NATIVE-MEETINGS.md). Automated tests exercise actual SQLite and PostgreSQL transactions, restart recovery, two-client contention and the native Mod controls. This is implementation validation, not a claim that a live mixed-model meeting or a whole-Orca restart has been accepted.
