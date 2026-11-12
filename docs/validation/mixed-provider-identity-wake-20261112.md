# Mixed-provider identity and idle Codex wake-up — 2026-11-12

Development candidate on `feat/team-orchestrator-completion` / draft PR #204. This is not an installed-runtime or live-worker acceptance claim. No CiteReflex session was prompted, restarted, rebound, granted permission or assigned work by this change.

**Follow-up:** the [bidirectionality/freshness audit](wake-bidirectionality-audit-20261112.md) found incomplete reverse delivery, a new request ID for the same delivery after rebind, post-read stale reservations and missing progress recovery. The green suites below cover narrower cases. Do not interpret this report as complete two-way delivery or duplicate prevention across binding changes.

The subsequent [repair report](wake-fencing-repair-20261112.md) supersedes the client-side status and digest below. Automatic sends now require a proposed Orca host fence; the installed host does not implement that contract, so the candidate blocks automatic wake-up and exposes the dependency.

## Incident and accepted design

Read-only native session search and the head's actual tool-result transcript established that the saved Research workers already had `cli: codex` and `binding.provider: codex` before the Claude head called them Claude. `model: default` did not identify a provider. The head later corrected itself. This was a reasoning/context error, not evidence of a saved binding being converted to Claude.

Earlier dispatch attempts had no pickup receipt and expired. The head saw idle Codex composers despite notifications; after the person asked the workers to read their own inbox, later attempts acquired pickup receipts. Notification, input acceptance, native turn start, inbox acknowledgement and assignment verification are different events.

Herman selected automatic wake-up for future deliveries to an already connected idle Codex worker: one fixed inbox-check prompt through Orca's normal prompt-delivery API, with a tracked receipt and duplicate prevention. The answer explicitly did not authorize prompting or restarting either existing Research session during development.

A later report confused `allow_write: 0` with a leaf-worker write denial. Both current guards apply the ordinary write restriction to managers with direct reports. A leaf's disabled standing switch alone does not establish a denial. A reported assignment expiry also does not establish a write denial. Other native/guard checks remain independent.

## Candidate behavior

- The Mod supplies a fresh authorized shared-team identity snapshot on each composer or peer prompt. It names configured CLI, saved session provider and configured model separately. It never infers CLI from a name, role or model, and never calls a saved binding proof of readiness or pickup. Missing/cross-team/stale reads cannot reuse a cached roster.
- `inspectCaller.guardPolicy` and team `guardPolicies` describe the existing manager-write rule using current active direct reports and standing switches. The Mod context also shows up to ten authorized assignment receipts, including returned/expired reasons, separately from that rule. Regression checks compare the explanation with both actual guards for a manager and a leaf, including an `AGENTS.md` write. This does not change permissions, guard decisions or assignment semantics, and cannot guarantee a model never misstates them.
- Codex recipients use the shared private native wake adapter. The Mod's hook child independently verifies its actual Claude parent, reconciles the original committed reservation and rechecks the current saved member/binding. An unknown reservation sends nothing. The Codex adapter verifies its actual parent and target as before.
- A new request requires a positively idle recognized native Codex target and `terminal.prompt-delivery.v1`. The adapter uses guarded `terminal.send` with `agentPrompt`, text-plus-Enter and a fixed inbox-check prompt. It never sends raw PTY input, Escape, shell commands, approval answers, interrupts, session creation or restart commands.
- A machine-local immutable request is flushed before sending. All processes share a key for the project, exact saved recipient binding and delivery/notice/meeting-generation pointer. Host replays retain the original request ID and payload. Lost replies remain uncertain; they never create a new request. Corrupt journal state or an Orca runtime change while pending stops automatic submission. A completed receipt is not overwritten by an older observation.
- Receipts distinguish `waiting-for-idle`, `unsupported`, `unknown`, `input-accepted` and `turn-started`. Only an exact native request/incarnation receipt with a supported `turn_started` observation establishes the last state. The Codex observer exposes its bounded recent wake receipts in status. Machine-local receipt files remain private adapter state.
- This transport does not read or acknowledge mail, verify an assignment, change standing permissions or extend task deadlines. Actual workers still use their own typed inbox/assignment tools.

## Validation

Final candidate, including the permission-context changes:

| Check | Result | Retained artifact |
| --- | --- | --- |
| Full common suite, SQLite and owned real PostgreSQL, Node 22.13, native Codex configured | 561 passed; 0 failed/cancelled/skipped | `%TEMP%/team-completion-pg-KPbwVN/suite.tap` |
| Full Mod SDK suite | 473 passed; 0 failed; 48 files | `%TEMP%/mixed-policy-sdk-20261112.log` |
| Runtime byte parity | 62 files in each package | `node team-orchestrator/scripts/sync-shared-store.mjs --check` |
| Patch whitespace | Passed | `git diff --check` |

SHA256, common suite: `84F940F6C0387DEF755E4876BD1626C2F185C2C57CB77093B17AC4CEF6BF3E8B`.

SHA256, Mod suite: `16606E7912FD01B12A076D6E0BCB4295434AF85F85C5631AD48BECCD1989CEC4`.

The owned PostgreSQL cluster stopped successfully. The native host socket fixture exercises the real Codex identity adapter's guarded prompt request and exact receipt validation. Both engine variants reconcile real Mod reservations and verify that transport leaves delivery outstanding and pickup absent. Additional cases cover concurrent processes, lost replies, accepted-but-not-started input, replay, provider/incarnation mismatch, busy/permission states, unsupported hosts, damaged journals, runtime changes and separate meeting generations. These host responses are fixtures; they do not prove actual model processing, human approval or current CiteReflex acceptance.

The earlier pre-permission common pass was 559/0/0/0 (`%TEMP%/team-completion-pg-LR4T3H/suite.tap`, SHA256 `B6770C22E21B7A1AFCB1A9EEDA0C49EFB3275E431FA334DC0D978A238BEE02C8`). The full Mod passes progressed through 471, 472 and finally 473 as regressions were added. A disposable test initially failed its cleanup order, then passed after database-close cleanup was registered before directory removal. No production database was involved.

Normal setup **preview only** returned `setup-ready`, candidate digest `eb3e435fdc0f05b0d759809dbd3ff9a34a7cb931c790f66534e44d3a2d8b3576`, 62 files, schema 10. Installed runtime differs; active runtime was not inspected by preview. Hook configuration is unchanged; no new native hook review is required by this preview, hook trust is not attested, and reconnect is required after any future apply. Global configuration and team store were unchanged. No apply or activation was run.

## Remaining acceptance

The candidate still needs normal reviewed installation/activation and a disposable real mixed-provider run that observes a native wake, worker role/brief ordering, inbox acknowledgement, assignment verification and separate head acceptance. Permission/trust menus, process replacement, host restart and unknown delivery must preserve their distinct states. No current live team is used as that experiment.

Private receipt storage is an adapter transport journal, not an additional team task engine or a shared read receipt. A pending request fenced by an Orca runtime change requires reconciliation; the adapter deliberately does not invent a fresh submission. Hosted onboarding and the other open completion lanes remain open. This work closes no Wayfinder ticket by itself.
