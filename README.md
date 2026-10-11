# 925-cc-plugins

Herman's Claude Code mods. One marketplace (`herman-mods`), one folder per mod.

| Mod | What it does | Version |
|---|---|---|
| `speaker-colours` | Speaker colours: a blue bar for your messages, orange for Claude's replies. | 0.1.0 |
| `team-orchestrator` | Runs a team of Claude Code sessions as Orca tabs, managed from a panel above the prompt: quick starts, a team form, a live roster (stacked, side by side or docked) and an org chart. Members start on their first message, close when idle and reopen when a message arrives; each has a role file. A guard keeps members from starting subagents, and members with reports from writing files, unless you allow it. Shows each member's open assumptions (from Session Panel) and lets its boss or team top confirm or mark them wrong. Works on Windows, macOS and Linux (see the mod's README). | 0.5.26 |
| `session-panel` | Hides tool calls and shows a calm step checklist above the prompt, with a Hide details / Show details button (`/simple on\|off`). Adds an Enhancer for your prompt (`/enhance`, or auto-enhance on Enter), an Assumptions list that Claude fills as it works, with Confirm, Wrong, Stop and Redirect, and its version in the band. | 0.3.32 |

## Install

1. Add the marketplace: `claude plugin marketplace add herman925/925-cc-plugins`
2. Install a mod: `claude plugin install team-orchestrator@herman-mods --scope user`
3. Run `/reload-plugins` in a session that is already open.

## Add a mod

1. Make a folder with `.claude-plugin/plugin.json` and `hooks/hooks.json` (and `hooks/register.tsx`).
2. Add it to `.claude-plugin/marketplace.json`.
3. Check it: `claude plugin validate <folder>` and `claude plugin test <folder>`.
