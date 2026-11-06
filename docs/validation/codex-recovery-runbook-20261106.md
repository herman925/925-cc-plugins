# Runbook — install the review-delivery fix and recover `01a18fc1`

Date: 2026-11-06
Companion to: `docs/validation/codex-review-delivery-diagnosis-20261106.md`
Branch with the fix: `fix/codex-review-delivery-honesty`

Who runs this: Herman, or the Codex session itself. Every step below that changes
anything is marked. Steps 1 and 2 are read-only.

Two facts decide the order:

1. The installer refuses to run outside a live Orca-hosted Codex session
   (`SETUP_HOST_UNSUPPORTED`). It cannot be run from a Claude session, by design.
2. A controller approval is scoped to one conversation. Only the `01a18fc1`
   terminal can approve for `01a18fc1`. An approval given elsewhere does not
   transfer and must not be presented as consent.

## Step 1 — read-only: confirm the existing installation

Run inside this project:

```
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs diagnose
```

Expected: `"installation":"installed"`, `"globalConfigurationChanged":false`,
`"teamStoreChanged":false`.

Do not continue if `installation` is not `installed`.

## Step 2 — read-only: confirm confirmation prompts are actually enabled

Open `C:\Users\Herman\Downloads\925-cc-plugins\.codex\config.toml` and check the
first two lines. They must read:

```toml
approval_policy = { granular = { sandbox_approval = false, rules = false, mcp_elicitations = true, request_permissions = false, skill_approval = false } }
approvals_reviewer = "user"
```

`mcp_elicitations = true` is what makes the review form appear. This is already
correct in this project as of 2026-11-06. Do not change it.

## Step 3 — CHANGES FILES: install the fix

Run this **inside the Orca-hosted Codex session for this project**, not from
Claude:

```
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs preview
```

Read the preview. It must report the runtime it would install and the two files it
would write. Then, only if the preview matches:

```
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs apply
```

What this changes: the project's `.codex/config.toml`, `.codex/hooks.json`, the
private installation receipt, and a new immutable runtime snapshot under
`~/.codex/925-to/installations/`. It writes a backup and a journal first.

What it does not change: the team store, the roster, task history, the workers, or
global Codex configuration. The preview states this as
`globalConfigurationChanged:false` and `teamStoreChanged:false`.

If apply is interrupted, run `... setup.mjs recover` before retrying. Do not delete
the private backup.

## Step 4 — CHANGES FILES: trust the hook, if the preview says it changed

Codex requires the project hook to be trusted after it changes. Confirm it in
Codex's own hook review. This is a person's decision, made in Codex.

## Step 5 — reconnect the runtime

Restart the Codex session (or the MCP server) so the new runtime loads. Until this
happens the old bytes keep running and the fix is not in effect.

Verify the new runtime is loaded by asking the Team Orchestrator for status and
checking that `elicitationProbe` appears in the reply. If it is absent, the old
runtime is still running.

## Step 6 — recover `01a18fc1`, in its own terminal

In the `01a18fc1` session, with the fix loaded:

1. `shared_team_status`. Read `bindingState` and `elicitationProbe`.
   - `bindingState: "stale-needs-explicit-reconnect"` confirms a stale binding.
   - `elicitationProbe.classification` tells you whether recent reviews actually
     reached a person, or returned too fast to be human.
2. `shared_team_sessions`. Find the entry for this conversation.
3. `shared_team_manage` with `command.type = "bindMember"`, the `target` from
   step 2, `expectedMemberGeneration` from status, `expectedBindingGeneration`
   (0 the first time), and `expectedControllerGeneration` if one exists.

A native review form will appear. **Herman must answer it himself.** If the tool
instead returns `API_APPROVAL_UNVERIFIED`, that means no form reached the person —
stop and check step 2 rather than assuming the request was refused.

What this preserves: the member id and its history. Rebinding updates the
conversation/terminal/incarnation on the existing member row. It does not delete
team history, tasks, messages or workers.

## Step 7 — verify

1. `shared_team_status` again. `bindingState` must be gone and `member` must be
   present.
2. Read the inbox, then confirm the receipt with `shared_inbox_seen`.
3. Do not start new work until status is clean.

## What none of this does

1. It does not relax permissions. Reads pass while a binding is stale; every
   effect still refuses.
2. It does not disable hooks.
3. It does not edit the team database directly, and it does not bypass native
   review for any mutation.
4. It does not replace, duplicate or stop any worker.

## If it still fails

Collect: the exact refusal code and message, `elicitationProbe.classification`, and
the output of `... setup.mjs diagnose`. Do not retry the same approval repeatedly —
that is what produced the misleading "declined or cancelled" in the first place.
