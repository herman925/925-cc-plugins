---
name: launch
description: Review one specific plan to launch unconnected local Codex workers, now or when team capacity becomes available. Use for starting team workers without replacing existing sessions.
---

# Launch workers

Read the [shared Team Orchestrator workflow](../team-orchestration-925/SKILL.md), then [launch plans](../team-orchestration-925/references/launch.md), resolving their references from that skill's directory.

Start the **launch-workers** branch directly. Inspect native status and the selected team's configuration. Gather which eligible Codex workers to start, show their actual roles/settings, and submit one exact plan through `shared_team_launch`. Draft choices and controller approval do not approve a launch. The native confirmation approves only the listed workers; a queued worker can start later without another click while its reviewed member/role generations remain valid.

Preserve the exact plan request and operation ID after uncertainty and reconcile first. A claimed or uncertain start retains capacity and is never automatically retried, replaced or closed. Report native input acceptance separately from verified binding or a model turn. This entry point uses the complete plugin's single shared runtime.
