# Ready-for-agent validation: #120–#124

Validated on 2026-10-16. All five development tickets passed their scoped validation after exercising the existing implementation and repairing observed defects. Human acceptance tickets #125–#131 remain open and unchanged. This record does not claim Windows/SSH, two-person installation or 11/21-member load acceptance.

Source input: `57d43ababa5a4453fa2dab3b59ec385da953b3d4`. One designated release agent produced release commit `c8ffe1929314b504ad919eb1834c3534e97f74c6`, version **0.1.11**, after all source fixes merged. Structured, sanitized evidence is in [the receipts file](ready-agent-120-124.receipts.json).

## Environment and method

Stock macOS arm64 Orca 1.4.223, build `ff4a51c872e723d87ab141044814301ea5a78634`, Electron 43.7.5 / Node 24.21.0. Original desktop PID 81356 and runtime `21b969f1-2209-4232-a416-8b8b9dcc554e` remained running throughout. Native tests requested Codex **gpt-6.1-sol / medium** and Claude Code **default model / default effort**. Claude defaults describe the configured backend, without asserting a particular underlying model.

Tests used actual native Head/Run/Task/Dispatch authority, worker completion reports, direct-supervisor reviews and panel user decisions. No native profile/database writes, installed-app patches, forged callers or fabricated completion reports were used. Input acceptance, actual completion, supervisor review and user acceptance were checked separately. Raw protocol tokens, private reports and database snapshots are excluded from published evidence.

Staffing, replacement, template exchange and hierarchy execution were measured on 0.1.10 and private source candidates before the consolidated release. The final source and 0.1.11 artifacts then passed the complete automated suite, actual hierarchy-history cleanup and formal-path connection smoke test. These are distinct observations; the version change alone is not a new provider execution test.

## Actual native validation

| Ticket / case | Result and evidence |
| --- | --- |
| #120 on-demand staffing | Actual Codex Head proposed one rejected and one approved Claude default worker. Rejection added no member. Approval added exactly one worker, whose admitted Task completed and received authentic direct-supervisor acceptance. |
| #120 direct addition | Panel added a Codex gpt-6.1-sol / medium reviewer. Its dependent Task followed the accepted first Task and produced actual file output, completion and review. Head acknowledged roster configurations 2 and 3; repeated checks produced no duplicate sessions. |
| #120 all-at-start staffing | Actual Claude default Head proposed AllReviewer. Approval prepared it once; native task start reused that exact prepared terminal. Its real read-only result and review succeeded. |
| #121 idle replacement | Same Worker-1 member changed Codex→Claude default→Codex gpt-6.1-sol / medium. Identity stayed fixed; generations advanced 1→2→3 with distinct native operations and both wake requests bound. |
| #121 busy refusal | During actual running Dispatch `ctx_6d488b7f48c8`, replacement refused: “Member has running, unknown or unreviewed execution.” Request count remained 2; no extra replacement session appeared. |
| #121 deferred organization change | Removal of unused Worker-1 stayed queued during the active Work. User acceptance applied roster 4→3 and configuration 3→4. Existing Tasks retained their identities and reviews. |
| #122 actual second profile | A separate stock Orca desktop/runtime installed and enabled the plugin, imported the actual four-role export with independent UUIDs, and created two independent same-name copies. Native disable/enable changed worker PID 40527→47741; reread preserved roles, preferences and reporting tree. Zero Work/Operation/Dispatch rows or member launches. Malformed JSON was refused without roster overwrite. |
| #123 real manual cleanup | Actual panel preview/apply succeeded for all three accepted Works below. Project bytes and retained native evidence stayed unchanged. Already cleaned Works became disabled selections. |
| #124 authentic three-level execution | Highest Head→Lead's original parent Dispatch→Lead's own native Run→leaf Dispatch at depth 2. Leaf completed; Lead reviewed it, then reported through its original parent Task/Dispatch/Run. Highest Head reviewed the actual parent report and proposed total delivery. |
| #124 complete delivery gate | First proposal omitted the leaf attempt; user acceptance refused with zero decisions. The actual Head corrected the proposal to include both accepted attempts; user acceptance completed the Work at `2026-10-16T11:22:29.280Z`. Panel evidence showed the leaf's owning Run, creator Dispatch and depth. |

The initial depth-2 native starts were refused with `effectsApplied:false` under maximum depth 1, without creating a child Dispatch. After explicit user authorization, the operator saved native Nested worker depth 2 through Settings, then used the same admitted Task normally. No standalone Run or replacement identity bypassed the refusal. After validation, the operator restored **1**, verified against the authoritative settings document in native `profile-state.db`, revision **19851**. The legacy JSON migration snapshot was not treated as current settings authority.

## Scoped native identities

| Work | Run | Accepted Task / Dispatch / worker report |
| --- | --- | --- |
| On-demand `88e44354-d5c7-40a9-93c2-7e44b900ce19` | `run_8d1a0f1abe46` | Approved: `task_b20476346446` / `ctx_be0f05e51b79` / `msg_745fc26e27de`; direct: `task_9d8c61814bf5` / `ctx_8cc11186b71d` / `msg_cd609434bd27` |
| All-at-start `04fa9093-1513-4ada-8114-b661f695d0db` | `run_0c3550f03c4d` | AllReviewer: `task_45ec9e0a70e8` / `ctx_76af95319377` / `msg_64769925b755`; busy proof: `task_f7bac4425f59` / `ctx_6d488b7f48c8` / `msg_799124493f11` |
| Hierarchy `48a38c6f-58c0-4ab0-a0fa-0c8f33a80676` | Head `run_765a3d34b169`; Lead `run_c735fa28d8cf` | Parent: `task_32bdeaeab618` / `ctx_f06834af3ce4` / `msg_ca7d2b071782`; leaf: `task_8de59c4835d9` / `ctx_0d232df2e5f3` / `msg_2197d00f8663` |

Accepted total deliveries: on-demand `task_a8a1816553d3`, all-at-start `task_4bba7259f5a3`, hierarchy corrected `task_a2088bccb319` (superseding incomplete `task_d40a6e0c8aca`). Hierarchy accepted attempts are `6865795e-bf50-4389-b2d9-18dbd3326535` and `773925ac-7f10-4a6c-9966-bffc5e8fc36a`. Leaf native creator Dispatch is the actual parent `ctx_f06834af3ce4`.

Second-profile runtime: `b12b7ff9-c916-4461-8b60-78af1fbf6450`; same-name target teams `d514c0ad-93f1-40d4-a920-08fb65bdb994` and `359b9f12-3750-444c-847c-3962ec9f2e36`. Export SHA-256: `7eca5b55aa8ca4c665ef975b05350fd0b7829742d295a309428bb19775406274`.

## Observed defects and repairs

1. Optional pending staffing proposals survived accepted Work closure, became impossible to decide, and blocked manual history cleanup. Verified acceptance now expires them transactionally; opening the store also reconciles authentic previously closed histories. Native proposal proof stays unchanged, and no staffing approval/rejection is invented. Only the corresponding proven historical display notification is exempted.
2. Frozen recipient replacement snapshots retained historical unknown statuses after successful native operations, bound wake requests and completed work. A proof-scoped, read-only uncertainty view corroborates exact runtime/scope/member/configuration/role/generation and accepted closure. It preserves raw snapshots and fences every dependency. Independent review added resumed-session ancestry and unsupported/future-format guards.
3. The hierarchy's incomplete overall delivery correctly remained pending after refusal, but its genuine accepted correction left the obsolete predecessor blocking cleanup. Cleanup now recognizes only the fully corroborated, contiguous accepted delivery chain. It preserves both original statuses and native proofs, rejects malformed, future, foreign, orphaned or cyclic chains, and fences predecessor revisions.

| Actual cleanup | Source / version | Preview and completion | Preservation checked |
| --- | --- | --- | --- |
| On-demand | `7e83b80`, candidate 0.1.10 | 1 Work, 6 records, 5 cached snapshots, 41,043 logical bytes; `2026-10-16T10:40:27.021Z` | Original staffing proposal and fingerprint unchanged; no fake user staffing decision; project files unchanged. |
| All-at-start after two replacements | `8ecf3c7`, candidate 0.1.10 | 1 Work, 6 records, 0 cached snapshots, 62,452 logical bytes; `2026-10-16T10:53:30.865Z` | Both raw unknown statuses, full recipient snapshot, both wake/native-operation rows and project files unchanged. |
| Hierarchy after corrected delivery | Final `57d43ab`, 0.1.11 worker 2869 | 1 Work, 8 records, 0 cached snapshots, 67,273 logical bytes; `2026-10-16T11:33:54.027Z` | Old delivery stayed pending, current delivery stayed accepted, both native proofs and project files unchanged. |

Logical preview bytes describe inspected plugin records, not reclaimed physical disk space. Detailed preserved-proof hashes are in the receipts file.

## Automated and independent verification

Final consolidated release passed **526 domain/bridge tests** (zero failures or skips), **64 browser tests**, build, metadata consistency, artifact syntax, hashes and diff checks. Both pinned host contracts passed: `9fdd90ffa7721e145f1353ad9fb9df2f70c31f43` and `ff4a51c872e723d87ab141044814301ea5a78634`. Independent Spec and Standards reviews at final source `57d43ab` each reported **zero actionable findings**.

Focused template/storage tests passed 29/29; actual exported JSON also passed public preview/import/reopen/export/replay through two isolated temporary stores with independent identities, retained roles/tree/preferences, no native launch and no Work/Dispatch. Those stores were removed.

Migration, backup failure, interruption/corruption injection, unsupported versions, concurrent panels, stale/replay edges, invalid trees, late superseded-member reports and unknown launch outcomes have fixture/store coverage. Destructive fault injection used isolated data; these checks are not described as live provider tests. Host contracts likewise do not establish actual agent readiness.

Final artifact SHA-256:

| File | SHA-256 |
| --- | --- |
| `main.mjs` | `f471497d3cd09386102381d86309afe4e7a294a581d5950427e022ed7662240f` |
| `panel.html` | `489ac277b2fb6a484292607343d179ed91ebcb1f508da5545697e731e018f00d` |
| `runtime-adapter.cjs` | `42f50b01555f575f774f3a4855791536b117056547c2896f6f96f85395464b63` |
| `orca-plugin.json` | `c4a0d0a061a93d0a133f422a815f0fd015ea48bff131798cb5f4543ec6c86d15` |

Aggregate artifact-manifest hash: `d4b95a12cfb7c16e52aae382cbabe731ef08d4f4c582793390158d5e849ade5f`. The runtime adapter remained byte-identical. Final live candidate and formal repository artifacts matched exactly.

## Teardown and final installed state

Authentic managers released reclaimable on-demand resources and the hierarchy leaf; the leaf showed released/exited. Prepared/reused parent and all-at-start terminals were intentionally retained as external resources by worker-release, with zero reclaimable rows. After settlement the operator closed their exact handles, with native PTY-stop confirmation. Test terminal tabs, native test project/worktree, test checkout, second desktop/profile, scoped Claude test directories, temporary source worktrees, candidate packages, screenshots, logs and raw private evidence were removed.

After confirming all three test Works completed and pruned with zero active Work/binding/member-dispatch/member-wake pointers, the operator disabled the plugin, verified its writer exited, and removed only this batch's test-owned plugin database. This explicit test teardown is separate from the product's manual history cleanup; neither action manually alters Orca's native ledger or global provider archives.

Native Development path was restored to this repository's `team-orchestrator-orca-plugin/`. Final **0.1.11** connection passed with worker **8437**, persistent storage loaded, empty roster and global nested depth **1**. The original desktop and two pre-existing terminal sessions remained running. Existing user untracked specification, analysis, glossary and handoff files were preserved.
