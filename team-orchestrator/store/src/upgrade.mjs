// Explicit schema upgrade only. Opening the normal store never invokes this.
import {randomUUID,createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {join,isAbsolute} from 'node:path';
import {realpath,lstat,mkdir,open} from 'node:fs/promises';
import {openBackend,inspectSchema,SHARED_SCHEMA} from './bootstrap.mjs';
import * as legacy from './schema5-contract.mjs';
import {ddlFor,historyGuardsFor} from '../contract.mjs';
import {normalizeWriter,checkWriter} from './writers.mjs';
import {authorize} from './authority.mjs';
import {text,integer,databaseInteger,nextInteger} from './validation.mjs';
import {refusal,StoreError} from './errors.mjs';

const definition={format:legacy.FORMAT,version:5,ddl:legacy.DDL,render:legacy.ddlFor,label:'team store'};
const tableNames=[...legacy.DDL.matchAll(/CREATE TABLE ([a-z_]+)\s*\(/g)].map(m=>m[1]);
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
async function tables(db) {
 const result={};
 for(const name of tableNames)result[name]=(await db.query(`SELECT * FROM ${name}`)).map(ordered).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
 return result;
}
async function lock(db) {
 await inspectSchema(db,definition);const [lease]=await db.lockLeaseControl();
 const now=await db.now();
 if(lease.holder_token!==null&&databaseInteger(lease.expires_at_ms,'lease expiry')>now)throw refusal('STORE_LEASE_HELD','A live writer holds the store; upgrade was refused.',{holderMachineId:lease.holder_machine_id,expiresAtMs:Number(lease.expires_at_ms)});
 return {lease,now};
}

export async function upgradeTeamStore(options,dependencies={}) {
 const projectRoot=await realpath(text(options.projectRoot,'projectRoot')),operationId=text(options.operationId,'operationId');
 const machineId=text(options.machineId,'machineId'),writer=normalizeWriter(options.writer,false);
 const scope={projectRoot,engine:options.postgres?'postgres':'sqlite',fromVersion:5,toVersion:6};
 authorize(options.authorize,options.caller,'upgradeStore',scope,{operationId},writer);
 let db;
 const backend=dependencies.openBackend??openBackend;
 try {
  try{({db}=await backend({...options,projectRoot,create:false},definition));}
  catch(error) {
   if(error.code!=='STORE_VERSION_UNSUPPORTED'||error.details.version!==6)throw error;
   ({db}=await backend({...options,projectRoot,create:false}));
   const [prior]=await db.query('SELECT * FROM schema_migrations WHERE operation_id=:id',{id:operationId});
   return prior?{status:'upgraded',fromVersion:5,toVersion:6,backupPath:prior.backup_path}:{status:'already_current',toVersion:6};
  }
  // Snapshot under the shared lock, write its backup outside any transaction,
  // then compare again under lock. Changed state refuses rather than migrating
  // data that the backup does not contain. No host I/O runs under the write lock.
  await db.begin();let before;
  try{await lock(db);before=await tables(db);await db.commit();}catch(error){await db.rollback().catch(()=>{});throw error;}
  for(const assignment of before.assignments)if(assignment.pickup_expired_at_ms!==null&&assignment.returned_to_member_id!==assignment.assigned_by_member_id)
   throw refusal('STORE_UPGRADE_DATA_UNMAPPED','An expired assignment has no unambiguous return to its admitting head. No value was invented.',{assignmentId:assignment.assignment_id});
  for(const decision of before.task_acceptances)if(decision.decision==='rejected'&&decision.accepted_by_member_id!==before.assignments.find(a=>a.assignment_id===decision.assignment_id)?.assigned_by_member_id)
   throw refusal('STORE_UPGRADE_DATA_UNMAPPED','A rejected assignment has no unambiguous admitting head. No value was invented.',{assignmentId:decision.assignment_id});
  const projectId=before.project_identity[0].project_id;
  const directory=await backupDirectory(options.backupRoot??join(homedir(),'.claude'),projectId);
  const backupPath=join(directory,`schema-5-${randomUUID()}.json`),file=await open(backupPath,'wx',0o600);
  try{await file.writeFile(JSON.stringify({format:'team-orchestrator-upgrade-backup',schemaVersion:5,engine:db.engine,projectId,schemaSql:legacy.ddlFor(db.engine),tables:before}));await file.sync();}finally{await file.close();}
  await dependencies.afterBackup?.({backupPath}); // Fault-injection seam, outside a database transaction.
  await db.begin();let committing=false;
  try {
   const {lease,now}=await lock(db);
   if(digest(await tables(db))!==digest(before))throw refusal('STORE_UPGRADE_CHANGED','The store changed while its backup was written. Upgrade was refused; retry after other activity settles.',{backupPath});
   const token=randomUUID(),generation=nextInteger(databaseInteger(lease.generation,'lease generation'),'lease generation'),expiry=integer(now+120000,'upgrade lease expiry');
   await db.query('UPDATE store_lease SET holder_machine_id=:machine,holder_token=:token,generation=:generation,expires_at_ms=:expiry WHERE singleton=1',{machine:machineId,token,generation,expiry});
   await checkWriter(db,writer,{advance:true});
   const ddl=ddlFor(db.engine);
   await db.exec('ALTER TABLE task_acceptances RENAME TO task_acceptances_schema5');
   await db.exec('CREATE UNIQUE INDEX assignment_admitting_head ON assignments (assignment_id,assigned_by_member_id)');
   for(const name of ['task_acceptances','assignment_returns','schema_migrations']) {
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
   const finished=await db.now();
   if(finished<now||finished>=expiry)throw refusal('STORE_LEASE_EXPIRED','Upgrade exceeded its database lease; the transaction was rolled back.');
   await db.query('INSERT INTO schema_migrations VALUES (:id,5,6,:machine,:path,:now)',{id:operationId,machine:machineId,path:backupPath,now:finished});
   await db.exec('UPDATE store_metadata SET schema_version=6 WHERE singleton=1');
   await db.exec('UPDATE store_lease SET holder_machine_id=NULL,holder_token=NULL,expires_at_ms=0 WHERE singleton=1');
   await inspectSchema(db,SHARED_SCHEMA);
   committing=true;await db.commit();
   return {status:'upgraded',fromVersion:5,toVersion:6,backupPath};
  }catch(error){await db.rollback().catch(()=>{});if(committing)throw refusal('STORE_COMMIT_UNKNOWN','Upgrade commit could not be confirmed. Check access before repeating.',{operationId,backupPath},error);if(error instanceof StoreError)throw error;throw refusal('STORE_UPGRADE_REFUSED','Upgrade constraints refused the data. The original schema was preserved.',{backupPath},error);}
 }finally{await db?.close();}
}
