# Ordinary-session recovery release — 2026-11-07

Release: Codex plugin **0.1.11**, Mod **0.5.61**, shared schema **9**.
Branch: `fix/codex-review-delivery-honesty`. PR #199 is excluded.

## Failure and correction

The successful native rebind did not cover a retired ordinary member whose
historical binding remained in the shared store. A disposable SQLite reproduction
with the production adapter and `launchWorkers:true` rejected the hook, status
and reviewed management calls with `API_MEMBER_SCOPE`. A resumed incarnation
instead entered stale-binding recovery even though membership had ended.

Guard and caller inspection now recognize an explicitly retired ordinary member
as outside the team. Status returns `member:null`, `binding:null`,
`membershipState:retired` and `retiredMemberId`. This is a read interpretation:
the historical binding is not deleted or rewritten. Task APIs still reject the
retired member. Active members keep their standing switches and native-reviewed
stale-binding recovery. A retired member with a launch reservation remains
restricted; retirement cannot turn a launched worker into an unrestricted session.

The full PostgreSQL run also exposed an empty-database onboarding failure:
the guard queried `store_metadata` before determining that no schema existed.
Empty stores now return `STORE_EMPTY` and impose no team-role restrictions.
Guard inspection does not initialize the store. Private authority protection
still applies, and unknown/nonempty malformed schemas remain refused. Two
review tests were corrected to use engine-neutral schema inspection rather
than SQLite's catalog on PostgreSQL.

A verified successful observer pass now clears the earlier failure, so a recovered
binding is not accompanied indefinitely by an old stale-binding warning.

## Validation

| Pass | Result |
| --- | --- |
| Regression first | Ordinary retirement and resume failed before the fix; observer recovery failed while the old failure remained. |
| Focused guard/adapter/ordinary-session checks, Node 22.13 | 23 passed, 10 PostgreSQL cases skipped in this isolated SQLite pass. |
| Focused ordinary-session/observer checks, Node 22.13 | 17 passed, 4 PostgreSQL cases skipped in this isolated SQLite pass. |
| Full suite, Node 22.13, native Codex configuration writer, SQLite and real PostgreSQL | **485 passed, 0 failed, 0 skipped**. Disposable PostgreSQL stopped afterward. |
| Mod SDK | **446 passed, 0 failed**, 45 files. No Claude model turns. |
| Native distribution probe | Passed plugin install, eight-skill discovery, pinned npx copy, update and removal in disposable consumer homes. |
| Package parity | All **52 runtime files** match in both client packages. |

Coverage includes no store, empty SQLite/PostgreSQL stores, an ordinary unbound
conversation beside another team's store, retirement with and without resume,
schema-5/6 read compatibility, preserved bindings, denied retired task access,
reserved-worker restrictions, and cleared recovered-observer failure state.

## Real recovery evidence and limits

Before this final release patch, this conversation completed a real native review
on installed runtime `5c33808fdc730c3db8397326522f45e73613532221a6b892b94d7cf8bd2283d5`.
Operation `recovery-rebind-01a18fc1-719fb308-20261107` returned the original member
`native-acceptance-head-20261105`, binding generation **2**, and reconciled to the
same receipt. Controller generation **1** was retained. Status confirmed the exact
current terminal/incarnation; public `Get-Content` and own-inbox reading succeeded.
No recovery receipt ID was returned by the inbox, so none was invented or acknowledged.

The final retirement and empty-store changes were verified in disposable fixtures,
not by retiring real members or editing the live team. Repository packaging does
not activate a new runtime in an already-running Codex process. Use normal plugin
update/setup and the verified Orca launch/resume workflow when activating this release.

Closing a panel or terminal does not retire or disconnect a saved active member.
This release does not add a leave-team operation. Native identity and unreadable
authority failures remain fail-closed; these tests are not a promise that every
future failure is impossible. No hooks were disabled, native reviews answered by
automation, or live team/history records edited to obtain these results.
