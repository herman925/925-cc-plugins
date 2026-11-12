# Managed orchestration fallback — 2026-11-12

Canonical decision: [Coordination fallback: managed orchestration without replacing the primary routes](https://github.com/herman925/925-cc-plugins/issues/205), a native child of [Map: Team Orchestrator — Claude Mod and Orca](https://github.com/herman925/925-cc-plugins/issues/2). Herman approved this in the live conversation. The decision was claimed, recorded in a verified resolution comment and closed before implementation continued. Only that route-policy question is resolved.

The canonical map and [Host-adaptive coordination: verified Orca adapter and independent CLI route](https://github.com/herman925/925-cc-plugins/issues/179) were updated and read back exactly. The latter remains open. Both original primary routes remain in scope; the new fallback neither replaces them nor grants a live launch, approval, binding, installation or restart.

## Implementation checkpoint

The route arbiter records one backend choice before any possible effect. A healthy primary wins; only positively unsupported transport can select an available reviewed fallback. Human refusal, permission/trust problems, busy or stale identity do not enable a second route. Unknown effects reconcile on the original backend. A previously selected fallback stays selected for that pointer even after the primary becomes healthy; new pointers prefer the primary. Pre-router wake receipts prevent an unsafe switch. Initial route tests: 13 passed, zero failures.

This checkpoint is not live fallback acceptance. Managed backend target proof, safe native effect admission, independent review/launch/binding/relay and real mixed-provider acceptance remain implementation work. The shared team store retains all task/read/acceptance authority.

## Native Orca finding

The version-matched orchestration guide and installed send handler support managed delivery, but `send` is not a transparent notification primitive. Its settled-Dispatch path can redirect to an active follow-up or create follow-up work; the native implementation can reopen a saved worker or start fresh. An exact Dispatch address and a client precheck alone therefore do not establish a no-restart guarantee.

The managed adapter must use a proven current-execution contract rather than infer safety from CLI success or command availability. When such proof or normal reviewed enrollment is missing, return setup/reconciliation required without sending. Continue the original fenced terminal host contract alongside this work. No installed Orca bundle, live mailbox, worker, hook, permission or database record was modified during this inspection.
