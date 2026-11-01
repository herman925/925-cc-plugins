# Schema-5 SQLite backup recovery check

Test-only follow-up after `b962ea5`; runtime/product code is unchanged. The upgrade conformance test now restores its complete schema-5 backup into a **separate disposable SQLite file**, leaving the upgraded source intact.

The check installs the verified frozen schema-5 DDL, restores every non-generated contract column, recomputes generated message endpoints, re-enables foreign-key enforcement, requires an empty `foreign_key_check`, and compares every restored row with the backup. The restored store also passes schema-5 inspection. Its data includes immutable message/delivery pairs, roster, controller approval, original rejection and operation receipts. Foreign keys are disabled only during construction of that isolated restore file and explicitly verified enabled afterward.

Final run on Node **22.13.0**, SQLite **3.47.2** and real PostgreSQL **18.6**: **278 passed, 0 failed, 0 skipped**, 67.42 seconds. Full output: [node22-two-engine.tap](validation/schema-6-backup-restore/node22-two-engine.tap). Disposable PostgreSQL stopped after the run. The prior 433-test Mod result remains applicable because no product/UI source changed.

Two initial probe assertions were corrected: comparing JSON objects must ignore key order, and the schema inspector takes a schema-definition object directly. Neither failure indicated lost backup data. The final row/FK/schema comparisons pass.

This establishes SQLite backup recoverability in a test fixture. It does not ship a restore button or utility, overwrite a real project, establish PostgreSQL restore acceptance, or establish autonomous model delivery. The real workspace store was not used. Earlier native/lifecycle and remaining acceptance limits are in [the gate report](VALIDATION-GATES.md) and [final history-guard report](VALIDATION-HISTORY-GUARDS.md).
