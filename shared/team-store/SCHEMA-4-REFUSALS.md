# Schema-4 new or changed refusal paths

Compared with the captured schema-3 catalogue. These are exact strings/templates, not new product permissions. Unchanged input validators also reject missing/wrong new field values.

| Code | Exact message template | Source |
| --- | --- | --- |
| `STORE_ANSWER_WINDOW_REQUIRED` | answerWindowMinutes must be explicitly configured; no default answer window was chosen. | `src/configuration.mjs:19` |
| `STORE_MESSAGE_ENDPOINTS_INVALID` | Message ${JSON.stringify(mutation.messageId)} sender/recipient must match the two endpoints of thread ${JSON.stringify(mutation.threadId)}. | `src/store.mjs:221` |
| `STORE_MESSAGE_EXISTS` | Message ${JSON.stringify(duplicate.message_id)} already owns that message or delivery identity; immutable content cannot be replaced. | `src/store.mjs:223` |
| `STORE_MESSAGE_IMMUTABLE` | STORE_MESSAGE_IMMUTABLE: Message content and membership are immutable; updates, replacement and deletion are refused. | `contract.mjs:13 (both database dialects)` |
| `STORE_MESSAGE_KIND_INVALID` | Message kind ${JSON.stringify(result.messageKind)} is unsupported. Allowed kinds: ${MESSAGE_KINDS.join(', ')}. | `src/store.mjs:52` |
| `STORE_REFERENCE_SCOPE` | Assignment ${JSON.stringify(mutation.assignmentId)} does not belong to thread task ${JSON.stringify(mutation.taskId)}. | `src/store.mjs:204` |
| `STORE_REFERENCE_SCOPE` | Message ${JSON.stringify(mutation.messageId)} Run, thread and team must agree. | `src/store.mjs:219` |
| `STORE_REFERENCE_SCOPE` | Run ${JSON.stringify(mutation.runId)} does not belong to team ${JSON.stringify(mutation.teamId)}. | `src/store.mjs:197` |
| `STORE_REPLAY_INTERVAL_REQUIRED` | replayIntervalMs must be explicitly configured as positive milliseconds; no default replay rate was chosen. | `src/configuration.mjs:21` |
| `STORE_SCHEMA_INCOMPLETE` | Message immutability guards are missing: ${absent.join(', ')}. No write was authorized. | `src/bootstrap.mjs:45` |
| `STORE_TASK_WINDOW_REQUIRED` | taskWindowMinutes must be explicitly configured as positive minutes or null for off; no default was chosen. | `src/configuration.mjs:20` |
| `STORE_THREAD_EXISTS` | Open thread ${JSON.stringify(existing.thread_id)} already connects those endpoints for team ${JSON.stringify(mutation.teamId)} / task ${JSON.stringify(mutation.taskId)}. | `src/store.mjs:210` |
