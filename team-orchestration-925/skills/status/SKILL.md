---
name: status
description: Inspect Team Orchestrator configuration, caller approval, native binding and capabilities from Codex. Use for team status and connection diagnosis.
---

# Team status

Read the [shared Team Orchestrator workflow](../team-orchestration-925/SKILL.md) first, resolving its references/helpers from that skill's directory. Use its current host, authority, confirmation and receipt-recovery rules.

Start the **status / diagnose** branch directly; skip the general action menu. Call `shared_team_status` first and use that result before any other team read.

- If `info.storeExists` is `false`, report **Connected · no team created** for the verified project. This is an expected first-use state. Stop here: do not call `shared_team`, `inspectCaller` or `inspectTeam` to rediscover the absent store. Mention `team-orchestration-925:create` as the next available workflow; do not start it automatically.
- If `info.upgradeRequired` is true, report **Connected · workspace update needed** and its store version. Existing approval is unknown until the update, not disproved. Explain the explicit backed-up `shared_team_upgrade` workflow; never upgrade on a status request alone.
- If the store exists but this caller has no approval/binding and no visible teams, report **No teams visible to this conversation**. An empty visibility list does not prove the project contains no teams. Status must not request approval or create another team to discover them.
- Report any visible teams, approval generation, binding or explicit reconnect requirement from the result. Inspect a team through `shared_team` only when a visible team id is available and the user requested its details. Do not guess a team id or make a redundant caller read.

Report actual capability state and `guardTrust` accurately. Native review availability is not approval; `not-attested` means hook enforcement is unverified. Reading status must not create a team, grant approval, mark another member's mail read or imply hook trust. If the status call itself refuses, report that exact condition rather than describing it as an empty workspace.

Report `observation.state` and `lastError` when relevant: `waiting-for-member` needs a verified member connection for member observation, `waiting-for-store` needs explicit creation, and `suspended` needs fresh native verification or reviewed reconnect. An approved controller can process a reviewed launch plan while unbound. The connected MCP client checks every 30 seconds; no observer runs after disconnect. Mailbox notifications do not mean a model turn started or a recipient read the message. Automatic local Codex workers require their own specific native-reviewed plan; controller approval alone never approves a launch.

This entry point is part of the complete plugin and shares its single runtime. If the shared workflow/helper is missing, explain the incomplete installation and use the documented complete package; do not invent a second store or bypass setup.
