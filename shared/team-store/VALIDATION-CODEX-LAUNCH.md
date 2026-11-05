# Codex reviewed launch validation — 2026-11-06

Release pair: **team-orchestration-925 0.1.8 / Mod 0.5.58**, shared schema **9**. Orca-hosted native Windows Codex is the supported launch path. Codex management, observation and worker startup do not require an active Claude session or Mod process.

## Three validation passes

1. **Behavior and refusal cases.** Added native-reviewed plan/receipt, role-generation invalidation, shared capacity, one-winner claims, unknown creation/input, explicit-connect races, terminal attachment and unbound-controller observation cases on both engines. Reserved startup cases cover missing stores/targets, wrong project/member, copied-runtime engine selection and changed native incarnation. An actual malformed-profile MCP subprocess keeps its hook registered and returns a valid deny.
2. **Regression suites.** Minimum Node **22.13.0**, SQLite and disposable native PostgreSQL **18.6**: **449 passed, 0 failed, 0 skipped**. Native Mod SDK: **446 passed, 0 failed**, across 45 files. The disposable PostgreSQL service is stopped after testing. The existing schema-8 project store is not migrated by these tests.
3. **Native boundaries and packaging.** Actual Codex **0.166.0** plugin install/update/remove, eight-skill discovery and pinned npx installation pass. Native form transport reviews a disposable team, edit and one queued launch plan; a harness supplies identity and form responses, observation is disabled, and no worker starts. An actual unowned ephemeral thread is refused before opening the store, with a supported blocking hook response. Native Windows argv capture and the real Codex configuration parser preserve quoted paths, model text, the private profile and the newly created terminal scope. All **51** runtime files match both distributed packages. Launch/status/menu skill validators pass.

## Bugs caught during development

- Windows PowerShell's native argument binder removed literal JSON quotes from the launch overrides. The launcher now supplies a CRT-quoted argument line directly through `ProcessStartInfo` with `UseShellExecute=false`. A compiled disposable native argv capture confirms apostrophes/spaces and injection-like model text remain literal arguments; no injected marker file is created.
- A missing reserved target could otherwise use the normal unbound-session allowance. Reserved startup now pins project UUID, launch, member and store selection and requires a verified attachment before any ordinary operation or hook decision. PostgreSQL profiles carry the same explicit driver/database selection through a copied runtime; the test confirms no SQLite store appears.
- A cached `attached:false` receipt could prevent a later valid attachment. Each attachment inspection has a fresh operation ID while the database still prevents duplicate binding. The test first refuses a missing target, then records it and verifies one successful attachment.
- Project configuration may retain an older conversation's fixed terminal reference. The worker command overrides that scope with its freshly recorded terminal/context. The real Codex parser probe starts with deliberately stale references and confirms they are replaced.
- Updating a plugin cache could delete the configured adapter. Setup now installs a content-addressed private runtime snapshot before changing the project connection, retains old snapshots and preserves native per-tool approval settings. Cache-removal survival and modified-snapshot refusal are covered.

## Native terminal measurement

An owned disposable **empty PowerShell terminal** was created through the real Orca CLI, verified by exact handle/context/incarnation, sent an argument-capture bootstrap and closed. Captured output confirms native input reached that terminal. **Zero model turns** were started. Terminal titles are not identity evidence; empty shells are inventoried through terminal listing because agent-session listing omits them. The final profile/scope argument additions are covered separately by the native argv/configuration-parser probe.

## Evidence boundaries

These checks do **not** establish a real Codex worker model turn, installed positive permission-hook enforcement, a Codex-led mixed-model task/meeting, whole-Orca restart, Docker execution, standalone/non-Windows hosting or Hermes support. Automatic recovery/replacement of an uncertain claimed start is deliberately absent. Claimed capacity remains reserved until explicit recovery work is designed and authorized.

The previously observed intermittent native caller refusal in the old running client is **not confirmed fixed**. New diagnostics preserve coded native failures, and disposable parser/probe processes no longer inherit the acting Orca conversation identity. Neither change weakens native proof or grants hook trust.

The Mod manifest validator exits successfully with existing author/icon warnings and the existing missing-license public-directory submission blocker. This is not a public-directory acceptance claim.

The next live acceptance uses the installed matching runtime after reconnect, an explicit native-reviewed backed-up schema update, a real reviewed team/launch plan and exact receipts. Controller approval is separate from launch approval and hook trust. Status, setup and this validation do not upgrade the real store or approve a plan.

## Reproduction

Use Node 22.13+ with `node --test --test-concurrency=2 shared/team-store/test/*.test.mjs`. Set `TEAM_STORE_TEST_POSTGRES` only to a loopback disposable `team_store_contract_test` database and `TEAM_TEST_CODEX_EXECUTABLE` to the actual native Codex executable. See the shared-store README for engine setup and restrictions.

- `claude plugin test team-orchestrator` — SDK tests, no model delegation.
- `node team-orchestrator/scripts/sync-shared-store.mjs --check` — exact package parity.
- `node shared/team-store/validation/probe-925-to-installers.mjs <codex.exe>` — disposable install/discovery/update/remove/npx.
- `node shared/team-store/validation/probe-codex-management.mjs <codex.exe>` — substituted-identity native form transport.
- `node shared/team-store/validation/probe-codex-launch-quoting.mjs <codex.exe>` — native argv and configuration parser, no worker execution.
- `node shared/team-store/validation/probe-codex-adapter.mjs <new-evidence-directory> <codex.exe> <project>` — unowned-thread refusal, no team writes.

Probe results and logs are retained in disposable TEMP evidence directories; no transcript, real roster or unrelated workspace file is changed by them.
