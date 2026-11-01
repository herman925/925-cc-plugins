// Trusted Mod guard dependency. This reader has no mutation/upgrade/approval
// path: native caller proof is supplied privately by the bridge, never a tool.
import {realpath} from 'node:fs/promises';
import {connectSqlite,connectPostgres} from './engines.mjs';
import {existingLocalPath,inspectSchema} from './bootstrap.mjs';
import * as schema5 from './schema5-contract.mjs';
import * as schema6 from './schema6-contract.mjs';
import * as current from '../contract.mjs';
import {normalizeActor,readGuardAuthority,apiResult} from './api-domain.mjs';
import {databaseInteger} from './validation.mjs';
import {refusal} from './errors.mjs';

export async function inspectGuardCaller({actor:input,postgres}){
 const actor=normalizeActor({...input,projectRoot:await realpath(input.projectRoot)});
 const db=postgres?await connectPostgres(postgres):await connectSqlite({path:await existingLocalPath(actor.projectRoot),readOnly:true});
 try{
  await db.exec(db.engine==='sqlite'?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const rows=await db.query('SELECT format,schema_version FROM store_metadata WHERE singleton=1');
  const version=rows.length===1?databaseInteger(rows[0].schema_version,'schema version'):null;
  const definition=[schema5,schema6,current].find(s=>s.SCHEMA_VERSION===version);
  if(!definition)throw refusal('STORE_VERSION_UNSUPPORTED','The guard cannot verify permissions in this store version. No migration or permission fallback was performed.',{version,supported:[5,6,current.SCHEMA_VERSION]});
  await inspectSchema(db,{format:definition.FORMAT,version,ddl:definition.DDL,render:definition.ddlFor,label:'team guard store'});
  const [identity]=await db.query('SELECT minimum_writer_protocol FROM project_identity WHERE singleton=1');
  if(!identity||databaseInteger(identity.minimum_writer_protocol,'minimum protocol')>current.WRITER_PROTOCOL_VERSION)throw refusal('STORE_PROTOCOL_UNSUPPORTED','This guard cannot interpret the project authority protocol.');
  const authority=await readGuardAuthority(db,actor,version);
  await db.commit();
  return apiResult({...authority,storeVersion:version,upgradeRequired:version!==current.SCHEMA_VERSION});
 }finally{await db.rollback().catch(()=>{});await db.close();}
}
