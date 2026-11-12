# Owned Claude connections and optional managed leads — 2026-11-13

This is the shared Team Orchestrator runtime and Codex workflow increment, not the separate Orca plugin. Candidate: **Mod 0.5.62 / Codex 0.1.12 / schema 11 / writer protocol 2**, with **86 matching runtime files**. Main was independently checked and remains Mod 0.5.61 / Codex 0.1.11. No candidate was installed or activated in a real project, no real store was upgraded and no existing conversation was adopted, stopped or rebound.

The prior checkpoint supplied independent Codex workers but left the external lead dependent on its existing host input route. This increment adds an optional pinned official Claude SDK component, provider-owned Claude connections within the same project dispatcher, human-request relay, and an explicitly selected owned lead for a new team. The [managed-lead decision](https://github.com/herman925/925-cc-plugins/issues/206) holds Herman's two selections. It is a closed design decision, not a declaration that live acceptance is complete.

## Resulting behavior

- A new team's optional managed lead receives the four coordination tools plus the five reviewed management/interview/session tools. It inherits **no controller approval, filesystem permission, subagent grant or sandbox override**. Its own native management proposal remains a separate confirmation.
- Workers expose only their four reviewed team tools and the private guard callback. Unlisted direct MCP calls are refused; the launch review is not just a set of per-tool UI preferences.
- The creating approved controller can inspect/display its exact managed lead's pending human request. The current approved top head relays worker requests, including workers originally launched by another approved controller. Both paths check the actual current member binding before and after review. An unbound controller cannot use this path to clear a worker's question directly.
- Native questions retain their original questions/options. Supported permission proposals display the actual one-time command/input or native file diff. Missing, secret, unsupported or oversized proposals remain pending. The model cannot submit an answer as a tool argument. Native cancellation is cancellation, not a human refusal. [The official SDK input contract](https://code.claude.com/docs/en/agent-sdk/user-input) documents the callback and answer shapes used by the Claude bridge.
- Preparation sends no model input. The native process/target is recorded before bootstrap; actual native session metadata establishes the binding. One durable claim precedes each bootstrap/wake/response. Unknown results never authorize another process, replayed input or a provider switch.
- Ordinary Orca terminal teams retain their route. A new team that explicitly selects managed-lead mode uses reviewed owned connections even when its controller is in Orca. That route is separate from the still-missing fence on ordinary Orca terminal prompt delivery.
- The SDK driver strips inherited controller/session identity at the final spawn boundary, where an SDK merge of `process.env` cannot reintroduce it. Native authentication, configuration and project hooks/settings remain in force. Actual CLI identity comes from the owned process/session proof.
- The dispatcher compatibility fence covers every shipped executable module, including schema/API/guard code, with text newline normalization so equivalent Windows/package checkouts still interoperate. A genuinely mismatched owner reports update-required and stays intact; it is never silently replaced.
- Verified nonmembers and eligible leaf workers can edit checked public package source. Stale/reserved identities, redirected/external targets and direct private execution remain refused. This repairs the installed hook's observed public-source false positives in source; it does not hotpatch that installed hook.

Schema 11 adds immutable opt-in and head-tool-consent records. Schema-10 worker consents remain the four-tool contract. The explicit backed-up schemas 5–10 upgrade preserves existing teams, approvals, history, worker consent and pending launch state; it creates no managed-head option or permission. Ordinary edits cannot convert an existing team, the legacy Mod launcher cannot claim a managed-team launch, and a managed lead cannot adopt an existing conversation. The native draft form has an explicit lead-session choice. The Mod panel identifies an owned lead and hides incompatible legacy launch/adoption buttons; its full owned creation/review workflow is currently the Codex workflow, not panel parity.

## Verification

All native fixtures used actual **Codex 0.167.0**, **Claude Code 2.1.322** and the pinned official **Claude SDK 0.3.322**, with deterministic loopback model responses, isolated homes/projects and explicit synthetic fixture creation/launch grants. **No paid model request or real human/native approval was answered.** Disposable-owner cleanup cancels retained fixture waits; it does not fabricate an answer.

| Pass | Result | Evidence |
| --- | --- | --- |
| Common SQLite + owned real PostgreSQL, Node 22.13 | **704 passed, 0 failed, 0 cancelled, 0 skipped** | Retained full TAP/hash below |
| Focused head/readiness/upgrade/review checks on both engines | **122 passed, 0 failed, 0 skipped** | Retained TAP/hash below |
| Mod SDK and panel regression | **474 passed, 0 failed**, 48 files | Includes no legacy launch/adoption controls for a managed lead |
| Final owner/source/environment/native-UI follow-up | **22 passed, 0 failed, 0 skipped** | Contract mismatch refuses enrollment; newline-only copies interoperate; lead choice stays draft-only and discovery lists itself once |
| Syntax and package parity | **85 MJS checked**, 0 syntax failures; **86 files** match both packages | One additional packaged file is the Windows ownership proof script |

The full run preceded the final draft-form/discovery and newline-compatibility polish; the explicit follow-up covers those changes. These counts are separate runs, not a combined total. An earlier run had four schema-10 expectation failures after the schema-11 change; those assertions were corrected and the clean full run above supersedes it. Both disposable PostgreSQL runs stopped their own clusters successfully. Docker was not exercised.

Native evidence, copied verbatim from successful fixtures:

| Fixture | Established result | Artifact |
| --- | --- | --- |
| Normal optional component installation on Node 22.13 | Preview/apply/hash readback, pinned npm lock, no scripts, no worker/config/store effects | [Component receipt](owned-claude-managed-lead-20261113/component-install.json) |
| Real SDK positive and negative guard | Positive executes one tool; negative invokes the guard twice and the tool zero times. Spawn asserts parent identity is absent | [Positive](owned-claude-managed-lead-20261113/claude-positive-sdk.json), [negative](owned-claude-managed-lead-20261113/claude-negative-guard.json) |
| Real Claude question and duplicate wake | Actual question pending, native form prepared, no answer, second wake refused, inbox still outstanding | [Question evidence](owned-claude-managed-lead-20261113/claude-native-question.json) |
| Optional Claude lead | Native binding + Ready, its own controller proposal pending, viewer inspection authorized, no inherited approval | [Claude lead](owned-claude-managed-lead-20261113/claude-owned-lead.json) |
| Optional Codex lead | Native binding + Ready, actual app-server elicitation pending, viewer authorized, no inherited approval | [Codex lead](owned-claude-managed-lead-20261113/codex-owned-lead.json) |
| Claude lead → Codex worker | Automatic two-way inbox, both acknowledged, worker outcome and distinct head acceptance; 13 Claude + 11 Codex model requests | [Mixed run](owned-claude-managed-lead-20261113/claude-head-codex-worker.json) |
| Codex lead → Claude worker | Same lifecycle and two-way acknowledgement; 12 requests per provider. Repeated after the full-runtime owner fence | [Reverse mixed run](owned-claude-managed-lead-20261113/codex-head-claude-worker.json) |

Both mixed runs used the real member tools to admit, verify, report and accept `5 + 7 = 12`. The worker's generation-3 outcome and the head's acceptance occupy separate rows. Only their initial bootstraps were submitted by the fixture; subsequent turns came through the automatic owned inbox path. The head coordinated without inheriting a controller grant. This establishes transport/API behavior with deterministic responses, **not real-model reasoning acceptance**. The Claude SDK guard was exercised natively; **Codex project-hook trust was not attested** by these fixtures, and must not be inferred from sandbox mode or Ready.

## Installation and acceptance limits

The final normal setup **preview only** reports:

```text
runtimeDigest: 8fdf0043f0d6a09605f20efeb52bb5bec1d2d1bb89ea0acd42566f47c97f4ce8
runtimeFileCount: 86
sharedSchemaVersion: 11
installedRuntimeMatchesPreview: false
activeRuntime: not-inspected
requiresNativeHookReview: false
requiresReconnect: true
```

[Exact preview](owned-claude-managed-lead-20261113/setup-preview.json). No apply ran. An unchanged hook does not need another review merely because the runtime changed; the preview does not attest its trust. Any future activation must use normal setup/reconnect and matching clients. A store upgrade is a separate native-reviewed backed-up operation. Status and installation never migrate a store automatically.

Still open: person-facing native form display/acceptance in the actual user client; real-model mixed task/meeting acceptance; positive live Codex hook-trust enforcement and configured project-hook compatibility; long pending-review/resume behavior for the new SDK route; safe recovery after loss of an owner/creating controller; live Orca enrollment and the ordinary terminal-delivery fence; full Mod panel creation/review parity. Unknown owners stay reserved, not replaced. Meeting records/replay remain on the common lifecycle, but no new mixed native meeting acceptance is claimed here. Hosted PostgreSQL onboarding, migration clients, Hermes and the separate Orca-plugin convergence remain on the map.

## Retained logs

[Check records](owned-claude-managed-lead-20261113/retained-checks.json) contain absolute retained log paths and complete SHA256 values. [Artifact hashes](owned-claude-managed-lead-20261113/SHA256SUMS.json) cover the copied JSON files. Primary full TAP:

```text
C:/Users/Herman/AppData/Local/Temp/team-completion-pg-9LURLC/suite.tap
SHA256 5BC33470578FE0F2B6A474EA964145273E0E450BC96E0B5C6A7C63EBFB0C3156
```

Only disposable resources were used. Original provider transcripts, current user conversations, team records, global configuration and installed Orca bundles remain untouched.
