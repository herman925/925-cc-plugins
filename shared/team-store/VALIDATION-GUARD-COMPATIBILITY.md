# Older-store permission guard repair — 0.5.53

Claude's independent checkpoint `msg_df9435cb49a8` reproduced ordinary Write calls to two unrelated Temp paths being refused because the project held schema 5 while the installed Mod supported schema 6. The same failure applied to schema-6 projects after the schema-7 release. The guard asked the mutating current-runtime API to inspect the caller, so an otherwise supported old store became a session-wide file-tool blocker before member permissions could be evaluated.

The guard now uses a private, version-aware read-only authority reader for released schemas 5, 6 and 7. SQLite is opened with `readOnly:true`; PostgreSQL uses a repeatable-read, read-only transaction. It validates the appropriate frozen/current schema and authority protocol, then reuses the existing member/binding/native-home validation. It neither acquires a lease nor installs DDL, updates a writer fence, records an operation, approves a controller or upgrades the store. A nonmember continues through the normal classic guard. A bound head still cannot write without the existing grant, Agent restrictions remain, and protected shared/private files remain blocked. Stale bindings, unknown schema versions and unverified native callers remain refused. A known older store produces a once-per-session update notice.

Evidence:

- **7/7** targeted tests pass on Node **22.13.0**, SQLite and real PostgreSQL **18.6**, with zero skips. Each supported schema checks a verified head, an ordinary nonmember, stale incarnation refusal, unchanged schema/lease/operations, and SQLite file-content hash equality. Unknown versions are refused without changing the file.
- **436/436** official Mod tests pass. The regression exercises ordinary Write to an unrelated path with schema 5, then verifies head/Agent and shared-store restrictions remain enforced.
- Mod validation passes with existing catalog metadata warnings. All **26** packaged/source modules match. No schema change is introduced.

Logs: [guard-compatibility](validation/guard-compatibility). Disposable PostgreSQL was stopped. The real workspace store and unrelated drafts were not opened or changed. The final version bump and documentation follow the tested product source; independent native retest is requested separately.

The report was initially sent to the CC Plugin Architect pane. Codex inspected that mailbox read-only, did not consume or acknowledge the Architect's mail, and supplied the correct live Codex handle for further reports. The separately attributed Session Panel missing-width issue and full automatic team lifecycle acceptance remain outside this repair.
