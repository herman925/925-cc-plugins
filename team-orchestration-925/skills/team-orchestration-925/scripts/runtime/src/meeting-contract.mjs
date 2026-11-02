// Durable meeting records share the project store, its writer lease and receipts.
// A meeting never changes task assignments, roles or permission switches.
export const MEETING_DDL = `
CREATE TABLE meetings (
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(meeting_id)>0),
 team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams(team_id),
 chair_member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members(member_id),
 title TEXT NOT NULL CHECK (length(title)>0),
 start_policy TEXT NOT NULL CHECK (start_policy IN ('joined','all')),
 status TEXT NOT NULL CHECK (status IN ('inviting','active','closed','cancelled')),
 generation BIGINT NOT NULL CHECK (generation>=1 AND generation<=9007199254740991),
 current_topic BIGINT NOT NULL CHECK (current_topic>=0 AND current_topic<=9007199254740991),
 line_limit BIGINT NOT NULL CHECK (line_limit BETWEEN 1 AND 100),
 round_limit BIGINT NOT NULL CHECK (round_limit BETWEEN 1 AND 5),
 extended INTEGER NOT NULL CHECK (extended IN (0,1)),
 created_at_ms BIGINT NOT NULL CHECK (created_at_ms>=0),
 ended_at_ms BIGINT,
 CHECK ((status IN ('closed','cancelled') AND ended_at_ms IS NOT NULL AND ended_at_ms>=created_at_ms) OR (status IN ('inviting','active') AND ended_at_ms IS NULL)),
 UNIQUE (meeting_id,team_id)
);
CREATE TABLE meeting_participants (
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES meetings(meeting_id),
 member_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES members(member_id),
 state TEXT NOT NULL CHECK (state IN ('invited','joined','declined')),
 checkpoint TEXT,
 responded_at_ms BIGINT,
 PRIMARY KEY(meeting_id,member_id),
 CHECK ((state='invited' AND checkpoint IS NULL AND responded_at_ms IS NULL) OR (state<>'invited' AND checkpoint IS NOT NULL AND length(checkpoint)>0 AND responded_at_ms IS NOT NULL))
);
CREATE TABLE meeting_topics (
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES meetings(meeting_id),
 topic_index BIGINT NOT NULL CHECK (topic_index>=0 AND topic_index<=9007199254740991),
 title TEXT NOT NULL CHECK (length(title)>0),
 state TEXT NOT NULL CHECK (state IN ('pending','discussed','deferred')),
 resolution TEXT,
 PRIMARY KEY(meeting_id,topic_index),
 CHECK ((state='pending' AND resolution IS NULL) OR (state<>'pending' AND resolution IS NOT NULL AND length(resolution)>0))
);
CREATE TABLE meeting_required (
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL,
 topic_index BIGINT NOT NULL,
 member_id TEXT COLLATE {{identity_collation}} NOT NULL,
 PRIMARY KEY(meeting_id,topic_index,member_id),
 FOREIGN KEY(meeting_id,topic_index) REFERENCES meeting_topics(meeting_id,topic_index),
 FOREIGN KEY(meeting_id,member_id) REFERENCES meeting_participants(meeting_id,member_id)
);
CREATE TABLE meeting_contributions (
 contribution_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(contribution_id)>0),
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL,
 topic_index BIGINT NOT NULL,
 member_id TEXT COLLATE {{identity_collation}} NOT NULL,
 round_number BIGINT NOT NULL CHECK (round_number BETWEEN 1 AND 6),
 body TEXT NOT NULL CHECK (length(body)>0),
 created_at_ms BIGINT NOT NULL CHECK (created_at_ms>=0),
 FOREIGN KEY(meeting_id,topic_index) REFERENCES meeting_topics(meeting_id,topic_index),
 FOREIGN KEY(meeting_id,member_id) REFERENCES meeting_participants(meeting_id,member_id),
 UNIQUE(meeting_id,topic_index,member_id,round_number)
);
CREATE TABLE meeting_outputs (
 output_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY CHECK (length(output_id)>0),
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL,
 proposed_by_member_id TEXT COLLATE {{identity_collation}} NOT NULL,
 owner_member_id TEXT COLLATE {{identity_collation}} NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('minutes','action','profile','handbook','role')),
 body TEXT NOT NULL CHECK (length(body)>0),
 state TEXT NOT NULL CHECK (state IN ('proposed','accepted','rejected')),
 reviewed_by_member_id TEXT COLLATE {{identity_collation}} REFERENCES members(member_id),
 review_note TEXT,
 reviewed_at_ms BIGINT,
 created_at_ms BIGINT NOT NULL CHECK (created_at_ms>=0),
 FOREIGN KEY(meeting_id,proposed_by_member_id) REFERENCES meeting_participants(meeting_id,member_id),
 FOREIGN KEY(meeting_id,owner_member_id) REFERENCES meeting_participants(meeting_id,member_id),
 CHECK ((state='proposed' AND reviewed_by_member_id IS NULL AND review_note IS NULL AND reviewed_at_ms IS NULL) OR (state<>'proposed' AND reviewed_by_member_id IS NOT NULL AND review_note IS NOT NULL AND length(review_note)>0 AND reviewed_at_ms IS NOT NULL AND reviewed_at_ms>=created_at_ms))
);
CREATE TABLE meeting_notifications (
 meeting_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES meetings(meeting_id),
 generation BIGINT NOT NULL CHECK (generation>=1 AND generation<=9007199254740991),
 recipient_member_id TEXT COLLATE {{identity_collation}} NOT NULL,
 event TEXT NOT NULL CHECK (event IN ('invitation','updated','ended')),
 created_at_ms BIGINT NOT NULL CHECK (created_at_ms>=0),
 read_at_ms BIGINT,
 last_notified_at_ms BIGINT,
 PRIMARY KEY(meeting_id,generation,recipient_member_id),
 FOREIGN KEY(meeting_id,recipient_member_id) REFERENCES meeting_participants(meeting_id,member_id),
 CHECK (read_at_ms IS NULL OR read_at_ms>=created_at_ms)
);
`;

export function meetingGuardsFor(engine) {
 const immutable=['meeting_contributions','meeting_required'];
 const guards=immutable.map(table=>engine==='sqlite'
  ? ['UPDATE','DELETE'].map(event=>`CREATE TRIGGER ${table}_${event.toLowerCase()} BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'STORE_MEETING_IMMUTABLE'); END;`).join('\n')
  : `CREATE FUNCTION ${table}_immutable() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STORE_MEETING_IMMUTABLE'; END; $guard$;
CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${table}_immutable();`).join('\n');
 const policies={
  meetings:{fixed:['meeting_id','team_id','chair_member_id','title','start_policy','line_limit','created_at_ms'],condition:"OLD.status IN ('closed','cancelled') OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1 OR NEW.current_topic<OLD.current_topic OR NEW.current_topic>OLD.current_topic+1 OR NEW.extended<OLD.extended OR NEW.round_limit<>OLD.round_limit+(NEW.extended-OLD.extended) OR (OLD.status='active' AND NEW.status='inviting')"},
  meeting_topics:{fixed:['meeting_id','topic_index','title'],condition:"OLD.state<>'pending'"},
  meeting_participants:{fixed:['meeting_id','member_id'],condition:"OLD.state<>'invited'"},
  meeting_outputs:{fixed:['output_id','meeting_id','proposed_by_member_id','owner_member_id','kind','body','created_at_ms'],condition:"OLD.state<>'proposed' OR NEW.state='proposed' OR NOT EXISTS (SELECT 1 FROM meetings m WHERE m.meeting_id=OLD.meeting_id AND m.chair_member_id=NEW.reviewed_by_member_id AND m.status='active')"},
 };
 const keys={meetings:'meeting_id=NEW.meeting_id',meeting_participants:'meeting_id=NEW.meeting_id AND member_id=NEW.member_id',meeting_topics:'meeting_id=NEW.meeting_id AND topic_index=NEW.topic_index',meeting_required:'meeting_id=NEW.meeting_id AND topic_index=NEW.topic_index AND member_id=NEW.member_id',meeting_contributions:'contribution_id=NEW.contribution_id OR (meeting_id=NEW.meeting_id AND topic_index=NEW.topic_index AND member_id=NEW.member_id AND round_number=NEW.round_number)',meeting_outputs:'output_id=NEW.output_id',meeting_notifications:'meeting_id=NEW.meeting_id AND generation=NEW.generation AND recipient_member_id=NEW.recipient_member_id'};
 const replacements=engine==='sqlite'?Object.entries(keys).map(([table,key])=>`CREATE TRIGGER ${table}_history_replace BEFORE INSERT ON ${table} WHEN EXISTS (SELECT 1 FROM ${table} WHERE ${key}) BEGIN SELECT RAISE(ABORT,'STORE_MEETING_IMMUTABLE'); END;`).join('\n'):'';
 return guards+'\n'+replacements+'\n'+Object.entries(policies).map(([table,{fixed,condition}])=>{
  const neq=engine==='sqlite'?'IS NOT':'IS DISTINCT FROM';
  const invalid=[...fixed.map(k=>`NEW.${k} ${neq} OLD.${k}`),`(${condition})`].join(' OR ');
  if(engine==='sqlite')return `CREATE TRIGGER ${table}_history_update BEFORE UPDATE ON ${table} WHEN ${invalid} BEGIN SELECT RAISE(ABORT,'STORE_MEETING_IMMUTABLE'); END;
CREATE TRIGGER ${table}_history_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'STORE_MEETING_IMMUTABLE'); END;`;
  return `CREATE FUNCTION ${table}_history() RETURNS trigger LANGUAGE plpgsql AS $guard$ BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STORE_MEETING_IMMUTABLE'; END IF;
 IF ${invalid} THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='STORE_MEETING_IMMUTABLE'; END IF;
 RETURN NEW; END; $guard$;
CREATE TRIGGER ${table}_history_update BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_history();
CREATE TRIGGER ${table}_history_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${table}_history();`;
 }).join('\n');
}
