# 925-cc-plugins

Herman's Claude Code mods. One marketplace (`herman-mods`), one folder per mod, plus one Orca plugin.

## Claude Code mods

| Mod | What it does | Version |
|---|---|---|
| [`session-panel`](session-panel/README.md) | Hides tool calls and shows a calm step checklist above the prompt, with a Hide details / Show details button (`/simple on\|off`). Has a prompt Enhancer (`/enhance`, or auto-enhance on Enter), and an Assumptions list that Claude fills as it works, with Confirm, Wrong and Delete. A question box rule, on by default, has Claude ask for permission and big choices with AskUserQuestion instead of in prose, including every `/grilling`, `/grill-me` and `/grill-with-docs` question, with an optional warning when it asks in prose. Settings is a floating card with tabs, laid out as a table. | 0.3.63 |
| [`team-orchestrator`](team-orchestrator/README.md) | Runs a team of Claude Code sessions as Orca tabs, managed from a panel above the prompt: quick starts, a team form, a live roster (stacked, side by side or docked) and an org chart. Members start on their first message, close when idle and reopen when a message arrives; each has a role file. Members can be added to a running team. A guard keeps members from starting subagents, and members with reports from writing files, unless you allow it. With Session Panel, it shows each member's open assumptions and lets its boss or the team top confirm, mark wrong or delete them (opt-in: Settings → Assumptions → Show). Works on Windows, macOS and Linux. | 0.5.37 |
| [`speaker-colours`](speaker-colours) | Speaker colours: a blue bar for your messages, orange for Claude's replies. | 0.1.0 |

### Install

1. Add the marketplace: `claude plugin marketplace add herman925/925-cc-plugins`
2. Install a mod: `claude plugin install team-orchestrator@herman-mods --scope user`
3. Run `/reload-plugins` in a session that is already open.

To update: `claude plugin marketplace update herman-mods`, then `claude plugin update <mod>@herman-mods`, then `/reload-plugins`. For Team Orchestrator, reload the team top first (see its README).

### Add a mod

1. Make a folder with `.claude-plugin/plugin.json` and `hooks/hooks.json` (and `hooks/register.tsx`).
2. Add it to `.claude-plugin/marketplace.json`.
3. Check it: `claude plugin validate <folder>` and `claude plugin test <folder>`.

## Orca plugin

[Team Orchestrator for Orca](team-orchestrator-orca-plugin/README.md) (0.1.06) lives in `team-orchestrator-orca-plugin/`. It brings Team Orchestrator's team creation into Orca's own plugin panel: quick starts and custom hierarchies, an organisation tree, the roster and member details. It bundles a local Node worker and an automatic in-memory runtime adapter that launch, name and brief Codex or Claude Code sessions on the selected workspace's host, with no separate helper to install and no Orca source patch. Injection depends on the installed Orca build passing its compatibility checks; its README explains native-worker consent, lazy startup, connection checks and the verified limits.

It is installed in Orca (Settings → Plugins), not from the marketplace above, and it keeps its teams in Orca's plugin storage, separate from the Claude Code mod's team files. It supports native task dispatch with on-demand member starts, hierarchical manager Runs, verified messages and user questions, recovery, and supervisor review followed by user acceptance of the total result. The panel tracks saved evidence and unknown outcomes; installed-provider and remote-host acceptance remain separate validation steps.
