# Schema 3 and machine schema 1 — proposal for CEO approval

Historical proposal, subsequently approved with clarifications in CEO message `msg_85906a57ec57` and implemented in the unreleased scratch SDK. The original proposal text below is retained for design provenance; `contract.mjs`, `RUNTIME.md` and `REPORT-TO-CEO.md` describe the resulting implementation. Fixed installed writer families and independent machine writer fences were added by that approval. No legacy import or real-project migration was performed.

Sources: current Mod `types/index.d.ts`, `hooks/status.ts`, `hooks/changes.ts`, and the settled L1–L10 table in #152. Roster, settings and role documents live in the shared project store. Observed process/session liveness belongs exclusively to the machine store.

## Decisions requiring your answer

1. **Older writers across two products.** Mod 0.5.42 and Orca plugin 0.1.24 are not comparable release sequences. A config generation prevents stale edits but does not stop an older binary that freshly rereads it. Proposed additional fence: a monotonic shared writer-protocol floor plus per-client-family release high-water marks. Compare strict numeric `major.minor.patch` only within a family; unknown/malformed versions refuse. Check and advance fences in the same lease-locked transaction as the configuration change. The client policy must attest writer identity/version; these are not self-granted permissions. This is more than a config-version column and needs your decision.
2. **Shared state versus local liveness.** You requested a shared roster state and machine-only liveness. Proposed shared `membership_state = active|retired`; actual starting/working/idle/asking/offline/closed/failed observations stay local. Do not duplicate a shared “working” flag that could be mistaken for current liveness. If you intend a different shared state, please name it.
3. **Pickup default and project identity.** No default pickup window was settled in #152: require a positive integer minute value explicitly when configuring a team. Generate one stable shared project UUID during explicit schema installation; machine files bind to that UUID and their machine ID, not only a path-derived directory key. Approve both, or supply the intended default/key rule.

## Proposed shared additions

`{{identity_collation}}` has the existing single-source BINARY/C substitution. Counters/millisecond values use the contract's safe-integer limits; repetitive upper-bound checks below are expressed where columns are introduced. Boolean fields are portable 0/1 integers, never permission grants by themselves.

```sql
CREATE TABLE project_identity (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE CHECK (length(project_id) > 0),
  minimum_writer_protocol BIGINT NOT NULL CHECK (minimum_writer_protocol >= 1 AND minimum_writer_protocol <= 9007199254740991)
);
CREATE TABLE writer_fences (
  writer_client TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY,
  version_major BIGINT NOT NULL CHECK (version_major >= 0),
  version_minor BIGINT NOT NULL CHECK (version_minor >= 0),
  version_patch BIGINT NOT NULL CHECK (version_patch >= 0),
  writer_version TEXT NOT NULL,
  writer_protocol BIGINT NOT NULL CHECK (writer_protocol >= 1),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991)
);
CREATE TABLE teams (
  team_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(team_id) > 0),
  name TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE CHECK (length(name) > 0),
  function_text TEXT NOT NULL,
  config_version BIGINT NOT NULL CHECK (config_version >= 1 AND config_version <= 9007199254740991),
  written_by_client TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES writer_fences (writer_client),
  written_by_version TEXT NOT NULL
);
CREATE TABLE members (
  member_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(member_id) > 0),
  team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams (team_id),
  name TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE CHECK (length(name) > 0),
  boss_member_id TEXT COLLATE {{identity_collation}} REFERENCES members (member_id),
  role TEXT NOT NULL,
  level BIGINT NOT NULL CHECK (level >= 1),
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  worktree TEXT,
  home_context_kind TEXT CHECK (home_context_kind IN ('worktree','folder','unknown')),
  home_execution_host_id TEXT,
  home_original_path TEXT,
  machine_id TEXT,
  location TEXT CHECK (location IN ('local','remote','other-cli')),
  membership_state TEXT NOT NULL CHECK (membership_state IN ('active','retired')),
  address TEXT,
  short_name TEXT,
  cli TEXT,
  allow_agent INTEGER NOT NULL CHECK (allow_agent IN (0,1)),
  allow_write INTEGER NOT NULL CHECK (allow_write IN (0,1)),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  CHECK (boss_member_id IS NULL OR boss_member_id <> member_id),
  CHECK ((home_context_kind IS NULL AND home_execution_host_id IS NULL AND home_original_path IS NULL)
    OR (home_context_kind IS NOT NULL AND home_execution_host_id IS NOT NULL AND home_original_path IS NOT NULL))
);
CREATE TABLE team_settings (
  team_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES teams (team_id),
  auto_close INTEGER NOT NULL CHECK (auto_close IN (0,1)),
  idle_minutes BIGINT NOT NULL CHECK (idle_minutes >= 0),
  reopen TEXT NOT NULL CHECK (reopen IN ('resume','fresh')),
  max_open BIGINT NOT NULL CHECK (max_open >= 0),
  launch TEXT NOT NULL CHECK (launch IN ('demand','all')),
  batch_size BIGINT NOT NULL CHECK (batch_size >= 1),
  auto_scratch INTEGER NOT NULL CHECK (auto_scratch IN (0,1)),
  assumptions INTEGER NOT NULL CHECK (assumptions IN (0,1)),
  scratch_dir TEXT NOT NULL,
  pickup_window_minutes BIGINT NOT NULL CHECK (pickup_window_minutes >= 1)
);
CREATE TABLE settings_exemptions (
  team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES team_settings (team_id),
  member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  PRIMARY KEY (team_id, member_id)
);
CREATE TABLE role_documents (
  member_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES members (member_id),
  official_text TEXT NOT NULL,
  advisory_notes TEXT NOT NULL,
  official_generation BIGINT NOT NULL CHECK (official_generation >= 1 AND official_generation <= 9007199254740991),
  notes_generation BIGINT NOT NULL CHECK (notes_generation >= 1 AND notes_generation <= 9007199254740991)
);
```

All configuration/official-roster changes compare `expectedConfigVersion`, increment that team's `config_version`, and record the attested writer within one ordinary idempotent transaction. Member/role generations protect more specific edits. The project-wide protocol floor and per-family writer fences are reread before configuration writes and cannot decrease. A higher writer version does not override a stale configuration generation. Full ancestor-cycle checks and approval of official roles/grants remain client-side obligations under the existing authorization callback; no Head/role engine is added to the store. Globally unique names preserve the current Mod's addressing constraint, while member IDs remain stable through renames. A null boss means reporting to the user; a boss may belong to another team in the same project, preserving CEO hierarchies. Registered home cannot be changed by a routine roster update; a future explicit transfer flow requires the #141 authority contract.

Settings such as `auto_close` and `auto_scratch` are preserved configuration only: storage does not enable automatic closure or cleanup. Official role content and advisory notes are distinct columns and distinct generations; changing notes cannot change official content or permissions.

## Required lifecycle-column changes (layout, not execution policy)

Schema 3's fresh-install definitions would also change these existing tables. No schema-2 migration or `ALTER` against a user's database is proposed in this slice:

- `runs`: add required `team_id REFERENCES teams(team_id)` so team inbox ownership has an explicit home.
- `tasks`: add `status` (`open|blocked|succeeded|failed`, default `open`) and nullable `outcome` (`succeeded|failed`). A CHECK requires matching terminal status/outcome and NULL outcome for open/blocked. “Open” does not claim pickup or understanding.
- `assignments`: make existing `member_id` reference members; add required `assigned_by_member_id REFERENCES members`; required `pickup_deadline_ms > admitted_at_ms`; nullable `pickup_observed_at_ms`, `pickup_expired_at_ms`, and `returned_to_member_id REFERENCES members`. Any observed pickup/expiry must be no earlier than admission. The future admission implementation snapshots the configured pickup window. Expiry scheduling and the definition of pickup remain outside this layout slice.
- `threads`: add required `task_id REFERENCES tasks`; required canonical `endpoint_a_member_id` and `endpoint_b_member_id` references with byte-order `a < b`; allow `superseded` in the existing status constraint; add nullable `superseded_by_thread_id REFERENCES threads`. Keep the existing generation and answer consistency rules, extending NULL-answer terminal handling to superseded. One open thread per `(task_id, endpoint_a_member_id, endpoint_b_member_id)` via a partial unique index. Terminal rows remain historical; future client transactions enforce that they never reopen and that supersession links are complete.
- `decision_gates`: add `status = open|resolved` (default open), nullable opaque `options_json`, nullable opaque `resolution_json`, nullable `resolved_at_ms`, and a row generation. Resolved requires non-NULL resolution/time; open requires both NULL. JSON syntax is validated by clients without inventing option or resolution mechanics. Task blockedness and resolution application need the later lifecycle transaction; do not claim a cross-table CHECK enforces them.
- `deliveries`: keep its current columns and states. Do not invent message rows or batch membership while those #152 decisions remain open.

Required contract SQL adjustment: `SQL.admitAssignment` must bind the admitted-by member and computed pickup deadline. Existing conditional answer/ack/rebind statements need no change. Fresh primitive creation requests must supply the new required team/task/endpoint references. I request permission to update the reserved conformance fixtures to explicit column lists and seed the necessary team/member identities, retaining every original assertion and adding layout constraints. The old public request shape is not silently accepted as a fabricated default team/member.

## Proposed machine schema (SQLite only, separate version 1)

Place `<verified-machine-config-root>/team-orchestrator/<projectKey>/machine.sqlite`; the default config root is `~/.claude` and the proposed default projectKey is the shared project UUID. A safe directory key is not by itself project identity: check the stored project UUID and machine ID before any write and refuse mismatches. No shared table or shared connection is attached by this API.

```sql
CREATE TABLE store_metadata (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  format TEXT NOT NULL CHECK (format = 'team-orchestrator-machine'),
  schema_version BIGINT NOT NULL CHECK (schema_version >= 1)
);
CREATE TABLE machine_identity (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT COLLATE BINARY NOT NULL,
  project_key TEXT COLLATE BINARY NOT NULL,
  machine_id TEXT COLLATE BINARY NOT NULL
);
CREATE TABLE member_observations (
  member_id TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
  session_id TEXT COLLATE BINARY NOT NULL,
  binding_generation BIGINT NOT NULL CHECK (binding_generation >= 1),
  state TEXT NOT NULL CHECK (state IN ('starting','working','idle','asking','offline','closed','failed','unknown')),
  raw_state TEXT,
  heartbeat_at_ms BIGINT NOT NULL CHECK (heartbeat_at_ms >= 0),
  turn_start_ms BIGINT CHECK (turn_start_ms IS NULL OR turn_start_ms >= 0),
  turn_end_ms BIGINT CHECK (turn_end_ms IS NULL OR turn_end_ms >= 0),
  context_used_percent DOUBLE PRECISION CHECK (context_used_percent IS NULL OR (context_used_percent >= 0 AND context_used_percent <= 100)),
  context_window_tokens BIGINT CHECK (context_window_tokens IS NULL OR context_window_tokens >= 1),
  model TEXT,
  effort TEXT,
  task_label TEXT,
  observed_at_ms BIGINT NOT NULL CHECK (observed_at_ms >= 0),
  generation BIGINT NOT NULL CHECK (generation >= 1)
);
CREATE TABLE local_observation_receipts (
  receipt_id TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
  member_id TEXT COLLATE BINARY NOT NULL,
  session_id TEXT COLLATE BINARY NOT NULL,
  binding_generation BIGINT NOT NULL CHECK (binding_generation >= 1),
  shared_delivery_id TEXT COLLATE BINARY,
  observation_kind TEXT NOT NULL CHECK (observation_kind IN ('read','acknowledged','liveness')),
  detail_json TEXT,
  observed_at_ms BIGINT NOT NULL CHECK (observed_at_ms >= 0)
);
CREATE TABLE local_operations (
  operation_id TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  committed_at_ms BIGINT NOT NULL CHECK (committed_at_ms >= 0)
);
```

The final definitions would apply the existing nonempty/NUL-free identifier and safe-integer upper-bound rules to all relevant fields. Shared-store foreign keys cannot span database files, so local member/delivery IDs are observation references, not proof that a shared record exists or transitioned. Historical receipts survive a later binding change. Stale binding generations, stale observation row generations and regressing heartbeat times refuse local updates; they do not fence/acknowledge anything in the shared store. Rebinding is an explicit caller-authorized machine-store operation, not inferred from a heartbeat.

Expose a separate `openMachineStore` with the same synchronous client-policy seam, explicit creation, version refusal, bounded SQLite busy retry, atomic local receipts and unknown-commit reconciliation. It accepts fixed observation operations only. It has no access to a shared-store object and exposes no shared delivery or task mutation. No machine-local data is copied into the shared roster automatically.

## Acceptance after approval

- Shared DDL and writer fences/config CAS on both real engines; deterministic per-family version comparisons and rejection of an older freshly reread writer, not merely stale generations.
- Roster, settings, exemptions, role/advisory separation, registered-home shape, hierarchy integrity, and the approved lifecycle fields/constraints on both engines.
- Separate SQLite machine version/format/project/machine refusal without reset; stale session/binding and generation refusal; atomic/idempotent observations and unknown-commit reconciliation; no shared transition after any local acknowledgement.
- Dependency-free copied-source shared and machine APIs; no integration, migration execution, release, commit or push.

New refusal messages will be specified and tested with the implementation after these choices and the exact contract change are approved. No new refusal behavior is claimed by this proposal alone.
