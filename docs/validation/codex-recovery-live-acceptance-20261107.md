# Codex recovery: real Orca launch, resume and native review

Date: 2026-11-07, Asia/Kuala_Lumpur (machine-readable evidence uses UTC).
Branch: `fix/codex-review-delivery-honesty`.
Affected conversation: `01a18fc1-a164-76b0-b83d-5421ca7db4a9`.

## Root cause and changes

The affected process was already running `d3937032...`, which fixes stale-binding
preflight, but its live turn still had `approval_policy: never`,
`sandbox_policy: danger-full-access`, and a disabled execution permission profile.
Its resume command supplied no MCP confirmation override. The project setting
alone had not established the effective policy. See
[`affected-before-hosted.json`](codex-recovery-20261107/affected-before-hosted.json).

Orca's typed launch-settings API reported its inherited Full access recipe as
`--dangerously-bypass-approvals-and-sandbox`, with no Codex user arguments. That
recipe also suppresses MCP confirmations. The official
[configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents that the granular `mcp_elicitations` category permits prompts to surface.

The normal setup helper now provides `launch-preview` and `launch-apply`. They
use Orca's typed `settings.getAgentLaunch` / `settings.mutateAgentLaunch` API,
retain a private backup, and read the setting back. For this verified Full access
recipe they configure:

```text
--sandbox danger-full-access
-c approval_policy={granular={sandbox_approval=false,rules=false,mcp_elicitations=true,request_permissions=false,skill_approval=false}}
-c approvals_reviewer=user
```

Execution remains unrestricted. Only the MCP prompt category changes. Other
agents, model/effort choices, environment and hooks are preserved. Unknown or
custom execution recipes are refused. Stored preferences are reported separately
from active-session policy; a no-op preference check never attests activation.

The helper's `resume <conversation-id>` uses Orca's normal
`terminal.ensureAgentSession` explicit saved-session path with the reviewed
arguments, preserving the exact provider conversation. Old processes were first
verified idle, exited through their CLI, and confirmed exited. No duplicate
provider was started. Orca admitted each saved resume and recorded its arguments
for later resumes. The shipped host expects the Codex provider key `session_id`;
an initial wrong-key request was refused before launch, then corrected and tested.

The launch-preflight correction uses the existing restricted recovery policy,
including for direct MCP calls. Writes, launches, unrelated effects, unrelated
identity/authority failures, and reserved-worker attachment failures remain
denied. Management still requires native approval; no team database records were
edited directly.

Setup now reports actual `hookConfigurationChanged`; an unchanged-hook runtime
update reports `requiresNativeHookReview: false`. `hookTrust: not-attested` neither
grants trust nor claims the hook is untrusted. Status now labels slow replies
`human-paced-reply-delivery-unverified`, always reporting `delivery: unverified`.
Timing and advertised capabilities do not establish delivery or consent.

## Three validation passes

The final full-suite passes each use the installed native Codex configuration
writer: **299 tests; 282 passed, 0 failed, 17 skipped**. PostgreSQL is not
configured on this host. The skips are retained in the TAP evidence, not counted
as passing. Runtime packaging verifies 52 identical files in both packages.

| Pass | Suite evidence | Actual Orca-hosted observation |
| --- | --- | --- |
| 1 | [`pass1-tests.json`](codex-recovery-20261107/pass1-tests.json), [TAP](codex-recovery-20261107/pass1-tests.tap) | [Fresh normal CLI launch](codex-recovery-20261107/pass1-hosted.json), conversation `01a1b2a3-3853-74c3-b023-aa3c76507c3a`, Codex PID 61964 / MCP PID 62672. |
| 2 | [`pass2-tests.json`](codex-recovery-20261107/pass2-tests.json), [TAP](codex-recovery-20261107/pass2-tests.tap) | [Normal saved-session resume](codex-recovery-20261107/pass2-hosted.json), conversation `01a1b299-e939-7d93-8679-3afbcd3c905e`, Codex PID 16924 / MCP PID 11612. |
| 3 | [`pass3-tests.json`](codex-recovery-20261107/pass3-tests.json), [TAP](codex-recovery-20261107/pass3-tests.tap) | [Affected conversation resumed](codex-recovery-20261107/pass3-hosted.json), Codex PID 59312 / MCP PID 73968, followed by the actual native recovery form. |

Each hosted observation verifies the exact provider/terminal through the live Orca
registry, connects its native Codex process to its MCP child, and reads the latest
effective turn policy. All three use the installed digest below, granular MCP
confirmations, and unchanged `danger-full-access` / disabled execution profile.
The earlier [fresh launch baseline](codex-recovery-20261107/fresh-launch-baseline-hosted.json)
verified the new launch policy before the diagnostic runtime update; it still ran
`d3937032...` and is not presented as final-runtime acceptance.

Regression coverage includes launch-enabled bare/prefixed recovery names, refused
effects/direct calls, unrelated verification failures, MCP wire behavior, native
review missing/decline/cancel/false/forged responses, one accepted reviewed rebind,
hook-change detection, unknown launch-recipe refusal, native epoch changes,
private launch backup/readback, idempotent preference updates, and the exact
Codex resume provider key. Temporary test identities and harness confirmations are
distinct from the real hosted evidence and the person's live decision below.

Static host inspection used Orca 1.4.251 build `e987c5d4f5c3` and its typed method
schemas. REA partial evidence
`ev_e1914dbc9fb2b5f0773bd19c688ef113f5e97b45ecab8731a31d02b6d1653e99`
has incomplete coverage because a large unrelated source exceeded its parser
deadline. Static inspection was used to locate the integration; the successful
typed API calls, native launches, resumes and live policies above establish the
runtime behavior. Orca's installed binaries were not patched.

## Installed runtime and activation

Normal `setup.mjs preview` then `apply` completed. The receipt
`.codex/925-to-installation.json` was read afterward:

```json
{
  "phase": "installed",
  "version": "0.1.10",
  "runtimeDigest": "691b3a624fb4b841e24b0f1fb5db98fd3453aefbc5648deed1d999e468c7b18a",
  "serverHash": "d50e611bcf937e995f48d543159854f01bbaad24049b0c4240e79d7fa0bcb2d5",
  "guardHash": "38f9eec9a75d47aab7a00f0d159ea3f9fdbf182cdd9bb7ebfca4a1cf91a96394"
}
```

Its runtime path ends in
`runtimes/691b3a624fb4b841e24b0f1fb5db98fd3453aefbc5648deed1d999e468c7b18a/codex-mcp.mjs`.
The affected session's actual MCP child uses that directory. The hook bytes were
unchanged and no new native hook review was required. Setup neither granted hook
trust nor changed global Codex configuration or the team store. The separately
requested launch action changed only Codex's Orca user arguments.

## Live native recovery decision

The affected conversation requested operation
`recovery-rebind-01a18fc1-aefcab07-20261107` for only `bindMember` on team
`native-acceptance-20261105-01a18fc1`, existing member
`native-acceptance-head-20261105`. Reviewed generations: configuration 8, member 2,
binding 1, controller 1. The native form displayed this exact conversation and
proposal, with `approveController: false`, in the focused CC Plugin Worker tab.
Its False option was selected by default. No automation selected or submitted an
answer.

Acceptance is pending the person's native decision and subsequent receipt/status
verification. This section must be updated with the actual outcome before claiming
the rebind succeeded or normal access returned.

## Isolation

PR #199 remains open on `feat/worker-runtime-readiness`; its unfinished work was
not merged into this recovery branch. Existing unrelated project-local state and
the earlier `live-acceptance-20261030.md` were preserved. No hooks were disabled,
no native approval was bypassed, and no workers were started by a team launch.
Only explicitly owned disposable validation Codex sessions were started for the
hosted checks.
