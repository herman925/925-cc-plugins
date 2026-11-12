# Mod reliability and meeting-default checkpoint — 2026-11-08

This extends the D1 working-tree correction under Herman's subsequent instruction to implement all remaining Wayfinder areas. It is an implementation checkpoint, not a release, installation, native approval or live team mutation.

## Changes and remaining boundaries

- D1: retain the membership-first guard, compound-reader and bounded literal-cat-heredoc controls and uncertain/machine-key fencing documented in the earlier D1 report.
- D2: native CLI failures now retain bounded `access-denied`, `executable-unavailable`, `timeout` or `subprocess-failed` categories and an integer exit status in guard diagnostics. Raw subprocess text is not included. Tests exercise nonzero subprocess results through the SDK and classification of direct errors. The actual previously failing plugin host has not returned new evidence; the root cause remains unresolved. The SDK can obscure an exception's original details, so unknown remains unknown.
- D3: reproduced a Mod UI recovery loop: stale member inspection prevented a separately approved controller from reaching session reconnection. `inspectSharedCaller` now falls back only on `API_STALE_BINDING` to the existing controller inspection API. Its recovery projection contains no member or binding authority. Approved controllers can inspect their teams and explicitly choose a verified native session and Connect; unapproved callers receive no automatic controller approval or rebind. Ordinary model API/member guard behavior is unchanged.
- Meeting creation: Herman selected joined members as the default via native multiple choice. The Mod draft defaults to `joined`, retains `all` as a per-meeting override and still requires invitation review. The Codex workflow sends the chosen policy explicitly. Existing meetings and topic contribution/deferral rules are unchanged.

## Evidence

1. D2 diagnostic regressions failed before the implementation. A test fixture initially threw an SDK handler error, which hid the underlying errno; the fixture was corrected to return the actual nonzero subprocess-result shape. No production diagnostic was taught to infer a hidden errno.
2. D3 approved/unapproved recovery and meeting-default regressions failed before the implementation. The older approved-controller UI had no reachable workspace refresh; the stale unapproved UI had no approval control; the draft policy was empty.
3. Final Mod SDK run: **465 passed / 1 failed**, **466 tests across 47 files**. The only failure is the unchanged six-second crypto unlock timing assertion (6448.80 ms). The earlier clean-baseline check reproduced that timing failure. Log: `%TEMP%/mod-reliability-meeting-green-20261108.log`. D1, D2 diagnostic, D3 UI and meeting default/override cases pass.
4. Node 22.13, focused common API recovery: **1 passed / 0 failed** on SQLite. Log: `%TEMP%/mod-d3-api-sqlite-20261108.tap`. It verifies stale member operations remain refused, independently approved controller/configuration inspection survives, an exact verified self-rebind advances binding generation, reconciliation returns the same receipt and the original member/controller remain. The name-filtered run did not exercise PostgreSQL; zero reported skips is not PostgreSQL evidence.
5. The D1 disposable SQLite discovery checkpoint remains 16/16; no discovery implementation changed in this increment. Runtime files remain unchanged; package parity and whitespace are checked before commit.

No real human/native Mod reconnect, installed hook enforcement, D2 host root cause, final mixed-model task/meeting acceptance or whole-Orca restart is established by these SDK/common API fixtures.

## Independent review request

Herman was notified before the CEO testing handoff. Verified-body message `msg_940574909485` asks the existing CEO for source review, the exact earlier heredoc shape and nonmutating active-plugin diagnostics only if the current code is already loaded. No installation, reload, approval, rebind or concurrent source editing is requested. The message was queued; no completed review is inferred.

The accepted worker-readiness work in draft PR #199 is the next development dependency. Broader Wayfinder lanes remain selected for implementation, with unresolved product decisions handled through native multiple-choice grilling.
