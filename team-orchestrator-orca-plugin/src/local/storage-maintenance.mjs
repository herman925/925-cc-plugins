import {mkdir,realpath,open,rename,readFile,readdir,stat} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {questionStore} from './questions-store.mjs';
import {validatePersistentState} from '../team.mjs';
import {validateWork} from '../work.mjs';
import {validateDispatch,validateDispatchProtocol} from '../dispatch.mjs';
export const STORAGE_SCHEMA=2;
export const MAINTENANCE_DDL='CREATE TABLE maintenance (id TEXT PRIMARY KEY, json TEXT NOT NULL)';
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=id=>'"'+id.replaceAll('"','""')+'"';
// Includes unknown tables, columns, receipt families and every version, not just roster revision.
export function storageDigest(db){const tables=db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();return hash(JSON.stringify(tables.map(t=>[t,t.type==='table'?db.prepare(`SELECT * FROM ${quote(t.name)}`).all().map(r=>JSON.stringify(r)).sort():null])));}
export function validateDatabase(db){
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Damaged SQLite integrity');
 const schema=db.prepare('PRAGMA user_version').get().user_version;
 if(![1,STORAGE_SCHEMA].includes(schema))throw Error(`Unsupported team database schema ${schema}; supported schemas 1–${STORAGE_SCHEMA}. Use a compatible plugin; never downgrade or initialise this file.`);
 if(db.prepare('SELECT format FROM metadata').get()?.format!=='orca-team-store')throw Error('Unrecognized team database format');
 const snapshot=JSON.parse(db.prepare('SELECT json FROM snapshot WHERE id=1').get()?.json??'null');validatePersistentState(snapshot);
 for(const table of ['scopes','team_versions','role_versions','receipts'])for(const row of db.prepare(`SELECT * FROM ${table}`).all()){
  const v=JSON.parse(row.json);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Damaged stored JSON object');
  if(table==='team_versions'){validatePersistentState({...snapshot,teams:[v]});if(v.id!==row.team_id||v.configVersion!==row.version)throw Error('Archived configuration identity mismatch');}
  if(table==='receipts'){
   if(row.id.startsWith('work:')||row.id.startsWith('native-run-binding:')){validateWork(v);if(!db.prepare('SELECT 1 FROM team_versions WHERE team_id=? AND version=?').get(v.teamId,v.configVersion))throw Error('Missing archived Work configuration');}
   if(row.id.startsWith('dispatch:')){validateDispatch(v);if(!db.prepare('SELECT 1 FROM receipts WHERE id IN (?,?)').get(`work:${v.workId}`,`native-run-binding:${v.workId}`)||!db.prepare('SELECT 1 FROM team_versions WHERE team_id=? AND version=?').get(v.teamId,v.configVersion)||!db.prepare('SELECT 1 FROM role_versions WHERE member_id=? AND version=?').get(v.memberId,v.roleVersion))throw Error('Missing Dispatch identity or archived configuration');}
   if(row.id.startsWith('wake:')&&(!v.oldBinding||typeof v.oldBinding.requestId!=='string'))throw Error('Damaged recovery binding');
   if(row.id.startsWith('stop:')&&(!v.target||typeof v.target.teamId!=='string'||typeof v.target.memberId!=='string'))throw Error('Damaged stop target');
   if(row.id.startsWith('dispatch-protocol:'))validateDispatchProtocol(v);
  }
 }
 for(const team of snapshot.teams){const scope=JSON.parse(db.prepare('SELECT json FROM scopes WHERE team_id=?').get(team.id)?.json??'null');if(!scope||scope.workspaceKey!==team.scope.workspaceKey||scope.executionHostId!==team.scope.executionHostId||typeof scope.workspaceId!=='string')throw Error('Missing saved project identity');if(!db.prepare('SELECT 1 FROM team_versions WHERE team_id=? AND version=?').get(team.id,team.configVersion))throw Error('Missing current archived configuration');for(const member of team.members)if(!db.prepare('SELECT 1 FROM role_versions WHERE member_id=? AND version=?').get(member.id,member.roleVersion))throw Error('Missing current archived role');}
 questionStore({db}).listQuestions('preflight');
 for(const row of db.prepare('SELECT result FROM requests').all()){const v=JSON.parse(row.result);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('Damaged saved request result');if(v.format==='orca-team-store')validatePersistentState(v);}
 if(schema===STORAGE_SCHEMA)for(const row of db.prepare('SELECT json FROM maintenance').all())JSON.parse(row.json);
 return {schema,revision:snapshot.revision,digest:storageDigest(db)};
}
async function syncFile(path){const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function privateDirectory(path,parent){try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const real=await realpath(path),rel=relative(parent,real);if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error('Backup directory escapes plugin storage');if((await stat(real)).mode&0o077)throw Error('Backup directory must be private (owner access only)');return real;}
export async function prepareStorage({path,directory,DatabaseSync,backup}){
 let source;
 try{
  source=new DatabaseSync(path,{readOnly:true});const original=validateDatabase(source);
  if(original.schema===STORAGE_SCHEMA)return {expected:original};
  if(typeof backup!=='function')throw Error('This worker lacks module-level node:sqlite backup; upgrade is blocked');
  const backups=await privateDirectory(join(directory,'backups'),directory),id=randomUUID(),partial=join(backups,`${id}.partial`),final=join(backups,id);
  await mkdir(partial,{mode:0o700});const destination=join(partial,'database.sqlite');const file=await open(destination,'wx',0o600);await file.close();
  await backup(source,destination);
  const check=new DatabaseSync(destination,{readOnly:true});let verified;try{verified=validateDatabase(check);}finally{check.close();}
  if(verified.digest!==original.digest||storageDigest(source)!==original.digest)throw Error('Storage changed during backup; reopen to create a fresh backup before migration');
  await syncFile(destination);
  const manifest={id,createdAt:new Date().toISOString(),sourceSchema:original.schema,format:'orca-team-store',sourceRevision:original.revision,pluginBuild:typeof __PLUGIN_DISPLAY_VERSION__==='string'?__PLUGIN_DISPLAY_VERSION__:'unbundled-development',sha256:hash(await readFile(destination)),verified:true};
  const mf=await open(join(partial,'manifest.json'),'wx',0o600);try{await mf.writeFile(JSON.stringify(manifest,null,2));await mf.sync();}finally{await mf.close();}
  await syncFile(partial);await rename(partial,final);await syncFile(backups);
  return {expected:original,backupId:id};
 }finally{source?.close();}
}
export function migrateStorage(db,prepared){
 if(prepared.expected.schema===STORAGE_SCHEMA){if(validateDatabase(db).schema!==STORAGE_SCHEMA)throw Error('Storage schema changed after preflight; reopen with a compatible plugin.');return;}
 db.exec('BEGIN IMMEDIATE');try{
  const current=validateDatabase(db);if(current.schema!==prepared.expected.schema||current.digest!==prepared.expected.digest)throw Error('Storage changed after backup; migration refused. Reopen for a fresh verified backup.');
  db.exec(MAINTENANCE_DDL);
  db.prepare('INSERT INTO maintenance VALUES(?,?)').run('migration:2',JSON.stringify({from:1,to:2,backupId:prepared.backupId,recordedAt:new Date().toISOString()}));
  db.exec(`PRAGMA user_version=${STORAGE_SCHEMA}`);validateDatabase(db);db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
export async function recoveryInventory(directory,DatabaseSync){
 const rows=[];let names;const root=join(directory,'backups');
 try{const resolved=await realpath(root),rel=relative(directory,resolved);if(rel.startsWith('..')||isAbsolute(rel))return rows;names=await readdir(root);}catch{return rows;}
 for(const id of names.filter(n=>/^[a-f0-9-]{36}(\.partial)?$/.test(n))){
  if(id.endsWith('.partial')){rows.push({id,status:'incomplete-not-recoverable'});continue;}
  let check;try{
   const base=await realpath(join(root,id)),rel=relative(root,base);if(rel.startsWith('..')||isAbsolute(rel))continue;
   for(const file of ['manifest.json','database.sqlite']){const path=await realpath(join(base,file));if(relative(base,path).startsWith('..'))throw Error('Escaping backup file');}
   const m=JSON.parse(await readFile(join(base,'manifest.json'),'utf8'));
   if(!m.verified||m.id!==id||hash(await readFile(join(base,'database.sqlite')))!==m.sha256)throw Error('Backup hash mismatch');
   if(DatabaseSync){check=new DatabaseSync(join(base,'database.sqlite'),{readOnly:true});const v=validateDatabase(check);if(v.schema!==m.sourceSchema||v.revision!==m.sourceRevision)throw Error('Backup manifest mismatch');}
   rows.push({id,createdAt:m.createdAt,sourceSchema:m.sourceSchema,status:'verified-backup'});
  }catch{rows.push({id,status:'invalid-not-recoverable'});}finally{check?.close();}
 }
 return rows;
}
// Read-only diagnostics are available even when executor creation is refused.
export async function inspectTeamStorage({userData,sqlite=()=>import('node:sqlite')}={}){
 const guidance='Preserve the current database and its WAL/SHM/journal sidecars. Stop the plugin before taking a recovery copy. Use a compatible plugin for a newer schema. Restore only a verified backup with all writers stopped, then manually reconcile native effects after its cutoff before admitting work. Never reset storage or automatically relaunch missing operations.';
 try{
  if(typeof userData!=='string'||!isAbsolute(userData))throw Error('Verified profile unavailable');
  const profile=await realpath(userData),directory=await realpath(join(profile,'plugins-data/herman925.team-orchestrator')),rel=relative(profile,directory);
  if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error('Plugin directory escapes verified profile');
  const path=await realpath(join(directory,'team-orchestrator.sqlite')),fileRel=relative(directory,path);if(fileRel.startsWith('..')||isAbsolute(fileRel))throw Error('Database path escapes plugin directory');
  const {DatabaseSync}=await sqlite();let db,foundSchema=null,status='unavailable';
  try{db=new DatabaseSync(path,{readOnly:true});foundSchema=db.prepare('PRAGMA user_version').get().user_version;validateDatabase(db);status='available';}catch{status=foundSchema!==null&&![1,STORAGE_SCHEMA].includes(foundSchema)?'unsupported-schema':'damaged-or-unrecognized';}finally{db?.close();}
  return {status,foundSchema,supportedSchema:STORAGE_SCHEMA,location:directory,backups:await recoveryInventory(directory,DatabaseSync),guidance};
 }catch{return {status:'unavailable',foundSchema:null,supportedSchema:STORAGE_SCHEMA,backups:[],guidance};}
}
