import {HEAD_TOOL_POLICY,HEAD_TOOL_BUNDLE_JSON} from './managed-head.mjs';
export const MANAGED_HEAD_DDL=`
CREATE TABLE managed_head_options (
 team_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES teams(team_id),
 member_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE REFERENCES members(member_id),
 created_by_controller_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES controller_approvals(controller_id),
 created_at_ms BIGINT NOT NULL CHECK(created_at_ms>=0 AND created_at_ms<=9007199254740991)
);
CREATE TABLE managed_head_tool_consents (
 launch_id TEXT COLLATE {{identity_collation}} NOT NULL,
 plan_id TEXT COLLATE {{identity_collation}} NOT NULL,
 policy_id TEXT NOT NULL CHECK(policy_id='${HEAD_TOOL_POLICY}'),
 tools_json TEXT NOT NULL CHECK(tools_json='${HEAD_TOOL_BUNDLE_JSON}'),
 created_at_ms BIGINT NOT NULL CHECK(created_at_ms>=0 AND created_at_ms<=9007199254740991),
 PRIMARY KEY(launch_id,plan_id),
 FOREIGN KEY(launch_id,plan_id) REFERENCES worker_tool_consents(launch_id,plan_id)
);
`;
export function managedHeadGuardsFor(engine){
 const message='STORE_HEAD_CONSENT_IMMUTABLE: Optional lead mode and reviewed head access cannot be rewritten.';
 const scopes={managed_head_options:'SELECT 1 FROM members m WHERE m.member_id=NEW.member_id AND m.team_id=NEW.team_id AND m.boss_member_id IS NULL',managed_head_tool_consents:'SELECT 1 FROM member_launches l JOIN members m ON m.member_id=l.member_id JOIN managed_head_options o ON o.member_id=m.member_id AND o.team_id=m.team_id JOIN launch_plans p ON p.plan_id=NEW.plan_id AND p.controller_id=l.controller_id JOIN launch_plan_members r ON r.launch_id=l.launch_id AND r.plan_id=p.plan_id WHERE l.launch_id=NEW.launch_id AND m.boss_member_id IS NULL'};
 return Object.entries(scopes).map(([table,scope])=>(engine==='sqlite'?`CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} WHEN NOT EXISTS(${scope}) BEGIN SELECT RAISE(ABORT,'${message}'); END;`:`CREATE FUNCTION ${table}_scope_check() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN IF NOT EXISTS(${scope}) THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='${message}'; END IF; RETURN NEW; END; $g$;
CREATE TRIGGER ${table}_scope BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_scope_check();`)+(engine==='sqlite'?`CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'${message}'); END;
CREATE TRIGGER ${table}_immutable_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'${message}'); END;
CREATE TRIGGER ${table}_immutable_replace BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${table==='managed_head_options'?'team_id=NEW.team_id OR member_id=NEW.member_id':'launch_id=NEW.launch_id AND plan_id=NEW.plan_id'}) BEGIN SELECT RAISE(ABORT,'${message}'); END;`:`CREATE FUNCTION ${table}_immutable() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='${message}'; END; $g$;
CREATE TRIGGER ${table}_immutable_update BEFORE UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${table}_immutable();
CREATE TRIGGER ${table}_immutable_truncate BEFORE TRUNCATE ON ${table} FOR EACH STATEMENT EXECUTE FUNCTION ${table}_immutable();`)).join('\n');
}
