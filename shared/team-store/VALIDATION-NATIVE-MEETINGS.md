# Native Codex preview and durable meeting validation

Source: Mod 0.5.55, shared schema 8. Tests ran in disposable fixtures on Windows. The user's project store, installed/global configuration and original provider session were not modified. No Claude CEO handoff or model turn was started.

At least three passes were performed, with repairs verified again:

| Pass | Scope and result |
| --- | --- |
| 1 — contract and recovery | Initial full SQLite suite: 181 passed, 13 PostgreSQL checks skipped. Meeting tests exercised restart recovery, native-member attribution, explicit start rules, required contributions, separate minutes review, bounded replies and stable receipts. |
| 2 — both engines and integration | SQLite plus real PostgreSQL on Node 22.13: 330 passed, zero failures/skips. Mod integration exposed an illegal Node import into the restricted hook runtime; pure schema/catalogue modules fixed it. The native Codex probe exposed eager lock-directory opening; initialization now waits for per-call ownership proof. |
| 3 — adversarial and release checks | Added independent-client contention, notification ownership, native-incarnation fencing, immutable review/topic history, replacement attacks, aggregate line budgets and private receipt recovery. SQLite replacement evaded a delete trigger; explicit BEFORE INSERT collision guards now cover every meeting unique key. Final full two-engine suite: **343 passed, zero failures/skips**, Node 22.13, PostgreSQL 18.6. |

Final native Mod suite: **438 passed, zero failures**, including invitation review and Agenda/Discussion/Outputs controls. Plugin validation passed with existing author/license/icon catalogue warnings. Source and packaged runtime hashes match for **39 files**. `git diff --check` passed.

Native Codex transport was exercised through the installed Codex 0.166.0 app-server and the actual production stdio entry point, with **zero model turns**. An ephemeral thread without a writer-lock ownership record received a supported PreToolUse denial and `API_NATIVE_UNVERIFIED` for the team API. This proves the negative ownership path and wire compatibility; it does not prove a positive Orca-bound model call or actual model-tool blocking. Private dependency fixtures separately exercise exact parent/FILETIME/thread ownership and host epochs, actor isolation, guard decisions, frame handling and inbox close ordering.

The final review also fixed an asynchronous inbox lifetime bug: the adapter now awaits poll/confirmation before closing its journal and database connections. Guard checks reject obvious shell output/preprocessor/subexpression write bypasses. Codex prompt keywords remain unable to grant permissions. Upgrade authorization sees the actual source schema, and private team-summary receipts require the current member binding.

Evidence in [validation/native-meetings](validation/native-meetings/):

- `final-two-engine.tap`: the final complete 343-test SQLite/PostgreSQL run.
- `final-mod.log`, `final-plugin-validation.log`: the final Mod checks.
- `pass2-two-engine.tap`: the earlier 330-test pass.
- `pass3-before-replacement-fix.tap`: the failing replacement probe before its repair.
- `native-codex-evidence.json`: actual native transport refusals, without model inference.
- `runtime-hashes.json`: source/copy equivalence.

The disposable PostgreSQL server was stopped after each run. Native probe app-servers ended. Test fixtures did not create or modify a real team in the user's project.

Still unproven: positive live-model Codex guard acceptance, the hook's installed/trusted state in a real Codex session, a live Claude–Codex meeting/wake sequence, whole-Orca restart, non-Windows native identity, automatic Codex launch, and independent non-Orca operation. The existing hosted-store onboarding and older JSON/plugin migration work also remain separate. The default meeting start policy is still an unanswered product question; creation makes the rule explicit instead.
