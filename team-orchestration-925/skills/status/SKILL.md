---
name: status
description: Inspect Team Orchestrator configuration, caller approval, native binding and capabilities from Codex. Use for team status and connection diagnosis.
---

# Team status

Read the [shared Team Orchestrator workflow](../team-orchestration-925/SKILL.md) first, resolving its references/helpers from that skill's directory. Use its current host, authority, confirmation and receipt-recovery rules.

Start the **status / diagnose** branch directly; skip the general action menu. Inspect `shared_team_status` and the selected team through the shared API. Report actual approval, binding and capability state. Reading status must not create a team, grant approval, mark another member's mail read or imply hook trust.

This entry point is part of the complete plugin and shares its single runtime. If the shared workflow/helper is missing, explain the incomplete installation and use the documented complete package; do not invent a second store or bypass setup.
