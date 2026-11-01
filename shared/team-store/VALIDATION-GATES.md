# Gate application, deadline returns, and minimum-Node verification

Unreleased development increment on `feat/shared-team-runtime`, after `eb3f969`. It implements Herman's decision: answer every effective gate, then resume the same assignment while it is still valid. It does not release schema 6 or establish autonomous lifecycle acceptance.

## Automated evidence

| Check | Result |
| --- | --- |
| Full SQLite + real PostgreSQL, Node **22.13.0** | **276 passed, 0 failed, 0 skipped**, 68.07 seconds |
| Full native Mod SDK suite | **433 passed, 0 failed**, 45 files |
| Product hook validation | Passed with existing directory metadata warnings |
| Runtime packaging | **21** byte-identical source/packaged modules |
| Native snapshot comparison | Those 21 modules plus the 3 changed UI/transport modules match the recorded snapshot files |

The minimum-Node run used SQLite **3.47.2** and disposable PostgreSQL **18.6**. PostgreSQL was stopped after each run. The official Windows Node archive was downloaded into a unique Temp directory and matched its [published SHA-256](https://nodejs.org/dist/v22.13.0/SHASUMS256.txt); no installed Node runtime was replaced. Docker execution was attempted but its local daemon pipe was unavailable; Docker acceptance is not claimed.

Evidence is committed under [validation/schema-6-gates](validation/schema-6-gates/): the two-engine output, full Mod output, product validation, archive checksum, module hashes, and bounded native evidence. Validation's existing author/license/icon directory findings remain; a source-hook pass does not establish directory submission acceptance.

The suites cover multiple gates, exact offered choices and optional notes, immutable replacement links, one conditional winner between independent database connections, unchanged assignment on resume, an expired answer before/after observation, unresolved gates retained by retry, current-head checks during receipt recovery, task deadlines while blocked, and stopping the task clock at explicit worker outcome. Upgrade probes preserve opaque historical gate data, block tasks with open gates, and roll back ambiguous terminal-task/open-gate upgrades.

## Native check, without model credit

Owned fixture worktree: `C:/Users/Herman/orca/workspaces/925-cc-plugins/runtime-gates-20261101`, based on `eb3f969`. Its frozen product snapshot and test driver are in `C:/Users/Herman/AppData/Local/Temp/team-gates-native-20261101`. The earlier `runtime-ui-20261101` fixture remains separate and unchanged. Both are disposable test data, not the real main-workspace store.

The native driver is another Mod invoking the actual registered product tools. Controller permission was granted through actual product controls. It does not mint approvals, substitute API responses, or supply model-chosen actor facts. UI navigation used targeted PTY keyboard input with independently observed native focus keys. The driver requests pane focus; default OS focus behavior is not established by this instrumentation.

Verified sequence:

1. The native Update workspace control upgraded schema 5 to the current draft schema 6. A backup was created; **zero approvals** existed immediately afterward.
2. Separate native management actions approved the two conversations. Verified self-bindings remained at generation 1.
3. The head used Reassign task on the preserved rejected attempt. The worker retrieved the official role and admitted brief through the native API.
4. Through native Inputs, the head entered a question and two separate choices, then pressed Save gate. The task became blocked. A worker report was refused with **API_TASK_BLOCKED**.
5. Through the panel, the head entered an optional note and selected an offered choice. The recorded gate became resolved, the **same assignment** resumed, and a durable status message was queued. The worker read dispatch and resume messages in FIFO order and confirmed their local recovery receipts.
6. Explicit worker outcome left acceptance pending. Worker self-acceptance was refused with **API_HEAD_REQUIRED**. The head read the outcome, confirmed receipt and accepted separately.
7. The bounded final snapshot shows a succeeded task, the original rejection plus the separate accepted attempt, three acknowledged deliveries, and both bindings at generation 1.
8. A fresh native typed-API probe opened two gates. The first answer did not resume; the last did. Final inspection showed the same assignment at attempt generation 1. These extra unpicked fixture tasks remain available for inspection and can later expire through the normal observer.
9. An explicit private bridge inspection using the downloaded **Node 22.13.0** verified the native caller, its controller approval and binding at generation 1. The full native flow above used the configured installed Node runtime; changing a fixture settings file and reloading plugins did not establish a changed active runtime. The minimum-Node native claim is limited to that separate bridge inspection.

The arithmetic result is supplied by the test driver. No autonomous agent reasoning, model wake-up, or model-driven completion is claimed.

## Issues found and corrected

The initial native reassignment callback exceeded the host's 10-second UI budget while awaiting transport along with mutation/refresh. Product actions now confirm their durable receipt and schedule transport on a separate host timer, with the periodic pump as recovery if reload cancels the timer. A regression checks that scheduling performs no immediate transport I/O and coalesces pending timers. Native gate save/answer callbacks completed after the change, with no additional callback timeout observed in that sequence. The old timeout line remains in the retained transcript.

One recipient poll returned `retry:true` when a stale staged read could no longer win its generation check. Polling again recovered the message. The test driver initially tried to confirm that empty poll; its own error was corrected by waiting for an actual receipt. Another driver probe sent extra authority fields to the strict `inspectAssignment` shape and was correctly refused; a corrected fresh probe passed. These were fixture-driver errors, not product defects.

The first conformance run used an older error-pattern assertion that did not recognize `STORE_GATE_IMMUTABLE`. That assertion was corrected, and the full final minimum-Node/two-engine run passed. Historical validation reports are retained rather than rewritten.

## Remaining acceptance and scope

A read-only native target check identified the idle-worker wake limitation precisely: **API_NATIVE_UNVERIFIED — Target binding requires an explicit native Claude conversation association.** The target lacks that association before a real model turn. The verifier was not weakened. A live model test must establish native associations, then verify automatic delivery and resume behavior. Queue reservations and explicit recipient reads do not establish that acceptance.

No whole-Orca restart, Docker execution, remote transport, legacy file import, hosted Mod configuration, question/answer deadline transitions, broader scheduler, or Orca-plugin store integration is established. Question-window columns alone do not implement bounded question exchange.

The real main-workspace `.team-orchestrator/` was never used. No plugin install or global configuration-changing command was requested. Native startup can write profile metadata; no global-profile baseline was captured, so an unchanged global profile is not claimed. Owned fixture sessions and test data are retained for independent inspection. This increment is not merged to main or published by this report.
