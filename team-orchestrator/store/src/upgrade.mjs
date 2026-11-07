// Explicit schema upgrade only. Opening the normal store never invokes this.
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {realpath,lstat,mkdir,open} from 'node:fs/promises';
import {openBackend,inspectSchema,SHARED_SCHEMA} from './bootstrap.mjs';
import * as schema5 from './schema5-contract.mjs';
import * as schema7 from './schema7-contract.mjs';
import * as schema8 from './schema8-contract.mjs';
import * as schema9 from './schema9-contract.mjs';
import {SCHEMA_VERSION} from '../contract.mjs';
import {WORKER_READINESS_DDL,workerReadinessGuardsFor} from './worker-readiness-contract.mjs';
import {LAUNCH_DDL,launchPlanGuardsFor} from './launch-contract.mjs';
import {MEETING_DDL,meetingGuardsFor} from './meeting-contract.mjs';
import * as schema6 from './schema6-contract.mjs';
import {ddlFor,historyGuardsFor,gateGuardsFor,runtimeGuardsFor} from '../contract.mjs';
import {normalizeWriter,checkWriter} from './writers.mjs';
import {authorize} from './authority.mjs';
import {text,integer,databaseInteger,nextInteger} from './validation.mjs';
import {refusal,StoreError} from './errors.mjs';

const definitionFor=legacy=>({format:legacy.FORMAT,version:legacy.SCHEMA_VERSION,ddl:legacy.DDL,render:legacy.ddlFor,label:'team store'});
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,ordered(value[k])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(ordered(value))).digest('hex');
async function backupDirectory(root,projectId) {
 if(!isAbsolute(root))throw refusal('STORE_PATH_INVALID','Upgrade backup root must be absolute.');
 await mkdir(root,{recursive:true,mode:0o700});let directory=await realpath(root);
 for(const part of ['team-orchestrator',projectId,'backups']) {
  directory=join(directory,part);
  await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(directory);
  if(!info.isDirectory()||info.isSymbolicLink())throw refusal('STORE_PATH_INVALID','Backup directories must be real local directories.');
 }
 return directory;
}
async function tables(db,legacy) {
 const tableNames=[...legacy.DDL.matchAll(/CREATE TABLE ([a-z_]+)\s*\(/g)].map(m=>m[1]);
 const result={};
 for(const name of tableNames)result[name]=(await db.query(`SELECT * FROM ${name}`)).map(ordered).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
 return result;
}
async function lock(db,legacy) {
 await inspectSchema(db,definitionFor(legacy));const [lease]=await db.lockLeaseControl();
 const now=await db.now();
 if(lease.holder_token!==null&&databaseInteger(lease.expires_at_ms,'lease expiry')>now)throw refusal('STORE_LEASE_HELD','A live writer holds the store; upgrade was refused.',{holderMachineId:lease.holder_machine_id,expiresAtMs:Number(lease.expires_at_ms)});
 return {lease,now};
}

export async function upgradeTeamStore(options,dependencies={}) {
 const projectRoot=await realpath(text(options.projectRoot,'projectRoot')),operationId=text(options.operationId,'operationId');
 const machineId=text(options.machineId,'machineId'),writer=normalizeWriter(options.writer,false);
 const scope={projectRoot,engine:options.postgres?'postgres':'sqlite',fromVersion:9,toVersion:SCHEMA_VERSION};
 let db,legacy=schema9;
 const backend=dependencies.openBackend??openBackend;
 try {
  for(const candidate of [schema9,schema8,schema7,schema6,schema5]) {
   legacy=candidate;
   try{({db}=await backend({...options,projectRoot,create:false},definitionFor(legacy)));authorize(options.authorize,options.caller,'upgradeStore',{...scope,fromVersion:legacy.SCHEMA_VERSION},{operationId},writer);break;}
   catch(error){
    if(error.code!=='STORE_VERSION_UNSUPPORTED')throw error;
    if(error.details.version===SCHEMA_VERSION){
     ({db}=await backend({...options,projectRoot,create:false}));
     authorize(options.authorize,options.caller,'upgradeStore',{...scope,fromVersion:SCHEMA_VERSION},{operationId},writer);
     const [prior]=await db.query('SELECT * FROM schema_migrations WHERE operation_id=:id',{id:operationId});
     return prior?{status:'upgraded',fromVersion:Number(prior.from_version),toVersion:Number(prior.to_version),backupPath:prior.backup_path}:{status:'already_current',toVersion:SCHEMA_VERSION};
    }
    if(![5,6,7,8,9].includes(error.details.version))throw error;
   }
  }
  if(!db)throw refusal('STORE_VERSION_UNSUPPORTED','No supported legacy store was opened.');
  // Snapshot under the shared lock, write its backup outside any transaction,
  // then compare again under lock. Changed state refuses rather than migrating
  // data that the backup does not contain. No host I/O runs under the write lock.
  await db.begin();let before;
  try{await lock(db,legacy);before=await tables(db,legacy);await db.commit();}catch(error){await db.rollback().catch(()=>{});throw error;}
  for(const assignment of before.assignments)if(assignment.pickup_expired_at_ms!==null&&assignment.returned_to_member_id!==assignment.assigned_by_member_id)
   throw refusal('STORE_UPGRADE_DATA_UNMAPPED','An expired assignment has no unambiguous return to its admitting head. No value was invented.',{assignmentId:assignment.assignment_id});
  for(const decision of before.task_acceptances)if(decision.decision==='rejected'&&decision.accepted_by_member_id!==before.assignments.find(a=>a.assignment_id===decision.assignment_id)?.assigned_by_member_id)
   throw refusal('STORE_UPGRADE_DATA_UNMAPPED','A rejected assignment has no unambiguous admitting head. No value was invented.',{assignmentId:decision.assignment_id});
  const projectId=before.project_identity[0].project_id;
  const directory=await backupDirectory(options.backupRoot??join(homedir(),'.claude'),projectId);
  const backupPath=join(directory,`schema-${legacy.SCHEMA_VERSION}-${randomUUID()}.json`),file=await open(backupPath,'wx',0o600);
  try{await file.writeFile(JSON.stringify({format:'team-orchestrator-upgrade-backup',schemaVersion:legacy.SCHEMA_VERSION,engine:db.engine,projectId,schemaSql:legacy.ddlFor(db.engine),tables:before}));await file.sync();}finally{await file.close();}
  await dependencies.afterBackup?.({backupPath}); // Fault-injection seam, outside a database transaction.
  await db.begin();let committing=false;
  try {
   const {lease,now}=await lock(db,legacy);
   if(digest(await tables(db,legacy))!==digest(before))throw refusal('STORE_UPGRADE_CHANGED','The store changed while its backup was written. Upgrade was refused; retry after other activity settles.',{backupPath});
   const token=randomUUID(),generation=nextInteger(databaseInteger(lease.generation,'lease generation'),'lease generation'),expiry=integer(now+120000,'upgrade lease expiry');
   await db.query('UPDATE store_lease SET holder_machine_id=:machine,holder_token=:token,generation=:generation,expires_at_ms=:expiry WHERE singleton=1',{machine:machineId,token,generation,expiry});
   await checkWriter(db,writer,{advance:true});
   const ddl=ddlFor(db.engine);
   if(legacy.SCHEMA_VERSION===5){
   await db.exec('ALTER TABLE task_acceptances RENAME TO task_acceptances_schema5');
   await db.exec('CREATE UNIQUE INDEX assignment_admitting_head ON assignments (assignment_id,assigned_by_member_id)');
   await db.exec('CREATE UNIQUE INDEX decision_gate_task ON decision_gates (gate_id,task_id)');
   for(const name of ['task_acceptances','assignment_returns','schema_migrations','decision_gate_supersessions']) {
    const sql=ddl.match(new RegExp(`CREATE TABLE ${name} \\([\\s\\S]*?\\n\\);`))?.[0];
    if(!sql)throw refusal('STORE_UPGRADE_INVALID','Upgrade DDL is incomplete.');
    await db.exec(sql);
   }
   await db.exec('INSERT INTO task_acceptances SELECT * FROM task_acceptances_schema5');
   await db.exec('DROP TABLE task_acceptances_schema5');
   await db.exec("CREATE UNIQUE INDEX one_accepted_outcome_per_task ON task_acceptances (task_id) WHERE decision='accepted'");
   await db.exec(`INSERT INTO assignment_returns (assignment_id,returned_to_member_id,reason,returned_at_ms)
    SELECT assignment_id,returned_to_member_id,'pickup_expired',pickup_expired_at_ms FROM assignments WHERE pickup_expired_at_ms IS NOT NULL`);
   await db.exec(`INSERT INTO assignment_returns (assignment_id,returned_to_member_id,reason,returned_at_ms)
    SELECT assignment_id,accepted_by_member_id,'rejected',decided_at_ms FROM task_acceptances WHERE decision='rejected'`);
   await db.exec(historyGuardsFor(db.engine));
   await db.exec(gateGuardsFor(db.engine));
   const inconsistent=await db.query("SELECT 1 FROM decision_gates g JOIN tasks t ON t.task_id=g.task_id WHERE g.status='open' AND t.status NOT IN ('open','blocked')");
   if(inconsistent.length)throw refusal('STORE_UPGRADE_INVALID','An open historical gate belongs to a terminal task. Resolve this ambiguity before upgrading.');
   await db.exec("UPDATE tasks SET status='blocked' WHERE task_id IN (SELECT task_id FROM decision_gates WHERE status='open')");
   }
   if(legacy.SCHEMA_VERSION<7){
   await db.exec("ALTER TABLE threads ADD COLUMN thread_kind TEXT NOT NULL DEFAULT 'work' CHECK (thread_kind IN ('work','question'))");
   await db.exec('ALTER TABLE threads ADD COLUMN answer_window_minutes BIGINT CHECK (answer_window_minutes IS NULL OR (answer_window_minutes >= 1 AND answer_window_minutes <= 9007199254740991))');
   await db.exec('DROP INDEX one_open_thread_per_task_endpoints; DROP INDEX one_open_thread_per_team_endpoints');
   await db.exec(ddl.match(/CREATE UNIQUE INDEX one_open_thread_per_task_endpoints[\s\S]*?;/)[0]);
   await db.exec(ddl.match(/CREATE UNIQUE INDEX one_open_thread_per_team_endpoints[\s\S]*?;/)[0]);
   await db.exec(ddl.match(/CREATE TABLE member_launches \([\s\S]*?\n\);/)[0]);
   await db.exec(ddl.match(/CREATE TABLE deadline_notices \([\s\S]*?\n\);/)[0]);
   await db.exec(runtimeGuardsFor(db.engine));
   }
   if(legacy.SCHEMA_VERSION<8){await db.exec(MEETING_DDL.replaceAll('{{identity_collation}}',db.engine==='sqlite'?'BINARY':'"C"'));await db.exec(meetingGuardsFor(db.engine));}
   if(legacy.SCHEMA_VERSION>=7&&legacy.SCHEMA_VERSION<9){
    for(const table of ['member_launches','deadline_notices']){
     for(const suffix of db.engine==='sqlite'?['update','delete','replace']:['update','truncate'])await db.exec(`DROP TRIGGER ${table}_guard_${suffix}${db.engine==='postgres'?` ON ${table}`:''}`);
     if(db.engine==='postgres')await db.exec(`DROP FUNCTION ${table}_guard()`);
    }
    if(db.engine==='sqlite'){
     await db.exec('ALTER TABLE member_launches RENAME TO member_launches_schema8');
     await db.exec(ddl.match(/CREATE TABLE member_launches \([\s\S]*?\n\);/)[0]);
     await db.exec('INSERT INTO member_launches SELECT * FROM member_launches_schema8');await db.exec('DROP TABLE member_launches_schema8');
    }else{await db.exec('ALTER TABLE member_launches ALTER COLUMN conversation_id DROP NOT NULL');await db.exec("ALTER TABLE member_launches ADD CHECK(status<>'bound' OR conversation_id IS NOT NULL)");}
    await db.exec(runtimeGuardsFor(db.engine));
   }
   if(legacy.SCHEMA_VERSION<9){await db.exec(LAUNCH_DDL.replaceAll('{{identity_collation}}',db.engine==='sqlite'?'BINARY':'"C"'));await db.exec(launchPlanGuardsFor(db.engine));}
   await db.exec(WORKER_READINESS_DDL.replaceAll('{{identity_collation}}',db.engine==='sqlite'?'BINARY':'"C"'));await db.exec(workerReadinessGuardsFor(db.engine));
   const finished=await db.now();
   if(finished<now||finished>=expiry)throw refusal('STORE_LEASE_EXPIRED','Upgrade exceeded its database lease; the transaction was rolled back.');
   await db.query('INSERT INTO schema_migrations VALUES (:id,:from_version,:to_version,:machine,:path,:now)',{id:operationId,from_version:legacy.SCHEMA_VERSION,to_version:SCHEMA_VERSION,machine:machineId,path:backupPath,now:finished});
   await db.query('UPDATE store_metadata SET schema_version=:version WHERE singleton=1',{version:SCHEMA_VERSION});
   await db.exec('UPDATE store_lease SET holder_machine_id=NULL,holder_token=NULL,expires_at_ms=0 WHERE singleton=1');
   await inspectSchema(db,SHARED_SCHEMA);
   committing=true;await db.commit();
   return {status:'upgraded',fromVersion:legacy.SCHEMA_VERSION,toVersion:SCHEMA_VERSION,backupPath};
  }catch(error){await db.rollback().catch(()=>{});if(committing)throw refusal('STORE_COMMIT_UNKNOWN','Upgrade commit could not be confirmed. Check access before repeating.',{operationId,backupPath},error);if(error instanceof StoreError)throw error;throw refusal('STORE_UPGRADE_REFUSED','Upgrade constraints refused the data. The original schema was preserved.',{backupPath},error);}
 }finally{await db?.close();}
}
