# Managed orchestration fallback — 2026-11-12

Canonical decision: [Coordination fallback: managed orchestration without replacing the primary routes](https://github.com/herman925/925-cc-plugins/issues/205), a native child of [Map: Team Orchestrator — Claude Mod and Orca](https://github.com/herman925/925-cc-plugins/issues/2). Herman approved this in the live conversation. The decision was claimed, recorded in a verified resolution comment and closed before implementation continued. Only that route-policy question is resolved.

The canonical map and [Host-adaptive coordination: verified Orca adapter and independent CLI route](https://github.com/herman925/925-cc-plugins/issues/179) were updated and read back exactly. The latter remains open. Both original primary routes remain in scope; the new fallback neither replaces them nor grants a live launch, approval, binding, installation or restart.

## Implementation checkpoint

The route arbiter records one backend choice before any possible effect. A healthy primary wins; only positively unsupported transport can select an available reviewed fallback. Human refusal, permission/trust problems, busy or stale identity do not enable a second route. Unknown effects reconcile on the original backend. A previously selected fallback stays selected for that pointer even after the primary becomes healthy; new pointers prefer the primary. Pre-router wake receipts prevent an unsafe switch. Initial route tests: 13 passed, zero failures; managed-backend checks: 6 passed. Codex private-enrollment/native-identity/routing focused checks: 31 passed.

The host-adaptive arbiter is wired through both Codex wake and the Mod's active/legacy private helpers. The managed backend port accepts an already enrolled owned execution transport; it does not create/adopt/resume one. Missing enrollment reports fallback-setup-required. Startup inboxWake state describes the primary terminal route; managedFallback reports whether a private enrollment adapter still needs target proof. The Mod displays an explicit setup-needed status. All task/read/permission decisions remain in the shared API.

The candidate is still Mod 0.5.62 / Codex 0.1.12 / schema 10, now 71 matching runtime files. No runtime was installed, activated or merged. The earlier 68-file single-dispatcher report remains its dated baseline.

This checkpoint is not live fallback acceptance. Managed Orca target proof and concrete enrollment, independent review/launch/binding/relay and real mixed-provider acceptance remain implementation work. The shared team store retains all task/read/acceptance authority. The private backend factory is not an exposed skill/configuration switch; ordinary clients cannot enroll a transport merely by setting a flag.

## Native Orca finding

The version-matched orchestration guide and installed send handler support managed delivery, but `send` is not a transparent notification primitive. Its settled-Dispatch path can redirect to an active follow-up or create follow-up work; the native implementation can reopen a saved worker or start fresh. An exact Dispatch address and a client precheck alone therefore do not establish a no-restart guarantee.

The managed adapter must use a proven current-execution contract rather than infer safety from CLI success or command availability. When such proof or normal reviewed enrollment is missing, return setup/reconciliation required without sending. The [original host contract and managed supplement](orca-fenced-inbox-wake-handoff-20261112.md) remain in scope. No installed Orca bundle, live mailbox, worker, hook, permission or database record was modified during this inspection.

## Validation

The Mod SDK passed 473/473 across 48 files; retained log `%TEMP%/team-managed-fallback-sdk.log`, SHA256 `2E059B423B41CA952F1CAE82085D756F3594A19FA98FBB5DC4E2DDDFBAAC1CF5`.

Real Codex app-server, Node 22.13, deterministic loopback model: original direct mode passed (`%TEMP%/team-single-dispatch-native-dudhvv/evidence.json`, SHA256 `28682CCF714CE3438DE00AF02139800ABADC8CDDC290C91243632969AB69DE6B`); unavailable-primary/managed-fallback mode passed (`%TEMP%/team-single-dispatch-native-4lhURA/evidence.json`, SHA256 `2134F0651B8A8F66FF67E2B60AC224D1020B920C1BDF434B88097B8D33934FBB`). Each produced one model request and the same request/native receipt on repetition, zero answered approvals, zero Orca calls and zero real team mutations. The fallback availability condition is fixture-controlled; this does not establish a real standalone launch/review workflow or an Orca backend. Claude and Orca managed transports have contract fixtures only.

The first common run retained in `%TEMP%/team-completion-pg-2XUa3z` caught an obsolete assertion that unsupported terminal delivery still returned host-update-required rather than the new fallback-setup-required result. The native regression was updated to assert the new state and no native input/launch; the added private-enrollment case verifies that target proof comes only from trusted adapter code.

Final common validation: **617 passed / 0 failed / 0 cancelled / 0 skipped**, SQLite plus owned real PostgreSQL, Node 22.13 and configured native setup checks. Owned PostgreSQL stopped successfully. Log `%TEMP%/team-completion-pg-AAyMcp/suite.tap`, SHA256 `AFFE30C196F50F40781EA26105C60265D794B7A17AF97C96A16373F8DBE72DD8`.

The final native/routing/managed focused run passed **31/31**, after explicitly isolating the unsupported-host fixture's receipt directory under its TEMP root: `%TEMP%/team-managed-fallback-focused.tap`, SHA256 `B5F0ABC97512CC5C24D0A8FDD71B7E20A9D98DAEA3E1FF5AFDDFE7F2E98A4CFC`. Packaging check verified 71 byte-matching runtime files in both targets. No Claude/CEO test handoff was sent.
