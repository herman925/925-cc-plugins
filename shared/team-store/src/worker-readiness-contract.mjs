import {WORKER_TOOL_POLICY,WORKER_TOOL_BUNDLE_JSON} from './worker-policy.mjs';
export const WORKER_READINESS_DDL=`
CREATE UNIQUE INDEX launch_member_identity ON member_launches(launch_id,member_id);
CREATE TABLE worker_tool_consents (
 launch_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES member_launches(launch_id),
 plan_id TEXT COLLATE {{identity_collation}} NOT NULL REFERENCES launch_plans(plan_id),
 policy_id TEXT NOT NULL CHECK(policy_id='${WORKER_TOOL_POLICY}'),
 tools_json TEXT NOT NULL CHECK(tools_json='${WORKER_TOOL_BUNDLE_JSON}'),
 created_at_ms BIGINT NOT NULL CHECK(created_at_ms>=0 AND created_at_ms<=9007199254740991),
 PRIMARY KEY(launch_id,plan_id)
);
CREATE TABLE worker_readiness (
 member_id TEXT COLLATE {{identity_collation}} NOT NULL PRIMARY KEY REFERENCES members(member_id),
 launch_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE,
 plan_id TEXT COLLATE {{identity_collation}} NOT NULL,
 runtime_epoch TEXT COLLATE {{identity_collation}} NOT NULL,
 native_execution_key TEXT COLLATE {{identity_collation}} NOT NULL,
 binding_generation BIGINT NOT NULL CHECK(binding_generation>=1 AND binding_generation<=9007199254740991),
 conversation_id TEXT COLLATE {{identity_collation}} NOT NULL,
 incarnation_id TEXT COLLATE {{identity_collation}} NOT NULL,
 receipt_id TEXT COLLATE {{identity_collation}} NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('checking','ready','disconnected')),
 status_checked SMALLINT NOT NULL CHECK(status_checked IN (0,1)),
 api_checked SMALLINT NOT NULL CHECK(api_checked IN (0,1)),
 inbox_checked SMALLINT NOT NULL CHECK(inbox_checked IN (0,1)),
 seen_checked SMALLINT NOT NULL CHECK(seen_checked IN (0,1)),
 generation BIGINT NOT NULL CHECK(generation>=1 AND generation<=9007199254740991),
 created_at_ms BIGINT NOT NULL CHECK(created_at_ms>=0 AND created_at_ms<=9007199254740991),
 last_verified_at_ms BIGINT NOT NULL CHECK(last_verified_at_ms>=created_at_ms AND last_verified_at_ms<=9007199254740991),
 CHECK(state<>'ready' OR (status_checked=1 AND api_checked=1 AND inbox_checked=1 AND seen_checked=1)),
 FOREIGN KEY(launch_id,member_id) REFERENCES member_launches(launch_id,member_id),
 FOREIGN KEY(launch_id,plan_id) REFERENCES worker_tool_consents(launch_id,plan_id)
);
`;
export function workerReadinessGuardsFor(engine){
 const error='STORE_WORKER_RUNTIME_IMMUTABLE: Worker consent is immutable and readiness is generation fenced.';
 if(engine==='sqlite')return `CREATE TRIGGER worker_consent_update BEFORE UPDATE ON worker_tool_consents BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER worker_consent_delete BEFORE DELETE ON worker_tool_consents BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER worker_consent_replace BEFORE INSERT ON worker_tool_consents WHEN EXISTS(SELECT 1 FROM worker_tool_consents WHERE launch_id=NEW.launch_id AND plan_id=NEW.plan_id) BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER worker_readiness_update BEFORE UPDATE ON worker_readiness WHEN NEW.member_id IS NOT OLD.member_id OR NEW.launch_id IS NOT OLD.launch_id OR NEW.created_at_ms IS NOT OLD.created_at_ms OR NEW.generation<>OLD.generation+1 OR NEW.last_verified_at_ms<OLD.last_verified_at_ms BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER worker_readiness_delete BEFORE DELETE ON worker_readiness BEGIN SELECT RAISE(ABORT,'${error}'); END;
CREATE TRIGGER worker_readiness_replace BEFORE INSERT ON worker_readiness WHEN EXISTS(SELECT 1 FROM worker_readiness WHERE member_id=NEW.member_id OR launch_id=NEW.launch_id OR receipt_id=NEW.receipt_id) BEGIN SELECT RAISE(ABORT,'${error}'); END;`;
 return `CREATE FUNCTION worker_consent_immutable() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='${error}'; END; $g$;
CREATE TRIGGER worker_consent_update BEFORE UPDATE OR DELETE ON worker_tool_consents FOR EACH ROW EXECUTE FUNCTION worker_consent_immutable();
CREATE TRIGGER worker_consent_truncate BEFORE TRUNCATE ON worker_tool_consents FOR EACH STATEMENT EXECUTE FUNCTION worker_consent_immutable();
CREATE FUNCTION worker_readiness_fence() RETURNS trigger LANGUAGE plpgsql AS $g$ BEGIN IF NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.launch_id IS DISTINCT FROM OLD.launch_id OR NEW.created_at_ms IS DISTINCT FROM OLD.created_at_ms OR NEW.generation<>OLD.generation+1 OR NEW.last_verified_at_ms<OLD.last_verified_at_ms THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='${error}'; END IF; RETURN NEW; END; $g$;
CREATE TRIGGER worker_readiness_update BEFORE UPDATE ON worker_readiness FOR EACH ROW EXECUTE FUNCTION worker_readiness_fence();
CREATE TRIGGER worker_readiness_delete BEFORE DELETE ON worker_readiness FOR EACH ROW EXECUTE FUNCTION worker_consent_immutable();
CREATE TRIGGER worker_readiness_truncate BEFORE TRUNCATE ON worker_readiness FOR EACH STATEMENT EXECUTE FUNCTION worker_consent_immutable();`;
}
