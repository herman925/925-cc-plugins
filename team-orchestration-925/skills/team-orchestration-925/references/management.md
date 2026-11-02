# Team management

The shared API enforces controller, project, binding and generation authority. `shared_team_manage` handles native confirmation for `approveController`, `createFreshTeam`, `editTeam` and `bindMember`; ordinary `shared_team` refuses these Codex management effects. Do not put approval flags, actors, database paths or shell commands into tool arguments.

## Create

1. Read `shared_team_status`. Establish purpose, team name, the top member, direct reporting lines and CLI for each member. Prefer a small composition matching the user's work, not an arbitrary large template. Offer an interactive interview or direct draft editing. When native question tools are unavailable, `shared_team_interview` supplies fixed action/team/member/change forms; pass distinct current draft boss names for the member form.
2. Every member needs a stable new ID, unique name, role label, official instructions and `cli: codex|claude`. Order bosses before reports and use exactly one top member (`bossMemberId: null`). Include guidance in the top's instructions to use native interactive questions, relay worker questions, and await actual answers. Workers read official role/task evidence before work and report explicit outcomes; their admitting head accepts separately.
3. Propose concrete settings for review. Existing Mod defaults: autoClose false, idleMinutes 10, reopen resume, maxOpen 8, launch demand, batch 1, autoScratch false, assumptions false, scratchDir `.claude/scratch`, pickupWindowMinutes 2, answerWindowMinutes 3, taskWindowMinutes null, replayIntervalMs 1000, exemptMemberIds []. Explain capacity queues rather than evicts, and the answer window starts on recipient read. User changes override these draft defaults.
4. Show composition/settings, then call `shared_team_manage` with `{operationId,command:{type:'createFreshTeam',teamId,name,functionText,settings,members,expectedControllerGeneration}}`. Use status's approval generation, or 1 for a new approval. A revoked controller cannot silently be resurrected. The native review includes conversation management approval when needed; the user must explicitly confirm the exact proposal.
5. Read back the stored result. Use session discovery/binding to connect eligible existing sessions, including this Codex conversation as head if selected. No session is silently started or attached.

## Edit

Inspect caller/team and current config/member generations. `editTeam` requires teamId, expectedControllerGeneration, expectedConfigVersion and a `changes` array. Supported change shapes:

- `{type:'updateTeam',name,functionText}`.
- `{type:'saveSettings',settings}` with the full explicit settings object.
- `{type:'addMember',memberId,name,bossMemberId,role,officialText,cli}`; the boss must already exist or be added earlier in the same batch. New members have no session binding and no write/subagent grants.
- `{type:'updateMember',memberId,expectedMemberGeneration,patch}`. Patch fields: name, role, officialText, advisoryNotes, model, effort, allowWrite, allowAgent. Permission switches and official roles are shown in the native confirmation. Role changes during unfinished assignments are refused. Model/effort changes for a connected member require a separate execution-change flow.

Present a concrete before/after preview. Submit through `shared_team_manage`, then read back the resulting state. Edits are atomic: a stale or invalid sub-change rolls the whole batch back. Do not guess version increments; inspect the returned version.

Removal, reporting-line reparenting, CLI conversion, home transfer, rebinding and active-model replacement are not routine edit operations in this slice. Explain the refusal and retain the proposal; never simulate these by overwriting records. Use explicit session binding only for a user-selected verified target.

## Approval and recovery

Native MCP form confirmation is required. Missing client support, decline, cancellation or a false/missing confirmation grants nothing. Never substitute a model-produced answer, question transcript, ordinary tool argument or edited approval file. The native caller/target is reverified after review and state generations are checked at commit.

For uncertain changes, preserve the original id/command/target and call the same management tool with `reconcile:true`. A confirmed receipt needs no new approval or repeated effect. An unknown receipt is not proof that every external effect failed; use the documented operation flow and current state before retrying the original request.
