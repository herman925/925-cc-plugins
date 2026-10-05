# 925-cc-plugins

Herman's Claude Code mods. One marketplace (`herman-mods`), one folder per mod.

| Mod | What it does | Version |
|---|---|---|
| `speaker-colours` | Speaker colours: a blue bar for your messages, orange for Claude's replies. | 0.1.0 |
| `team-orchestrator` | Builds and manages a team of Claude Code sessions as Orca tabs. Welcome screen with quick starts (Squad, All-Purpose Team, Tech Team), a table-style team form, a live roster (move, remove, add, settings for layout and columns) and an animated org chart whose dots follow each session's status. Short names for the chart are set by the person. A guard keeps roster members from starting subagents, and heads from writing files, unless the person allows it (see the mod's README). | 0.4.3 |

## Install

1. Add the marketplace: `claude plugin marketplace add herman925/925-cc-plugins`
2. Install a mod: `claude plugin install team-orchestrator@herman-mods --scope user`
3. Run `/reload-plugins` in a session that is already open.

## Add a mod

1. Make a folder with `.claude-plugin/plugin.json` and `hooks/hooks.json` (and `hooks/register.tsx`).
2. Add it to `.claude-plugin/marketplace.json`.
3. Check it: `claude plugin validate <folder>` and `claude plugin test <folder>`.
