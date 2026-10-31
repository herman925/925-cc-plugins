# Independent guided setup 0.5.47 acceptance

## Decision

Accept the bounded UI increment with the coverage limits below. No confirmed product blocker remains on frozen v4. This is an independent test recommendation, not publication authorization.

Final candidate: local implementation commit 3276685, as reported by Codex. Seven runtime files match the final v4 manifest independently. Publication, merging and release installation remain Codex/user responsibilities.

Evidence root: C:/Users/Herman/AppData/Local/Temp/setup047-ceo-yOp6bl
Report path: C:/Users/Herman/AppData/Local/Temp/setup047-ceo-yOp6bl/FINAL-SETUP-047-ACCEPTANCE.md
Handoff thread: msg_2f5fc2742af7; original design/handoff thread: msg_81ba2a3cb66a.

## Measured checks

| Check | Result | Evidence scope |
|---|---|---|
| Final Mod suite | 397 passed, 0 failed; 41 files; 32.22 seconds | Frozen source-v4, v4-tests.log |
| Manifest/hooks validation | Validation passed with warnings | v4-validation.log; directory-submission checks separately report missing license/icon metadata |
| Packaged shared-store parity | 16 modules verified | sync-shared-store.mjs --check; no core changes or fresh PostgreSQL acceptance claimed |
| Final runtime identity | 7/7 hashes match in source-v4 and the explicitly overlaid running source-v3 path | v4-hashes.json; historical v3 preserved before overlay |
| Real global settings/install records | 2/2 SHA256 values unchanged | global-baseline.json; final verification |
| Actual project preference save | Native Review action saved scalar JSON through supported config.set | v3 native fixture, unchanged positive-path representation in v4 |
| New conversation, saved project | Connection shows On | same-project-remembered-on.json, v3 native evidence |
| Other project, same isolated client | Connection shows Off | other-project-default-off.json, v3 native evidence |
| Contextual approval | Actual Allow team management succeeded before Create | v3 authenticated fixture; auth-after-allow-settled.json |
| Separate Create | Created Setup047NativeTeam, 2 members, config version 5, bindings [], work [] | v3 authenticated native action plus exact typed projection |
| Explicit connection | Native session Select plus separate Connect linked Head, binding generation 1 | final v4 UI and typed inspectCaller/inspectTeam results |
| New authenticated conversation | controllerGeneration:null, member:null, teams:[] | final v4, operation setup047-new-conversation |
| Store-only navigation | Open teams; settled NEEDS APPROVAL; separate Allow team management | final v4; v4-neutral-access-settled.json |
| Narrow inline guided setup | Back from Review through Options to Members; native member selector opens | final v4; v4-narrow-options.json, v4-narrow-member.json, viewed v4-narrow-setup.png |

The final verification reads typed tool receipts from owned fixture transcripts. It does not inspect raw shared-store tables. final-verified-results.json preserves initial/final projections and the exact saved preference.

## Versioned native evidence

1. V1/V2 exposed a real native persistence defect.
   1.1 The manifest used multiple:true. The host omitted that option from config rows.
   1.2 Actual Review enable failed with the error below. No preference, approval or creation followed.
   1.3 Installed Claude 2.1.316 source confirmed that config-row construction skips multiple:true fields.
   1.4 Codex received the reproduction and repaired the representation. No manual preference seeding substituted for persistence.

```text
HooksError: team-orchestrator: $.config.set: no /config row with key team-orchestrator.projectWorkspaceModes ($.config.list names them)
```

2. V2 retained valid native editing evidence.
   2.1 Actual Edit inline closed the placed pane and retained one same-draft body.
   2.2 Team name, two-line purpose, member Select and Reports to Select worked through native controls.
   2.3 Multiline Chinese/English official instructions survived Back and Close/reopen.
   2.4 Settings showed the consolidated groups. Returning preserved the Review draft.
   2.5 These checks are retained v2 evidence, not fresh v4 executions of every field.

3. V3 repaired supported persistence.
   3.1 A fresh owned process loaded the scalar manifest. This avoided stale multiple:true host metadata.
   3.2 Actual Review enable saved this exact option in the isolated client settings:

```json
"projectWorkspaceModes": "[\"shared|c:/users/herman/appdata/local/temp/setup047-ceo-yop6bl/project\"]"
```

   3.3 sharedStorePreview stayed absent/default false in that isolated configuration.
   3.4 A new conversation in that project displayed On. Another project displayed Off.
   3.5 A separate authenticated fixture used a declared per-invocation project override. It did not save real global options.
   3.6 Actual simulated-user Allow and separate Create succeeded in that disposable authenticated project.
   3.7 After Allow, Review still displayed a separate Create team button. Approval did not itself create the team.
   3.8 Successful creation selected Team workspace. Initial typed data showed two active, unconnected members and zero work.

4. V4 added only malformed-setting refusal relative to v3.
   4.1 Historical source-v3-preserved remains separate. The running source-v3 path was explicitly overlaid with final v4.
   4.2 source-v4 is the separate frozen final copy. Both paths match all seven final runtime hashes.
   4.3 The final suite covers malformed preferences refusing saves/private calls, including inherited globalOn.
   4.4 Actual native selection displayed This verified conversation. Separate Connect then linked Head.
   4.5 Final typed projection contains exactly one binding, generation 1, for the original conversation and Head member.
   4.6 Worker remains unbound. Config version remains 5. Work remains empty.
   4.7 A new authenticated conversation in that same project has no controller approval or member binding.
   4.8 Its primary label is Open teams. The settled access panel says NEEDS APPROVAL, not that the project has no teams.

## Selection and authority boundaries

The initial post-create typed projection has bindings:[]. A subsequent pre-connect projection also has bindings:[]. Final native Select evidence shows the selected session and a separate Connect selected session button. Final post-connect projections agree on one Head binding.

One earlier focus attempt failed before selection. Its model prompt described the intended selection prematurely. Do not count that attempt, or the model's corresponding narration, as proof of a successful dropdown choice. The later native selection and explicit Connect succeeded. There is no extra typed projection between that later successful choice and Connect. Thus the strongest live claim is: initial/pre-connect data was unbound; native selection showed the separate action; explicit Connect produced one binding. The final suite independently covers selection having no binding side effect.

The new conversation's empty teams projection is withheld discovery, not an empty-project assertion. No approval was clicked in that new conversation. Existing approval remained scoped to the original authenticated conversation.

All approval and connection mutations here are authorized simulated-user native actions in owned disposable fixtures. They are not human approval of the real project. No forged ticket, private handler invocation, copied credential, weakened verifier or raw database mutation was used.

## UI observations and limits

| Area | Observation or limit |
|---|---|
| Pane | Actual pane painting observed. Pane field editing remains unverified. |
| Supported fallback | Actual Edit inline worked and retained the same draft. This is not pane-input acceptance. |
| Narrow layout | Viewed 1450x1120 window capture shows the inline Members step and open native selector in the available terminal area. This is not a calibrated 60-column claim. |
| Scrolling | Native focus exposes controls. Long forms can require native scrolling; not every field appears simultaneously. |
| Normal screenshot attempt | v4-normal-workspace.png is rejected visual evidence. Window movement produced clipped/black content. Typed/UI readbacks remain separate evidence. |
| Inherited globalOn on Create | Covered by final host tests/source review, not a live authenticated globalOn persistence run. Real global option writes stayed prohibited. |
| Malformed scalar | Final suite/source evidence only; no live externally corrupted configuration fixture claimed. |
| Bound leaf tasks | Final regression suite covers existing behavior. No fresh leaf-worker lifecycle run belongs to this 0.5.47 increment. |
| Unknown creation/read failure recovery | Final host tests cover retained identity and receipt handling. No native transport-fault injection claimed. |

This is layered isolated persistence plus separately authenticated native approval/create evidence. It is not one combined defaultOff-to-approved-created live run. The handoff explicitly permitted this layered method. V4 retains the same scalar manifest and ordinary positive paths as v3.

## Harness faults retained

1. The first final receipt assertion selected the intentionally invalid inspectTeam request using name. The API correctly refused API_INPUT_INVALID.
   1.1 The fixture retried with teamId and succeeded. The read-only evidence parser now selects the actual successful typed receipt.
2. Some early native key focus attempts failed or hit stale redraw state. Those attempts are excluded from positive input claims.
3. The normal screenshot capture failed geometry verification. It is excluded from accepted visual evidence.

No product source change occurred in response to these harness faults. First-failure artifacts remain available.

## Preservation and restoration

| Resource | Final result |
|---|---|
| Real project .team-orchestrator/ | No read of raw DB, mutation, approval, migration, deletion, commit or cleanup by this acceptance work |
| Unrelated docs/validation/ | Preserved; git still reports the untracked directory |
| Repository implementation | Tester made no implementation edits, commits, pushes or publication |
| Real settings.json | SHA256 unchanged: d45cb9ad6f88dbe654f48065e7f0fd5e691d21cc6fc17e333d5346465a51925b |
| installed_plugins.json | SHA256 unchanged: 2c12b2a93a8a3236df7b70374f40bc84c5637c62b3952aaa24d0cfff187f54ca |
| Original provider transcripts | Read-only evidence extraction; no edits |
| Orca window | Exact baseline bounds restored: x=-5173,y=545,width=4154,height=1682; topmost:false; PID56964/handle792174 verified |
| Current 0.5.47 fixtures | All six fixture terminal handles present in final local inventory |
| Older .45/.46/schema terminals | Tester did not close them. Their historical handles are absent from the final local live inventory; continued liveness cannot be confirmed. Historical evidence directories remain untouched. |
| Snapshots | V1/V2/V3 preserved; final V4 separate; failed persistence and input artifacts retained |

Current fixtures:

| Fixture | Terminal |
|---|---|
| Original v1/v2 draft | term_9602fe20-4232-424e-8e0e-4a650ae4fd63 |
| Isolated project persistence, final overlay | term_fa2016ea-aebf-4e06-8e02-8f2dc8b2096b |
| New same-project isolated conversation | term_ee62c349-9b79-41e0-bbf4-74cc50c3279d |
| Other isolated project | term_8059121b-4577-43c0-a049-b32f6b670ffa |
| Approved/created/Head-connected authenticated fixture | term_6b8d62de-1900-4228-b7b7-6b7be0921ec6 |
| New unapproved authenticated conversation | term_413a885f-93a4-4e5b-866c-b6af9c4711cb |

## Scope boundary

No migration, scheduler/replay/delivery, automatic task-window fencing, worker launching, rejected-task recovery, Orca plugin integration, whole-Orca restart, release installation or broad lifecycle acceptance is claimed.

No broad PostgreSQL rerun was required or performed for this unchanged-core UI increment. No new framework, engine, launcher, scheduler or transport was introduced by this acceptance work.

Conclusion: the confirmed v1/v2 native-save blocker is repaired. Final v4 has 397 passed, 0 failed, working explicit connection and new-conversation authority isolation. Accept this bounded release with the listed unverified areas kept explicit.
