# session-panel

Session Panel hides tool calls, diffs and command output while Claude works, and shows a calm step checklist above the prompt, with a Hide details / Show details button. Made for people who do not read code.

- Claude plans the job with `plan_steps`, reports progress with `report_progress`, and asks questions with `ask_choices` (numbered choices in the band).
- Until a plan exists, other tools are refused for the main agent (subagents are never gated). If the gate hook ever fails, tools are allowed through.
- `/simple on|off` (or the button) toggles it. The setting is kept between sessions. It starts on.
- `NO_COLOR` is honoured. `NO_MOTION`, `REDUCE_MOTION` or `PREFERS_REDUCED_MOTION` gives a static meter.

## Assumptions file (for other tools)

Each session keeps its assumptions list in one file, written on every change and read back when the session starts:

`<project root>/.claude/session-panel/assumptions/<session id>.json`

- The file name is the session id. The plugin cannot read the `/rename` title, so the title is not used.
- The folder has a `.gitignore` with `*`, so git ignores it. The project's own `.gitignore` is not changed.
- Shape: `{ "version": 1, "member": "<session id>", "sessionId": "<session id>", "entries": [...] }`. `member` holds the session id until the plugin can read a member name.
- Each entry: `{ id, text, turn, kind: "declared" | "flagged", path?, status: "open" | "confirmed" | "wrong", at, resolvedAt? }`. `flagged` entries have a `path` and text `edited <path> with no stated assumption`.
- A session writes only its own file. If the plain file belongs to another session, this one writes `<session id>-<tag>.json`.

### Status lines from the team head

A status line sets an entry's status without a model turn: `SESSION-PANEL: confirm <id>` or `SESSION-PANEL: wrong <id>`, alone on its own line.

- Typed by the user: accepted.
- Inside a cross-session message: accepted only when `from-name` is this member's boss or the team top, read from `.claude/team-orchestrator/roster.json` (read only). Any other sender, or an unreadable roster, is refused with a note.
- `wrong` also fills the box with the Redirect text. Nothing is submitted.
- If the message has other text, the status is applied and the message goes on to the model. If it is only status lines, the message is dropped.
- An unknown id, or an entry already resolved, changes nothing and says why.

Check it: `claude plugin validate session-panel` and `claude plugin test session-panel`.
