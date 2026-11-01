# Bounded questions and fresh worker launch — 0.5.52

| Check | Result |
| --- | --- |
| Node 22.13.0, SQLite and real PostgreSQL 18.6 | **289 passed, 0 failed, 0 skipped** |
| Official Mod runner | **435 passed, 0 failed**, 45 files |
| Mod validation | Passed with existing attribution/catalog metadata warnings |
| Packaged/source store | All **25 modules** identical |
| Native launch smoke test | Real Claude worker started, self-bound, read its role, checked its empty inbox and waited |
| Repeated native launch request | Returned the same bound reservation; still exactly driver + one worker |

The two-engine suite covers concurrent question answers, answer windows starting on recipient read, late-answer refusal, single expiry, immutable question content, recipient-only notice acknowledgement, queue capacity, private launch command rejection at the public API, one launch claim, verified child attachment and same-conversation incarnation refresh. Explicit schema-5 and schema-6 updates preserve backups and refuse silent opens. Raw database probes refuse launch-state reversal and SQLite alternate-key replacement. The effect-runner tests cover an unknown create reply without a repeated create and exact child project/executable settings.

The native smoke test used a new disposable project, the source Mod and a small command driver. Controller approval and the roster were seeded through the trusted test factory; this is not another test of the approval button. The repaired real worker ran as the reserved conversation, called the member API, reported its active generation-1 binding and empty inbox, and waited without an admitted task. The database and terminal receipts agree on conversation, exact project home, terminal and incarnation. Repeating the same native launch request returned its bound reservation and created no duplicate.

The native test found a product bug: Windows PowerShell legacy argument passing stripped inline settings JSON. The repair writes a protected settings file and passes its path. The first failed launch reservation remained claimed rather than being blindly repeated; the repaired native check used a separate fresh member. A test-fixture PostgreSQL write also needed an explicit transaction; this was corrected before the final two-engine pass. Disposable PostgreSQL was stopped after the run. Fixture terminals were closed after evidence capture; their files remain available.

Evidence is under [schema-7-questions-launch](validation/schema-7-questions-launch). No real workspace database or unrelated draft was used. No global renderer or installed plugin settings were changed.

Limits: no claim of full automatic model dispatch/pickup/outcome/head-acceptance acceptance, whole-Orca restart, Linux/macOS native launch, Docker, hosted Mod configuration or classic-file migration. The deadline scheduler is an active-client 30-second observer with catch-up, not a daemon when all clients are closed. Capacity retains uncertain starts conservatively; no automatic reclamation or replacement of existing members is added. Independent Claude review has not yet run against this increment.
