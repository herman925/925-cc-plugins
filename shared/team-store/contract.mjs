// Contract foundation for issue #154. Neither shipped client imports this yet.
// One shared table source; dialect fragments only implement equivalent constraints.
export const FORMAT = 'team-orchestrator-shared';
export const SCHEMA_VERSION = 5;
export const WRITER_PROTOCOL_VERSION = 1;
export const KNOWN_WRITER_FAMILIES = Object.freeze(['team-orchestrator', 'team-orchestrator-orca']);
export const MACHINE_FORMAT = 'team-orchestrator-machine';
export const MACHINE_SCHEMA_VERSION = 1;
export const PROJECT_DIRECTORY = '.team-orchestrator';
export const PROJECT_DATABASE = 'team.sqlite';
export const MACHINE_DATABASE = 'machine.sqlite';
export const MESSAGE_KINDS = Object.freeze(['status', 'dispatch', 'worker_done', 'merge_ready', 'escalation', 'handoff', 'decision_gate', 'question', 'heartbeat']);
export const MESSAGE_IMMUTABLE = 'STORE_MESSAGE_IMMUTABLE: Message content and membership are immutable; updates, replacement and deletion are refused.';

export const DDL = `
CREATE TABLE store_metadata (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  format TEXT NOT NULL CHECK (format = 'team-orchestrator-shared'),
  schema_version BIGINT NOT NULL CHECK (schema_version >= 1)
);
CREATE TABLE store_lease (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  holder_machine_id TEXT COLLATE {{identity_collation}},
  holder_token TEXT COLLATE {{identity_collation}},
  generation BIGINT NOT NULL CHECK (generation >= 0 AND generation <= 9007199254740991),
  expires_at_ms BIGINT NOT NULL CHECK (expires_at_ms >= 0 AND expires_at_ms <= 9007199254740991),
  CHECK ((holder_machine_id IS NULL AND holder_token IS NULL AND expires_at_ms = 0)
      OR (holder_machine_id IS NOT NULL AND length(holder_machine_id) > 0
          AND holder_token IS NOT NULL AND length(holder_token) > 0 AND expires_at_ms > 0))
);
CREATE TABLE project_identity (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE CHECK (length(project_id) > 0),
  minimum_writer_protocol BIGINT NOT NULL CHECK (minimum_writer_protocol >= 1 AND minimum_writer_protocol <= 9007199254740991)
);
CREATE TABLE writer_fences (
  writer_client TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (writer_client IN ('team-orchestrator','team-orchestrator-orca')),
  version_major BIGINT NOT NULL CHECK (version_major >= 0 AND version_major <= 9007199254740991),
  version_minor BIGINT NOT NULL CHECK (version_minor >= 0 AND version_minor <= 9007199254740991),
  version_patch BIGINT NOT NULL CHECK (version_patch >= 0 AND version_patch <= 9007199254740991),
  writer_version TEXT NOT NULL,
  writer_protocol BIGINT NOT NULL CHECK (writer_protocol >= 1 AND writer_protocol <= 9007199254740991),
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
  level BIGINT NOT NULL CHECK (level >= 1 AND level <= 9007199254740991),
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
  idle_minutes BIGINT NOT NULL CHECK (idle_minutes >= 0 AND idle_minutes <= 9007199254740991),
  reopen TEXT NOT NULL CHECK (reopen IN ('resume','fresh')),
  max_open BIGINT NOT NULL CHECK (max_open >= 0 AND max_open <= 9007199254740991),
  launch TEXT NOT NULL CHECK (launch IN ('demand','all')),
  batch_size BIGINT NOT NULL CHECK (batch_size >= 1 AND batch_size <= 9007199254740991),
  auto_scratch INTEGER NOT NULL CHECK (auto_scratch IN (0,1)),
  assumptions INTEGER NOT NULL CHECK (assumptions IN (0,1)),
  scratch_dir TEXT NOT NULL,
  pickup_window_minutes BIGINT NOT NULL CHECK (pickup_window_minutes >= 1 AND pickup_window_minutes <= 9007199254740991),
  answer_window_minutes BIGINT NOT NULL CHECK (answer_window_minutes >= 1 AND answer_window_minutes <= 9007199254740991 AND answer_window_minutes = CAST(answer_window_minutes AS BIGINT)),
  task_window_minutes BIGINT CHECK (task_window_minutes IS NULL OR (task_window_minutes >= 1 AND task_window_minutes <= 9007199254740991 AND task_window_minutes = CAST(task_window_minutes AS BIGINT))),
  replay_interval_ms BIGINT NOT NULL CHECK (replay_interval_ms >= 1 AND replay_interval_ms <= 9007199254740991 AND replay_interval_ms = CAST(replay_interval_ms AS BIGINT))
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
INSERT INTO writer_fences (writer_client, version_major, version_minor, version_patch, writer_version, writer_protocol, generation)
VALUES ('team-orchestrator', 0, 0, 0, '0.0.0', 1, 1),
       ('team-orchestrator-orca', 0, 0, 0, '0.0.0', 1, 1);
CREATE TABLE runs (
  run_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(run_id) > 0),
  consumer_generation BIGINT NOT NULL CHECK (consumer_generation >= 1 AND consumer_generation <= 9007199254740991),
  team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams (team_id),
  UNIQUE (run_id, team_id)
);
-- Controller approval is conversation-scoped; live transport bindings are separate.
CREATE TABLE controller_approvals (
  controller_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY,
  machine_id TEXT COLLATE {{identity_collation}} NOT NULL,
  provider TEXT COLLATE {{identity_collation}} NOT NULL,
  conversation_id TEXT COLLATE {{identity_collation}} NOT NULL,
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  approved_at_ms BIGINT NOT NULL CHECK (approved_at_ms >= 0 AND approved_at_ms <= 9007199254740991),
  revoked INTEGER NOT NULL CHECK (revoked IN (0,1)),
  UNIQUE (machine_id, provider, conversation_id)
);
CREATE TABLE member_bindings (
  member_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES members (member_id),
  machine_id TEXT COLLATE {{identity_collation}} NOT NULL,
  provider TEXT COLLATE {{identity_collation}} NOT NULL,
  conversation_id TEXT COLLATE {{identity_collation}} NOT NULL,
  execution_host_id TEXT COLLATE {{identity_collation}} NOT NULL,
  context_id TEXT COLLATE {{identity_collation}} NOT NULL,
  terminal_handle TEXT COLLATE {{identity_collation}} NOT NULL,
  incarnation_id TEXT COLLATE {{identity_collation}} NOT NULL,
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  UNIQUE (machine_id, provider, conversation_id),
  UNIQUE (machine_id, execution_host_id, terminal_handle)
);
CREATE TABLE tasks (
  task_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(task_id) > 0),
  run_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES runs (run_id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','blocked','succeeded','failed')),
  outcome TEXT CHECK (outcome IN ('succeeded','failed')),
  UNIQUE (task_id, run_id),
  CHECK ((status IN ('open','blocked') AND outcome IS NULL) OR (status IN ('succeeded','failed') AND outcome IS NOT NULL AND outcome = status))
);
-- An admitted assignment is a durable record, not proof of worker understanding.
-- Each retry is a new historical assignment. Observers/transitions are a later slice.
CREATE TABLE assignments (
  assignment_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(assignment_id) > 0),
  task_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES tasks (task_id),
  member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  admitted_at_ms BIGINT NOT NULL CHECK (admitted_at_ms >= 0 AND admitted_at_ms <= 9007199254740991),
  assigned_by_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  pickup_deadline_ms BIGINT NOT NULL CHECK (pickup_deadline_ms > admitted_at_ms AND pickup_deadline_ms <= 9007199254740991),
  pickup_observed_at_ms BIGINT CHECK (pickup_observed_at_ms IS NULL OR (pickup_observed_at_ms >= admitted_at_ms AND pickup_observed_at_ms <= 9007199254740991)),
  pickup_expired_at_ms BIGINT CHECK (pickup_expired_at_ms IS NULL OR (pickup_expired_at_ms >= admitted_at_ms AND pickup_expired_at_ms <= 9007199254740991)),
  returned_to_member_id TEXT COLLATE {{identity_collation}} REFERENCES members (member_id),
  previous_assignment_id TEXT COLLATE {{identity_collation}},
  task_window_minutes BIGINT CHECK (task_window_minutes IS NULL OR (task_window_minutes >= 1 AND task_window_minutes <= 9007199254740991 AND task_window_minutes = CAST(task_window_minutes AS BIGINT))),
  task_deadline_ms BIGINT CHECK (task_deadline_ms IS NULL OR (task_deadline_ms >= 0 AND task_deadline_ms <= 9007199254740991 AND task_deadline_ms = CAST(task_deadline_ms AS BIGINT))),
  UNIQUE (assignment_id, task_id),
  FOREIGN KEY (previous_assignment_id, task_id) REFERENCES assignments (assignment_id, task_id),
  CHECK (previous_assignment_id IS NULL OR previous_assignment_id <> assignment_id),
  CHECK ((task_window_minutes IS NULL AND task_deadline_ms IS NULL)
    OR (task_window_minutes IS NOT NULL AND
      ((pickup_observed_at_ms IS NULL AND task_deadline_ms IS NULL)
        OR (pickup_observed_at_ms IS NOT NULL AND task_deadline_ms IS NOT NULL AND task_deadline_ms >= pickup_observed_at_ms))))
);
CREATE UNIQUE INDEX one_initial_assignment_per_task ON assignments (task_id) WHERE previous_assignment_id IS NULL;
CREATE UNIQUE INDEX one_successor_per_assignment ON assignments (previous_assignment_id) WHERE previous_assignment_id IS NOT NULL;
CREATE TABLE task_briefs (
  task_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES tasks (task_id),
  instructions TEXT NOT NULL CHECK (length(instructions) > 0),
  expected_result TEXT NOT NULL CHECK (length(expected_result) > 0)
);
CREATE TABLE assignment_attempts (
  assignment_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES assignments (assignment_id),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  outcome TEXT CHECK (outcome IN ('succeeded','failed')),
  summary TEXT,
  evidence TEXT,
  reported_at_ms BIGINT CHECK (reported_at_ms IS NULL OR (reported_at_ms >= 0 AND reported_at_ms <= 9007199254740991)),
  CHECK ((outcome IS NULL AND summary IS NULL AND evidence IS NULL AND reported_at_ms IS NULL)
    OR (outcome IS NOT NULL AND summary IS NOT NULL AND length(summary) > 0 AND evidence IS NOT NULL AND length(evidence) > 0 AND reported_at_ms IS NOT NULL))
);
CREATE TABLE task_acceptances (
  task_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES tasks (task_id),
  assignment_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE,
  accepted_by_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
  reason TEXT NOT NULL CHECK (length(reason) > 0),
  decided_at_ms BIGINT NOT NULL CHECK (decided_at_ms >= 0 AND decided_at_ms <= 9007199254740991),
  FOREIGN KEY (assignment_id, task_id) REFERENCES assignments (assignment_id, task_id)
);
CREATE TABLE threads (
  thread_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(thread_id) > 0),
  run_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES runs (run_id),
  status TEXT COLLATE {{identity_collation}} NOT NULL CHECK (status IN ('open', 'answered', 'fenced', 'superseded')),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  answer TEXT,
  task_id TEXT COLLATE {{identity_collation}},
  endpoint_a_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  endpoint_b_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  superseded_by_thread_id TEXT COLLATE {{identity_collation}} REFERENCES threads (thread_id),
  team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams (team_id),
  assignment_id TEXT COLLATE {{identity_collation}},
  question_delivered_at_ms BIGINT CHECK (question_delivered_at_ms IS NULL OR (question_delivered_at_ms >= 0 AND question_delivered_at_ms <= 9007199254740991 AND question_delivered_at_ms = CAST(question_delivered_at_ms AS BIGINT))),
  answer_deadline_ms BIGINT CHECK (answer_deadline_ms IS NULL OR (answer_deadline_ms >= 0 AND answer_deadline_ms <= 9007199254740991 AND answer_deadline_ms = CAST(answer_deadline_ms AS BIGINT))),
  UNIQUE (thread_id, team_id),
  UNIQUE (thread_id, team_id, endpoint_a_member_id, endpoint_b_member_id),
  FOREIGN KEY (run_id, team_id) REFERENCES runs (run_id, team_id),
  FOREIGN KEY (task_id, run_id) REFERENCES tasks (task_id, run_id),
  FOREIGN KEY (assignment_id, task_id) REFERENCES assignments (assignment_id, task_id),
  CHECK (assignment_id IS NULL OR task_id IS NOT NULL),
  CHECK ((question_delivered_at_ms IS NULL AND answer_deadline_ms IS NULL)
    OR (question_delivered_at_ms IS NOT NULL AND answer_deadline_ms IS NOT NULL AND answer_deadline_ms >= question_delivered_at_ms)),
  CHECK (endpoint_a_member_id < endpoint_b_member_id),
  CHECK ((status = 'answered' AND answer IS NOT NULL) OR (status IN ('open', 'fenced', 'superseded') AND answer IS NULL))
);
CREATE UNIQUE INDEX one_open_thread_per_task_endpoints
ON threads (task_id, endpoint_a_member_id, endpoint_b_member_id) WHERE status = 'open' AND task_id IS NOT NULL;
CREATE UNIQUE INDEX one_open_thread_per_team_endpoints
ON threads (team_id, endpoint_a_member_id, endpoint_b_member_id) WHERE status = 'open' AND task_id IS NULL;
CREATE TABLE deliveries (
  delivery_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(delivery_id) > 0),
  run_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES runs (run_id),
  consumer_generation BIGINT NOT NULL CHECK (consumer_generation >= 1 AND consumer_generation <= 9007199254740991),
  status TEXT COLLATE {{identity_collation}} NOT NULL CHECK (status IN ('outstanding', 'acknowledged', 'fenced')),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams (team_id),
  message_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE CHECK (length(message_id) > 0),
  replay_count BIGINT NOT NULL DEFAULT 0 CHECK (replay_count >= 0 AND replay_count <= 9007199254740991 AND replay_count = CAST(replay_count AS BIGINT)),
  last_replayed_at_ms BIGINT CHECK (last_replayed_at_ms IS NULL OR (last_replayed_at_ms >= 0 AND last_replayed_at_ms <= 9007199254740991 AND last_replayed_at_ms = CAST(last_replayed_at_ms AS BIGINT))),
  UNIQUE (delivery_id, message_id, team_id),
  FOREIGN KEY (run_id, team_id) REFERENCES runs (run_id, team_id),
  CHECK ((replay_count = 0 AND last_replayed_at_ms IS NULL) OR (replay_count > 0 AND last_replayed_at_ms IS NOT NULL))
  {{delivery_message_fk}}
);
CREATE TABLE messages (
  message_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(message_id) > 0),
  delivery_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE CHECK (length(delivery_id) > 0),
  team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams (team_id),
  thread_id TEXT COLLATE {{identity_collation}} NOT NULL,
  sender_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  recipient_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members (member_id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('status','dispatch','worker_done','merge_ready','escalation','handoff','decision_gate','question','heartbeat')),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0 AND created_at_ms <= 9007199254740991 AND created_at_ms = CAST(created_at_ms AS BIGINT)),
  endpoint_a_member_id TEXT COLLATE {{identity_collation}} GENERATED ALWAYS AS
    (CASE WHEN sender_member_id < recipient_member_id THEN sender_member_id ELSE recipient_member_id END) STORED,
  endpoint_b_member_id TEXT COLLATE {{identity_collation}} GENERATED ALWAYS AS
    (CASE WHEN sender_member_id < recipient_member_id THEN recipient_member_id ELSE sender_member_id END) STORED,
  UNIQUE (message_id, delivery_id, team_id),
  FOREIGN KEY (delivery_id, message_id, team_id) REFERENCES deliveries (delivery_id, message_id, team_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (thread_id, team_id, endpoint_a_member_id, endpoint_b_member_id)
    REFERENCES threads (thread_id, team_id, endpoint_a_member_id, endpoint_b_member_id),
  CHECK (sender_member_id <> recipient_member_id)
);
{{message_guards}}
CREATE TABLE decision_gates (
  gate_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(gate_id) > 0),
  task_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES tasks (task_id),
  question TEXT NOT NULL CHECK (length(question) > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  options_json TEXT,
  resolution_json TEXT,
  resolved_at_ms BIGINT CHECK (resolved_at_ms IS NULL OR (resolved_at_ms >= 0 AND resolved_at_ms <= 9007199254740991)),
  generation BIGINT NOT NULL DEFAULT 1 CHECK (generation >= 1 AND generation <= 9007199254740991),
  CHECK ((status = 'open' AND resolution_json IS NULL AND resolved_at_ms IS NULL)
    OR (status = 'resolved' AND resolution_json IS NOT NULL AND resolved_at_ms IS NOT NULL))
);
CREATE TABLE operations (
  operation_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(operation_id) > 0),
  request_fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  committed_at_ms BIGINT NOT NULL CHECK (committed_at_ms >= 0 AND committed_at_ms <= 9007199254740991)
);
INSERT INTO store_metadata (singleton, format, schema_version) VALUES (1, 'team-orchestrator-shared', 5);
INSERT INTO store_lease (singleton, holder_machine_id, holder_token, generation, expires_at_ms)
VALUES (1, NULL, NULL, 0, 0);
`;

// Separate SQLite-only machine observations. This schema cannot establish shared transitions.
export const MACHINE_DDL = `
CREATE TABLE store_metadata (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  format TEXT NOT NULL CHECK (format = 'team-orchestrator-machine'),
  schema_version BIGINT NOT NULL CHECK (schema_version >= 1)
);
CREATE TABLE machine_identity (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT COLLATE BINARY NOT NULL,
  project_key TEXT COLLATE BINARY NOT NULL,
  machine_id TEXT COLLATE BINARY NOT NULL,
  minimum_writer_protocol BIGINT NOT NULL CHECK (minimum_writer_protocol >= 1 AND minimum_writer_protocol <= 9007199254740991)
);
CREATE TABLE member_observations (
  member_id TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
  session_id TEXT COLLATE BINARY NOT NULL,
  binding_generation BIGINT NOT NULL CHECK (binding_generation >= 1 AND binding_generation <= 9007199254740991),
  state TEXT NOT NULL CHECK (state IN ('starting','working','idle','asking','offline','closed','failed','unknown')),
  raw_state TEXT,
  heartbeat_at_ms BIGINT NOT NULL CHECK (heartbeat_at_ms >= 0 AND heartbeat_at_ms <= 9007199254740991),
  turn_start_ms BIGINT CHECK (turn_start_ms IS NULL OR turn_start_ms >= 0),
  turn_end_ms BIGINT CHECK (turn_end_ms IS NULL OR turn_end_ms >= 0),
  context_used_percent DOUBLE PRECISION CHECK (context_used_percent IS NULL OR (context_used_percent >= 0 AND context_used_percent <= 100)),
  context_window_tokens BIGINT CHECK (context_window_tokens IS NULL OR context_window_tokens >= 1),
  model TEXT,
  effort TEXT,
  task_label TEXT,
  observed_at_ms BIGINT NOT NULL CHECK (observed_at_ms >= 0 AND observed_at_ms <= 9007199254740991),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991)
);
CREATE TABLE local_observation_receipts (
  receipt_id TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
  member_id TEXT COLLATE BINARY NOT NULL,
  session_id TEXT COLLATE BINARY NOT NULL,
  binding_generation BIGINT NOT NULL CHECK (binding_generation >= 1 AND binding_generation <= 9007199254740991),
  shared_delivery_id TEXT COLLATE BINARY,
  observation_kind TEXT NOT NULL CHECK (observation_kind IN ('read','acknowledged','liveness')),
  detail_json TEXT,
  observed_at_ms BIGINT NOT NULL CHECK (observed_at_ms >= 0 AND observed_at_ms <= 9007199254740991)
);
CREATE TABLE local_operations (
  operation_id TEXT COLLATE BINARY NOT NULL PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  committed_at_ms BIGINT NOT NULL CHECK (committed_at_ms >= 0 AND committed_at_ms <= 9007199254740991)
);
CREATE TABLE writer_fences (
  writer_client TEXT COLLATE BINARY NOT NULL PRIMARY KEY CHECK (writer_client IN ('team-orchestrator','team-orchestrator-orca')),
  version_major BIGINT NOT NULL CHECK (version_major >= 0 AND version_major <= 9007199254740991),
  version_minor BIGINT NOT NULL CHECK (version_minor >= 0 AND version_minor <= 9007199254740991),
  version_patch BIGINT NOT NULL CHECK (version_patch >= 0 AND version_patch <= 9007199254740991),
  writer_version TEXT NOT NULL,
  writer_protocol BIGINT NOT NULL CHECK (writer_protocol >= 1 AND writer_protocol <= 9007199254740991),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991)
);
INSERT INTO writer_fences (writer_client, version_major, version_minor, version_patch, writer_version, writer_protocol, generation)
VALUES ('team-orchestrator', 0, 0, 0, '0.0.0', 1, 1),
       ('team-orchestrator-orca', 0, 0, 0, '0.0.0', 1, 1);
INSERT INTO store_metadata VALUES (1, 'team-orchestrator-machine', 1);
`;

const deliveryMessageForeignKey = 'FOREIGN KEY (message_id, delivery_id, team_id) REFERENCES messages (message_id, delivery_id, team_id) DEFERRABLE INITIALLY DEFERRED';
export function messageGuardsFor(engine) {
  if (engine === 'sqlite') return `
CREATE TRIGGER messages_immutable_update BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT, '${MESSAGE_IMMUTABLE}'); END;
CREATE TRIGGER messages_immutable_delete BEFORE DELETE ON messages BEGIN SELECT RAISE(ABORT, '${MESSAGE_IMMUTABLE}'); END;
CREATE TRIGGER messages_immutable_replace BEFORE INSERT ON messages
WHEN EXISTS (SELECT 1 FROM messages WHERE message_id = NEW.message_id OR delivery_id = NEW.delivery_id)
BEGIN SELECT RAISE(ABORT, '${MESSAGE_IMMUTABLE}'); END;`;
  if (engine === 'postgres') return `
ALTER TABLE deliveries ADD CONSTRAINT delivery_message_membership ${deliveryMessageForeignKey};
CREATE FUNCTION reject_message_mutation() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = '${MESSAGE_IMMUTABLE}'; END;
$guard$;
CREATE TRIGGER messages_immutable_update BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION reject_message_mutation();
CREATE TRIGGER messages_immutable_truncate BEFORE TRUNCATE ON messages FOR EACH STATEMENT EXECUTE FUNCTION reject_message_mutation();`;
  throw new Error(`Unsupported team-store engine: ${engine}`);
}

export function ddlFor(engine) {
  if (engine !== 'sqlite' && engine !== 'postgres') throw new Error(`Unsupported team-store engine: ${engine}`);
  const collation = engine === 'sqlite' ? 'BINARY' : '"C"';
  return DDL.replaceAll('{{identity_collation}}', collation)
    .replace('{{delivery_message_fk}}', engine === 'sqlite' ? `, ${deliveryMessageForeignKey}` : '')
    .replace('{{message_guards}}', messageGuardsFor(engine));
}

// These are protocol statements, not a store API. Bind values; never interpolate them.
// :now_ms must come from the database clock in the transaction, not a remote machine.
const leaseGuard = `EXISTS (
  SELECT 1 FROM store_lease
  WHERE singleton = 1 AND holder_machine_id = :machine_id AND holder_token = :holder_token
    AND generation = :lease_generation AND expires_at_ms > :now_ms
)`;
const currentConsumer = `EXISTS (
  SELECT 1 FROM runs WHERE runs.run_id = :run_id AND consumer_generation = :consumer_generation
)`;

export const SQL = Object.freeze({
  readVersion: 'SELECT format, schema_version FROM store_metadata WHERE singleton = 1',
  readProjectIdentity: 'SELECT project_id, minimum_writer_protocol FROM project_identity WHERE singleton = 1',
  readWriterFence: 'SELECT * FROM writer_fences WHERE writer_client = :writer_client',
  readOperation: 'SELECT request_fingerprint, result, committed_at_ms FROM operations WHERE operation_id = :operation_id',
  readLease: 'SELECT holder_machine_id, holder_token, generation, expires_at_ms FROM store_lease WHERE singleton = 1',
  // Portable row-lock acquisition. EXISTS alone does not serialize the lease
  // against another PostgreSQL transaction. Sample the clock AFTER this returns.
  lockLease: `UPDATE store_lease SET generation = generation
    WHERE singleton = 1 AND holder_machine_id = :machine_id AND holder_token = :holder_token
      AND generation = :lease_generation
    RETURNING expires_at_ms`,
  acquireLease: `UPDATE store_lease
    SET holder_machine_id = :machine_id, holder_token = :holder_token,
        generation = generation + 1, expires_at_ms = :expires_at_ms
    WHERE singleton = 1 AND generation = :expected_generation AND expires_at_ms <= :now_ms
      AND :expires_at_ms > :now_ms
    RETURNING generation`,
  renewLease: `UPDATE store_lease SET expires_at_ms = :expires_at_ms
    WHERE singleton = 1 AND holder_machine_id = :machine_id AND holder_token = :holder_token
      AND generation = :lease_generation AND expires_at_ms > :now_ms
      AND :expires_at_ms > expires_at_ms
    RETURNING generation`,
  admitAssignment: `INSERT INTO assignments (assignment_id, task_id, member_id, admitted_at_ms, assigned_by_member_id, pickup_deadline_ms, task_window_minutes)
    SELECT :assignment_id, :task_id, :member_id, :now_ms, :assigned_by_member_id, :pickup_deadline_ms, :task_window_minutes WHERE ${leaseGuard}
    RETURNING assignment_id`,
  answerThread: `UPDATE threads SET status = 'answered', answer = :answer, generation = generation + 1
    WHERE thread_id = :thread_id AND run_id = :run_id AND status = 'open' AND generation = :expected_generation
      AND ${currentConsumer} AND ${leaseGuard}
    RETURNING generation`,
  acknowledgeDelivery: `UPDATE deliveries SET status = 'acknowledged', generation = generation + 1
    WHERE delivery_id = :delivery_id AND run_id = :run_id AND status = 'outstanding'
      AND generation = :expected_generation AND consumer_generation = :consumer_generation
      AND ${currentConsumer} AND ${leaseGuard}
    RETURNING generation`,
  fenceDeliveries: `UPDATE deliveries SET status = 'fenced', generation = generation + 1
    WHERE run_id = :run_id AND consumer_generation = :consumer_generation AND status = 'outstanding'
      AND ${currentConsumer} AND ${leaseGuard}
    RETURNING delivery_id`,
  rebindConsumer: `UPDATE runs SET consumer_generation = consumer_generation + 1
    WHERE run_id = :run_id AND consumer_generation = :consumer_generation AND ${leaseGuard}
    RETURNING consumer_generation`,
});

// Normative companion to the DDL. The next store increment must implement and test
// these rules; constraints alone cannot enforce every multi-statement transition.
export const RULES = Object.freeze({
  version: 'Read format and schema_version before any write, including lease acquisition. Refuse unknown versions without DDL, reset, downgrade, or legacy-file writes. Schema installation is for a verified empty store only.',
  identity: 'Use lower_snake_case SQL names and case-sensitive opaque identifier values. Bind nonempty, NUL-free UTF-8 strings. Do not normalize member identity from a display name or filesystem case.',
  numbers: 'Bind finite, nonnegative safe integers for counters and UTC epoch milliseconds. Consumer and row generations start at one. Refuse generation overflow; never wrap or reset.',
  foreignKeys: 'Enable and verify SQLite foreign_keys on every connection before BEGIN. Refuse a connection if enforcement cannot be enabled. PostgreSQL constraints must remain enabled.',
  lease: 'Acquire and renew with conditional writes. A live lease refuses every competing holder, including a different token on the same machine. Report the recorded machine and expiry. Every shared mutation transaction must lockLease first, before locking any entity row. Zero rows refuses the transaction. Sample the database clock after that potentially blocking lock, then check expiry within the mutation; a stale pre-lock timestamp is invalid. Expiry is exclusive. Hold the lease row lock through COMMIT so acquisition cannot interleave with the mutation. EXISTS alone is insufficient under PostgreSQL MVCC. Reacquisition increments its generation; renewal preserves it. Never hold a write transaction across non-database external effects: agent calls, HTTP requests to other services, filesystem writes outside the database, or message sends. Database protocol reads and writes are permitted.',
  commit: 'Success means COMMIT succeeded. RETURNING rows are provisional until commit. Zero rows on a conditional write is a conflict, not success. Roll back the entire transaction on any failed prerequisite. Never launch, send, or acknowledge an external effect based on provisional rows.',
  assignment: 'Each task has one initial admitted assignment and a single successor per retry, linked by previous_assignment_id to the same task. Each retry has a new identity; never rewrite history or reopen its old thread. Admission records acceptance, not pickup or understanding. The later lifecycle transaction must check predecessor eligibility, preserve acyclic lineage and close the old attempt/thread before admitting a retry. No retry or pickup observer is implemented in this slice.',
  thread: 'Every thread names a team and may optionally name a task in its Run/team. Team-owned coordination is valid; ownerless threads are not. Owner transfer is undecided and has no API. Endpoints are canonical. Answer only an open thread at its expected row and consumer generations under the current lease. Answered, fenced and superseded threads never reopen. Only one committed writer wins.',
  messages: 'Messages are immutable content with stable identity and one delivery membership, one team/thread, sender, recipient, kind, body and creation time. Database guards reject updates, replacement and deletion. Create the message and its sole delivery together in one transaction; deferred mutual foreign keys require both at commit. Acknowledging or fencing a delivery and closing a thread do not mutate messages. Deliveries is the single batch-state table; there is no second delivery_batches state owner.',
  windows: 'Require explicit positive pickup and answer minutes, explicit task minutes or NULL for off, and explicit positive replay interval milliseconds. A question answer window starts when that question is delivered, not when work is picked up. Pickup comes from a local status observation; the shared store records only its time. Task-window minutes are snapshotted at admission; NULL minutes and deadline mean off. When enabled, no deadline exists before pickup and the deadline cannot precede pickup. No observer, timeout, scheduling or gate-application behavior is implemented here.',
  replay: 'Replay reuses the same delivery and immutable message. Replay count/time are delivery metadata, never message edits or a new message identity. Acknowledgement stops replay; an already-answered message must never be replayed. The future lifecycle enforces queue order, replay rate and delivery eligibility; these rules are not implemented by a timer or transport here.',
  gates: 'The store preserves options_json and resolution_json as opaque nullable TEXT and enforces only open/resolved presence consistency. The client validates JSON syntax, at least two offered strings, and a resolution naming an offered option with an optional note. An unoffered answer requires a new gate. No common JSON parser or option interpretation is embedded in the shared schema. Gate application and automatic unblocking remain undecided.',
  delivery: 'Acknowledged and fenced deliveries are terminal. Acknowledgement uses the expected row and consumer generations under the current lease. Fencing is not acknowledgement. Terminal historical rows remain intact.',
  rebind: 'In one transaction, fence the old consumer generation\'s outstanding deliveries, then increment the Run consumer generation by compare-and-set. Roll back both if the rebind loses or the lease expires. New consumers cannot acknowledge old deliveries. Message replay and redelivery policy are not defined by this foundation.',
  retry: 'SQLite busy/locked and PostgreSQL 40001/40P01 require a bounded whole-transaction retry after rollback, with the same operation identity and freshly read generations. A lost commit response is unknown: reconcile before retrying. A uniqueness violation is a domain conflict, not a transient retry. No retry may duplicate an external effect.',
  receipts: 'Write the operation id, canonical request fingerprint, serialized outcome and database commit timestamp atomically in the mutation transaction. Fingerprint the operation kind, authenticated principal id and every outcome-determining request value, including expected row generations; object key order must not matter. Exclude database-generated timestamps, refreshed lease bindings, and explicitly nonsemantic request metadata such as submission timestamps. Same id and fingerprint replays the recorded result after current authorization and version checks. Same id and a different fingerprint is a conflict, never an overwrite. After a lost commit reply, reconcile using that same operation id; an absent receipt alone does not prove an in-flight operation rolled back. Serialize with the lease and recheck the receipt before any repeated mutation.',
  storage: 'Use project-root .team-orchestrator/team.sqlite on a local filesystem, or an explicitly configured project PostgreSQL database. Never concurrently write copied or file-synchronized SQLite replicas. Machine-local observations belong in machine.sqlite; local receipts do not establish a shared delivery transition. The migration must leave legacy folders intact.',
  writers: 'Only the two installed writer families may configure shared state or write local observations. Compare strict numeric release versions only within a family; never compare Mod and plugin release numbers. Require a synchronous client-policy attestation of family/version/protocol. Check protocol floor, family presence and release high-water mark before accepting writes; advance fences atomically with configuration or local observation mutations. A fresh configuration/row generation does not authorize an older binary. Missing/unknown families and malformed versions refuse explicitly. Machine and shared writer floors are independent and monotonic.',
  authority: 'A lease or an admitted assignment never grants tool, role, or filesystem permissions. Preserve existing guards, user grants, protected managers, and the peer-message early return. At capacity wait; never evict or automatically close.',
});
