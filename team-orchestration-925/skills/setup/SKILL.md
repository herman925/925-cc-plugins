---
name: setup
description: Set up or repair the project-local Team Orchestrator MCP connection for Codex. Use for preview, installation updates, interrupted setup recovery or removal.
---

# Setup team connection

Read the [shared Team Orchestrator workflow](../team-orchestration-925/SKILL.md) first, resolving its references/helpers from that skill's directory. Use its current host, authority, confirmation and receipt-recovery rules.

Start the **setup / diagnose** branch directly; skip the general action menu. Read [setup and diagnosis](../team-orchestration-925/references/setup.md). Resolve its helper at `../team-orchestration-925/scripts/setup.mjs` relative to this skill. Preview the requested project-local change, preserve owned recovery records and follow the requested setup/update/remove/recover workflow. Reconnect and native hook review remain explicit host steps.

This entry point is part of the complete plugin and shares its single runtime. If the shared workflow/helper is missing, explain the incomplete installation and use the documented complete package; do not invent a second store or bypass setup.
