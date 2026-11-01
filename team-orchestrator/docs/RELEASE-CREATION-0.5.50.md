# Creation choices and member picker — 0.5.50

The shared Create team flow now exposes the original **Squad**, **All-Purpose Team** and **Tech Team** templates and **Interview me** on its first step. These paths had remained in classic setup when the shared wizard became the default entry.

Templates preview the existing structures (4, 11 and 21 members), then **Use template** replaces the drafted name and members. Purpose and options stay. CEO templates use their original named heads and worker groups as reporting branches within one shared roster. They do not create separate shared teams. Classic presets use the same definitions.

Interview me asks interactive creation questions in the conversation. Its visible request stays short; a scoped read-only draft helper supplies complete data to the agent without relying on capped tool descriptions. Create remains unavailable until the proposal completes or is cancelled. A scoped, one-use `team_draft` tool returns a complete proposal to editable **Review & permission**. It does not create teams, enable workspace mode, grant management or launch/connect sessions. Manual edits, cancellation, pending operations or a changed conversation prevent an old proposal from replacing the draft. Cancel proposal invalidates the proposal; it does not stop the model turn.

The setup member picker is now an explicit menu: its control opens and closes it, choosing any member closes it, and Close member picker is available. Member names appear once; the hierarchy is shown in the member detail. Back/Settings/close retain edits. Controls use native click and Tab/Enter. Setup-pane Escape follows host close behavior; inline Escape retains the host's focus behavior.

Update, then restart/resume Claude Code and confirm **0.5.50**. Restart is needed for the newly registered draft tool; a hooks-only reload is not evidence that the host refreshed its tool catalogue.

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

## Validation

Local suite: **416 passed, 0 failed, 43 files**. Plugin validation passes with existing directory metadata warnings; 16 packaged shared-store modules remain unchanged; diff-check clean. Layout detector returned no findings. The transport report confirms native picker collapse, selection retention, no duplicated Head label, restored template buttons/previews and All-Purpose template application. The catalogue addendum corrects the earlier card evidence and records real unanswered choices plus the 4096-character descriptor limit. The final reader-based run supplies the complete draft, asks genuine native questions, accepts their answers and reaches editable Review & permission without creating or approving anything. The visible request stays short and the descriptor truncation warning is gone.

The native fixture used a 57-column dock body on Claude Code 2.1.316. Tech Team's 21-member shape and complete reader payload, stale/cancelled/wrong-conversation refusals, and the approved-controller Create guard are covered by the SDK suite. No new schema, PostgreSQL, lifecycle, migration or scheduler acceptance is claimed. Earlier unchanged encryption timing checks exceeded their limits under load; final local and independent runs pass without changing crypto code or thresholds.

See the [final independent addendum](INDEPENDENT-CREATION-0.5.50.md), [transport report](INDEPENDENT-CREATION-0.5.50-TRANSPORT.md), [catalogue report](INDEPENDENT-CREATION-0.5.50-CATALOG.md) and [final tested runtime hashes](CREATION-0.5.50-RUNTIME-HASHES.json). Reports are archived without editing. Runtime hashes identify the tested Windows bytes; Git can normalize newlines on other checkouts. No new schema, lifecycle, migration or scheduler acceptance is claimed.
Final source is reader build `54f4d37`; local suite 416/0 in 32.95s and independent suite 416/0 in 35.50s. Immutable report SHA256 values: final reader `d74d680fc71d9a0284928e64166848396ab51bd136a8261b690347aeab76dc6d`; transport `a63f7b5f411517701d9673f80f959424a1f3472b84af963524136609f252d821`; catalogue `3ab6a99e0b00beb8e3ac218aced9f6973963a03b523664894ac5e32d395611b8`.

The model's statement that the MCP server disconnected after proposal delivery was not confirmed by the tester; host logs show the draft call completing and the catalogue being refreshed. This does not establish continued agent editing after proposal completion. The product's next step is the user-editable Review panel; no create, management approval or session action was performed in this run.
