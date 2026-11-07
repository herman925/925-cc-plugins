# Codex native review delivery — diagnosis and prepared change

Date: 2026-11-06
Scope: the `01a18fc1-a164-76b0-b83d-5421ca7db4a9` self-lockout and the Codex
recovery path that depends on native review.
Branch: `fix/codex-review-delivery-honesty` (off `main`, isolated from PR #199).

## 1. What was asked

1. Check whether the approval form actually reached Herman, without treating the
   refusal as consent.
2. Fix the Codex recovery path so a stale binding does not block the narrowly
   scoped, user-reviewed recovery tools.
3. Diagnose this session's effective configuration and prepare any change for
   review.
4. Install the tested fix through the normal update path.

## 2. Did the form reach Herman? No — but the refusal is not proof of anything

Reproduced against the real `codex.exe` (codex-cli 0.166.0) by driving a live
`app-server` and flipping one setting:

| `mcp_elicitations` | Forms shown | Client reply | Elapsed |
| --- | --- | --- | --- |
| true | 1 | `{"action":"accept",...}` | human-paced |
| false | **0** | `{"action":"decline"}` | **1 ms** |

With the setting off, Codex answers the review itself and never shows a form. The
old code mapped that to:

```
API_APPROVAL_REQUIRED: The proposed change was declined or cancelled.
```

So a silent client answer was reported to the person as their own refusal. That is
why the other Codex session honestly relayed "declined" — it had no way to know
nothing was displayed.

Rule adopted: a fast reply is evidence that the form was **probably** not shown.
It is not proof. A client could still have displayed a form that was dismissed.
The refusal therefore reports "approval not obtained; delivery unverified" and
names an automatic decline as one possible cause.

Corroborating facts from the recorded session:

| Check | Result |
| --- | --- |
| Elicitation frames in the transcript | 0 |
| Round-trip of the failing call | 4.6 s |
| Server review window | 180 s |
| `nativeReviewAvailable` in status | `true` (capability-derived) |

## 3. Root cause of the full lockout

A resumed session has a new `incarnation_id`. `memberActor` (`src/api-domain.mjs`)
fails `STALE_BINDING`, the guard hook threw, and `codex-mcp.mjs` converted that
into a blanket deny — status, shell, reads and clarification included. Recovery
needs `bindMember`, which needs controller approval, which needs the form that
never appeared. A closed loop.

## 4. Changes on the branch

| Change | Effect |
| --- | --- |
| `API_APPROVAL_UNVERIFIED` | A sub-human-speed reply reports `Approval not obtained; delivery unverified. No changes made.` Timing and the actionable hint travel as structured refusal details. Never reported as the person's refusal, and never asserts what they saw. |
| `elicitationProbe` in status | Reports the timing observation instead of relying on advertised capability, which over-reports delivery. |
| Stale binding reaches recovery | Read-only inspection, `shared_team_status`, `shared_team_sessions`, `inspectCaller`, `inspectController` and exactly the two reviewed recovery operations (`approveController`, `bindMember`) stay reachable. Everything else, including `editTeam`, `createFreshTeam` and every other `shared_team` command, still refuses. |
| Regression tests | Sub-millisecond decline and its exact message, human-paced decline, the full stale allow/deny matrix including a prefixed MCP tool name, and that a stale rebind closes through exactly one native review and clears the stale state. |

Why the recovery operations must be admitted: they are what rebinds the
conversation. Allowing only read-only inspection left the loop closed — the
session could diagnose itself and still never recover. Admitting them grants no
authority, because both require a native review form that the person themselves
answers.

Deliberate limitation: acceptance is **not** gated on timing. An automated harness
may legitimately answer at once, and no auto-accept path has been observed.
Gating it would break real automation on speculation.

## 5. Validation

| Pass | Result |
| --- | --- |
| Unit suite, `main` clean baseline | 278 tests, 260 pass, **0 fail** |
| Unit suite with this fix | 280 tests, 262 pass, **0 fail** |
| Native transport probe, real `codex.exe` | `"passed": true` |
| Real Codex, `mcp_elicitations` off | returns `API_APPROVAL_UNVERIFIED` with the honest wording |
| Package parity | `Verified 52 shared runtime files in 2 packages.` |

PR #199's branch was measured too, for reference only: 278 tests, 250 pass,
**12 fail** with or without these changes. Those failures are its unfinished
schema-10 work, not this fix. This branch does not include it.

## 6. Configuration diagnosis — no change is needed

| Layer | `mcp_elicitations` |
| --- | --- |
| `~/.codex/config.toml` (global) | key absent |
| `<project>/.codex/config.toml` | `true` |

The project config already has the correct setting, and
`resume-with-mcp-prompts.mjs` sets the same policy explicitly on the command line.
Both config files were written at 03:43 today, after the 20:12 failure. The
observed auto-decline therefore came from the configuration in force at that time,
which is no longer the configuration on disk.

Conclusion: **no configuration change is prepared, because none is needed.** If the
lockout recurs, the honest refusal plus `elicitationProbe` will now say so directly
instead of implying the person refused.

## 7. Live recovery of `01a18fc1` — not performed here

A controller approval is scoped to a single conversation, so only that terminal can
approve for itself. Approving from elsewhere would not transfer and must not be
presented as consent. See the runbook supplied with this diagnosis.

## 8. What this document does not claim

1. It does not prove the form was never rendered in the historical session. It
   shows the client answered without the Team Orchestrator server seeing a form.
2. It does not prove why that specific session's client answered that way.
3. It does not establish that the fix is installed. The installed runtime under
   `~/.codex/925-to/installations/...` still holds the previous bytes until an
   update is run.
