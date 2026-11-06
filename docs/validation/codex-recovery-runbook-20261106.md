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

This step must run **inside the Orca-hosted Codex session for this project**. It
cannot run from a Claude session, and it must not be forced to: the installer
verifies the live local Orca terminal and refuses with `SETUP_HOST_UNSUPPORTED`
otherwise. That guard is deliberate. Do not spoof the host identity.

Expected digest. The runtime this branch installs hashes to:

```
859a43aa1873571b9c8e7b0034c9a1affb5d8a897a4225876ca19f58af6f79b4
```

(52 files, computed with the installer's own `prepareRuntime`.) After applying, the
receipt at `<project>/.codex/925-to-installation.json` must show this value as
`runtimeDigest`, and `runtimePath` must end in a `runtimes\<digest>\codex-mcp.mjs`
directory with the same hash. If the digest differs, stop — the wrong bytes are
being installed.

Run:

```
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs preview
```

Read the preview, then only if it matches:

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

## Step 6 — recover `01a18fc1` in its own terminal

In the `01a18fc1` session, with the fix loaded:

1. `shared_team_status`. Read `bindingState` and `elicitationProbe`.
   - `bindingState: "stale-needs-explicit-reconnect"` confirms a stale binding.
   - `info.recovery` names the call to use.
   - `elicitationProbe.classification` says whether recent reviews reached a person
     or returned too fast to be human.
2. `shared_team_sessions`. Find the entry whose `conversationId` is
   `01a18fc1-a164-76b0-b83d-5421ca7db4a9`. Copy its whole `reference` object.
3. `shared_team_manage` with:
   - `command.type`: `bindMember`
   - `command.teamId`: the team from status
   - `command.memberId`: `native-acceptance-head-20261105`
   - `command.expectedMemberGeneration`: from status
   - `command.expectedBindingGeneration`: from status (0 the first time)
   - `command.expectedControllerGeneration`: from status, if one exists
   - `target`: the `reference` copied in step 2

While the binding is stale, the guard admits exactly these calls and nothing else:
`shared_team_status`, `shared_team_sessions`, `inspectCaller`,
`inspectController`, and the two reviewed recovery operations `approveController`
and `bindMember`. Everything else is refused, including `editTeam` and
`createFreshTeam`.

A native review form will appear. **Herman must answer it himself.** If the tool
instead returns `API_APPROVAL_UNVERIFIED` — "Approval not obtained; delivery
unverified. No changes made." — the form probably did not appear. Check step 2,
fix that, and try once more. Do not assume the request was refused, and do not
retry repeatedly.

What this preserves: the member id and its history. Rebinding updates the
conversation, terminal and incarnation on the existing member row. It does not
delete team history, tasks, messages or workers.

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
