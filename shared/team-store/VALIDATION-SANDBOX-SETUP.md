# Sandbox-compatible Codex setup discovery

Release: **team-orchestration-925 0.1.3**. Mod 0.5.56, shared schema 8 and the 43 shared runtime files are unchanged.

## Independent defect

The CEO's live acceptance on main `8e8d44e` confirmed that the real picker discovers all seven skills and `:setup` enters its own flow. Setup then failed. Its ancestor walk used `Get-CimInstance Win32_Process`, which the native Codex sandbox denied with `0x80041003`. The tester cancelled the process-query escalation prompt. Separately, generic host-discovery catches obscured the cause/stage of a refusal. Report: Orca message `msg_b5775441c269` (2026-11-03 15:50 UTC); acknowledgment `msg_8e1cdce6a025`.

The repair resolves a native CLI on PATH or through the installed npm package behind its shim, validates the absolute native executable with `--version`, and permits an explicit `TEAM_CODEX_EXECUTABLE` for a non-PATH installation. It executes no shell shim and uses no process query. This executable is used only for isolated native configuration parsing/writing; it is not caller identity proof.

Host discovery now preserves public categories/stages: denied local profile/connection access, missing host prerequisites, a failed Orca subprocess, native verification refusal, or changed local terminal scope. It does not print private stderr/configuration and does not replace genuine access refusal with another authority source. The actual MCP parent's FILETIME/thread ownership and current Orca actor checks are unchanged.

## Verification

- **18 tests passed, zero failures/skips**, on Node 22.13: native PATH discovery, current/legacy npm layouts, configured-path validation, missing/unsupported executables, refused execution/version output, actual installed native CLI resolution without a Codex ancestor, host denial/exit classification, exact scope checks and six setup/update/remove/recovery cases.
- Native Codex package installation, seven-skill discovery, installed helper imports, pinned npx menu installation, fixture update and removal pass in disposable consumers with zero model turns. Both new helper modules travel with the self-contained menu skill/plugin.
- The matching 43-file shared runtime check passes for both packaged copies. The shared database/Mod suites were not rerun because their production runtime is unchanged; earlier evidence remains separately scoped.
- `git diff --check` and new-module syntax checks pass. No real team store, hook trust or project setup configuration was changed by these tests.

Evidence is in [validation/sandbox-setup](validation/sandbox-setup/). The focused command is `node --test shared/team-store/test/codex-executable.test.mjs shared/team-store/test/codex-setup-host.test.mjs shared/team-store/test/codex-setup.test.mjs`, with `TEAM_TEST_CODEX_EXECUTABLE` pointing to the installed native Codex executable.

**Live retest is still required:** these checks do not establish that the CEO's original sandboxed fixture completes setup, accepts the native hook review or passes the blocked create/edit, guard, mixed-task and meeting acceptance. The independent tester must rerun that fixture and report remaining access refusals distinctly; no bypass or inferred live acceptance is included in this release.
