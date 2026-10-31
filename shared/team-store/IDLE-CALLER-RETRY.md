# Idle caller approval retry — 2026-10-31

For the real approval refusal in msg_0f344e424809 / msg_0ca60e09ccd1. The exact idle Orca terminal projection has no providerSession. Native terminal.inspectProcess is read-only but exposes no PID fence on this host, so it is not used as substitute evidence.

Copy ONE runtime file, byte-verify it against the authoritative repository, and preserve all other source-fixture files and the preview-only fixture manifest:

- team-orchestrator/store/mod-native.mjs

Authoritative source is shared/team-store/mod-native.mjs, byte-identical to the packaged file. Associated test and documentation changes are shared/team-store/test/mod-native.test.mjs, SCHEMA-5.md and VALIDATION-SCHEMA-5.md. No schema, database API, UI hook, global configuration or installed plugin changed. The Node child reads this module per invocation; a global reload is unnecessary.

The verifier still requires one native Claude terminal tab with the exact terminal handle and incarnation, current local host/context/root, runtime profile/epoch and a unique live exact-conversation Claude registry row. Present provider IDs must agree. For the actual bridge caller only, absent providerSession may be replaced by direct OS parent identity: registry PID equals process.ppid, inherited Orca terminal/context agree, and registry procStart equals a fresh OS process creation FILETIME. Windows decimal FILETIME is the only currently verified fallback format; unsupported formats/hosts fail closed. No identity cache or terminal title is used. A requested target cannot use the caller fallback; bindMember still needs an explicit fresh native provider association. If idle target binding becomes the next blocker, report it rather than substituting copied IDs or weakening proof.

Local verification: seven native proof cases pass (including conflicting/missing/duplicate tabs, wrong incarnation, stale/missing process birth, wrong parent and inherited context). The full SQLite-only suite passes 119 tests, 0 failures, 6 PostgreSQL skips, 10.51 s. Sixteen packaged modules byte-match; syntax and diff checks pass. Earlier full two-engine results precede this verifier-only delta.

Retry the actual Shared store approval button in the same disposable live project. Obtain a fresh scoped ticket through the real panel action; do not reuse the expired ticket or forge one. Simulated-user keyboard/button interaction in this scratch fixture is already authorized. Capture the starting store state and then verify the returned receipt and database state. A successful UI ticket or click alone is not approval success. If approval succeeds, continue the remaining schema-5 lifecycle acceptance and explicit outcome/head-acceptance checks under the original handoff. No existing user team migration, global install/reload, commit, push, release, terminal closure or fabricated lifecycle authority is authorized.

Please send the approval retry result promptly, including exact refusal and native/parent evidence if it fails. Preserve the retained sessions for inspection.
