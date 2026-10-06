# team-orchestrator 0.5.0 / 0.5.1 / 0.5.2: agreed spec

Source: the spec as agreed with the user in a grilling session on 2026-10-06. Recorded as received, only reflowed into
headings. This file is the input to the map in `map.md`; it is not a build plan and nothing here is built yet.

## 0.5.0 Leaders and safety

**Top leader** (reports to the user) is a pure orchestrator.

- Read-only shell allowlist: git status / log / show / diff / rev-list / rev-parse / ls-files / blame; ls, dir, gci;
  cat, head, tail, wc, gc; grep, rg, sls; sha256sum, Get-FileHash; find without -delete / -exec / -execdir / -ok /
  -okdir / -fprint*; pwd, echo, date without -s.
- Refused: git -c, --output=, rg --pre / --hostname-bin, all `$(...)` and backticks, redirects, here-docs, chains with
  any non-allowed part.
- PowerShell Select-Object / Measure-Object / Sort-Object / Format-* are allowed, but no `{script blocks}`.
- Writes only to: its memory folder; its own session scratchpad (`<TEMP>/claude/<seg>/<own sessionId>/scratchpad`);
  `<project>/.claude/team/**/*.md`; plus project overrides.
- Refuses 8.3 names (`~digit`), trailing dot or space, and `:` streams. Junctions are a documented limit.
- Tools: team-orchestrator, SendMessage / ListAgents, AskUserQuestion, read-only MCP.
- Reads only to review worker output. Only it talks to the user.
- Only the user's typed `#allow-write` unlocks writes (plain words do not).

**Middle lead** (has a boss and reports) is a player-coach under the worker guard.

- Must delegate when its team is idle. Never verifies its own work.
- Grants Level 1 only inside its team's own worktree on this machine; remote, shared or cross-team goes to the top.
- Verification: a different worker in the same team, else the top assigns one from another team, else park.

**Risk levels for all members**

- L0 (auto): own scratch / temp / build output, literal paths, no -f, no globs, no silenced errors. Bad form is
  bounced with "rewrite as a literal path".
- L1: leader `grant_delete(member, exact path)`, one-shot, after a different worker confirms the backup / rollback.
  Also: deploy with rollback, push of reviewed commits.
- L2: user only (secrets, configs, live data, unrecoverable, history rewrite, sending to people, no rollback).
  Parked while the user is away; work continues.

**Hard-blocked for workers until granted:** deletes outside L0 (including inside ssh / scp remote commands, parsed),
`git push --force` / `-f`, `git reset --hard`, `git clean -f`, history rewrite.

- Deploy / send / spend are behaviour rules; spend caps belong to the project, not the plugin.
- Path classes: built-in defaults (`.env*`, `*secret*`, `*.key`, `settings.json`, `.git/`, `~/.ssh`) plus a per-project
  list in `.claude/team-orchestrator.json`.
- `decisions.md` is one register: Needs you / Approved while you were away / History, with a badge for unread items.
- UI: a member with no reports shows "Allow writes" as `[x]` dimmed, "n/a: no reports".
- Rules go into the role briefing and the README (drop "Bash is not guarded").
- Location defaults under `<project>/.claude/team/`, project-overridable.

## 0.5.1 Specialisation and context

- `members/<name>.md` = Profile (at most 40 lines, curated) + Log (at most 60 lines, dated; oldest folded into the
  Profile or dropped). Loaded into the briefing. One small hook re-injects Profile + the last 10 Log lines on session
  start and after compact (no per-turn nag).
- Specialty is assigned first, then grows. A Specialty column in the roster. Routing rule: route to the specialist;
  queue if busy unless urgent; out-of-specialty work needs a one-line reason.
- `handbook.md` (at most 150 lines), curated by the top.
- True context: each session's plugin instance writes its own `$.session.usage()` `{tokens, window, percent}` into the
  shared roster. Automatic "handover + /compact" at a per-model threshold (default 70%, set in Team actions ->
  Context thresholds). Manual "Handover + compact" in each row's Actions menu. Unknown shows "?" and never triggers.
- Onboarding: current members draft their Profile from today's work; the top proposes specialties for user approval.

## 0.5.2 Meeting

- A Meeting dropdown: Start meeting / Meeting settings.
- Agenda: lessons from mistakes; good practices; lost user / agent instructions; progress and replanning; unshared
  research and findings; housekeeping (misplaced files, stale work); misunderstandings and duty changes.
- Defaults: about 25 lines per member, up to 2 reply rounds, the leader may extend once.
- Settings: limits; agenda sections (toggle, reorder, custom); attendees and who may call; outputs.
- Outputs: `meetings/<date>.md`, action items with owners, Profile / Log updates, handbook proposals.
- Callers: the user, the top leader.
- Role changes: the top proposes, the user approves; when unsupervised, the top approves and records it in
  `decisions.md`.
- Members finish their current step, then join.
- The meeting UI needs three design directions for the user to pick before it is built.

A project's own Stop hook (a script the project wires into its settings): unchanged.
