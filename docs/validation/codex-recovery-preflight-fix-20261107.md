# Codex stale-binding recovery through launch preflight

Date: 2026-11-07 (Asia/Kuala_Lumpur)
Branch: `fix/codex-review-delivery-honesty`; PR #199 remains separate.

## Observed failure

Native process inspection linked the affected conversation
`01a18fc1-a164-76b0-b83d-5421ca7db4a9` to Codex PID 86112 and its MCP child
PID 57788. That child was already started from runtime directory
`859a43aa1873571b9c8e7b0034c9a1affb5d8a897a4225876ca19f58af6f79b4`.
The receipt was therefore insufficient evidence that recovery worked.

The native router recorded a refusal for
`mcp__team_orchestrator__shared_team_status` at 2026-11-06 19:28:01 UTC:
`Native caller or team authority could not be verified. API_STALE_BINDING`.
The setup helper wires the callback as `team_guard` with
`{tool: '${tool_name}', input: '${tool_input}'}`. The restricted guard accepts
both bare and prefixed recovery tool names. Raw hook arguments were not captured.

Real Orca identity sets `launchWorkers: true`. Its preflight inspected guard
authority before tool dispatch and rethrew `API_STALE_BINDING`, so neither the
hook recovery handler nor the status recovery handler was reached. The earlier
regression fixture did not enable worker launches.

An isolated reproduction using the 52-file packaged source verified its digest
as `859a43aa1873571b9c8e7b0034c9a1affb5d8a897a4225876ca19f58af6f79b4`.
Bare and prefixed status/recovery hook events were admitted with worker launches
disabled, but all threw the stale-binding error when launches were enabled. The
MCP wire returned the same blanket refusal as the native router.

## Correction and authority boundary

Launch preflight retains only `API_STALE_BINDING` and routes it through the
existing restricted guard policy. Hook calls receive that policy's decision;
direct MCP calls must also pass it before dispatch. Inspection and the two
reviewed recovery operations remain reachable. Refused calls do not reach an API,
launch effect, or deferred observation.

Native caller verification and unrelated preflight errors remain mandatory.
Reserved-worker attachment verification is unchanged. Launches, writes, inbox
operations, team creation/editing, and unrelated effects remain refused while the
binding is stale. The management confirmation implementation is unchanged.

## Validation

- Regression tests first failed on the original preflight path, then passed.
- New launch-enabled guard matrix covers bare and prefixed inspection/recovery
  names, denied effects, direct MCP effects, malformed hook requests, unrelated
  authority/native identity failures, and the MCP hook wire.
- A real temporary SQLite team is bound, resumed into a stale incarnation, and
  recovered with `launchWorkers: true`. Missing native review, decline, cancel,
  false confirmation, and forged approval fields leave the binding/controller
  generations unchanged. Both recovery commands reject missing/negative review;
  one accepted native review advances the binding and clears stale status.
- Full shared-store suite: 285 tests; 267 pass, 0 fail, 18 skipped. PostgreSQL was
  not configured and its local Docker engine was unavailable. Native setup and
  executable checks were then enabled separately: 17 pass, 0 fail, 0 skipped.
- Existing reserved-launch tests pass, including refusal after an incarnation
  change and refusal when a reserved worker's store is missing.
- Real Codex form-transport probe: passed in temporary project
  `925-to-native-management-hJZZtc`, with zero model turns. Identity and approval
  were supplied by the documented test harness, not a real person's consent.
- Packaging/parity: 52 files verified in both runtime packages.
- Mod plugin validation passed with existing metadata/directory warnings.
- `git diff --check`: passed.

## Installation receipt

Normal setup `diagnose` reported an installed project; `preview` reported
`setup-ready`; `apply` reported `complete`. The receipt was read after apply and
the packaged source digest was recomputed with the installer's `prepareRuntime`.

Receipt: `.codex/925-to-installation.json`

```json
{
  "phase": "installed",
  "version": "0.1.10",
  "runtimeDigest": "d3937032959dadf54f46bad5662d7c2845ea112b0488dfed9b8bd225fcf6a325",
  "serverHash": "d2ac3e846cffda7a5e58a76f661b36666180b540a985ed8cda00473eb6a83ea1",
  "guardHash": "38f9eec9a75d47aab7a00f0d159ea3f9fdbf182cdd9bb7ebfca4a1cf91a96394"
}
```

The receipt's runtime path ends in
`runtimes/d3937032959dadf54f46bad5662d7c2845ea112b0488dfed9b8bd225fcf6a325/codex-mcp.mjs`.
Setup reports `globalConfigurationChanged: false`, `teamStoreChanged: false`,
`hookTrustGranted: false`, `requiresReconnect: true`, and
`requiresNativeHookReview: true`. No live team mutation or live recovery approval
was attempted from this working session.

## Required activation and recovery

Immediately after apply, native process inspection still showed PID 57788 using
`859a43aa...` in the affected session and PID 77604 using `a6f24df3...` in this
working session. Installation does not replace either running process.

Review the project hook in Codex's native interface as required, then reconnect
the project's MCP server or restart/resume the affected Codex session. Confirm its
MCP child starts from the new digest directory. In that session,
`shared_team_status` must now return `elicitationProbe` and the stale recovery
information, rather than a blanket preflight refusal. Follow the updated runbook
to rebind through its own native approval form, then verify clean status and
complete the inbox receipt flow. Do not transfer approval from another session.
