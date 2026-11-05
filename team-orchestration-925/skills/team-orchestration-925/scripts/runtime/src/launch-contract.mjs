export const LAUNCH_DDL=`
CREATE TABLE launch_plans (
 plan_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY,
 team_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES teams(team_id),
 controller_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES controller_approvals(controller_id),
 machine_id TEXT COLLATE {{identity_collation}} NOT NULL,
 approved_config_version BIGINT NOT NULL CHECK(approved_config_version>=1 AND approved_config_version<=9007199254740991),
 selection_json TEXT NOT NULL,
 created_at_ms BIGINT NOT NULL UNIQUE CHECK(created_at_ms>=0 AND created_at_ms<=9007199254740991)
);
CREATE TABLE launch_plan_members (
 launch_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES member_launches(launch_id),
 plan_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES launch_plans(plan_id),
 member_generation BIGINT NOT NULL CHECK(member_generation>=1 AND member_generation<=9007199254740991),
 official_generation BIGINT NOT NULL CHECK(official_generation>=1 AND official_generation<=9007199254740991),
 notes_generation BIGINT NOT NULL CHECK(notes_generation>=1 AND notes_generation<=9007199254740991),
 PRIMARY KEY(launch_id,plan_id)
);
CREATE TABLE launch_targets (
 launch_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES member_launches(launch_id),
 terminal_handle TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE,
 context_id TEXT COLLATE {{identity_collation}} NOT NULL,
 incarnation_id TEXT COLLATE {{identity_collation}} NOT NULL,
 execution_host_id TEXT COLLATE {{identity_collation}} NOT NULL CHECK(execution_host_id='local'),
 project_root TEXT COLLATE {{identity_collation}} NOT NULL,
 machine_id TEXT COLLATE {{identity_collation}} NOT NULL,
 created_at_ms BIGINT NOT NULL CHECK(created_at_ms>=0 AND created_at_ms<=9007199254740991)
);
`;
export function launchPlanGuardsFor(engine){
 return ['launch_plans','launch_plan_members','launch_targets'].map(table=>{
  const error='STORE_LAUNCH_IMMUTABLE: Reviewed launch plans and native targets are immutable.';
  if(engine==='sqlite')return `CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER ${table}_immutable_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${table==='launch_plan_members'?'launch_id=NEW.launch_id AND plan_id=NEW.plan_id':table==='launch_targets'?'launch_id=NEW.launch_id OR terminal_handle=NEW.terminal_handle':'plan_id=NEW.plan_id OR created_at_ms=NEW.created_at_ms'}) BEGIN SELECT RAISE(ABORT,'${error}'); END;`;
  return `CREATE FUNCTION ${table}_immutable() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='${error}'; END; $g$;
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_immutable();
CREATE TRIGGER ${table}_immutable_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${table}_immutable();`;
 }).join('\n');
}
