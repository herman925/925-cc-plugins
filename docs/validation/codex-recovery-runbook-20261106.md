# Runbook — install the review-delivery fix and recover `01a18fc1`

Date: 2026-11-06
Updated: 2026-11-07, including the launch-preflight correction documented in
`docs/validation/codex-recovery-preflight-fix-20261107.md`.
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

## Step 2 — read-only: inspect the effective launch/resume policy

Read the affected conversation's latest live turn context and inspect its native
process command line. `approval_policy: never` suppresses MCP confirmations even
when the project file below enables them. Orca's Full access recipe and saved
resume arguments can override project configuration. The live execution profile
must remain unchanged when enabling MCP prompts.

The following project-file check is a historical configuration check only. It
does not establish the policy of an already running or resumed conversation.

Open `C:\Users\Herman\Downloads\925-cc-plugins\.codex\config.toml` and check the
first two lines. They must read:

```toml
approval_policy = { granular = { sandbox_approval = false, rules = false, mcp_elicitations = true, request_permissions = false, skill_approval = false } }
approvals_reviewer = "user"
```

The effective policy must allow `mcp_elicitations`; no configuration value alone
proves that a form was displayed. Do not change the project's execution profile
or infer consent from advertised capability or reply duration.

### Step 2b — CHANGES ORCA LAUNCH PREFERENCES: enable MCP prompts

For the verified Full access profile, run and review:

```
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs launch-preview
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs launch-apply
```

This uses Orca's typed launch-settings API and retains a private backup. Execution
stays `danger-full-access`; sandbox, rule, permission-request and skill approvals
stay off; only MCP confirmations are enabled. Other agents and model/effort
preferences are preserved. Unknown/custom launch recipes are refused.

## Step 3 — CHANGES FILES: install the fix

This step must run **inside the Orca-hosted Codex session for this project**. It
cannot run from a Claude session, and it must not be forced to: the installer
verifies the live local Orca terminal and refuses with `SETUP_HOST_UNSUPPORTED`
otherwise. That guard is deliberate. Do not spoof the host identity.

Expected digest. The runtime this branch installs hashes to:

```
5c33808fdc730c3db8397326522f45e73613532221a6b892b94d7cf8bd2283d5
```

(52 files, computed with the installer's own `prepareRuntime`.) This replaces
`859a43aa1873571b9c8e7b0034c9a1affb5d8a897a4225876ca19f58af6f79b4`, whose
launch preflight could throw before reaching the restricted recovery handler.
It also supersedes `d3937032959dadf54f46bad5662d7c2845ea112b0488dfed9b8bd225fcf6a325`
with honest timing-only status diagnostics. See the live launch/resume acceptance
record in `docs/validation/codex-recovery-live-acceptance-20261107.md`.
The review-delivery correction also supersedes
`691b3a624fb4b841e24b0f1fb5db98fd3453aefbc5648deed1d999e468c7b18a`:
human review no longer expires after three minutes on the server while Codex
keeps its form open. See `codex-review-delivery-fix-20261107.md` for the native
input timeline, protocol correlation and validation limits.
After applying, the
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

If `hookConfigurationChanged` and `requiresNativeHookReview` are true, review the
changed hook through Codex's native interface. Updating only the runtime with an
unchanged hook does not require a new review. `hookTrust: not-attested` reports
that setup cannot observe native trust; it does not mean the hook is untrusted.

## Step 5 — reconnect the runtime

After verifying that the conversation is idle, exit its old Codex process and
confirm that process exited. Resume through Orca's normal saved-session API with
the configured MCP policy:

```
node team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs resume 01a18fc1-a164-76b0-b83d-5421ca7db4a9
```

The helper preserves the provider conversation and records explicit launch
arguments for subsequent resumes. It does not answer any native approval. Until
the new runtime is loaded, the old bytes keep running.

Verify the MCP child process runs from the expected digest directory, then check
the resumed turn's effective granular policy and unchanged execution profile.
Ask Team Orchestrator for status and confirm `elicitationProbe` appears. The probe
reports observed timing only; `delivery: unverified` is deliberate. Visible form
inspection and the person's native answer are separate acceptance evidence.

## Step 6 — recover `01a18fc1` in its own terminal

In the `01a18fc1` session, with the fix loaded:

1. `shared_team_status`. Read `bindingState` and `elicitationProbe`.
   - `bindingState: "stale-needs-explicit-reconnect"` confirms a stale binding.
   - `info.recovery` names the call to use.
   - `elicitationProbe.classification` describes recent round-trip timing. Neither
     a slow reply nor advertised capability proves a person saw the review.
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

A native review form is required. **Herman must answer it himself.** If the tool
instead returns `API_APPROVAL_UNVERIFIED` — "Approval not obtained; delivery
unverified. No changes made." — the form probably did not appear. Check step 2,
fix that, and try once more. Do not assume the request was refused, and do not
retry repeatedly.

Human review has no server deadline. Keep the exact request pending until the
person responds, cancels, or the native connection closes. Stderr records
`[925-to-review]` request and completion IDs without proposal or response content.
A `request` trace proves emission; it does not attest foreground visibility.
Only an actual response counts toward the timing probe; failed waits are counted
separately. An explicitly configured test deadline cancels the client request and
rejects late answers. A native `Accept` log alone does not prove `confirm:true`.
The management receipt and normal-access verification are still required.

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
