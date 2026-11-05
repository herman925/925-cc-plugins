# Public-source guard repair — 2026-11-06

Release pair: **Codex plugin 0.1.10 / Mod 0.5.60**, schema **9 unchanged**. This is a prerequisite developer-guard repair. The [accepted worker access/readiness design](DESIGN-WORKER-READINESS.md) is not implemented by this release.

## Reproduced defect

The live Codex lead had an explicitly reviewed standing write setting, but its regression-test patch was refused because the patch body named an internal API factory. Another defensive test was refused for including mock shared-store paths. Neither patch targeted live state, and the refusals created no test file.

The old guard scanned the entire patch body for private authority identifiers. It could not distinguish authoring public package source/tests from running private authority code or editing private state. A real-public-API-source fixture reproduces the false refusal without accessing private runtime files.

## Scope of the repair

A native `apply_patch` may edit public package source only when the member has an **explicit standing write grant**, every Add/Update/Delete/Move target is inside its verified project home, and every target is under the named public package/docs roots with a source/document extension. Hidden runtime paths, unrelated roots, external targets and redirected paths do not qualify. Existing files or nearest existing parents are canonicalized, including junctions/symlinks. Every target in a multi-file patch must qualify.

This exception covers editing source only. Direct execution of private API source still refuses. Shell/code-mode rules, subagent settings, native caller proof, private databases/configuration and installed runtime protection remain enforced. Unknown patch formats do not receive the exception. It remains a best-effort tool guard, not an OS sandbox against arbitrary malicious code running as the same account.

No active hook was disabled or hot-patched to get the refused edits through. The readiness WIP was preserved separately while this narrow repair went through the ordinary source, tests, packaging and setup route. Loading the repaired private snapshot still requires reconnecting the native client.

## Validation

Three passes completed:

1. A new public-source regression fails on the old guard and passes after the repair. Focused guard/native-adapter suite: **10 passed, 0 failed**. It covers explicit write permission, absent write permission, actual API source as patch data versus direct execution, external targets, mixed-file targets, external moves, hidden paths, non-source files, unknown formats and real source-directory redirects. Existing private-state and native-authority refusal tests remain green.
2. Minimum Node **22.13.0**, SQLite and disposable real PostgreSQL **18.6**: **454 passed, 0 failed, 0 skipped**. Mod SDK: **446 passed, 0 failed**, across 45 files. PostgreSQL is stopped after testing. No real project migration or task mutation is performed by these tests.
3. Actual native Codex **0.166.0** plugin install/update/remove, eight-skill discovery and pinned npx installation pass with zero model turns. All **52** runtime files match the two distributed packages. The unowned-thread native MCP probe retains a supported denial before opening a store.

The live source-edit exception is not claimed verified until the matching installed runtime is reconnected and the previously refused public regression-test edit is retried normally.

## Separate live acceptance findings

The real schema-9 project successfully completed the reviewed worker-add edit, native head binding and one specific Codex launch plan. One real Codex worker started and self-bound with its actual native conversation identity. The worker read its official role, but native approval policy refused its inbox-context confirmation. The admitted assignment expired and returned to the head; no task work, outcome or head acceptance succeeded. The worker is idle and retained; the Claude acceptance member and CEO session were not used.

Herman rejected a temporary permission-mode toggle and selected the permanent design: the **launch review includes the listed workers AND their scoped team-tool access; readiness is verified before assignment**. No live tool-access grant is inferred from that design answer. Consent records, native configuration, bootstrap/readiness and common transactional admission gating remain work on the readiness feature branch. Existing task/expiry history is preserved.
