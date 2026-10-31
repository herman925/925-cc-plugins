# Runtime refusal catalogue

Schema-5 typed API adds the following refusal families. Exact messages live in `api.mjs`, `src/api-domain.mjs`, `mod-native.mjs`, `mod-bridge.mjs` and the Mod's `hooks/shared-store.tsx`; the older primitive catalogue below retains its historical line references.

| Code | Meaning |
| --- | --- |
| `API_AUTHENTICATOR_REQUIRED` | Trusted integration did not supply a native verifier. |
| `API_CALLER_SCOPE` | Verified caller project/machine differs from fixed API configuration. |
| `API_NATIVE_UNVERIFIED` | Native runtime, terminal, exact conversation, live registry or bridge parent cannot be verified. No authority is inferred from absence. |
| `API_INPUT_INVALID` / `API_OPERATION_DENIED` | Unsupported command/shape, extra field, invalid explicit outcome or an attempt to use a private operation. |
| `API_APPROVAL_REQUIRED` | No specific controller approval action was verified. |
| `API_CONTROLLER_REQUIRED` / `API_CONTROLLER_REVOKED` | This conversation has no current approval, or a revoked record cannot be silently resurrected. |
| `API_STALE_AUTHORITY` | Expected team/controller/member/binding/attempt generation differs from current state. Inspect and decide a new operation; do not substitute a guessed counter. |
| `API_BINDING_REQUIRED` / `API_STALE_BINDING` | No current binding, or its native incarnation/home no longer agrees with verified facts. |
| `API_MEMBER_SCOPE` / `API_TARGET_UNVERIFIED` | Inactive/wrong-team caller or target; target project, native home and current facts must agree. |
| `API_DIRECT_REPORT_REQUIRED` / `API_ASSIGNEE_REQUIRED` / `API_HEAD_REQUIRED` | The caller does not own this operation's reporting relationship or assignment. |
| `API_PICKUP_REQUIRED` / `API_ALREADY_PICKED_UP` / `API_PICKUP_EXPIRED` | Worker has not verified the admitted assignment, already did so, or missed its pickup window. |
| `API_OUTCOME_REQUIRED` / `API_ATTEMPT_SETTLED` | Head acceptance needs an explicit worker outcome; a decided/reported/non-open attempt cannot be silently repeated. |
| `API_BRIDGE_FAILED` | Private subprocess could not verify/complete the call; it publishes no success. |
| `API_BRIDGE_UNKNOWN` | No confirmed subprocess receipt. Keep the same operation ID and reconcile; this is not proof of no effect. |

The typed API also preserves primitive `STORE_*` refusals, loud lease conflicts, writer fences, rollback and unknown-commit handling. Ordinary validation can use `STORE_INPUT_INVALID`. An unknown receipt is never automatic permission to repeat external work.

Exact messages/templates and source locations. `${...}` denotes runtime interpolation. Database immutability errors carry the displayed code prefix; native filesystem failures retain their OS codes.

| Code | Exact message template | Source |
| --- | --- | --- |
| `STORE_ANSWER_WINDOW_REQUIRED` | answerWindowMinutes must be explicitly configured; no default answer window was chosen. | `src/configuration.mjs:19` |
| `STORE_AUTHORITY_ASYNC` | Client authorization policy must return a synchronous decision. | `src/authority.mjs:14` |
| `STORE_AUTHORITY_DENIED` | Client authorization policy refused this team store operation. | `src/authority.mjs:11`, `src/authority.mjs:16` |
| `STORE_AUTHORITY_REQUIRED` | A synchronous client authorization policy is required. | `src/authority.mjs:7` |
| `STORE_CLOCK_INVALID` | Database clock moved backwards during the machine transaction. | `src/machine-store.mjs:209`, `src/machine-store.mjs:214` |
| `STORE_CLOCK_INVALID` | Database clock moved backwards during the write transaction. | `src/store.mjs:312` |
| `STORE_CLOCK_INVALID` | Local heartbeat clock regressed for member ${JSON.stringify(input.memberId)}. | `src/machine-store.mjs:171` |
| `STORE_CLOSED` | Machine store is closed. | `src/machine-store.mjs:126` |
| `STORE_CLOSED` | Team store is closed. | `src/store.mjs:96` |
| `STORE_COMMIT_UNKNOWN` | Commit outcome is unknown for operation ${JSON.stringify(operationId)}. Reconcile using the same operation id; do not repeat external effects. | `src/store.mjs:120` |
| `STORE_COMMIT_UNKNOWN` | Machine commit outcome is unknown for operation ${JSON.stringify(request.operationId)}. Reconcile using the same operation id. | `src/machine-store.mjs:222` |
| `STORE_COMMIT_UNKNOWN` | Schema installation commit outcome is unknown. Reopen and inspect the schema before any repeat installation. | `src/bootstrap.mjs:80` |
| `STORE_CONFIG_CONFLICT` | Configuration changed for team ${JSON.stringify(mutation.teamId)}; the transaction was rolled back. | `src/configuration.mjs:188` |
| `STORE_CONFIG_CONFLICT` | Team ${JSON.stringify(id)} configuration changed (expected ${expected}, current ${current}). | `src/configuration.mjs:104` |
| `STORE_CONFLICT` | Team store mutation lost its expected state or generation. The transaction was rolled back. | `src/store.mjs:17` |
| `STORE_CONNECTION_CLOSED` | Team store database connection closed. | `src/engines.mjs:25`, `src/engines.mjs:38` |
| `STORE_CONNECTION_FAILED` | Cannot connect to the configured PostgreSQL team database. | `src/engines.mjs:92` |
| `STORE_CONSTRAINTS_UNAVAILABLE` | PostgreSQL team storage requires enabled origin constraint enforcement. | `src/engines.mjs:87` |
| `STORE_CONSTRAINT_CONFLICT` | Team store constraint refused the operation. No partial mutation was committed. | `src/store.mjs:342` |
| `STORE_DATABASE_ERROR` | Machine database operation failed. No success was published. | `src/machine-store.mjs:240` |
| `STORE_DATABASE_ERROR` | Team store database operation failed. No success was published. | `src/store.mjs:344` |
| `STORE_DRIVER_UNAVAILABLE` | Hosted team storage requires the optional pg driver. Local SQLite does not require it. | `src/engines.mjs:76` |
| `STORE_EMPTY` | ${definition.label} is empty. Explicit creation is required. | `src/bootstrap.mjs:99` |
| `STORE_EMPTY` | Team store is empty. Explicit creation is required. | `src/bootstrap.mjs:156` |
| `STORE_FORMAT_UNSUPPORTED` | Unsupported team store format. No writes were performed. | `src/bootstrap.mjs:27` |
| `STORE_HIERARCHY_CYCLE` | Boss chain for member ${JSON.stringify(m.memberId)} would contain a cycle through ${JSON.stringify(boss)}. | `src/configuration.mjs:139` |
| `STORE_HOME_IMMUTABLE` | Registered home for member ${JSON.stringify(m.memberId)} cannot change in a routine roster update; an explicit transfer flow is required. | `src/configuration.mjs:144` |
| `STORE_IDEMPOTENCY_CONFLICT` | Machine operation id ${JSON.stringify(request.operationId)} was already used with a different request. | `src/machine-store.mjs:135` |
| `STORE_IDEMPOTENCY_CONFLICT` | Operation id ${JSON.stringify(request.operationId)} was already used with a different request. | `src/store.mjs:135` |
| `STORE_IDENTITY_INVALID` | Machine storage requires the shared project UUID, not a path-derived identity. | `src/machine-store.mjs:112` |
| `STORE_IDENTITY_INVALID` | Store identity is missing; no writer floor was invented. | `src/writers.mjs:38` |
| `STORE_IDENTITY_INVALID` | The ${definition.label} has no valid project UUID. No identity was invented. | `src/bootstrap.mjs:49` |
| `STORE_INPUT_INVALID` | ${field} must be ${allowEmpty ? 'a' : 'a nonempty'} NUL-free UTF-8 string. | `src/validation.mjs:5` |
| `STORE_INPUT_INVALID` | ${field} must be a boolean. | `src/configuration.mjs:9` |
| `STORE_INPUT_INVALID` | ${field} must be a safe integer between ${min} and ${max}. | `src/validation.mjs:12` |
| `STORE_INPUT_INVALID` | ${field} must be one of ${values.join(', ')}. | `src/configuration.mjs:10` |
| `STORE_INPUT_INVALID` | A machine request must contain between 1 and 100 observation mutations. | `src/machine-store.mjs:39` |
| `STORE_INPUT_INVALID` | A mutation request must contain between 1 and 100 mutations. | `src/store.mjs:40` |
| `STORE_INPUT_INVALID` | A team store request is required. | `src/store.mjs:32` |
| `STORE_INPUT_INVALID` | Hosted storage requires explicit PostgreSQL configuration. | `src/bootstrap.mjs:145` |
| `STORE_INPUT_INVALID` | Machine creation requires an explicit project and machine binding. | `src/bootstrap.mjs:68` |
| `STORE_INPUT_INVALID` | Machine storage supports SQLite only. | `src/bootstrap.mjs:12` |
| `STORE_INPUT_INVALID` | Missing SQL parameter: ${name}. | `src/engines.mjs:8` |
| `STORE_INPUT_INVALID` | Observation detail must be finite JSON data. | `src/machine-store.mjs:33` |
| `STORE_INPUT_INVALID` | PostgreSQL connectionString must be an explicit postgres URL. | `src/engines.mjs:69`, `src/store.mjs:86` |
| `STORE_INPUT_INVALID` | PostgreSQL connectionString must name an explicit host and project database. | `src/engines.mjs:71` |
| `STORE_INPUT_INVALID` | Unexpected configuration field or shape. | `src/configuration.mjs:12` |
| `STORE_INPUT_INVALID` | Unexpected machine observation field or shape. | `src/machine-store.mjs:23` |
| `STORE_INPUT_INVALID` | Unexpected team store mutation field. | `src/store.mjs:46` |
| `STORE_INPUT_INVALID` | Unsupported team store mutation type. | `src/store.mjs:45` |
| `STORE_INPUT_INVALID` | Unsupported team store operation kind. | `src/store.mjs:36` |
| `STORE_INPUT_INVALID` | Unsupported team store read entity. | `src/store.mjs:364` |
| `STORE_INPUT_INVALID` | contextUsedPercent must be finite and between 0 and 100, or null. | `src/machine-store.mjs:55` |
| `STORE_INPUT_INVALID` | exemptMemberIds must be an explicit array of member IDs. | `src/configuration.mjs:22` |
| `STORE_INPUT_INVALID` | exemptMemberIds must contain unique member IDs. | `src/configuration.mjs:24` |
| `STORE_INPUT_INVALID` | observationKind must be read, acknowledged or liveness. | `src/machine-store.mjs:63` |
| `STORE_INPUT_INVALID` | rawState contradicts the supplied unknown observation state. | `src/machine-store.mjs:52` |
| `STORE_LEASE_EXPIRED` | Team store lease expired during the mutation. The transaction was rolled back. | `src/store.mjs:309`, `src/store.mjs:313` |
| `STORE_LEASE_EXPIRED` | Team store lease expired or belongs to another holder. Reacquire before renewing. | `src/store.mjs:159` |
| `STORE_LEASE_HELD` | Team store is held by ${JSON.stringify(lease.machineId)} until ${lease.expiresAtMs}; this writer was refused. | `src/store.mjs:150` |
| `STORE_LOCAL_BINDING_MISSING` | No local binding exists for member ${JSON.stringify(input.memberId)}. | `src/machine-store.mjs:144` |
| `STORE_LOCAL_BINDING_STALE` | Local session or binding generation is stale for member ${JSON.stringify(input.memberId)}. No observation or acknowledgement was written. | `src/machine-store.mjs:146` |
| `STORE_LOCAL_BINDING_STALE` | Rebinding member ${JSON.stringify(input.memberId)} requires a newer binding generation. | `src/machine-store.mjs:155` |
| `STORE_LOCAL_GENERATION_CONFLICT` | Observation generation changed for member ${JSON.stringify(input.memberId)}. | `src/machine-store.mjs:162`, `src/machine-store.mjs:180` |
| `STORE_LOCAL_GENERATION_CONFLICT` | Observation generation for member ${JSON.stringify(input.memberId)} changed (expected ${input.expectedGeneration}, current ${current}). | `src/machine-store.mjs:154`, `src/machine-store.mjs:170` |
| `STORE_LOCAL_RECEIPT_EXISTS` | Local observation receipt ${JSON.stringify(input.receiptId)} already exists and cannot be overwritten. | `src/machine-store.mjs:184` |
| `STORE_MACHINE_BINDING_MISMATCH` | Machine store ${column} is ${JSON.stringify(identity[column])}, not ${JSON.stringify(expected)}. No writes were performed. | `src/bootstrap.mjs:52` |
| `STORE_MACHINE_OPERATION_UNSUPPORTED` | Machine storage accepts neither a hosted database nor a shared-store object. | `src/machine-store.mjs:110` |
| `STORE_MACHINE_OPERATION_UNSUPPORTED` | Machine storage cannot execute ${JSON.stringify(input?.type)}; only fixed local observation operations are supported. | `src/machine-store.mjs:41`, `src/machine-store.mjs:65` |
| `STORE_MEMBER_CONFLICT` | Member ${JSON.stringify(m.memberId)} generation changed (expected ${mutation.expectedGeneration}, current ${actual}). | `src/configuration.mjs:134` |
| `STORE_MEMBER_CONFLICT` | Member generation changed for ${JSON.stringify(m.memberId)}; the transaction was rolled back. | `src/configuration.mjs:157` |
| `STORE_MEMBER_NAME_EXISTS` | Member name ${JSON.stringify(m.name)} already belongs to ${JSON.stringify(nameTaken.member_id)}. | `src/configuration.mjs:136` |
| `STORE_MEMBER_SCOPE` | Member ${JSON.stringify(id)} belongs to team ${JSON.stringify(row.team_id)}, not ${JSON.stringify(teamId)}. | `src/configuration.mjs:111` |
| `STORE_MEMBER_SCOPE` | Member ${JSON.stringify(m.memberId)} belongs to another team; routine roster updates cannot transfer it. | `src/configuration.mjs:132` |
| `STORE_MESSAGE_ENDPOINTS_INVALID` | Message ${JSON.stringify(mutation.messageId)} sender/recipient must match the two endpoints of thread ${JSON.stringify(mutation.threadId)}. | `src/store.mjs:221` |
| `STORE_MESSAGE_EXISTS` | Message ${JSON.stringify(duplicate.message_id)} already owns that message or delivery identity; immutable content cannot be replaced. | `src/store.mjs:223` |
| `STORE_MESSAGE_IMMUTABLE` | STORE_MESSAGE_IMMUTABLE: Message content and membership are immutable; updates, replacement and deletion are refused. | `contract.mjs:13 (both database dialects)` |
| `STORE_MESSAGE_KIND_INVALID` | Message kind ${JSON.stringify(result.messageKind)} is unsupported. Allowed kinds: ${MESSAGE_KINDS.join(', ')}. | `src/store.mjs:52` |
| `STORE_METADATA_MISSING` | Team store metadata is missing from a nonempty database. No schema was installed. | `src/bootstrap.mjs:21` |
| `STORE_NOT_EMPTY` | Cannot install team store schema: database is not empty. | `src/bootstrap.mjs:65` |
| `STORE_NOT_FOUND` | Machine store does not exist. Explicit creation is required. | `src/machine-store.mjs:90`, `src/machine-store.mjs:101` |
| `STORE_NOT_FOUND` | Team store does not exist. Explicit creation is required. | `src/bootstrap.mjs:120`, `src/bootstrap.mjs:131` |
| `STORE_PATH_INVALID` | Machine database must be a regular local file, not a symlink. | `src/machine-store.mjs:105` |
| `STORE_PATH_INVALID` | Machine observations require local storage; a UNC path is not supported. | `src/machine-store.mjs:82` |
| `STORE_PATH_INVALID` | Machine projectKey must be one safe directory component. | `src/machine-store.mjs:75` |
| `STORE_PATH_INVALID` | Machine storage components must be real directories, not symlinks. | `src/machine-store.mjs:94` |
| `STORE_PATH_INVALID` | Machine storage requires an absolute configuration root. | `src/machine-store.mjs:74` |
| `STORE_PATH_INVALID` | SQLite team storage cannot use a UNC network path; configure PostgreSQL for shared-host storage. | `src/bootstrap.mjs:113` |
| `STORE_PATH_INVALID` | Team database must be a regular file inside the project storage directory. | `src/bootstrap.mjs:128`, `src/bootstrap.mjs:135` |
| `STORE_PATH_INVALID` | Team storage directory must be a real directory inside the project root. | `src/bootstrap.mjs:124` |
| `STORE_PATH_INVALID` | Team storage requires an absolute project root. | `src/bootstrap.mjs:110`, `src/store.mjs:81` |
| `STORE_PICKUP_WINDOW_REQUIRED` | Task ${JSON.stringify(mutation.taskId)} has no explicitly configured team pickup window. | `src/store.mjs:244` |
| `STORE_PICKUP_WINDOW_REQUIRED` | pickupWindowMinutes must be explicitly configured; no default pickup window was chosen. | `src/configuration.mjs:18` |
| `STORE_READ_FAILED` | Cannot read a consistent configuration for team ${JSON.stringify(teamId)}. | `src/store.mjs:405` |
| `STORE_RECEIPT_INVALID` | Stored machine operation receipt is invalid. It was not overwritten or retried. | `src/machine-store.mjs:140` |
| `STORE_RECEIPT_INVALID` | Stored operation receipt is invalid. It was not overwritten or retried. | `src/store.mjs:140` |
| `STORE_REFERENCE_MISSING` | No role document exists for member ${JSON.stringify(mutation.memberId)}. | `src/configuration.mjs:170` |
| `STORE_REFERENCE_MISSING` | Unknown ${key} ${JSON.stringify(id)}. No referenced record was invented. | `src/writers.mjs:73` |
| `STORE_REFERENCE_SCOPE` | Assignment ${JSON.stringify(mutation.assignmentId)} does not belong to thread task ${JSON.stringify(mutation.taskId)}. | `src/store.mjs:204` |
| `STORE_REFERENCE_SCOPE` | Message ${JSON.stringify(mutation.messageId)} Run, thread and team must agree. | `src/store.mjs:219` |
| `STORE_REFERENCE_SCOPE` | Run ${JSON.stringify(mutation.runId)} does not belong to team ${JSON.stringify(mutation.teamId)}. | `src/store.mjs:197` |
| `STORE_REFERENCE_SCOPE` | Task ${JSON.stringify(mutation.taskId)} does not belong to Run ${JSON.stringify(mutation.runId)}. | `src/store.mjs:200` |
| `STORE_REPLAY_INTERVAL_REQUIRED` | replayIntervalMs must be explicitly configured as positive milliseconds; no default replay rate was chosen. | `src/configuration.mjs:21` |
| `STORE_RETRY_EXHAUSTED` | Machine transaction retry limit reached after ${tries + 1} attempts. | `src/machine-store.mjs:236` |
| `STORE_RETRY_EXHAUSTED` | Team store transaction retry limit reached after ${tries + 1} attempts. | `src/store.mjs:338` |
| `STORE_ROLE_CONFLICT` | ${counter} for member ${JSON.stringify(mutation.memberId)} changed (expected ${mutation.expectedGeneration}, current ${current}). | `src/configuration.mjs:174` |
| `STORE_ROLE_CONFLICT` | Role document generation changed for member ${JSON.stringify(mutation.memberId)}. | `src/configuration.mjs:180` |
| `STORE_ROLE_DOCUMENT_EXISTS` | Role document already exists for member ${JSON.stringify(mutation.memberId)}. | `src/configuration.mjs:165` |
| `STORE_ROLLBACK_UNKNOWN` | Machine rollback could not be confirmed for operation ${JSON.stringify(request.operationId)}. Reconcile before retrying. | `src/machine-store.mjs:225` |
| `STORE_ROLLBACK_UNKNOWN` | Rollback could not be confirmed for operation ${JSON.stringify(operationId)}. Reconcile before retrying. | `src/store.mjs:126` |
| `STORE_SCHEMA_INCOMPLETE` | Message immutability guards are missing: ${absent.join(', ')}. No write was authorized. | `src/bootstrap.mjs:45` |
| `STORE_SCHEMA_INCOMPLETE` | Team store lease row is missing. | `src/store.mjs:61` |
| `STORE_SCHEMA_INCOMPLETE` | Team store schema is incomplete: missing ${missing.join(', ')}. No schema was installed. | `src/bootstrap.mjs:37` |
| `STORE_SCHEMA_UNREADABLE` | Cannot inspect the team store schema. No schema was installed. | `src/bootstrap.mjs:18` |
| `STORE_SCHEMA_UNREADABLE` | Cannot read team store metadata. No schema was installed. | `src/bootstrap.mjs:25` |
| `STORE_TASK_WINDOW_REQUIRED` | taskWindowMinutes must be explicitly configured as positive minutes or null for off; no default was chosen. | `src/configuration.mjs:20` |
| `STORE_TEAM_EXISTS` | Team ID or name ${JSON.stringify(mutation.teamId)} / ${JSON.stringify(mutation.name)} already belongs to ${JSON.stringify(duplicate.team_id)}. | `src/configuration.mjs:118` |
| `STORE_THREAD_ENDPOINTS_INVALID` | A thread requires two distinct endpoint member IDs. | `src/store.mjs:208` |
| `STORE_THREAD_EXISTS` | Open thread ${JSON.stringify(existing.thread_id)} already connects those endpoints for team ${JSON.stringify(mutation.teamId)} / task ${JSON.stringify(mutation.taskId)}. | `src/store.mjs:210` |
| `STORE_VERSION_UNSUPPORTED` | Invalid team store schema version. No writes were performed. | `src/bootstrap.mjs:31` |
| `STORE_VERSION_UNSUPPORTED` | Unsupported ${definition.label} schema version: ${version} (supported: ${definition.version}). No writes were performed. | `src/bootstrap.mjs:33` |
| `STORE_WRITER_FAMILY_UNKNOWN` | Unknown writer family ${JSON.stringify(client)}. Installed families: ${KNOWN_WRITER_FAMILIES.join(', ')}. | `src/writers.mjs:17` |
| `STORE_WRITER_FENCE_CONFLICT` | The writer protocol floor changed; the transaction was rolled back. | `src/writers.mjs:66` |
| `STORE_WRITER_FENCE_CONFLICT` | Writer fence for ${JSON.stringify(writer.client)} changed; the transaction was rolled back. | `src/writers.mjs:61` |
| `STORE_WRITER_FENCE_INVALID` | Writer fence for ${JSON.stringify(writer.client)} has an invalid release version. No fence was repaired. | `src/writers.mjs:47` |
| `STORE_WRITER_FENCE_MISSING` | Writer fence for installed family ${JSON.stringify(writer.client)} is missing; no writer was registered. | `src/writers.mjs:42` |
| `STORE_WRITER_PROTOCOL_OLD` | This adapter cannot read configuration requiring writer protocol ${identity.minimum_writer_protocol}; supported protocol is ${WRITER_PROTOCOL_VERSION}. | `src/store.mjs:391` |
| `STORE_WRITER_PROTOCOL_OLD` | Writer protocol ${writer.protocol} is below the store's required protocol ${floor}. No configuration or observation was written. | `src/writers.mjs:40` |
| `STORE_WRITER_PROTOCOL_UNSUPPORTED` | Writer protocol ${protocol} exceeds this adapter's supported protocol ${WRITER_PROTOCOL_VERSION}. | `src/writers.mjs:22` |
| `STORE_WRITER_REQUIRED` | An attested writer family, release version and protocol are required for this write. | `src/writers.mjs:14` |
| `STORE_WRITER_TOO_OLD` | Writer ${JSON.stringify(writer.client)} version ${writer.version} is older than the recorded ${fence.writer_version} (protocol ${oldProtocol}). A fresh configuration generation does not authorize this binary. | `src/writers.mjs:50` |
| `STORE_WRITER_VERSION_INVALID` | Writer version ${JSON.stringify(version)} must be numeric major.minor.patch. | `src/writers.mjs:7` |
