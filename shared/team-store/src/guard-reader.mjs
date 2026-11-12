// Trusted Mod guard dependency. This reader has no mutation/upgrade/approval
// path: native caller proof is supplied privately by the bridge, never a tool.
import {realpath} from 'node:fs/promises';
import {connectSqlite,connectPostgres} from './engines.mjs';
import {existingLocalPath,inspectSchema} from './bootstrap.mjs';
import * as schema5 from './schema5-contract.mjs';
import * as schema6 from './schema6-contract.mjs';
import * as schema7 from './schema7-contract.mjs';
import * as schema8 from './schema8-contract.mjs';
import * as schema9 from './schema9-contract.mjs';
import * as schema10 from './schema10-contract.mjs';
import * as current from '../contract.mjs';
import {normalizeActor,readGuardAuthority,apiResult,pendingNativeLaunch} from './api-domain.mjs';
import {databaseInteger} from './validation.mjs';
import {refusal} from './errors.mjs';

async function inspectGuardState({actor:input,postgres,allowLaunchProbe=false},schemaOnly=false){
 const actor=normalizeActor({...input,projectRoot:await realpath(input.projectRoot)});
 const db=postgres?await connectPostgres(postgres):await connectSqlite({path:await existingLocalPath(actor.projectRoot),readOnly:true});
 try{
  await db.exec(db.engine==='sqlite'?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const objects=await db.objects();
  if(!objects.length)throw refusal('STORE_EMPTY','The team store has no schema or membership. No schema or authority was installed.');
  const rows=await db.query('SELECT format,schema_version FROM store_metadata WHERE singleton=1');
  const version=rows.length===1?databaseInteger(rows[0].schema_version,'schema version'):null;
  const definition=[schema5,schema6,schema7,schema8,schema9,schema10,current].find(s=>s.SCHEMA_VERSION===version);
  if(!definition)throw refusal('STORE_VERSION_UNSUPPORTED','The guard cannot verify permissions in this store version. No migration or permission fallback was performed.',{version,supported:[5,6,7,8,9,10,current.SCHEMA_VERSION]});
  await inspectSchema(db,{format:definition.FORMAT,version,ddl:definition.DDL,render:definition.ddlFor,label:'team guard store'});
  const [identity]=await db.query('SELECT minimum_writer_protocol FROM project_identity WHERE singleton=1');
  if(!identity||databaseInteger(identity.minimum_writer_protocol,'minimum protocol')>current.WRITER_PROTOCOL_VERSION)throw refusal('STORE_PROTOCOL_UNSUPPORTED','This guard cannot interpret the project authority protocol.');
  const launch=!schemaOnly&&version>=9&&allowLaunchProbe?await pendingNativeLaunch(db,actor):null;
  const authority=schemaOnly?{}:launch?{pendingLaunchId:launch}:await readGuardAuthority(db,actor,version);
  await db.commit();
  return apiResult({...authority,storeVersion:version,upgradeRequired:version!==current.SCHEMA_VERSION});
 }finally{await db.rollback().catch(()=>{});await db.close();}
}

export const inspectGuardCaller=options=>inspectGuardState(options);
// Native-reviewed upgrades need verified schema/protocol metadata, not a live
// member binding: resuming changes incarnation before the older store can be
// rebound by the current API. This projection contains no member authority.
export const inspectGuardSchema=options=>inspectGuardState(options,true);
