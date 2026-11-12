# Mod nonmember guard correction (D1)

Source and test work only, on `fix/mod-nonmember-guard-d1`, based on merged PR #200 at `19ece2bc153bc9957a9868a93f1ba7193dc9dafb`.

## Problem and behavior

A project containing shared team storage made ordinary Claude sessions run native identity verification before membership was established. A failing guard probe could therefore block Write and Agent in a conversation that had never joined a team, including writes outside the project. Some read-only folder listings were also blocked because their spelling matched a protected path.

The guard now discovers membership before native preflight. Shared membership discovery uses trusted SDK session data and a read-only SQLite transaction, validates the existing schema, and does not initialize or migrate a store. An ordinary nonmember skips native authority verification. An active member or launch reservation remains a candidate for the existing native verification and permission checks. Uncertain discovery still blocks; its error identifies a failure of the guard itself, without blaming the requested command. The shared adapter uses `hostname()` as its machine key. A matching active conversation, launch reservation, or terminal target under another machine key returns unknown, preventing a machine rename or mismatched registration from silently releasing enforcement.

Classic roster detection is also read-only. Known classic members retain held-session restrictions, composer-only grants, and team-file protections when native preflight fails. Managed creation remains denied in that case. A notification failure cannot skip the shared-member verdict.

The CEO's corrected A/B evidence identifies the missing `cd` prefix, rather than folder spelling alone. Plain compound reads now admit `cd`, `head`, `echo`, and `true` alongside the existing readers, while retaining substitution, redirection, and mixed-effect checks. Literal and globbed listings, stderr merging, pipes, and the unrelated-folder controls are covered. This opt-in classification does not change the default classic `notReadOnly` classifier.

For a plain `cat` with a single-quoted heredoc delimiter, shared-folder reference checks ignore its literal message body and retain its output destination and commands after the closing delimiter. A report written to `/tmp` can therefore mention the shared folder without being treated as a state mutation. Executable, expanding, incomplete, or compound heredoc headers remain conservatively classified. This is a bounded literal-data exception, not a general shell parser. Private authority protections still run first. These checks are not an OS sandbox.

## Changes

- `team-orchestrator/hooks/register.tsx`: membership-first guard ordering, classic candidate lookup, guard-owned diagnostics, retained held-member behavior.
- `team-orchestrator/hooks/shared-membership.mjs`: read-only discovery; no identity proof or approval is issued.
- `team-orchestrator/hooks/shared-store.tsx`: plain-reader classification before general literal-path checks, after private authority checks; bounded literal heredoc reference handling.
- `team-orchestrator/hooks/guard.ts`: opt-in compound-reader classification.
- `team-orchestrator/hooks/guard-nonmember.test.ts`: twelve D1 regressions and member/protection controls, including the CEO's compound command matrix and explicit unknown-membership refusal.
- `team-orchestrator/hooks/lock.test.ts` and `shared-store.test.tsx`: explicit member fixtures and diagnostic expectations.
- `team-orchestrator/scripts/shared-membership.test.mjs`: real disposable SQLite discovery checks.

## Verification

1. Before the fix, the initial SDK regression run had 448 passes and four failures, covering ordinary nonmember effects, preview-only behavior, diagnostic ownership, and known classic membership.
2. The first frozen `claude plugin test team-orchestrator` run was **454 passed, zero failed, 46 files**. Raw log: `%TEMP%/mod-d1-frozen-sdk-20261108.log`; SHA256 `EBDFD6B362235A481AD09B4EE3798D56578FF4B06FE34145FE2EC0198D81974B`. This predates the CEO's corrected compound-command inputs. The new compound-read and heredoc regressions reproduced failures before the refinements above.
3. Final expanded SDK run: **457 passed, one failed, 458 tests across 46 files**. All twelve D1 cases pass. The failure is the unchanged crypto test `bundle round-trips at the default cost, and unlock finishes in under 6 s`: unlock took 7471.94 ms. This same timing failure was reproduced from a temporary archive of unchanged `HEAD` at the baseline commit: **445 passed, one failed, 446 tests across 45 files**, with unlock taking 6897.00 ms. No test threshold was changed. Final source log: `%TEMP%/mod-d1-ceo-inputs-final-20261108.log`; SHA256 `DC5B3E8F6F533D38DADB1449E52C701E489CEBEEE2656A563DD6A7A1EFC271F3`. Baseline log: `%TEMP%/mod-d1-ceo-baseline-20261108.log`; SHA256 `FF4E0DB3E27EBF6BBB09D43345D1C33D6849DE5C1F6DBFB3CD8C0DC732A67371`. The temporary extracted checkout path is recorded in `%TEMP%/mod-d1-ceo-baseline-path-20261108.txt`. The final full suite is not green.
4. Node **22.13.0**, `--test team-orchestrator/scripts/shared-membership.test.mjs`: **16 passed, zero failed, zero skipped**. Tests cover provider separation, older schemas, active/retired/reserved sessions, launch targets, machine-key mismatches, malformed/inaccessible store paths, SDK permission errors, uncertain metadata, and missing schema protections. Each real database probe verifies the database file hash is unchanged. Log: `%TEMP%/mod-d1-ceo-membership-20261108.tap`; SHA256 `190DCF4F30C3F7483D0E5C17E015C8E1A210BFBBF7602BDD6BAD8C44C1D303BC`.
5. `git diff --check` passed. `node team-orchestrator/scripts/sync-shared-store.mjs --check` verified **52 runtime files in two packages**, unchanged by D1.

The SDK tests simulate the failed native probe; they do not prove the running Mod now permits the CEO's live tools. Independent review and authorized activation/live acceptance remain outstanding. D2's underlying native-probe/environment failure and D3's Mod recovery acceptance gap are not resolved here.

## PostgreSQL evidence clarification

The CEO's two-suite rerun without PostgreSQL correctly reported 17 tests: 12 passed and five skipped. The previous handoff's zero-skip count referred to a separate full run with disposable PostgreSQL, whose retained log reports **485 passed, zero failed, zero skipped**. Its path is `%TEMP%/team-questions-pg-43802def07dc4fb284636faac6deccd5/codex-ordinary-final-20261107.log`, SHA256 `226B84228903F02961930325CB9CBAFAD5CC608A22926ADBAAA9498929CD1105`.

No PostgreSQL instance was started for this D1 work. No Codex guard, schema, runtime package, installation, activation, live approval, binding, membership, or team data was changed. PR #199 remains separate. No release authorization is implied by this report.
