# Schema 5: authenticated fresh-team API slice

Opt-in fresh-store preview packaged with Mod 0.5.43; the standalone library remains private. Schema 4 is refused without automatic migration. Machine schema 1 and writer protocol 1 remain unchanged. The historical schema-4 independent report applies to that earlier revision.

`api.mjs` is a private client integration factory, with declarations in `api.d.mts`. Trusted client code supplies a native verifier and fixed project/storage/writer configuration. `execute` and `reconcile` accept only strict typed command objects, stable operation IDs and, for member binding, a target reference to verify. Supplied caller names, roles, policies, roots and SQL cannot become authority through these requests. `approveController` is a separate trusted UI entry point, absent from the model command catalogue.

## Permission matrix

| Operation | Required current authority |
| --- | --- |
| Approve controller | Fresh native caller proof and a specific user UI action for that project/conversation |
| Create fresh team | Approved controller and expected controller generation |
| Bind member | Approved controller; expected team, member and old binding generations; independently verified target in the same local project/home |
| Inspect caller | Verified native caller; only its own approval/binding/rights |
| Inspect team | Approved controller or a currently bound member of that team |
| Admit assignment | Currently bound head; target is an active direct report; expected team, actor and target member/binding generations |
| Inspect assignment | Admitted assignee or its current admitting direct head |
| Verify assignment | Current assignee; expected authority/attempt generations; unexpired pickup window |
| Report outcome | Current assignee; pickup already recorded; explicit succeeded/failed, summary and evidence |
| Decide acceptance | Current admitting direct head; explicit outcome already recorded; expected authority/attempt generations |
| Revoke controller | The approved controller itself, with expected generation |

Controller approval is persisted separately from live bindings. Several approved conversations coexist. The same verified conversation on the same machine/project retains approval after restart; every call still re-proves the current native identity. A member's changed incarnation requires explicit rebinding and an increased binding generation. A new conversation receives no inherited approval.

Host calls finish before database transactions. The transaction locks the common lease, then reads current approval, membership, native binding and team generations again. No client-supplied callback or host/network operation runs while holding the database lock. Replays and reconciliation recheck current caller authority before returning durable receipts. Current receipt identity includes the logical caller and command, not an ephemeral transport token.

`controller_approvals` records conversation approvals and revocation generations. `member_bindings` allows only one current binding per member, conversation and terminal, with explicit generation. `task_briefs` preserves instructions and expected result. `assignment_attempts` stores an explicit outcome, summary, evidence, report time and generation. `task_acceptances` separately stores the head's accepted/rejected decision and reason. An accepted decision settles the task to the worker's explicit outcome; rejection blocks it without inventing a successful outcome. Retry, re-review and rejected-task recovery are later increments.

Verification returns the official role and task brief and records pickup; it does not prove comprehension or prove a role was read before file work. A live acceptance run must establish that order separately. Optional task deadlines start at pickup. This increment has no scheduler to expire/reassign tasks, no automatic task-window fencing and no message delivery/replay/gate application. It neither opens nor closes workers; existing capacity/queue behavior is untouched.

## Mod adapter and trust boundary

The Mod hooks runtime refuses Node imports. The opt-in adapter therefore invokes packaged Node modules through `$.process.run` with bounded JSON on stdin, without a shell. `scripts/sync-shared-store.mjs` copies the authoritative shared modules into `team-orchestrator/store`; `--check` detects stale copies. Node 22.13+ with `node:sqlite` is required. The Mod preview uses SQLite; PostgreSQL is covered by the internal API suite and is not exposed as a new Mod configuration here.

Native proof checks the current Orca runtime profile/epoch, local terminal root/context/host/incarnation, one matching Claude terminal tab, and a unique live local registry entry. A native provider-session ID, when present, must match exactly. Target binding always requires that explicit native association. The subprocess additionally must be a direct child of the matching registered Claude process, with matching inherited Orca terminal/context.

Orca omits providerSession from some idle terminal projections. For the actual bridge caller only, its direct OS parent can instead prove the conversation: the registry PID must equal the parent PID and its creation fingerprint must match a fresh OS query. This fallback currently supports Windows Claude registry decimal FILETIME fingerprints only; unsupported formats/hosts refuse until verified. It cannot authenticate another target, and a conflicting native ID always refuses. There is no cached identity, title-based inference or approval from missing data. The actual Windows idle-panel approval retry passed, with its scoped approval and atomic receipt verified independently in the database.

A panel action displays the project and conversation, rechecks them on click and writes a random, short-lived, scoped machine-local approval ticket. The bridge verifies that ticket; unrelated answered questions, tool arguments and arbitrary `approve: true` flags do not qualify. Model-facing tools never receive a ticket, native proof or private bridge mode.

The existing composer-only one-turn grants, Agent restrictions and manager write restrictions also apply to shared-bound members. Literal writes to the shared store and access to private approval tickets are blocked before top/controller exceptions. Shell/path classification remains best effort, like the existing Mod. Trusted hooks, installed code, the native runtime, local registry, OS account and database owner remain trusted; this is not isolation from hostile code already running as that OS account. Do not describe the private subprocess as an independently authenticated remote service.

## Measured acceptance and remaining limits

The independent source-Mod scratch run captured its starting state and passed actual panel approval, native head/worker binding, assignment admission, strict role/brief-before-fixture ordering, explicit worker outcome, refusal of worker self-acceptance and separate head acceptance. Multiple approved controllers coexist. A new disposable conversation initially had no approval; after actual panel approval and confirmed graceful process exit, resuming that same conversation retained generation-1 approval under fresh native proof without another click. See [measured validation and preserved evidence](VALIDATION-SCHEMA-5.md). Approvals in this run were authorized simulated-user fixture actions.

Whole-Orca app restart, other operating systems' idle fingerprint formats, Docker execution and installed/release acceptance remain untested. Target binding still requires an explicit fresh native provider association; the caller fallback cannot bind another idle target whose projection omits it. Existing user sessions and installed plugins were preserved. Future independent testing must preserve uncertain receipts, avoid duplicate effects and notify Herman before handing work to Claude.
