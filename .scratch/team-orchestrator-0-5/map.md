## Destination

A build-ready spec for team-orchestrator 0.5.0 (leaders and safety), 0.5.1 (specialisation and true context) and 0.5.2
(meeting): every open design decision settled, so that implementation tickets can be cut from it. The agreed text so far
is in [spec.md](spec.md). Nothing is built until this map clears.

## Notes

- Domain: the Claude Code plugin ("mod") in `team-orchestrator/`; sessions are Orca tabs; the roster, the guard hook and
  the role briefing are the parts touched. Read `team-orchestrator/README.md` and `team-orchestrator/types/index.d.ts`.
- Plan, don't do: no code changes while this map is open. Any ticket that reads "build the X" is mis-typed.
- Known facts a ticket may rely on (measured 2026-10-06): the plugin runs inside every
  member's session, and `$.session.usage()` returns that session's own `{tokens, window, percent}` (types file, line
  2778); a transcript's model id never carries `[1m]`, so the transcript cannot tell a 200k window from a 1M one.
- Skills for tickets: `/grilling` and `/domain-modeling` (default), `/prototype` for the meeting UI, `/research` for
  API facts. If the project building this requires a UI direction review before drafting, the meeting UI needs it.
- Standing preferences: the user decides role changes and anything L2; a project's own Stop hook stays
  unchanged; spend caps belong to the project, not the plugin.
- Charting provenance: the spec was decided in a grilling session with the user on 2026-10-06 (about 46 questions, all
  answered one at a time). The map was written from the result of that session, so the open tickets and the remaining
  fog are a reading of what it did not settle, for the user to correct. This repo has no tracker configured, so the map follows wayfinder's local-markdown fallback
  (`.scratch/<effort>/map.md` plus `issues/NN-slug.md`). Wayfinder's own docs warn that markdown planning files in a repo
  can be kept by accident; the effort's files are kept only as long as the effort needs them.

## Decisions so far

<!-- Decided in the 2026-10-06 grilling session with the user; the detail lives in spec.md, not restated here. -->

- [Release numbering](spec.md) — three releases: 0.5.0 leaders and safety, 0.5.1 specialisation and context, 0.5.2 meeting.
- [Top and middle leader roles](spec.md#050-leaders-and-safety) — the top leader (reports to the user) is a pure
  orchestrator on a read-only allowlist; a middle lead is a player-coach under the worker guard and must delegate when idle.
- [Verification chain](spec.md#050-leaders-and-safety) — a different worker in the same team, else the top assigns one from
  another team, else park; a lead never verifies its own work.
- [User contact](spec.md#050-leaders-and-safety) — only the top leader talks to the user.
- [Unlocking writes](spec.md#050-leaders-and-safety) — only the user's typed `#allow-write`; plain words do not.
- [Risk levels and parking](spec.md#050-leaders-and-safety) — L0 auto, L1 leader grant after a different worker confirms
  the rollback, L2 user only and parked while the user is away, with work continuing.
- [Hard-block list](spec.md#050-leaders-and-safety) — out-of-L0 deletes (including inside ssh / scp), force push,
  `reset --hard`, `clean -f` and history rewrite are blocked for workers until granted.
- [Path classes](spec.md#050-leaders-and-safety) — built-in defaults plus a per-project list.
- [decisions.md](spec.md#050-leaders-and-safety) — one register with three sections (Needs you / Approved while you were
  away / History) and an unread badge.
- [Member notes and handbook sizes](spec.md#051-specialisation-and-context) — Profile at most 40 lines plus Log at most 60;
  handbook at most 150.
- [True context](spec.md#051-specialisation-and-context) — each session's plugin reads its own `$.session.usage()`;
  automatic handover + compact at a per-model threshold (default 70%); a manual button in each row's Actions menu;
  unknown shows "?" and never triggers.
- [Meeting rules](spec.md#052-meeting) — agenda, default limits, settings groups, callers, and the approval rule for
  role changes.
- [Onboarding](spec.md#051-specialisation-and-context) — current members draft their Profile from today's work; the top
  proposes specialties for the user to approve.

## Not yet specified

<!-- Only what the grilling session did not settle. -->

- The detail of the `.claude/team-orchestrator.json` schema (path-class entries, project overrides, locations).
- Specialty routing mechanics: how "busy" and "urgent" are decided, and the shape of the one-line reason.
- Meeting output formats: the action-item shape, and how Profile / Log updates and handbook proposals are reviewed.
- The `decisions.md` unread badge: who marks an item read, and where that is stored.
- Migration: what happens to existing rosters, briefings and members when 0.5 loads.
- Test plan for 0.5.0: one runnable check per guard rule. How far the guard can enforce each rule depends on
  [Which tool-call details can the guard see](issues/02-guard-hook-visibility.md).

## Out of scope

- Spend caps and spend rules: they belong to each project, not the plugin (per the spec).
- Changes to a project's own Stop hook: the spec says unchanged.
- Writing any plugin code, version bumps or releases: this map ends at a spec, and `to-spec` / `to-tickets` take over.
