# Independent schema-5 acceptance — completed bounded source-Mod flow

Date: 2026-10-31. Tester: CC Plugin CEO session. Codex owns product source.
Evidence root: `C:/Users/Herman/AppData/Local/Temp/schema5-ceo-acceptance-eokqi0`.

## Result

The bounded fresh-team source-Mod flow passed after two real live failures were repaired.
This is not acceptance of inbox/replay/scheduler/gate/migration or Orca-plugin shared-store integration.

| Independent check | Measured result | Evidence |
| --- | --- | --- |
| Initial schema-5 full suite, SQLite + real PostgreSQL | 211 passed, 0 failed, 0 skipped; 38.41 seconds | both-engines.tap/json |
| Initial SQLite-only suite | 113 passed, 0 failed, 6 standalone PostgreSQL skips | sqlite-only.tap/json |
| Final full suite after native verifier repair | 217 passed, 0 failed, 0 skipped; 30.35 seconds | both-engines-final.tap/json |
| Focused repaired native verifier suite | 7 passed, 0 failed, 0 skipped; included in final 217 | native-repair-independent.tap |
| Runtime packaging | 16 packaged modules byte-match shared source | sync-shared-store.mjs --check output |
| Fresh source Mod | Actual --plugin-dir copy overrides installed Mod | controller-A.debug.log |
| Actual scratch approval | Successful panel receipt plus database approval/operation rows | idle-retry-success-screen.json; idle-retry-database.json |
| Fresh team | 2 members, config version 5, both member generations 1 | team-head-bound.json; live-final-verification.json |
| Native member bindings | 2 exact session/terminal/incarnation bindings, generation 1 | primary-flow-final-db.json |
| Unapproved conversation | controllerGeneration null/member null; team inspect refused API_BINDING_REQUIRED | Worker B primary transcript |
| Worker role/brief ordering | verify result, explicit requirements text, then fixture command; separate ordered events | worker-ordered-events.json; live-final-verification.json |
| Fixture result | 13 words; exact first line; 97 bytes; hash matches | fixture-independent.json |
| Worker outcome | One succeeded attempt, generation 3; task still open; 0 acceptance rows | after-worker-before-head.json |
| Self-acceptance | Valid-shaped worker call refused API_HEAD_REQUIRED | s5-worker-self-accept-exact-1 in Worker B transcript |
| Head review | Actual inspect result and review text precede acceptTask | live-final-verification.json |
| Head acceptance | 1 separate accepted row by s5-head; task succeeded | primary-flow-final-db.json |
| Two controllers | A/B separately approved; both generation 1, revoked 0; both retain API access | two-controller-db.json; live-final-verification.json |
| New conversation | Fixture C initially had no approval/member | s5-C-before-approval receipt |
| Same-conversation process resume | Same C conversation; changed PID/process birth; approval unchanged; inspectCaller/controllerGeneration 1 and inspectTeam succeed without new approval | resume-C-verification.json |

Node v26.9.0. Real SQLite 3.53.4 and native PostgreSQL 18.6.
Codex separately reports Node 22.13 SQLite acceptance. That minimum-runtime run is not my independent execution.

## Actual source and fixture configuration

Created a new isolated source copy and new scratch Git repository before the first run.
Captured initial Git status and 188 source/document hashes in source-baseline.json.
No old schema-4 store or existing team store was used.

The source Mod is unreleased and still reports 0.5.42. Version is NOT provenance evidence.
Debug confirms the isolated --plugin-dir Mod overrides the installed Mod.
Initial fixture-only change: manifest sharedStorePreview.default=true.
Per-invocation session-options.json disables installed team-orchestrator for this test invocation and enables inline preview.
No global settings or installed plugin copy was written by this acceptance session.

Authorized updates applied only to the isolated fixture:

1. UI repair: hooks/register.tsx, hooks/shared-store.tsx, types/index.d.ts. All 3 copied and hash-matched. Old files preserved in pre-ui-patch/.
2. Idle-caller repair: store/mod-native.mjs ONLY. Packaged/shared/copy SHA256 all equal `fab8a3daef4cc646211e2e91236998c8efd11bb6a20b500a9d544a1ec84ee12c`. Old file preserved as pre-idle-caller-mod-native.mjs.

Final isolated runtime files match current source. Remaining differences are the disclosed preview manifest and stale unused shared-store.test.tsx (test source was intentionally not copied).
Declared baseline deltas are recorded in declared-source-deltas.json. Codex made those source/document repairs; this testing session made no repository edits.

## Real failures and accepted repairs

| Failure | Direct evidence | Repair and verified result |
| --- | --- | --- |
| Shared store button did not navigate | Real user click logged tab-shared; roster persisted; later stale button handles | Render made state-only; actions awaited; extra animation stopped. Actual page readback then showed correct project/conversation/terminal/button. |
| Idle approval refused native association | Actual approval handler minted ticket, child returned API_NATIVE_UNVERIFIED; native idle tab omitted providerSession | Caller-only exact OS parent + registry process-birth path. Exact native host/root/context/incarnation and conflicting-provider refusal remain. Actual approval succeeded, with database readback. |

The idle repair does not give target bindings the caller-only fallback.
Both real target bindings nevertheless succeeded in this run using the actual verifier; no copied-ID or title fallback was supplied.

## Approval provenance

All three approvals are clearly labelled SIMULATED-USER FIXTURE ACTIONS, not observed human approvals.
The user explicitly authorized actual panel activation in this disposable project.
No approval was granted in the real repository.

Used native terminal keyboard navigation (Ctrl+X, Tab, focus readback, Enter) to invoke the real Shared store and approval Button handlers.
Debug records exact shared-approve-controller focus, panel-generated scoped ticket write, Node subprocess result and awaited handler completion.
No ticket was hand-written or replayed; no direct factory call replaced live panel approval.

GUI coordinate clicks were unreliable because the provider restored/resized the window and screenshots could show occluded/other content. Their synthetic receipts are NOT approval evidence. The terminal keyboard path demonstrably reached the real handlers.

## Primary live flow

| Logical member | Conversation | Native handle | Binding generation |
| --- | --- | --- | --- |
| s5-head / Controller A | 65199823-8eb0-4ae4-83e6-4d7728752d15 | term_3a05373a-bade-4458-8a9a-0a6b1ade67f7 | 1 |
| s5-worker / Worker B | d7d7b451-3d8f-4c43-8aad-1697e2f858b0 | term_fef5811b-74aa-4d5f-a806-62f1b7c663e2 | 1 |

Team: s5-live. Run: s5-run-1. Task: s5-task-1. Assignment: s5-assignment-1.
All required team settings were explicit fixture choices: pickup 2 min, answer 3 min, task window null/off, replay interval 1000ms; no product default inferred.

Head admission wrote the durable assignment before one external terminal-send delivered the assignment reference.
That external test transport is separate evidence, not a new Mod inbox/transport claim.
Pickup occurred at 1793446498542, before pickup deadline 1793446559167.
Task deadline remained null because task window was explicitly off.

Worker verifyAssignment returned role and brief. The worker stated their requirements before its single read-only fixture Bash command.
The successful pickup result and requirements text are strictly earlier primary transcript events, not parallel-batch assumptions.

Exact fixture first line: `Schema five source Mod acceptance fixture.`
Word count: 13. Lines: 2. Bytes: 97.
SHA256: `7575e60e54d54bbb9a59d1e873ba652bed9f0742135cd183d2330db58b0a3b71`.
Independent measurement matches the stored worker evidence.

Worker explicit report left task open/outcome null and acceptance absent.
A correctly shaped worker acceptTask call returned:
`API_HEAD_REQUIRED: Only the admitting current direct head may decide acceptance.`
Head then inspected, reviewed evidence in text, and accepted in a separate call.
One task_acceptances row names s5-head; one assignment_attempts row records worker succeeded; task then becomes succeeded.

Model input mistakes are retained, not counted as product policy evidence:
The worker initially added unsupported fields to reportOutcome/acceptTask/inspectAssignment; strict API validation refused them. Only the final valid-shaped authority denial establishes self-acceptance protection. Exactly one committed worker outcome receipt exists. No duplicate work or outcome was written.

Primary flow verifier confirms 0 Head file-tool calls after lifecycle start, 0 Worker Write/Edit calls, one attempt, one acceptance and one successful outcome receipt.
The earlier Head read-only investigation of the malformed slash prompt is outside lifecycle start and is not hidden as zero whole-session file calls.

## Controller coexistence and resume

B was initially unapproved/unbound and refused team access. After primary task settlement, B was separately approved through its actual panel. A remained approved. Both later inspectCaller/inspectTeam calls succeeded.

Created ONE new dedicated fixture C for safe process resume; A/B were not stopped or resumed.
C conversation: `34e123cf-fe64-459c-9418-d4349dcf3fd7`.
Handle: `term_3615210a-4a4c-47c4-a0a1-9afcf66d257d`.
C initially returned controllerGeneration null/member null, then received its own actual panel approval.
After confirmed idle, sent /exit ONLY to C; verified old PID 48824 exited (ESRCH) and shell showed the exact resume instruction.
Resumed that exact conversation in the same project/terminal with the isolated source flags.
New PID 21768 and different OS process creation fingerprint were recorded. No simultaneous duplicate conversation was launched.
Fresh API native verification succeeded; controllerGeneration remained 1; inspectTeam succeeded; approval row including approval time stayed identical. No post-resume approval click occurred.

This proves provider-process restart/resume in the same Orca terminal, not an Orca application restart, changed-terminal binding recovery, cross-machine transfer or a changed PTY incarnation. No new member binding was tested for C because C is a controller-only fixture.

## Test-harness faults, preserved honestly

1. Git Bash converted the first bare /team terminal argument to C:/Program Files/Git/team. Tester error, not product defect; fixed per invocation with MSYS_NO_PATHCONV=1.
2. The PostgreSQL package lacked createdb.exe. Initial SQLite suite passed; runner stopped its own cluster after ENOENT. Continued through SQL CREATE DATABASE, then full engine runs passed. File-backed PostgreSQL control output avoided prior inherited-pipe problems.
3. Primary transcript verifier initially counted an earlier path-investigation Bash as lifecycle Head work. Scoped it to lifecycle-start operation instead; original failure output remains in session tool history.
4. Resume-row deep comparison initially differed only by node:sqlite's null object prototype versus parsed JSON. Normalized a copied row and compared every actual value; approval data matched unchanged.

No product source was changed for these harness faults.

## Preservation and limits

All added acceptance scripts/reports are outside the repository.
Disposable own PostgreSQL stopped after final run; pidfile absent.
A/B remain retained; C is resumed and retained. Original schema-4 resources and unrelated sessions were not closed or modified.
Panel-generated private approval tickets are left under native configuration by the product; no settings file was altered.

No whole-Orca restart, Docker execution, existing-team migration, inbox/replay/scheduler, automatic fencing, gate application, rejected-task recovery, shared-store Orca-plugin integration, commit, push or release was performed.

No remaining product defect was confirmed in the bounded flow after the disclosed UI and idle-caller repairs. The broader product remains unaccepted beyond the measured scope.
