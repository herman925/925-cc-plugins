# macOS / local live validation for #125

Live checkpoint through 2026-10-16 08:48 UTC. The first six TeamWorks, including the recovery validation, are completed. Two additional Stop measurement Works remain diagnostic records; their outcomes below are not misrepresented as accepted total deliveries. Issue #125 stays OPEN / ready-for-human because the unverified cases below remain. PR #132 has merged; PR #133 delivered0.1.08. PR #134 now combines restart recovery and the active-Stop contract fix, with one final0.1.09 release step. This report distinguishes the tested candidate from that release.

## Environment and evidence boundaries

Stock Orca 1.4.223, commit ff4a51c872e723d87ab141044814301ea5a78634, darwin arm64. The real adapter gate observed Electron 43.7.5 and Node 24.21.0. Live tests began on d51f519 and continued on the unreleased 1409b2a candidate (integration 9f3f19a), display version 0.1.07 / manifest 0.1.7. Candidate revisions and formal release artifacts are separate. The combined question-origin and observation-version candidate e039e24 (integration bf23191) was copied while disabled, re-enabled, and initialized through native controls. Both affected live paths passed: the existing partial-team delivery was accepted at 06:42:11.753Z; the explicit supplement was delivered and authenticated by the actual Head, then the folder control-goal delivery was accepted at 06:44:06.289Z. No installed Orca source or binary was patched. The documented AXManualAccessibility attribute was enabled in memory for GUI automation after the user granted macOS permissions.

Codex CLI reported 0.162.1; actual terminal status displayed GPT-6-Astra / high (some sessions displayed fast). Earlier model and effort preferences were inherited from Orca. The user then requested Codex gpt-6.1-sol / medium and Claude Code default model / default effort, preserving mixed teams. Future-launch preferences were updated; the partial-preparation team Head and Worker-2 actually displayed GPT-6.1-Sol medium, and Worker-2 completed the read-only validation. Historical completed sessions retain their observed original models. The eight QA-owned Claude Code session logs report model deepseek-flash; CLI versions are 2.1.296 for the first Git workers and 2.1.301 for later sessions. These are observed response/session metadata, not a guessed Anthropic model. This validates the Codex and Claude Code CLI paths using the existing configured backends. Requested defaults and observed effective values are kept separately.

Tests used isolated Git and ordinary non-Git projects. All native launch and dispatch receipts match those exact local workspace identities. Provider credentials, runtime secrets, and unrelated conversations are excluded from exported evidence. Raw scoped receipts remain in the private local evidence directory; published extracts should contain only the identity, state, outcome, and proof references needed to reproduce a conclusion.

## Live matrix

| Case | Result | Evidence / limit |
| --- | --- | --- |
| Install, consent, initialize, connect | PASS | Genuine native settings and command palette; stock runtime accepted |
| Git four-member mixed team | PASS | Codex Head + Claude/Codex/Claude; real Run, 3 Tasks/Dispatches, 3 native succeeded reports, manager reviews, 4 tests passed, user delivery accepted |
| Ordinary folder four-member mixed team | PASS | Claude Head + Codex/Claude/Codex; all 4 prepared sessions reused by dispatch; real results and reviews, 4 tests passed, user delivery accepted; no .git created |
| On-demand vs all-at-start | PASS | Git created only Head during preparation; folder created exactly saved four members; no duplicate prestarts |
| Next objective uses fresh conversations | PASS | New Git and folder TeamWorks have new supervisor handles and Runs; previous accepted work retained |
| Write scope conflict vs independent task | PASS | B on summary.py stayed unstarted while A succeeded but awaited review; C on report.py completed independently; after A acceptance B started once, completed docstrings, and total delivery was accepted |
| Team and member admission pause | PASS | Two valid intents queued with zero Dispatches while team paused; team resume started independent Worker-2 while Worker-1 stayed paused; member resume then admitted Worker-1 |
| Two explicit failures and escalation | PASS after repair | Two genuine failures escalated to the user. An explicit new supplement reached the actual Head and received native answer-ack task_89ef0d876a63. The old blocked answer remained byte-identical and unsent; no third attempt occurred. The expected negative result remained failed, and total QA delivery was accepted |
| Malformed never-admitted intents | PASS after repair | Actual Head authenticated withdrawal of both never-admitted originals to exact corrected Tasks. Originals retained; correction differs only by workerRules; administrative withdrawal does not increment worker failures |
| Manual close then Wake | PASS after repair | Current folder Worker-2 exact native close confirmed; Head checked handoff; user created one approved replacement; genuine revalidation Dispatch succeeded and was reviewed. Wake bound, same member, new instance generation 3; old accepted result preserved |
| Stop current execution after next goal | PASS for prepared idle process | Correct current folder Worker-3 binding stopped with native-exact-stop and post-stop verification. Repeated Stop and two checks kept one byte-identical Stop row/version 4. Active Task interruption remains unverified |
| Plugin disable and reload | PASS | Original Runs/Tasks and pending failure question restored without recreation; disabled command absent; normal re-enable/initialize restored panel |
| Distinct permission revocation | UNVERIFIED | This stock dev-plugin UI exposes enable/disable and logs, no separate revoke control. Removal is not substituted |
| Whole Orca restart | PASS after explicit recovery fix | Actual desktop PID/runtime changed; original four handles/PTYs/incarnations/panes, Team/Work/Run and operation IDs remained. On source6259b83, one explicit Reconnect restored authorization without changing original binding/input/send/creation hashes. The original Head then dispatched the original Worker-2, received a genuine succeeded report, reviewed it and proposed delivery; explicit user acceptance completed the same Work |
| Physical machine sleep/wake | PASS | Actual macOS Sleep15:33:56 and Wake15:34:41 +0800,45seconds. Runtime, original session identities, Run generation1 and zeroTask count were preserved. After the explicit restart recovery fix, the same Head/Worker completed real read-only work and total delivery |
| Partial preparation interruption | PASS | Disabled through native UI after preparation began; 2 of 4 sessions settled before disable. Continue retained first two request IDs/handles and produced exactly four operations/handles. Exactly one genuine Worker-2 Dispatch reused its prepared session; four tests and median/pretty-report assertions passed; Head reviewed the actual report and proposed delivery; the existing delivery was accepted once on the repaired candidate |
| Native startup readiness failure | PASS for observed failure handling | A real Codex update prompt blocked an on-demand worker at agent_readiness. Native receipt confirmed the Task never ran. Skip caused no CLI upgrade; the actual Head followed native nextAction worker-release and verified released/exited, then only on explicit operator authorization used another saved member. No automatic retry or invented worker_done |
| Active native-owned Task Stop | PASS after contract fix | While the actual600-second Python command was running, one panel Stop produced a completed native workerStop receipt with state stopped, processAction closed_agent_terminal and ptyKilled true. Exact worker observation showed exited and the Python process disappeared. Repeat Stop and Check retained one Stop and version3 |
| Explicit recovery of a previously unknown Stop | PASS for same-request recovery and no false exit | Kept the original native UUID, exact plan/target and immutable historical unknown row. Native replay returned alreadySettled/processAction none because that measurement had naturally finished; UI kept unknown while its process remained alive, rather than claiming a stop |
| Provider backend outage / process spawn failure | UNVERIFIED | The observed update-prompt readiness failure is not evidence of every provider outage or failed process creation mode |

## Defects found on the real path

1. Exact stock 1.4.223 build was unsupported. Add its verified tuple while preserving strict unknown-build rejection.
2. Composite ordinary-folder workspaces were mislabeled Git. Read the native repository kind with exact repository identity verification.
3. Native Task creator authority uses PTY-qualified process identity, whereas terminal prompt acknowledgements use the raw incarnation UUID. Separate these identities throughout admission, review, delivery, and recovery; reject wrong PTY/incarnation/owner/generation.
4. Success could retain a stale absent-ledger warning, and dispatch reconciliation could retain an obsolete version-conflict warning. Clear only warnings superseded by matching native proof.
5. Delivery instructions did not make the worker_report:MESSAGE_ID evidence convention explicit. First Git delivery needed one recorded operator clarification; later protocol guidance fixes that gap without inventing acceptance.
6. Manual close and next-goal Stop control defects are described above. Never infer process death from a missing event.
7. Missing workerRules correctly refused admission but lacked a safe correction route. The repair preserves originals and requires an authentic, narrowly scoped supervisor withdrawal of a never-admitted/never-dispatched intent to its exact corrected replacement.

A stale-view acceptance refusal occurred for folder first delivery and Git second delivery; both were confirmed no-effect and succeeded after explicit refresh and retry. Partial-preparation delivery then refused twice, including after Check work evidence, while background observation advanced the Work version. The source cause was timestamp-only observations advancing Work.version. Repair e039e24 retains the version for equivalent state with refreshed observation times while genuine task, delivery and authority changes retain rejection. On the actual repaired candidate, the same saved partial-team delivery succeeded on its first explicit acceptance, followed by successful folder delivery acceptance. No automatic retry or acceptance-fence relaxation was used.

## Reproduction outline

Use the native plugin panel to create and confirm each project-bound Squad; choose the mixed per-member provider preferences; launch using the intended preparation mode. Submit the saved objective, then reconcile actual Head-owned Run and Task evidence. Validate the test artifacts independently before user acceptance. Queue the next objective before acceptance to observe fresh conversations. For the overlap case, hold A's supervisor review after its real success report and verify B has no Dispatch while C completes. For the pause case use valid corrected intents, because a malformed intent cannot prove admission pause behavior. For the failure case leave qa-input.txt absent and require actual failing checks, not fabricated failure reports.

Release version and packaged outputs were not updated per fix. After all current source fixes, reviews and the affected live reruns passed, one designated release subagent was assigned the single 0.1.08 / strict 0.1.8 metadata and artifact update. Remaining host interruption/scale validation is explicitly separate; this release does not close #125.

## Reproducible project contract

Create two empty, test-owned directories. Initialize Git in only the first; open the second through Orca’s ordinary-folder flow. In each create reading.py, summary.py and report.py with the function names imported below and bodies raising NotImplementedError. Put this unchanged contract in tests/test_contract.py:

```python
import json
import unittest
from reading import read_values
from summary import summarize
from report import render_report

class ContractTests(unittest.TestCase):
    def test_read(self):
        self.assertEqual(read_values(" 1 -2.5\n3 "), [1.0, -2.5, 3.0])
        self.assertEqual(read_values(" \n"), [])
        with self.assertRaises(ValueError): read_values("1 invalid 2")
    def test_summary(self):
        self.assertEqual(summarize([1, 2, 6]), {"count":3,"total":9,"mean":3,"minimum":1,"maximum":6})
        self.assertEqual(summarize([]), {"count":0,"total":0,"mean":None,"minimum":None,"maximum":None})
    def test_report(self):
        obj={"count":2,"total":3,"mean":1.5,"minimum":1,"maximum":2}
        value=render_report(obj)
        self.assertEqual(json.loads(value),obj)
        self.assertLess(value.index('"count"'),value.index('"total"'))
    def test_end_to_end(self):
        self.assertEqual(json.loads(render_report(summarize(read_values("2 4 6"))))["mean"],4)

if __name__ == "__main__": unittest.main()
```

For the first objective, assign one module per worker and require the genuine Head to review real worker_done evidence before proposing delivery. Run `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s tests -v`; the baseline must fail and the completed objective must pass all four tests. Workers may modify only their declared module. Do not edit the test contract to obtain a pass.

For the next Git objective, A adds median(values) to summary.py (empty→None, even→mean of middle pair, no input mutation), C adds pretty_report(value) to report.py exactly matching json.dumps(value, sort_keys=True, indent=2), and B adds docstrings to summary.py. Hold A’s supervisor review after its native succeeded report; confirm C progresses independently and B has no Dispatch until A is accepted.

For folder admission/failure tests, pause the team and Worker-1, then create valid intents: Worker-1 checks the deliberately absent qa-input.txt and reports the actual failed Python assertion; Worker-2 writes qa-independent.txt as ready plus newline. Resume the team first, then Worker-1. Request exactly one genuine rework after the first failure and escalation after the second; never fabricate a worker result or authorize a third attempt by silence. The eventual operator decision preserves the expected negative result and requires a genuine answer acknowledgement.

For partial preparation, create a fresh four-member all-at-start team, disable the plugin through native Settings while sequential creation is incomplete, record settled and pending operation identities, then re-enable/initialize and explicitly Continue roster preparation. Verify every original settled handle/request is retained and only the remaining members are created. Submit one read-only task to a prepared member, require actual native completion and review, then explicitly accept its total delivery. This is an interruption test, not a simulated provider rejection.

## Source checks after the latest repairs

Integration bf23191 contains the completion-origin Head-decision repair and timestamp-only observation version correction. The latest candidate passed 387 domain/bridge tests, 9 focused lifecycle/question browser tests, both pinned-host contracts and build; independent Spec and Standards rechecks have no remaining findings. The preceding question candidate passed all 59 browser tests and a final 3-test focused rerun. Candidate source inputs were byte-checked against committed source. The affected live supplement and both delivery acceptance reruns subsequently passed on that exact source candidate. The release metadata/build verification is recorded separately.

## Completed decision rerun identities

- Partial Work b87e55f7-5274-42f6-b3f5-f728d7591e8b: completed 2026-10-16T06:42:11.753Z, delivery task_cc33ba708d51, original Run run_734694af0a52 retained.
- Question 5658f585-8c38-42f3-aedf-a8291b712fec: answered; explicit supplement f571f588-30fe-46dc-8003-2de47e2f2f05 accepted and processing confirmed by authentic acknowledgement Task task_89ef0d876a63.
- Old answer 7384ee70-7272-405e-9b63-ab3d1ca5173f: still blocked/unconfirmed, unchanged canonical JSON SHA256 618041b6bc20b348fbf3544f81dd027f27cb03c35283900fddc12b833753f40a. It was not replayed.
- Folder control Work dfb5018c-db5c-4005-8990-b2e5fad6e88a: completed 2026-10-16T06:44:06.289Z, delivery task_3c3448c4933d, original Run run_a2796e27d913 retained. Exactly two qa-missing-input failed attempts remain; qa-input.txt remains absent.

These live paths support closing the corresponding development issues #107–#116 and #118 after their required fixes and consistent artifacts reach main. The remaining issues stay open under the user's live-evidence closure policy; lack of a live result does not mean their existing source implementation or fixture coverage is absent.

## Actual restart and sleep follow-up on installed 0.1.08

The user authorized closing other local sessions without archiving their work. Thirty-two local terminal sessions were closed; project source files were preserved. The current coordinator remained open. Four fresh test sessions were then prepared through the existing saved roster and a new Work was started only to create its genuine Head-owned Run, with zero native Tasks and no file-writing instructions.

Recovery Work: `8fed3b77-24fd-4b7f-9c62-72bf0385546d`; Run: `run_bcdbde078954`. The actual user quit and reopened Orca. Desktop PID changed 92042→81356 and runtime changed, while all four original native execution instances remained connected. Normal native initialization restored the plugin panel; Open verified session restored original pane UUIDs. No launch, objective, protocol or Task was automatically replayed.

Work is `needs_attention`, Run `unverified`, with “Native runtime epoch changed during observation; intent remains reserved.” This is the safe refusal required by the current guard, but the missing explicit reauthentication path prevents continued business work. Existing Stop→Wake is not a valid workaround for this live, zero-Task Head. No database edit, forced kill or weakened epoch check was performed. This remains tracked in #117.

The user then performed physical sleep/wake. The system event pair proves45seconds asleep; runtime, five total terminals including the coordinator, four member operation IDs, Run generation1 and zero native Tasks remained unchanged. This passes native session continuity and absence of duplicate effects. It does not establish resumed task execution, because the earlier authorization limitation remains. A strict explicit recovery fix was subsequently validated on those exact retained instances, as recorded below.

## Same-instance recovery and active Stop repairs: real reruns

Source6259b83 (unreleased candidate displayed0.1.08) was installed through native disable/copy/enable/initialize. Explicit Reconnect created audit `b506c251-2cff-4d12-a2c8-1799c1abff10`. Original Work binding, objective send and input hashes remained identical; all four original member creation identities and operation IDs remained identical. Native Run `run_bcdbde078954` stayed at generation1 with zero Tasks before the operator's new release message. The original Head then created Task `task_80667a4e072d`, attempt `cac1fb54-4fee-476e-9d02-dd1dcca57a20`, Dispatch `ctx_e23b01a78fb9`, reusing original Worker-2 terminal. Actual report `worker_report:msg_62ecc6fd6823` succeeded; the four tests and median/pretty-report assertions passed with file hashes unchanged. Genuine supervisor review and explicit delivery acceptance completed Work `8fed3b77-24fd-4b7f-9c62-72bf0385546d` at2026-10-16T08:21:42.868Z.

A separate prepared-worker Stop measurement exposed missing normal socket envelope contract version. The original native gate refused before effects; this was not a Stop success. After source8569cf0, explicit recovery reused native request `fdac9827-6488-4140-9ca1-6fa786cb80fa`, preserving exact old target/plan and the full previous unknown row. Because the command had finished naturally, the native response was alreadySettled/processAction none; the UI correctly retained unknown and did not claim process exit.

The positive active-stop rerun used a separately authorized, native-owned on-demand Claude Code member, after a different Codex member's genuine startup update prompt blocked readiness. Stop `c2b8c2c3-ff8e-4f57-96d4-3ddda0489e63`, native request `c71e4981-a511-4bd3-a091-3613af181d0c`, targeted attempt `a28ae648-9530-4879-b3f1-66cc54ecee04`, Dispatch `ctx_b582160ea45c`, Task `task_6551fe44ce35`. The exact Python process was observed executing before the click and absent afterward. The native durable receipt recorded `stopped`, `closed_agent_terminal`, `ptyKilled:true`, `replayed:false`; the native worker was stopped with exact exited observation. Repeated Stop plus evidence check retained one request and version3. This proves stopped execution, not a fabricated successful worker report or an accepted total goal.

Recorded operator/model deviations remain visible: the first180-second measurement ended naturally before a guarded Stop, so it did not pass; a supervisor encoded a Run newline literally and created three unused malformed Runs before the correct one; an accepted review's prose claimed rework but its structured decision was accept, so its invalid never-admitted follow-up remained a diagnostic record and was not forced through admission. Later measurements used explicit separate authorization and new task keys. No database edits, forged caller identity, altered old accepted review or artificial worker_done was used.

Final combined source8569cf0 passed464 domain/bridge tests,10 affected UI checks, both pinned host contracts and build; preceding9be5664 passed63 full UI tests. Independent Spec/Standards rechecks have zero remaining findings. One designated agent generates0.1.09 metadata/artifacts once after these actual reruns. Formal release testing and candidate live testing are separate records.
