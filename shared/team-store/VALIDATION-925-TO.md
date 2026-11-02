# 925-to Codex integration validation

Source checkpoint: Mod 0.5.56, 925-to 0.1.0, shared schema 8 (unchanged). Validation ran on Windows with native Codex 0.166.0. SQLite/PostgreSQL ran on the minimum Node 22.13.0 and PostgreSQL 18.6. No Claude CEO handoff or model turn was started.

## Three passes and final checks

| Pass | Result and repair |
| --- | --- |
| 1: management and onboarding | Exercised reviewed creation without Claude, atomic edits, denial/cancellation, stale authority, private API gating and interrupted setup. Fixed duplicate machine-identity derivation so the API uses the verified native actor. |
| 2: both database engines | The full run exposed fresh PostgreSQL's `STORE_EMPTY` precondition, which now follows the same explicit creation path as absent SQLite. Re-run: 360 passed, zero failures/skips. Mod suite: 438 passed. |
| 3: recovery, native transport and distribution | Added stale-binding reconnect/controller recovery, revoked-approval refusal, native draft interviews, review keepalive, process-death installer-lock recovery and native installation/discovery/update/removal probes. Final two-engine suite: **368 passed, zero failures/skips**. Final serial Mod suite: **438 passed, zero failures**. |

Plugin validation passed with existing author/license/icon catalogue warnings. The skill frontmatter validator passed. All **43 runtime files** match the canonical source in both packaged copies. `git diff --check` passed.

One existing replay timing fixture assumed a full database run would finish within one second. Its fixture now uses a 60-second replay interval and explicitly expires it for the intended retry assertion; production timing is unchanged. A concurrent Mod run exceeded its existing crypto benchmark's six-second limit under database load. The final standalone Mod run passed; no crypto implementation was changed.

## Native Codex evidence

The actual Codex app-server transported a native action form and two exact management confirmations. A fixture team was created without a Claude session, edited, read back and reconciled without another confirmation or duplicate creation. **Zero model turns** were started. Native identity was deliberately substituted by a TEMP-only test fixture, and the harness supplied form responses through the native transport. This proves protocol compatibility and effect/recovery behavior; it does not establish a real Orca-bound identity or a human's click.

The actual native plugin commands selected the Codex marketplace alongside the existing Claude marketplace, installed a relocatable matching runtime, and exposed the skill through native `skills/list`. The pinned npx installer copied the same self-contained skill/runtime. A disposable fixture release updated from 0.1.0 to 0.1.1, then plugin removal cleared the installed entry. These installation probes used local repository sources and fresh TEMP consumers/CODEX_HOME, with no global changes.

A read-only setup preview in the actual repository verified the native Orca/Codex scope and reported setup-ready. It wrote no configuration, approval or team store. All applied setup tests, team mutations and installs used disposable projects. Owned project configuration preserves unrelated settings, refuses independent edits, and recovers after an installer process exits while holding its native lock.

## Reproduce and inspect

Evidence is in [validation/925-to](validation/925-to/): `final-two-engine.tap`, `final-mod.log`, `final-plugin-validation.log`, `native-management.json`, `distribution.json` and `runtime-hashes.json`. Probe sources are outside the packaged runtime:

```text
node shared/team-store/validation/probe-codex-management.mjs <native-codex.exe>
node shared/team-store/validation/probe-925-to-installers.mjs <native-codex.exe>
node team-orchestrator/scripts/sync-shared-store.mjs --check
```

The shared suite uses `TEAM_TEST_CODEX_EXECUTABLE` for native setup/parser checks and `TEAM_STORE_TEST_POSTGRES` for the disposable hosted engine. PostgreSQL was stopped after the final run; owned probe app-servers exited. The user's project store and global installed/configuration state were not modified.

Still pending: an actual user's hook review, positive live-model guard acceptance, a real Claude–Codex assignment/meeting/wake run, whole-Orca restart, non-Windows identity, automatic Codex launch, Hermes admission, standalone operation, hosted-store onboarding and classic/plugin migration. These broader acceptance/design tickets remain open. Default meeting start policy remains an explicit per-meeting choice until the product question is settled.
