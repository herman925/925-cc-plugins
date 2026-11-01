# Addendum: catalogue build and the real question card

This addendum follows the immutable transport report FINAL-CREATION-050.md (sent msg_0ff5b8142203, SHA256 a63f7b5f411517701d9673f80f959424a1f3472b84af963524136609f252d821, archived by Codex as INDEPENDENT-CREATION-0.5.50-TRANSPORT.md). It does not replace it.

Handoff thread: msg_33504e8e5f63. Frozen manifest: team050-runtime-hashes-catalog.json (HEAD 5114cfc). Evidence root: C:/Users/Herman/AppData/Local/Temp/team050-ceo

## Recommendation

Accept the catalogue presentation change on frozen catalogue bytes. One real native defect is in it and is reported below.

## Correction to my own prior evidence

The earlier report claimed the interview journey by citing t-qcard.json and proposal-review.json. Codex read those files and is correct: they show a completed proposal, not an unanswered native question card. My authorization message in that run had already given the name, purpose and members, so the model had nothing to ask and skipped the cards. The transport fix was genuinely verified; the card-to-answer path was not. I withdraw the card claim from the prior report and supply the measurement here.

A genuine card has now been captured on a draft with an unanswered purpose.

## Measured results

| Check | Result | Evidence |
|---|---|---|
| Suite on catalogue bytes | 414 passed, 0 failed; 43 files; 30.80 seconds | tests-catalog-new.log |
| Catalogue manifest | 6/6 SHA256 match | team050-runtime-hashes-catalog.json |
| Visible request after Interview me | 3 lines, no interviewId, no officialText, no raw JSON | c-request.json |
| Genuine unanswered card 1 | Purpose, 4 choices plus type and chat | c-card.json, c-q-purpose.json |
| Genuine unanswered card 2 | Structure, 4 choices | c-after-answer.json |
| Genuine unanswered card 3 | Roles, 3 choices | c-q3.json |
| Genuine unanswered card 4 | Name, 3 choices | c-q4.json |
| Proposal after answers | Step 4 of 4, Review & permission, Project Team, 4 members | c-proposal.json |
| Editable review | Review members control present in Review | c-proposal.json |
| Separate access step | Check project access present and unperformed | c-proposal.json |
| Protected globals | Unchanged from the same baseline hashes | global-baseline.json |

### The short visible request

Pressing Interview me printed this and nothing more:

```text
Prompt from the team-orchestrator plugin
Interview me to design this shared team. Follow the Team Orchestrator draft tool instructions, ask one interactive question at a time, then return an editable proposal for review. Do not create a team or launch sessions.
```

No interviewId, no draft JSON, no protocol text in the transcript. The wall of text from the prior run is gone. This is the change Herman asked for, and it is measured here rather than assumed.

### The genuine question cards

After the plugin prompt, the model asked for a real decision before anything changed. The first card is not pre-answered:

```text
☐ Next step
A plugin asked me to interview you and build a team proposal. Your earlier instruction said to hold and change nothing. Which do you want?
❯ 1. Hold off (Recommended)
  2. Run the interview
  3. Type something.
```

I chose option 2, then answered four real cards in sequence: Purpose, Structure, Roles, Name. Each listed its choices with a marked default and an escape into free text or chat. Each answer was consumed before the next card appeared.

The first card also shows the model correctly treating the fixture's standing user instruction as higher than the plugin prompt, and asking rather than assuming.

### The proposal

Answering the cards produced the proposal and moved the panel to `Step 4 of 4 · Review & permission`:

```text
Project Team · 4 members
Take a general project from first plan to reviewed finish.
[ Review members ]
Capacity 8 · Pickup 2 min · Answer 3 min
Task window off · Replay 1000 ms
```

`Review members` opened the editable builder. `Check project access` stayed present and unperformed. No run `Create team` button existed at that point. No approval, project-mode save, bind or launch happened.

## Real defect found on this build

The new model-facing description does not arrive whole. The host caps a tool description at 4096 characters and the plugin sent 5183. Both a visible notice and a host log record it:

```text
team-orchestrator: $.tool.register: the description of team_draft (5183 characters) reaches the model up to its first 4096
MCP server "team-orchestrator": Tool "team_draft" description truncated from 5183 to 4096 chars
```

The interview still worked here. The risk is what sits past character 4096. The description holds the active protocol, the live interviewId and the draft JSON, so the tail that is cut off is model-facing instruction the plugin believes it has given. The agent that succeeds may be reading a prefix only. The journey completed on this run, so this is a defect in delivery, not a proven functional failure.

One additional observation, adjacent and not a defect: because the model ran the interview before calling the tool, the second registration at 11:11:19 carried no fresh truncation notice. The cleanup path after a successful proposal therefore has no explicit success log line. The absence of that line is not evidence either way.

## Harness faults and limits

1. The first fixture in this run had a standing user instruction to hold everything. The model asked before acting. A bounded authorization was then given inside the same owned fixture, for questions and the draft tool only, and the cards followed. No answer was preloaded this time.
2. `bun test` is not the runner for this plugin. The official `claude plugin test .` passes 414/0.
3. Screen reads return the rendered 22-row frame, not full scrollback. Long lines are partly cut at the frame edge.
4. Card evidence is the visible frame plus the exact host log lines above.
5. No team was created, no management approved, no project mode saved, no session bound or launched.

## Correction of a prior wording error

The prior report said a mark of `▴` while collapsed. The captures show the opposite: `Edit member: CEO ▴` while the list was open, and `Edit member: CEO ▾` after the same control closed it. The down mark is the collapsed state. The behaviour reported was correct; the mark name was wrong. This is corrected here.

## Preservation and exit scope

| Resource | Final state |
|---|---|
| Prior transport report | Preserved immutable; not overwritten |
| Real repository .team-orchestrator/ | No read, approval, mutation or cleanup |
| Global settings and install records | Baseline hashes unchanged |
| Renderer and window | Per-invocation fullscreen only; no move or resize |
| Prior fixtures | Preserved; the earlier owned .50 fixture terminal was closed |
| Tester implementation or publication | No product edits, commit, merge, push or installation |

Conclusion: the short visible request, the genuine unanswered question cards, the answer path and the editable proposal all work natively on the frozen catalogue bytes. Independent suite 414 passed, 0 failed. One real defect: the 5183-character tool description is truncated to 4096 by the host, so part of the model-facing interview instructions does not reach the model.
