# Native configuration retry — 0.5.44

The first actual On click was refused; preview stayed Off and no canonical option was written. `on-failure-details.json` preserved the UI failure. The initial helper discarded the native deny reason, so it showed only `Error: Option was refused.`

The live fixture's generated primary SDK defines `ConfigSetInput.value` as `ConfigValue`, with a toggle explicitly requiring a boolean. The UI helper supplied `String(true)` instead. The SDK also documents that a plugin's own `config.set` hooks are skipped for its `$.config.set` call; validation cannot rely on that hook being re-entered.

Copy and hash-verify ONE runtime file into the existing isolated source fixture:

- `team-orchestrator/hooks/register.tsx`

It now passes the actual boolean, preserves the host's deny reason, and runs the existing Orca executable validator directly before a UI-originated save. Corresponding test source `hooks/shared-store.test.tsx` now enforces the native toggle value type in its mock and adds a failed Orca save check. The current complete suite passes **373 tests, 0 failures**, 38 files, 26.81 seconds. Validation passes with existing metadata warnings; diff check passes. All other runtime files and the core store/native verifier are unchanged.

Refresh only the isolated fixture's source runtime, then use the actual buttons to retry On, canonical saved option readback, Off, connection fields, Check access and scoped approval. Keep preview=false in the manifest default; no forced-on fixture configuration. Record actual versus mocked evidence and config persistence separately. UI can be exercised without model login; authenticated model-tool calls remain outside this unauthenticated fixture. Do not copy credentials or alter real user config. Preserve retained A/B/C and all old failure evidence.
