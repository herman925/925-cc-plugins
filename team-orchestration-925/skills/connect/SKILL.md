---
name: connect
description: Connect an existing verified Claude or Codex session to a Team Orchestrator member. Use for explicit session binding and reviewed reconnect after resume.
---

# Connect session

Read the [shared Team Orchestrator workflow](../team-orchestration-925/SKILL.md) first, resolving its references/helpers from that skill's directory. Use its current host, authority, confirmation and receipt-recovery rules.

Start the **connect-session** branch directly; skip the general action menu. Inspect the team and use `shared_team_sessions` to offer eligible sessions. Match the configured member CLI and obtain a specific selection before submitting `bindMember` through native management review. Never silently launch or rebind a session.

This entry point is part of the complete plugin and shares its single runtime. If the shared workflow/helper is missing, explain the incomplete installation and use the documented complete package; do not invent a second store or bypass setup.
