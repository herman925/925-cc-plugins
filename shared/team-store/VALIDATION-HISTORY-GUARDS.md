# Final immutable-history guard follow-up

This unreleased follow-up to `5d17348` fixes an actual SQLite replacement hole found during the pre-handoff constraint review. [The gate report](VALIDATION-GATES.md) remains the evidence for its earlier UI/lifecycle checkpoint.

SQLite's `INSERT OR REPLACE` could evict history through a unique key other than the primary identity: `decision_gate_supersessions.new_gate_id`, or the partial unique accepted-task index. A guard checking only the primary identity was insufficient. The new regression failed with **Missing expected rejection** before the fix. The SQLite BEFORE INSERT guards now cover every unique conflict key. PostgreSQL's corresponding conflict-update attempts remain refused by its immutable-update trigger.

Final verification:

- **Node 22.13.0, SQLite 3.47.2 + real PostgreSQL 18.6: 278 passed, 0 failed, 0 skipped**, 65.49 seconds. Disposable PostgreSQL stopped afterward.
- The Mod/UI source is unchanged from its **433-test** passing gate checkpoint.
- All **21** source, packaged and fresh native-fixture runtime modules match byte for byte.
- A **fresh native Update workspace action using Node 22.13.0** upgraded an owned schema-5 fixture to the final draft schema 6. Actual process observations identify the temporary Node 22 executable. The backup was read back and its project identity and original rejection matched. Controller approvals remained **zero**.
- Direct contract probes against that freshly upgraded **test-owned** database refused replacement through both alternative unique keys with `STORE_HISTORY_IMMUTABLE`. The original supersession, accepted row and seeded rejection remained unchanged. Installed trigger SQL was read back to verify the new predicates.

Evidence is in [validation/schema-6-history-guards](validation/schema-6-history-guards/). The native fixture is `C:/Users/Herman/orca/workspaces/925-cc-plugins/runtime-history-20261101`; snapshot/driver/evidence are in `C:/Users/Herman/AppData/Local/Temp/team-history-native-20261101`. Its native conversation is `1b52004e-b721-42c3-b067-b3e1491776a7`, terminal `term_dc94949d-8321-4cad-9f45-694ce3f6f243`. It is retained alongside the earlier fixtures. The raw database probes are constraint tests, not model-facing lifecycle operations or autonomous task acceptance.

The earlier gate fixture keeps its own frozen checkpoint; it was not silently migrated or rebuilt. Draft schema-6 fixtures are not release compatibility promises. The latest constraints were verified on fresh two-engine schemas and a fresh native schema-5 upgrade.

Automatic model wake-up, whole-Orca restart, Docker execution, question/answer transitions, legacy file import, hosted Mod configuration and Orca-plugin integration retain the limits stated in the gate report. The idle native target still requires an explicit Claude conversation association. No verification rule was relaxed. The real main-workspace store and unrelated drafts were not used. No global-profile baseline was captured, so an unchanged global profile is not claimed. This follow-up is not a release or a main-branch merge.
