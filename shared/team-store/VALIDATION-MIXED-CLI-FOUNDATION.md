# Orca-hosted mixed-CLI foundation — Mod 0.5.54

This is the first source increment toward the user's selected Codex–Claude direction, not completed managed Codex support. It introduces no schema change, automatic membership conversion, new controller approval path or Orca plugin-panel dependency. Existing Claude sessions continue through their registry and direct-parent checks.

## What changed

- Extracted the existing local Orca profile/epoch/credential/read-only-RPC checks into one host identity component. Claude retains its separate live registry and idle-parent fingerprint requirements.
- Added a private Windows Codex identity component for a future native MCP adapter. Trusted setup fixes the project, context, terminal, Codex executable and Codex home. Native transport supplies thread metadata. The component verifies the configured native executable's direct OS parent and creation fingerprint, explicit matching Orca provider/thread/incarnation, and unique OS ownership of that thread's writer-lock file before and after host observation. It cannot fall back to another provider or standalone transport.
- Fresh typed roster requests may explicitly select `claude` or `codex` per member. Omitting the field preserves the creator-provider default. Binding refuses a verified session whose provider conflicts with the configured member CLI; rebinding is not an implicit provider conversion.
- Added both-direction API conformance checks. Trusted fixture actors exercise Codex head → Claude worker and Claude head → Codex worker, using the same conversation string in the two provider namespaces. Each retains its own binding and authority. Head preview cannot acknowledge worker mail, worker self-acceptance is refused, outcome leaves acceptance pending, and head acceptance is separate.

The Codex component does **not** establish installed/enabled guard coverage, approve a controller, bind a member or expose a model tool by itself. Do not wire it into membership admission without the still-pending Codex guard/tool adapter and bounded native acceptance. The `thread-writer-locks` convention is observed in installed Codex 0.166.0, not a stable public cross-version contract; missing or ambiguous ownership must refuse. Default native process/lock inspection is Windows-only.

## Verification

| Check | Recorded result |
| --- | --- |
| Minimum Node 22.13.0, SQLite and real PostgreSQL 18.6 | 312 passed, 0 failed, 0 skipped |
| Official Mod runner | 436 passed, 0 failed, 45 files |
| Product validation | Passed with existing directory metadata warnings |
| Source/package check | 30 identical runtime files, including the Windows ownership observer |
| Native read-only host check | The current real Codex terminal/thread/context/incarnation matched the verified Orca runtime |
| Native Windows owner observation | The current Codex thread's lock had one OS-reported owner; its PID/creation FILETIME matched the actual running native codex.exe |

The process-to-thread link is deliberate: a genuine Codex executable plus a copied conversation ID is insufficient. Windows uses [RmGetList](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/nf-restartmanager-rmgetlist) and [RM_UNIQUE_PROCESS](https://learn.microsoft.com/en-us/windows/win32/api/restartmanager/ns-restartmanager-rm_unique_process) for resource-owner PID/start-time observations. The helper declares no shutdown, restart or process-stop API. Native observations are read-only; they do not constitute a connected MCP caller/guard/lifecycle run.

The fixture tests reject wrong/missing provider sessions, another project/context/host, disconnected or duplicate terminals, changed runtime/terminal/process incarnations, another parent executable and absent/ambiguous/transferred thread ownership. Parent/thread ownership is checked across native I/O. Earlier fixture assertions expected a recipient-authority error where the existing API returns inbox-order/idempotency refusal; the assertions were corrected without weakening the API. Fixture cleanup was reordered to close the API before removing its disposable files; an owned stalled test child was stopped only after its PID, parent and creation time were verified.

The final stress run exposed one real inherited transport race: a complete response could lose to socket close while the post-response metadata read was pending. The suite reported the failing subtest and its parent (307 passes, 2 failures). A deterministic stream-order regression reproduced the same refusal, then passed after the repair. A complete valid frame now waits for the existing bounded epoch check; incomplete frames, wrong request IDs and changed runtime metadata still refuse. The final 312-test pass includes both the deterministic ordering regression and real local-socket checks. The final unchanged-hook Mod run passed 436 tests; the Node-side components are additionally covered by 20 targeted minimum-Node identity/transport tests and the full final engine suite.

A native Windows resource-owner fixture also compares the actual OS-reported PID/start-time with process inspection. The implementation uses Get-Process's full FILETIME precision; Win32_Process.CreationDate truncates sub-microsecond ticks and must not be substituted. This was corrected before merging the new Codex component. The native fixture holds only its own temporary file and invokes no process-control operation.

Logs and selected native observations: [mixed-cli-foundation](validation/mixed-cli-foundation). The two-engine and Mod counts belong to this increment; they are not added to older checkpoint totals. Disposable PostgreSQL was stopped after the suite. No real project team database, global configuration, installed plugin or original provider transcript was modified.

## Meeting design work

The new [right-panel meeting prototype](../../team-orchestrator/prototypes/meeting-right-panel.prototype.html) keeps A (roster), B (dedicated workspace) and C (guided stages) selectable. It shows sample Codex/Claude participants, review before invitations, safe-step joining, required-topic input, explicit deferral and draft outputs. All state stays in browser memory; it sends no real messages, starts no sessions and grants/applies no permissions or role changes. The two older prototypes remain unchanged.

Eleven headless-browser checks passed: all three layouts and 360-pixel narrow mode have no horizontal overflow; opening Review sends no invitation; joining waits for the simulated checkpoint; required input blocks advancing; outputs remain unpublished drafts and retain deferred topics; no page errors or external requests occur. [Screenshots and checks](../../team-orchestrator/docs/validation/meeting-right-panel-20261102). These are prototype checks, not native production meeting acceptance. The user subsequently selected **B**, the dedicated workspace with Agenda, Discussion and Outputs tabs and compact participant status. That resolves the layout direction, not every sample behavior or the production lifecycle. The start/join rule is the next open product question in [meeting lifecycle](https://github.com/herman925/925-cc-plugins/issues/181).

## Remaining work

Native Codex tools, guard installation/trust/revalidation, caller-scoped approval/attachment, provider-aware wake transport and a real mixed-model task flow remain to implement and verify. Automatic mixed-provider launching follows the first existing-session slice. Standalone operation remains a separate route in [host-adaptive coordination](https://github.com/herman925/925-cc-plugins/issues/179). Existing schema-7 model final-review/replay/restart/gate/question gaps remain visible. Meetings still need the chosen native UI and durable meeting contract/runtime; the sample page is not that implementation. Notify the user before handing tests to Claude.
