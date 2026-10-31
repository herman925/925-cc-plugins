# Legacy team import plan — not implemented

This document designs the one-time transition requested in #154. It does not authorize or execute an import. No current code opens the legacy team files. Shared schema 4 and unchanged machine schema 1 supply the destination layout; source mapping, lifecycle implementation, cutover, writer quiescence and #141 client authority remain prerequisites.

**Required unresolved mapping:** legacy teams need explicit positive `pickupWindowMinutes`, `answerWindowMinutes` and `replayIntervalMs`, plus positive `taskWindowMinutes` or explicit NULL/off. No migration default was chosen. Shared schemas 1–3 are refused; no upgrade is implemented. Schema-3 deliveries lack mandatory message membership and cannot be silently assigned invented content. Its task-only threads and one-assignment-per-task constraint also need an explicit mapping. Preserve the installed project UUID, machine binding and independent writer high-water fences; never infer them from a path or copied liveness.

## Input inventory

The existing Mod's source and README describe these project files under `.claude/team-orchestrator/`:

- `roster.json`, `settings.json`, `meta.json`.
- `roles/<name>.md`, containing official role content and advisory member notes.
- `changes/*.json` and `changes/applied.json`, distinguishing unapplied changes from changes already folded into the roster.
- `queue/*.json` and `queue/pruned.json`, distinguishing pending, sending, delivered, failed, and ignored/pruned entries.
- `claims.json`, holding identity holds and decisions; `requests/*.json`, holding member requests and their outcomes.

The older `.claude/team-orchestrator.json`, `queue.json`, and `roster.json.bak` are historical inputs to inventory, not alternative truth to merge blindly. Machine-local status files under the Claude configuration directory contain observations, not portable evidence that a worker is live or a message was understood. The Orca plugin's `.orca/team-orchestrator/` database and requests/receipts audit ledger need a separate mapping and are not implicitly imported by this Mod transition.

## Proposed phases

1. **Preflight and preview.** Authenticate the importer through the eventual client API, verify the project root and source schema/version, and refuse symlinks/path escapes, malformed or unsupported files, duplicate member identities, and contradictory indexes. List what would import and what requires a decision. Do not launch agents, send queued messages, clear holds, or infer assignment admission from a legacy status `task` string.
2. **Quiesce writers.** Establish a supported pause/upgrade boundary for every legacy writer, including sessions on other machines and old Mod versions that still write change files. Do not kill sessions or edit roster/claim files to obtain ownership. Without a proven quiescence mechanism, stop before importing. A new SQLite lease cannot control old file-based writers or disconnected SQLite copies.
3. **Capture an immutable source manifest.** Record canonical relative paths, source schema and writer versions, file sizes, content digests, and applicable indexes. Resolve unapplied changes with the old format's actual fold rules; do not replay already-applied files or silently revive expired/pruned entries. Read and hash again after capture to detect concurrent edits. Preserve the old folders and every original byte in place; any additional recovery snapshot is a separate copy, never a move.
4. **Choose the destination mapping.** The approved tables provide destinations, but source mapping and lifecycle decisions remain open. Preserve stable logical member identity, hierarchy, protected-manager rules, official-role approval provenance, advisory notes, and unresolved holds. Official role and advisory-note content/generations remain separate. Require explicit pickup minutes. Do not copy session handles, live authority, one-turn tool grants, or heartbeat freshness into new execution authority. Pending/sending queue entries require explicit reconciliation policy; they cannot be silently resent or marked acknowledged.
5. **Install and import transactionally.** Open an explicitly selected local or hosted destination through the version-checked store. Acquire its lease and use the ordinary required write transaction. Insert the resolved destination records and a durable import receipt in the same transaction. The receipt must bind a stable source-team identity, canonical source-manifest digest, mapping version, and result. Schema version 2's `operations` ledger supplies the receipt storage; the future import operation and destination mapping still need decisions. No ad hoc sidecar or undocumented table substitutes for that ledger.
6. **Handle repetition explicitly.** A repeated request with the same source identity, digest, and mapping returns its original committed result. An existing receipt with a different digest or mapping is a visible conflict requiring review; never run a second import over live new-format edits. A lost commit reply is unknown until the receipt is reconciled. If a step fails before commit, roll back all destination records and leave all legacy files untouched.
7. **Validate and cut over clients.** Compare imported counts, identities, hierarchy, role content, configuration, and unresolved-item classifications against the manifest. Verify both clients recognize the destination schema and refuse unsupported versions. Only then switch their readers/writers through their supported configuration/upgrade path. Add only the new store's own ignore rules after the path/layout decision; do not alter old backups or automatically remove old directories.
8. **Keep downgrade behavior honest.** Old folders remain discoverable by the old Mod, but they are a frozen pre-migration backup, not a synchronized projection of new-format changes. Downgrade therefore requires a deliberate single-writer rollback/reconciliation decision; never run old and new clients concurrently against divergent state. New writes cannot be safely reconstructed by simply deleting the new store.

## Acceptance required before implementing this plan

- A scratch-project fixture for each supported legacy version, including unapplied changes, malformed indexes, identity holds, pending and ambiguous sending entries, and official-role versus note boundaries.
- Same-source repeated import returns one result; a changed source fails loudly; injected failure leaves no partial import; lost commit response reconciles without resend.
- Byte-for-byte hashes prove the old folders, registry, transcripts, and machine-local status files were not modified or deleted.
- Both engines pass equivalent atomicity/idempotency cases, and client-specific cutover/downgrade behavior has its own live acceptance run.
- No queued message, session start, role grant, capacity eviction, or automatic close occurs as an import side effect.

Open decisions above remain open. This plan uses the approved layout without choosing the remaining inbox model, import reconciliation, transport replay policy, or downgrade owner.
