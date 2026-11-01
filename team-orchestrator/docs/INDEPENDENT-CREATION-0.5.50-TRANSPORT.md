# Independent 0.5.50 creation-journey acceptance

## Recommendation

Accept the three repaired creation journeys on frozen transport-fix runtime bytes. No confirmed blocker remains. This is a test recommendation, not publication authorization.

Handoff thread: msg_33504e8e5f63. Verified manifest: team050-runtime-hashes-transport.json (HEAD b96ae61). Superseded manifests not used. Evidence root: C:/Users/Herman/AppData/Local/Temp/team050-ceo

## Measured results

| Check | Result | Evidence |
|---|---|---|
| Suite on final6 copy | 414 passed, 0 failed; 43 files; 38.95 seconds | tests-final6.log |
| Suite on transport fix | 414 passed, 0 failed; 43 files; 40.18 seconds | tests-transport.log |
| Transport manifest | 6/6 SHA256 match | team050-runtime-hashes-transport.json |
| Actual native dock | placement:dock, bodyColumns:57, viewport 136x47 fullscreen | native.debug.log, read-only observer |
| Restored templates | Squad, All-Purpose Team, Tech Team buttons on Step 1 | step0-open.json, squad.json, allpurpose.json |
| Template preview counts | Squad 4 members; All-Purpose 11 members | squad.json, allpurpose.json |
| Template apply | Team name became All-Purpose-Team; purpose and options kept | applied-ap2.json |
| Member picker expand | 11 options, each name once, arrow became the up mark | picker-open.json |
| Member picker collapse | Same control closed it | picker-closed.json |
| Picker explicit close | Close member picker closed it, selection kept | picker-closed-btn.json |
| Head label duplication | No `Head · Head` string in any rendered capture | step0-open.json, picker-open.json, review-members.json |
| Interview me present | Button on Step 1 | step0-open.json, back-team.json |
| Interview submission | Plugin prompt submitted with live interviewId | t-interview-submitted.json (token 55ea041abf1280de7654981eda505445) |
| Proposal into Review | Step 4 of 4, Review & permission, proposal applied | t-qcard.json, proposal-review.json |
| Proposal editable | Review members opened the editable builder | review-members.json |
| Protected globals | 2/2 SHA256 unchanged | global-baseline.json |
| Window bounds | -3449,363,-679,1485 recorded; no move or resize performed | ctypes GetWindowRect |

## The three repaired journeys

### 1. Member picker

The picker is now a controlled Button menu, not a host Select. It works:

1. `Edit member: CEO ▾` opened the list of 11 template members.
2. Each option showed its name once. No `Head · Head` duplication.
3. Pressing the same control again changed the mark to `▴` and collapsed the list.
4. Pressing `Close member picker` also collapsed it, and the selection survived.
5. Selecting `Team 1-Head` moved the detail panel to that member with `Reports to : CEO` and changed the mark back to `▾`.

Herman's reported inability to collapse is not reproducible on this candidate. The doubled `Head · Head` label is not present anywhere in the rendered captures.

### 2. Creation templates

Step 1 shows `Start with a template` with the three original buttons: Squad, All-Purpose Team, Tech Team.

1. Squad previewed `head + 3 workers · 4 members`.
2. All-Purpose Team previewed `CEO + 2 heads, 4 workers each · 11 members` plus the disclosure `Named reporting branches in one shared roster.`
3. `Use template` set the draft name to All-Purpose-Team and installed the members. The typed purpose and the numeric options were kept, as the on-screen note states.
4. Template apply, Cancel template and the draft remained separate from Create and from permission.

### 3. Interview me

The button was present on Step 1 and behaved as designed:

1. Pressing it submitted one plugin prompt carrying its live interviewId.
2. The model answered the interview and called the team_draft tool.
3. The proposal filled the draft and moved the panel to Step 4 of 4, `Review & permission`.
4. The panel showed the proposal name, purpose, member count, capacity, pickup and answer values, the project path and the separate `Project access` block.
5. No `Create team` run button existed at that point. `Check project access` remained an unperformed separate step. No approval, project-mode save, bind or launch occurred.
6. `Review members` opened the editable member builder inside the proposal.

## Defects found by this test

### Real, fixed before this run

Final2 stopped the whole plugin loading. `on("prompt.submit")` was registered twice with no matcher, and the host refused the module. Recorded at 145 passed, 269 failed. Codex withdrew that experiment.

### Real, found natively at final6, fixed before this run

At final6 the draft tool failed on every call. The native transport rejected the reply shape:

```text
invalid_union, path [], "expected string, received object"
```

The tool was declared to return text, and the hook returned an object. Codex fixed it at b96ae61 so the draft tool replies as JSON text; the new test asserts a string result and parses the status. Re-verified natively here: the proposal now fills the draft.

### Visible presentation, not a blocker

The plugin-submitted interview prompt prints the whole protocol, the live interviewId and the full draft JSON into the visible transcript. Herman asked me to judge the actual native presentation rather than the SDK framing. It is large and technical, and it dominates the screen while the interview runs. The product panel itself stayed clean, and the journey completed. I report this as an observed presentation cost, not as a functional defect, and make no recommendation to change it.

## Harness faults and limits

1. First native fixture was launched with a standing user instruction of "no tool use". The model correctly obeyed the real user over the plugin prompt, so the interview did not run. This was a fixture authorisation conflict, not a product defect. A bounded simulated-user authorisation was then sent inside the same owned fixture, with no Create, approval, mode save, bind or launch, and the interview then ran normally. The initial refusal transcript is preserved as a harness caveat.
2. `bun test` is not the right runner for this plugin; it fails to resolve `claude-code/testing`. The official `claude plugin test .` passes 414/0. An earlier failure I reported was this harness fault, not a product fault.
3. Native clicks on the band control did not always register; the keyboard focus route `Ctrl+X` then Tab, then Enter, was used instead. This is a test-input limitation.
4. Screen reads return 22 rows of the rendered frame. Long lines beyond the frame are only partly readable. The evidence captures are the visible frame, not full scrollback.
5. No team was created, no management approved, no project mode saved, no session bound or launched anywhere in this run.

## Preservation and exit scope

| Resource | Final state |
|---|---|
| Real repository .team-orchestrator/ | No read, approval, mutation, migration, deletion or cleanup |
| Unrelated docs/validation/ | Preserved |
| Global settings and install records | Both baseline hashes unchanged |
| Renderer | Only the declared per-invocation fullscreen; no global change |
| Window | No move or resize |
| Prior .49 fixtures and reports | Preserved; the earlier owned .50 fixture terminals were closed |
| Tester implementation or publication | No product edits, commit, merge, push or installation |

No schema, PostgreSQL or lifecycle acceptance was repeated. No scheduler, delivery, worker execution or outcome acceptance is claimed.

Conclusion: all three reported journeys work through normal native controls on the frozen bytes at b96ae61. Independent suite: 414 passed, 0 failed. One real native transport defect was found at final6 and is fixed and re-verified. Recommend acceptance with the stated limits.
