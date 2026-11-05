# Native shared-team editing validation

Release: **Claude Mod 0.5.57 / Codex package 0.1.4**, shared schema 8 unchanged. The Mod now exposes the existing typed `editTeam` operation through Team workspace → Edit team, with native Team, Options and Review tabs.

Later independent native panel results are recorded in [the CEO checkpoints](INDEPENDENT-MOD-TEAM-EDIT.md). Several visible/apply/refusal checks passed; native stale-save and recovery acceptance remain unmeasured.

The bounded editor supports name/purpose, open-session capacity, pickup/answer/task windows and replay timing. It preserves every setting outside those fields. Role/permission/hierarchy/CLI changes and hosted-store/migration workflows are not added by this increment.

## Authorization and recovery

Only an approved controller sees the editor. Draft changes and review create no team mutation or approval ticket. Apply records a short-lived private native action bound to the exact request, operation id, verified project, conversation, terminal and context. The private Mod bridge allows only `editTeam` through its new management modes; ordinary model-facing execution cannot invoke that path. Database controller/configuration checks still run under the shared lease.

Unknown replies preserve the original request. A known receipt settles without a duplicate effect or another approval; an unknown receipt exposes an explicit retry of the same request through a fresh native action. Stale approval/configuration refuses; refreshing marks the original draft stale and requires reopening against current state. Closing the edit view keeps its draft; Cancel discards it. Scope/busy checks protect current drafts from old callbacks.

## Verification passes

1. Private action tests cover exact payload/id matching, cross-project/conversation/terminal/context refusal, expiry/future/wrong/missing tickets, and retained controller/upgrade rules. Initial native UI checks exercise draft/review boundaries, cancellation, invalid input, preserved hidden settings, stale save and committed-reply recovery.
2. Full minimum-Node **22.13** SQLite and real **PostgreSQL 18.6** suite: **385 passed, zero failures/skips**. The disposable PostgreSQL server was stopped after the run.
3. Final native Mod SDK suite: **444 passed, zero failures**, including retry after an unconfirmed write with no receipt, exact original operation recovery and fresh native review evidence. Plugin validation passes with existing catalogue warnings. Native Codex installation/seven-skill discovery/helper imports, npx menu installation, fixture update and removal probes pass. All **44 shared runtime files** match both packaged copies. Syntax and `git diff --check` pass.

Evidence is in [validation/mod-team-edit](validation/mod-team-edit/): final database and Mod logs, plugin validation, package probe and runtime hashes. No real project team data, installed hook trust or project setup configuration was changed by these fixtures.

This establishes automated UI behavior, native evidence validation and database conformance. Actual installed-panel visual/human-click acceptance remains for the independent tester. The CEO separately confirmed that Codex 0.1.3 fixed executable discovery, but its ordinary sandbox still denies Orca binary/profile access; downstream live Codex guard/mixed-team acceptance remains blocked pending a real permission decision. This increment grants no sandbox access or substitute caller authority.
