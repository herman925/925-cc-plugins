# 0.5.45 independent acceptance checkpoint

Evidence root: C:/Users/Herman/AppData/Local/Temp/ws045-ceo-QiDxdH.

| Check | Result |
| --- | --- |
| Full Mod suite | 379 passed, 0 failed, 39 files; 30.40s |
| SQLite-only | 122 passed, 0 failed, 6 PostgreSQL skips; 10.49s |
| SQLite + real PostgreSQL | 222 passed, 0 failed, 0 skipped; 38.87s |
| Validation/packaging | Command completed; packaged modules matched |
| Disposable PostgreSQL | Own cluster stopped, pidfile absent; port 56047 |
| Fresh source panel | 0.5.45 loaded; actual approval and Create team form opened |
| Team creation | Not submitted; live form failure blocks it |

Runner fault: reused run-engines.cjs retained an old expected pass-count assertion of 211. It failed only after the both-engine TAP completed successfully with 222 passes. Both suite JSON/TAP artifacts retain actual measurements; no rerun was needed to change a reporting assertion. Server stopped normally in finally.

Live failure: after native focus on workspace-member-official-1, the tester sent Ctrl+A, Ctrl+K and plain role instructions as one terminal text event. The host then reported:

```text
team-orchestrator: ui.render hook skipped: returned the wrong shape (a tree AbovePrompt refuses: Input "workspace-member-official-1" value holds a control character)
```

The Team Orchestrator band disappeared; subsequent ordinary focus navigation only reached Session Panel controls. The tester's Create button focus helper failed before locating the target. An unconditional following Enter reached Session Panel Settings, not a team-creation button. No creation success is claimed.

Root cause is not established: the exact input included control U+0001 and U+000B as native editing keys. This may be a host input/test-sequence interaction. Codex received the exact failure and input in msg_584e1bc74b0e. Preserve the candidate, session and source; do not forge a state reset or weaken guards.

Retained fresh session: WS045Head, conversation 13310975-768e-4b52-8367-93d5e08045ed, handle term_12125f3e-74a0-421c-ba95-0588e176bcf6. Per-invocation source copy/options only. Prior A/B/C and UI044 fixtures remain untouched. No global settings edits, credentials copied, commits or pushes by this tester.

A combined shell evidence-writing action was denied by the installed shared-store guard. That denial was respected; it was not rerun through another path. Read-only file tools and the already-produced artifacts supply this report.

Full live creation/binding/assignment/outcome/head-acceptance, native unknown-receipt probes and narrow visual acceptance remain incomplete pending the implementation owner's response.
