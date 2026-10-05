# team-orchestrator

Builds and manages a team of Claude Code sessions as Orca tabs: a form to start a team, a live roster, an org chart, and a
guard that keeps the heads from writing files themselves and everybody from starting subagents unless Herman says so.

This page explains the two rules that people ask about. Everything else is on the screen.

## Short names in the org chart

Each member has a name (`Hualong PC Console Boss`). The org chart has little room, so it shows a short name instead.

**You decide the short name.** The rule below is only a fallback for members that have none.

### Where to set it

- **Team actions → Sessions → Set short name…** Tick one row of the team, open the box, type, press Save (or Enter).
  An empty name clears it. One row at a time.
- **`team_launch` and `team_adopt`**: each member takes an optional `short`. Adopting a member again keeps the short name
  it already has; an empty `short` clears it.
- **`member_move`** keeps it.

The short name is saved in the roster file next to the member.

### What the chart does with it

- A short name you set is shown **exactly as you typed it**. The chart never changes it. Only when the chart would not fit
  in the width, the long ones are cut with "…" to 14, then 10, then 6 characters. If even that does not fit, the chart
  shows dots only.
- Two members with **the same short name** both show it. The chart adds "!" after each of them and the roster row says
  "short name used twice". Nothing is renamed behind your back. Capital letters do not count: `Lead` and `lead` are the same.
- A member with **no** short name gets one from the rule, drawn dim. Under the chart a line says
  "dim = auto short name; set one in Team actions → Set short name".

### The rule (for members with no short name)

The rule only looks at the letters of the names. It does not know what they mean.

1. Take the name and drop the words it shares with its team name (`Hualong PC Worker A` in team `Hualong` leaves
   `PC Worker A`). Also drop the words that every member of the team starts with.
2. Try these in order and take the first one that no other member already has:
   1. the first word if it is all capitals, and the last word (`PC Boss`);
   2. the first letter and a short tail of numbers or letters (`Worker 5` → `W5`);
   3. the last word (`Workers`);
   4. the first word;
   5. all the words that are left.
3. If members still clash, put the first word of the team in front (`Dev Head`, `UI Head`), then the whole name.

The rule keeps away from every short name you set: if you call the CEO `Workers`, the member it would have called
`Workers` takes the next try.

### Hualong

| Name | What the rule gives | What Herman sets |
|---|---|---|
| Hualong CEO | CEO | CEO |
| Hualong Workers | Workers | Workers |
| Hualong Worker 5 | W5 | W5 |
| Hualong PC Console Boss | PC Boss | Boss |
| Hualong PC Worker A | PC A | WA |
| Hualong PC Worker B | PC B | WB |

The last two columns differ on three rows. The rule cannot know that `PC Console Boss` is "the boss" and that
`PC Worker A` is "worker A": set those three by hand.

### An example the rule does not understand

`HK University of Hong Kong president` should be `HK president`. The rule does not know that. What it gives depends on
the words around it:

- in a team that is also called `HK` it drops the shared word `HK` and gives `president`;
- in a team with another name it takes the first word (all capitals) and the last word and gives `HK president`, by luck.

If the short name matters, set it.

## The guard: no subagents, and heads do not write

A hook watches the tools of every session that is **on the roster**. A session that is not on the roster is never touched.
The plugin knows which member a session is by its **session id**, and if that fails by **its name** (the title in its transcript).

| Tool | Who is refused | Unless |
|---|---|---|
| `Agent` (a subagent) | every roster member | allowed (below) |
| `Write`, `Edit`, `NotebookEdit` | a member with reports (somebody has it as boss), the CEO included | allowed (below), or the file is in its own memory folder `~/.claude/projects/<project>/memory/…` |

The refusal says who is refused and tells the model to hand the work to a worker with `SendMessage`, or to ask Herman.
Each refusal, and each time a permission lets a call through, leaves one line in a toast, for example
`blocked Agent: Hualong CEO has no subagent permission`.

A subagent runs inside its session, so a refusal for the session covers its subagents too.

### How Herman allows something

1. **Standing:** Settings → Permissions. Each member has **Allow subagents** and **Allow writes**, both off. They are kept
   in the roster file, which the guard reads again on every call, so a change counts at once in every session of the project.
2. **One turn:** type a keyword in your own message.
   - `#allow-subagent` lets the Agent tool through for that turn.
   - `#allow-write` lets Write, Edit and NotebookEdit through for that turn.

   The words count only in a prompt **you typed at the terminal** (the engine's `composer` origin). The same words in a
   message from another session, in a tool result, or in a prompt that another plugin submitted allow nothing. A later prompt
   of yours without the words takes the grant back, and the grant also ends when the turn ends.

### Known limits

- **Bash is not guarded.** A head can still change files with a shell command. This is on purpose for now.
- The engine hands the hook the whole prompt text, so a keyword you **paste** into your own prompt counts like one you type.
- A prompt you type while a turn is running applies at once to the turn that is running.
- The one-turn grant lives in the session's memory: a reload of the plugin (`/reload-plugins`) forgets it.
- A session that is on the roster but whose id and name the plugin cannot match (no transcript yet) is treated as not on the roster.
