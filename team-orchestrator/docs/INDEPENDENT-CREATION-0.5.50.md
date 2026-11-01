# Second addendum: the draft reader and the descriptor cap

This addendum follows two immutable reports. FINAL-CREATION-050.md (msg_0ff5b8142203) and ADDENDUM-CREATION-050-CATALOG.md (msg_f0000f7dfe0f, SHA256 3ab6a99e0b00beb8e3ac218aced9f6973963a03b523664894ac5e32d395611b8). Neither is replaced.

Handoff thread: msg_33504e8e5f63. Frozen manifest: team050-runtime-hashes-reader.json (HEAD 54f4d37). Evidence root: C:/Users/Herman/AppData/Local/Temp/team050-ceo

## Recommendation

Accept the reader change on frozen reader bytes. Both defects it targets are fixed and measured natively. No blocker found.

## Measured results

| Check | Result | Evidence |
|---|---|---|
| Suite on reader bytes | 416 passed, 0 failed; 43 files; 35.50 seconds | tests-reader-new.log |
| Reader manifest | 6/6 SHA256 match | team050-runtime-hashes-reader.json |
| Captured files | 5 copied as instructed: register, team-setup, creation-draft, creation-flow test, shared-workspace test | source review |
| Short visible request | 2 lines, no interviewId, no officialText, no raw JSON | r-auth.json |
| Reader ran | `Draft read. Empty name and purpose.` | r-card1.json |
| Genuine unanswered card, question 1 | `☐ Purpose` with 4 choices plus type and chat, none pre-selected by me | r-card1.json |
| Genuine unanswered card, question 2 | `☐ Name` with 3 choices plus leave blank, type and chat | r-card2.json |
| Reader-driven answers | `Purpose set: software build team.` then `Two members kept.` | r-card2.json |
| Proposal into Review | Step 4 of 4, Review & permission, Build Team, 2 members | r-proposal.json |
| Editable review | Review members control present in Review | r-proposal.json |
| Separate access step | Check project access present, unperformed | r-proposal.json |
| Create boundary | No run Create team control while the interview was active | r-proposal.json |
| Descriptor truncation | No team-orchestrator truncation warning in the fresh log | reader.debug.log |
| Protected globals | Unchanged from the same baseline hashes | global-baseline.json |

## Defect one: the 4096 descriptor cap

Fixed and verified. The prior build sent a 5183-character tool description and the host cut it at 4096. This build registers two short static descriptions. The fresh native log carries no truncation line for either plugin tool:

```text
$.tool.register (team-orchestrator): mcp__team-orchestrator__team_draft_read visible after 0ms
$.tool.register (team-orchestrator): mcp__team-orchestrator__team_draft visible after 0ms
```

The only truncation line in the fresh log belongs to an unrelated server, `COMPOSIO_SEARCH_TOOLS`.

## The reader

The short request now says to read the draft first, and it carries no data:

```text
Prompt from the team-orchestrator plugin
Interview me to design this shared team. Read the current draft with the Team Orchestrator draft reader, ask one interactive question at a time, then return an editable proposal for review. Do not create a team or launch sessions.
```

The model then called the reader and reported what it found: `Draft read. Empty name and purpose. Placeholder members "Head" and "Worker".` That is the full current draft arriving through normal tool output rather than through the descriptor. The payload moved; it did not disappear.

Source review of `readTeamInterview` and `registerDraftTool` confirms the guard shape: the reader refuses unless the interview is active in this conversation, the draft is unchanged against its fingerprint, and no action is busy or pending. It returns instructions and data only. It mutates nothing, and it holds no creation authority.

## The question cards, genuinely unanswered

I authorised the questions and both tools and deliberately gave no answers. The model had to ask, and it did:

```text
☐ Purpose
What is this team's purpose?
❯ 1. Software build team (Recommended)
  2. Research team
  3. Ops and automation team
  4. General purpose team
  5. Type something.
  6. Chat about this
```

Answering it produced `Purpose set: software build team.` and the next card, `☐ Name`, with Build Team, Dev Squad, Team 050, Leave blank, type and chat. Answers were consumed one at a time before the next card appeared. This is the measurement the prior report claimed without having it.

## The proposal

The panel moved to `Step 4 of 4 · Review & permission`:

```text
Build Team · 2 members
Build software: design, write and review code, with a lead who reviews evidence before accepting outcomes.
[ Review members ]
Capacity 4 · Pickup 1 min · Answer 2 min
Task window off · Replay 1000 ms
```

The model's own summary listed the roster boss-first as Lead (role: Lead and review) and Developer (role: Implement and verify, boss: Lead), and stated that instruction text was kept and only names changed. `Review members` was present and editable. `Check project access` stayed present and unperformed. No run Create team control existed while the interview was active. No approval, project-mode save, bind or launch occurred.

## One claim I could not confirm

The model ended by saying the team-orchestrator MCP server disconnected right after the draft was written, so it could not read or edit the draft further. I did not confirm a failure. The fresh log shows the server connecting successfully at 11:24:21 and the `team_draft` call resolving normally at 11:24:21.479. What the log does show, repeatedly across the whole run, is the host marking plugin clients stale with `config hash changed` each time the tool set is re-registered. That is the plugin's own registration working, not a transport loss. I report this as an unconfirmed model statement about its own tool availability, not as a product defect, and I make no claim either way.

## Harness faults and limits

1. The fixture still carried the standing hold instruction, so the model again correctly asked before acting, then asked the first real question card. Bounded authorisation for questions and both tools was given inside the same owned fixture, with no pre-answers.
2. One `Escape` sent while waiting interrupted the model turn. It recovered; the card sequence ran normally afterwards.
3. Screen reads return the rendered frame. Later transcript text pushed the panel action row out of the captured frame after the proposal, so the Review and Create-boundary evidence is the `r-proposal.json` capture, taken while that row was still visible.
4. `bun test` is not the runner for this plugin. The official `claude plugin test .` gives 416/0.
5. No team was created, no management approved, no project mode saved, no session bound or launched.

## Preservation and exit scope

| Resource | Final state |
|---|---|
| Both prior reports | Preserved immutable; not overwritten |
| Real repository .team-orchestrator/ | No read, approval, mutation or cleanup |
| Global settings and install records | Baseline hashes unchanged |
| Renderer and window | Per-invocation fullscreen only; no move or resize |
| Prior fixtures | Preserved; the earlier owned .50 catalog terminal was closed |
| Tester implementation or publication | No product edits, commit, merge, push or installation |

Conclusion: on the frozen reader bytes, the descriptor cap is gone, the reader delivers the complete draft through normal tool output, the question cards are genuine and unanswered, and the answers produce an editable proposal with no Create. Independent suite 416 passed, 0 failed.
