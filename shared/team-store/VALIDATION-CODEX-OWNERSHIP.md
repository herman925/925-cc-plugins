# Windows ownership-query repair — 2026-11-06

Release pair: **team-orchestration-925 0.1.9 / Mod 0.5.59**. Shared schema **9 is unchanged**; this repair requires an adapter update/reconnect, not another database migration.

## Reproduced cause

After reconnecting to 0.1.8, real native status passed and the user-reviewed schema-8-to-9 update and original acceptance-team creation succeeded. A subsequent native edit failed with `API_NATIVE_UNVERIFIED`: the direct Codex parent did not uniquely own the thread-writer resource. Its exact receipt reconciled as unknown; no edit, binding or worker start was inferred.

Twelve sequential Windows observations found one stable native Codex owner with matching PID and exact FILETIME ticks. A bounded monitor caught additional short-lived processes during hook refusals. An instrumented TEMP-only helper captured their names and executable paths immediately: **other Windows PowerShell inspectors**.

A paired-query reproduction returned false extra owners in **40 of 40** overlapping observations. Each query could see the other inspector in Restart Manager's resource list. Thus a valid strict identity check rejected evidence polluted by concurrent observation. Hook calls, API revalidation and the active-client observer can overlap without any second conversation taking ownership.

## Repair and retained refusals

The helper now holds a named Windows mutex for the canonical case-normalized file path around the entire Restart Manager session. This coordinates independent helper processes and both packaged runtime locations. Waiting is bounded at four seconds; failure still produces `API_NATIVE_UNVERIFIED`. The OS session and mutex are released in `finally` blocks.

An abandoned observation gate grants no cached identity: after acquiring it, the helper makes a fresh OS query. This follows the [.NET named mutex ownership and abandonment semantics](https://learn.microsoft.com/en-us/dotnet/api/system.threading.mutex?view=netframework-4.8). The gate serializes **observation**, not the native writer or team store.

No owner is filtered by executable name, PID, age or presumed harmlessness. The adapter still requires exactly one owner matching the verified native parent PID and full FILETIME timestamp, plus its existing parent executable, native thread, project, host/context and terminal-incarnation checks before and after host I/O. Two genuine file holders remain visible and ambiguous identity remains refused. There is no permission, hook-trust, approval-policy or sandbox change.

## Three validation passes

1. **Red/green at the real OS seam.** Added an overlapping-query test against a disposable file held open by the test process. It fails on the old helper and passes after serialization. A separate real second-holder subprocess remains visible. A deliberately held observation gate causes a bounded refusal; after release, the next query obtains fresh matching ownership. Focused native identity/process tests: **13 passed, 0 failed**. Existing wrong-parent, changed timestamp, duplicate/missing owner, provider/thread/context/incarnation and native race refusals remain covered.
2. **Full regression.** Minimum Node **22.13.0**, SQLite and disposable real PostgreSQL **18.6**: **452 passed, 0 failed, 0 skipped**. Native Mod SDK: **446 passed, 0 failed**, across 45 files. PostgreSQL is stopped. All **51** runtime files match both packages; all three PowerShell copies parse successfully.
3. **Cross-package native stress and distribution.** Twenty batches of three concurrent OS queries—canonical source, Mod copy and Codex copy—produce **60 matching observations, zero false extra owners**. Actual Codex **0.166.0** plugin installation/update/removal, eight-skill discovery and pinned npx installation pass. Its native MCP unowned-thread probe still returns a supported blocking hook decision and refuses the API before opening a store. These probes start **zero model turns**.

Reproduce the disposable stress case with:

```text
node shared/team-store/validation/probe-windows-owner-overlap.mjs
```

The probe retains a TEMP JSON result, closes/removes its held fixture, and touches no real team store, approval or conversation. The regression cases are in `test/windows-native.test.mjs`; standard shared-store and Mod test commands remain as documented in [launch validation](VALIDATION-CODEX-LAUNCH.md).

## Live checkpoint and remaining acceptance

The real project is now schema 9, with a complete schema-8 backup from the native-reviewed update. The same conversation retained generation-1 controller approval. Retrying the exact original `live-native-create-20261105-01a18fc1` proposal created the reviewed two-member acceptance roster: Codex lead and unbound Claude worker. These saved acceptance records remain in the project; the CEO session was not used.

The subsequent `live-add-codex-worker-20261106-01a18fc1` proposal would add one Codex worker and enable the lead's standing write setting. Its native ownership failure and unknown receipt **do not approve or commit that edit**. Preserve the exact request and reconcile before retry. No member binding, worker launch plan, task dispatch or worker model turn has been completed by this checkpoint.

After adopting 0.1.9 and reconnecting, recheck real native status, reconcile the pending edit and perform its native review if still unknown. Explicit head connection and a specific worker launch plan remain separate reviews. All active adapters querying the same thread should use the repaired helper; older concurrent inspectors do not participate in the new gate and can still pollute a query.

The deterministic cause and repair are measured, but **post-reconnect live management/worker acceptance is still pending**. Positive installed hook enforcement, a real worker turn with role/brief-before-work, separate worker outcome/head acceptance, mixed-model meetings and whole-Orca restart remain distinct live checks. The repair does not attest hook trust or implement standalone/Hermes/uncertain-start recovery.
