-- GENERATED REVIEW ARTIFACT. Runtime source: contract.mjs / ddlFor(). Do not edit.

CREATE TABLE store_metadata (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  format TEXT NOT NULL CHECK (format = 'team-orchestrator-shared'),
  schema_version BIGINT NOT NULL CHECK (schema_version >= 1)
);
CREATE TABLE store_lease (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  holder_machine_id TEXT COLLATE "C",
  holder_token TEXT COLLATE "C",
  generation BIGINT NOT NULL CHECK (generation >= 0 AND generation <= 9007199254740991),
  expires_at_ms BIGINT NOT NULL CHECK (expires_at_ms >= 0 AND expires_at_ms <= 9007199254740991),
  CHECK ((holder_machine_id IS NULL AND holder_token IS NULL AND expires_at_ms = 0)
      OR (holder_machine_id IS NOT NULL AND length(holder_machine_id) > 0
          AND holder_token IS NOT NULL AND length(holder_token) > 0 AND expires_at_ms > 0))
);
CREATE TABLE project_identity (
  singleton INTEGER NOT NULL PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT COLLATE "C" NOT NULL UNIQUE CHECK (length(project_id) > 0),
  minimum_writer_protocol BIGINT NOT NULL CHECK (minimum_writer_protocol >= 1 AND minimum_writer_protocol <= 9007199254740991)
);
CREATE TABLE writer_fences (
  writer_client TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (writer_client IN ('team-orchestrator','team-orchestrator-orca')),
  version_major BIGINT NOT NULL CHECK (version_major >= 0 AND version_major <= 9007199254740991),
  version_minor BIGINT NOT NULL CHECK (version_minor >= 0 AND version_minor <= 9007199254740991),
  version_patch BIGINT NOT NULL CHECK (version_patch >= 0 AND version_patch <= 9007199254740991),
  writer_version TEXT NOT NULL,
  writer_protocol BIGINT NOT NULL CHECK (writer_protocol >= 1 AND writer_protocol <= 9007199254740991),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991)
);
CREATE TABLE teams (
  team_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(team_id) > 0),
  name TEXT COLLATE "C" NOT NULL UNIQUE CHECK (length(name) > 0),
  function_text TEXT NOT NULL,
  config_version BIGINT NOT NULL CHECK (config_version >= 1 AND config_version <= 9007199254740991),
  written_by_client TEXT COLLATE "C" NOT NULL REFERENCES writer_fences (writer_client),
  written_by_version TEXT NOT NULL
);
CREATE TABLE members (
  member_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(member_id) > 0),
  team_id TEXT COLLATE "C" NOT NULL REFERENCES teams (team_id),
  name TEXT COLLATE "C" NOT NULL UNIQUE CHECK (length(name) > 0),
  boss_member_id TEXT COLLATE "C" REFERENCES members (member_id),
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
  team_id TEXT COLLATE "C" NOT NULL PRIMARY KEY REFERENCES teams (team_id),
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
  team_id TEXT COLLATE "C" NOT NULL REFERENCES team_settings (team_id),
  member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  PRIMARY KEY (team_id, member_id)
);
CREATE TABLE role_documents (
  member_id TEXT COLLATE "C" NOT NULL PRIMARY KEY REFERENCES members (member_id),
  official_text TEXT NOT NULL,
  advisory_notes TEXT NOT NULL,
  official_generation BIGINT NOT NULL CHECK (official_generation >= 1 AND official_generation <= 9007199254740991),
  notes_generation BIGINT NOT NULL CHECK (notes_generation >= 1 AND notes_generation <= 9007199254740991)
);
INSERT INTO writer_fences (writer_client, version_major, version_minor, version_patch, writer_version, writer_protocol, generation)
VALUES ('team-orchestrator', 0, 0, 0, '0.0.0', 1, 1),
       ('team-orchestrator-orca', 0, 0, 0, '0.0.0', 1, 1);
CREATE TABLE runs (
  run_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(run_id) > 0),
  consumer_generation BIGINT NOT NULL CHECK (consumer_generation >= 1 AND consumer_generation <= 9007199254740991),
  team_id TEXT COLLATE "C" NOT NULL REFERENCES teams (team_id),
  UNIQUE (run_id, team_id)
);
CREATE TABLE tasks (
  task_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(task_id) > 0),
  run_id TEXT COLLATE "C" NOT NULL REFERENCES runs (run_id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','blocked','succeeded','failed')),
  outcome TEXT CHECK (outcome IN ('succeeded','failed')),
  UNIQUE (task_id, run_id),
  CHECK ((status IN ('open','blocked') AND outcome IS NULL) OR (status IN ('succeeded','failed') AND outcome IS NOT NULL AND outcome = status))
);
-- An admitted assignment is a durable record, not proof of worker understanding.
-- Each retry is a new historical assignment. Observers/transitions are a later slice.
CREATE TABLE assignments (
  assignment_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(assignment_id) > 0),
  task_id TEXT COLLATE "C" NOT NULL REFERENCES tasks (task_id),
  member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  admitted_at_ms BIGINT NOT NULL CHECK (admitted_at_ms >= 0 AND admitted_at_ms <= 9007199254740991),
  assigned_by_member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  pickup_deadline_ms BIGINT NOT NULL CHECK (pickup_deadline_ms > admitted_at_ms AND pickup_deadline_ms <= 9007199254740991),
  pickup_observed_at_ms BIGINT CHECK (pickup_observed_at_ms IS NULL OR (pickup_observed_at_ms >= admitted_at_ms AND pickup_observed_at_ms <= 9007199254740991)),
  pickup_expired_at_ms BIGINT CHECK (pickup_expired_at_ms IS NULL OR (pickup_expired_at_ms >= admitted_at_ms AND pickup_expired_at_ms <= 9007199254740991)),
  returned_to_member_id TEXT COLLATE "C" REFERENCES members (member_id),
  previous_assignment_id TEXT COLLATE "C",
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
CREATE TABLE threads (
  thread_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(thread_id) > 0),
  run_id TEXT COLLATE "C" NOT NULL REFERENCES runs (run_id),
  status TEXT COLLATE "C" NOT NULL CHECK (status IN ('open', 'answered', 'fenced', 'superseded')),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  answer TEXT,
  task_id TEXT COLLATE "C",
  endpoint_a_member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  endpoint_b_member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  superseded_by_thread_id TEXT COLLATE "C" REFERENCES threads (thread_id),
  team_id TEXT COLLATE "C" NOT NULL REFERENCES teams (team_id),
  assignment_id TEXT COLLATE "C",
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
  delivery_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(delivery_id) > 0),
  run_id TEXT COLLATE "C" NOT NULL REFERENCES runs (run_id),
  consumer_generation BIGINT NOT NULL CHECK (consumer_generation >= 1 AND consumer_generation <= 9007199254740991),
  status TEXT COLLATE "C" NOT NULL CHECK (status IN ('outstanding', 'acknowledged', 'fenced')),
  generation BIGINT NOT NULL CHECK (generation >= 1 AND generation <= 9007199254740991),
  team_id TEXT COLLATE "C" NOT NULL REFERENCES teams (team_id),
  message_id TEXT COLLATE "C" NOT NULL UNIQUE CHECK (length(message_id) > 0),
  replay_count BIGINT NOT NULL DEFAULT 0 CHECK (replay_count >= 0 AND replay_count <= 9007199254740991 AND replay_count = CAST(replay_count AS BIGINT)),
  last_replayed_at_ms BIGINT CHECK (last_replayed_at_ms IS NULL OR (last_replayed_at_ms >= 0 AND last_replayed_at_ms <= 9007199254740991 AND last_replayed_at_ms = CAST(last_replayed_at_ms AS BIGINT))),
  UNIQUE (delivery_id, message_id, team_id),
  FOREIGN KEY (run_id, team_id) REFERENCES runs (run_id, team_id),
  CHECK ((replay_count = 0 AND last_replayed_at_ms IS NULL) OR (replay_count > 0 AND last_replayed_at_ms IS NOT NULL))

);
CREATE TABLE messages (
  message_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(message_id) > 0),
  delivery_id TEXT COLLATE "C" NOT NULL UNIQUE CHECK (length(delivery_id) > 0),
  team_id TEXT COLLATE "C" NOT NULL REFERENCES teams (team_id),
  thread_id TEXT COLLATE "C" NOT NULL,
  sender_member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  recipient_member_id TEXT COLLATE "C" NOT NULL REFERENCES members (member_id),
  body TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('status','dispatch','worker_done','merge_ready','escalation','handoff','decision_gate','question','heartbeat')),
  created_at_ms BIGINT NOT NULL CHECK (created_at_ms >= 0 AND created_at_ms <= 9007199254740991 AND created_at_ms = CAST(created_at_ms AS BIGINT)),
  endpoint_a_member_id TEXT COLLATE "C" GENERATED ALWAYS AS
    (CASE WHEN sender_member_id < recipient_member_id THEN sender_member_id ELSE recipient_member_id END) STORED,
  endpoint_b_member_id TEXT COLLATE "C" GENERATED ALWAYS AS
    (CASE WHEN sender_member_id < recipient_member_id THEN recipient_member_id ELSE sender_member_id END) STORED,
  UNIQUE (message_id, delivery_id, team_id),
  FOREIGN KEY (delivery_id, message_id, team_id) REFERENCES deliveries (delivery_id, message_id, team_id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (thread_id, team_id, endpoint_a_member_id, endpoint_b_member_id)
    REFERENCES threads (thread_id, team_id, endpoint_a_member_id, endpoint_b_member_id),
  CHECK (sender_member_id <> recipient_member_id)
);

ALTER TABLE deliveries ADD CONSTRAINT delivery_message_membership FOREIGN KEY (message_id, delivery_id, team_id) REFERENCES messages (message_id, delivery_id, team_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION reject_message_mutation() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'STORE_MESSAGE_IMMUTABLE: Message content and membership are immutable; updates, replacement and deletion are refused.'; END;
$guard$;
CREATE TRIGGER messages_immutable_update BEFORE UPDATE OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION reject_message_mutation();
CREATE TRIGGER messages_immutable_truncate BEFORE TRUNCATE ON messages FOR EACH STATEMENT EXECUTE FUNCTION reject_message_mutation();
CREATE TABLE decision_gates (
  gate_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(gate_id) > 0),
  task_id TEXT COLLATE "C" NOT NULL REFERENCES tasks (task_id),
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
  operation_id TEXT COLLATE "C" NOT NULL PRIMARY KEY CHECK (length(operation_id) > 0),
  request_fingerprint TEXT NOT NULL,
  result TEXT NOT NULL,
  committed_at_ms BIGINT NOT NULL CHECK (committed_at_ms >= 0 AND committed_at_ms <= 9007199254740991)
);
INSERT INTO store_metadata (singleton, format, schema_version) VALUES (1, 'team-orchestrator-shared', 4);
INSERT INTO store_lease (singleton, holder_machine_id, holder_token, generation, expires_at_ms)
VALUES (1, NULL, NULL, 0, 0);
