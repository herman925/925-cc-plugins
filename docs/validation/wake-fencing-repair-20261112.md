# Automatic inbox wake-up repairs — 2026-11-12

Candidate Mod 0.5.62 / Codex 0.1.12 / schema 10 on draft PR #204. This supersedes the client-side gaps identified at `778d0c5`. It does **not** claim a host implementation or live acceptance.

## Selected host boundary

Herman selected: prepare the required Orca contract/maintainer handoff and block automatic sends on hosts without the target fence. Read-only inspection of the installed build found the expected-incarnation field in its parameter schema but no corresponding check in its send handler. Runtime `6af79682-e7aa-4493-82fc-0dde2119f78f` advertises neither the proposed fenced-prompt capability nor a durable prompt-journal identity.

The candidate therefore reports **host-update-required**, rather than falling back to a notification, session send, raw PTY input or an unchecked prompt. This applies to automatic inbox wake-up, not ordinary tools, the existing reviewed launch flow or a member reading its own inbox. No installed client/Orca file or configuration was changed. The person can continue the existing manual inbox workflow.

[Maintainer handoff and proposed host contract](orca-fenced-inbox-wake-handoff-20261112.md). The new capability and receipt method are proposed requirements; they are not APIs claimed to exist in the current host.

## Repairs

| Audit gap | Candidate behavior |
| --- | --- |
| Asymmetric transports | Both sender adapters use the same provider-independent path for Claude and Codex recipients. Automatic wake has no older notification or Mod session-send fallback. |
| Rebind resets duplicate prevention | The durable intent key identifies project/machine/recipient/pointer independently of binding generation. The original request ID, exact saved body and native target are retained. A same-process rebind reconciles that original request. |
| Changed native target | A different process/conversation needs authoritative retirement evidence for its predecessor. At most two native-target attempts exist for the intent. Unsettled predecessors stop for reconciliation. |
| Historical reservation used after read/expiry | A private authenticated API checks current eligibility, recipient/binding, inbox order, acknowledgement/fencing, assignment deadlines/supersession and latest meeting notification. It runs again immediately before submission. It does not acknowledge mail or return message bodies. Public model API calls cannot invoke it. |
| Started wake appears complete forever | The adapter reports awaiting-inbox-progress, then needs-attention after 30 seconds without confirmed inbox progress. It does not invent another assignment, grant writes or blindly send another same-process prompt. Actual delivery eligibility settles the observation. |
| Host restart strands uncertainty | A compliant host's read-only durable receipt lookup reconciles the original ID across runtime epochs. Only continuity in the same durable journal can establish accepted/refused/absent evidence. Missing/replaced/unknown history stops; it never becomes a fresh ID. |
| Initial-send race | Automatic submission requires the proposed host contract to atomically fence the complete provider/conversation/context/host/incarnation tuple at the physical write boundary. Current hosts without it receive no automatic input. |
| Mod failures hidden from head | The Mod retains timestamped results in prompt context and a compact workspace status card. Blocked/attention states also produce a bounded notification. Codex status exposes host admission and timestamped observer results. Observations become explicitly stale rather than presenting old receipts as current facts. |
| Progress not checked until another reservation | Active clients retain the latest pending batch for read-only reconciliation between shared replay reservations, so a manual read can settle the previous observation. Native input is still governed by the original journaled request. |
| Pre-fence candidate journals | Matching legacy records are surfaced for reconciliation rather than silently discarded during upgrade. Partial/corrupt request state cannot mint a replacement request. |

The shared-state check and the host write are separate systems, not a distributed transaction. State can change after a check or after input was already accepted. The prompt is a pointer to current inbox state, not a stale task brief or permission grant. The recipient must still use its own typed inbox/assignment operations; their current database guards determine what it may read or work on. No guarantee is made that an earlier accepted prompt can be withdrawn after someone reads the mail.

## Verification

| Check | Result | Artifact |
| --- | --- | --- |
| Final common suite, both real engines, Node 22.13, native setup configured | 578 pass; 0 fail/cancel/skip | `%TEMP%/team-completion-pg-bODKuB/suite.tap` |
| Full Mod SDK suite | 474 pass; 0 fail; 48 files | `%TEMP%/wake-fenced-sdk-pass3-20261112.log` |
| Focused native/status checks after the additive startup-status field | 40 pass; 0 fail/cancel/skip, Node 22.13 | `%TEMP%/wake-fenced-status-final-20261112.tap` |
| Runtime parity | 64 files match in both packages | `sync-shared-store.mjs --check` |
| Whitespace check | Passed | `git diff --check` |

The final full pass includes the additive `inboxWake` startup-status projection, its legacy-host negative control and the canonical native-binding comparison regression. It supersedes the earlier 576-test common pass and the focused 40-test intermediate check. Both owned PostgreSQL clusters stopped successfully. No production code changed after the final full pass.

SHA256:

- Final common suite: `869EBB77BCC1963211597B371232BEDFB1B3EB6F0AE03B24240113F620E2A660`.
- Mod SDK: `7AB404F79790CD4029CE94B92A7E016989AAC78FFBDE0F1561AD53C8FBA223BB`.
- Final native/status checks: `256BB47F3A028FC8D0E3E7DE948512062E10B0E500D7A4EB396B1FD7A6DF0386`.

The tests cover both supported recipient providers through each sender adapter, lost replies, rebinds, native replacement/attempt bounds, journal continuity loss, corrupt/legacy state, concurrent callers, started-but-unread progress, post-read/expired reservations, latest meeting generations, private-API refusal, and blocked-host visibility. Native host responses are fixtures implementing the proposed contract. They prove client behavior, not a shipped Orca fence or actual model processing.

Development checks caught and corrected an invalid Mod SDK call spelling and notification deduplication across different scopes. The failed intermediate runs are retained as `wake-fenced-sdk-pass1-20261112.log` and `wake-fenced-sdk-pass2-20261112.log`; the final Mod run is green. No failed test involved a production store or live worker.

The historical bug probe is preserved at `778d0c5`. Its current validation entrypoint now runs the regression checks, rather than asserting that the old defects still exist.

## Preview and remaining acceptance

Normal setup preview only: digest `370da2642efe09dced394f3f0430035ef943c3d5920d1c8c6909deb96f8a3da4`, 64 files, schema 10. Installed runtime differs; active runtime not inspected by preview. Hook configuration unchanged, no new native hook review required by this preview, hook trust not attested, reconnect required after any future apply. Global configuration and team store unchanged; no apply/activation was run.

The owning Orca maintainer must implement and verify the proposed host contract before automatic wake can run. Then normal client reconnect/activation and disposable real bidirectional Claude/Codex acceptance must establish role/brief ordering, inbox acknowledgement, assignment pickup and separate head acceptance. Current CiteReflex sessions were neither prompted nor restarted, and no permission, assignment, hook or team record was changed by this repair. No test was handed to Claude and no Wayfinder ticket is closed by these checks.
