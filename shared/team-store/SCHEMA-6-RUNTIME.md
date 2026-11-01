# Unreleased schema 6 runtime

This development branch extends the released schema-5 preview. The Orca plugin still uses its native engine and does not import this runtime. SQLite remains the Mod's configured store; the shared library also supports explicitly configured PostgreSQL. There is no automatic local/hosted mirroring.

Schema 6 is not released. Earlier development fixtures labelled schema 6 may contain only a prior checkpoint. Keep their frozen source snapshots with their data; do not treat those draft fixtures as release-compatible stores.

## Implemented

- Admission, dispatch and explicit worker outcome commit atomically with immutable messages and delivery-owned status. Recipient FIFO exposes one oldest outstanding message at a time.
- Only the recipient reads/acknowledges its mail. Head inspection does not acknowledge. A machine-local staged read recovers the exact committed message after an interrupted response until the consumer explicitly confirms receiving its context.
- Wake reservations use the team's replay interval and current native bindings. Failed transport remains outstanding. Automatic model wake-up still needs live acceptance; enqueue/reservation does not establish delivery.
- Pickup and optional task windows use database time. Task time starts at verified pickup and stops at the explicit worker outcome. Waiting on a gate does not pause the clock. An expired unfinished attempt returns once to its admitting head; no session is closed or evicted.
- Each retry is a new assignment. Rejection, return, outcome and acceptance remain separate historical records. Accepted tasks stay terminal.
- Gates block their task. The admitting current direct head offers at least two distinct nonempty string options. It records an offered choice and optional note. A different answer requires a fresh gate linked by immutable supersession; the prior question/options stay intact.
- All effective gates answered resumes the same assignment only while it is valid. Unfinished work receives a durable task-resumed message. A returned/expired attempt cannot be revived by answering a gate. A retry retains the task's unresolved gates.
- Native task controls show a decision selector, offered choice buttons, optional note, and an explicit gate draft with separate choice inputs. Workers see the pending decision; the top head presents human decision controls. Lower heads may record a decision relayed through the hierarchy via the typed API.
- Explicit schema-5 update writes a complete backup outside the write transaction, compares the source again under lock, and atomically installs schema 6. It preserves approvals and evidence, does not grant management permission, and refuses ambiguous historical state. Normal open never upgrades implicitly.

## Typed gate commands

All commands use the normal verified member/configuration/binding generations and durable operation id.

| Command | Additional fields |
| --- | --- |
| `openGate` | `assignmentId`, `expectedAttemptGeneration`, `gateId`, `question`, `options` |
| `replaceGate` | `gateId`, `expectedGateGeneration`, `newGateId`, `question`, `options` |
| `resolveGate` | `gateId`, `expectedGateGeneration`, `choice`, optional `note` |

Inspect the assignment/team to obtain gate generations and current status. Preserve the same operation id/body for reconciliation after an unknown result. Gate receipt recovery rechecks the current head relationship. Answering a gate grants no tool or filesystem permission.

## Still outstanding

Question/answer deadline transitions, broader scheduling, legacy file migration, hosted Mod configuration, and Orca-plugin integration remain separate work. No whole-app restart, Docker or autonomous model acceptance is established by the current bounded native fixture. Node 22.13 has two-engine, authenticated bridge and fresh native-upgrade evidence in [the gate report](VALIDATION-GATES.md) and [the final history-guard follow-up](VALIDATION-HISTORY-GUARDS.md). Historical validation reports describe their exact checkpoint, not future changes.
