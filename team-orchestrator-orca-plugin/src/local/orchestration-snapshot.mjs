import {realpath} from 'node:fs/promises';
import {join,relative,isAbsolute,sep} from 'node:path';

// One read-only schema-43 transaction owns every evidence query in a reader.
// Readers supply their existing public refusal wording and validate their own facts.
export async function withOrchestrationSnapshot(userData,{pathError,schemaError},read){
 let db;
 try{
  const root=await realpath(userData),file=await realpath(join(root,'orchestration.db')),rel=relative(root,file);
  if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error(pathError);
  const {DatabaseSync}=await import('node:sqlite');
  db=new DatabaseSync(file,{readOnly:true});db.exec('BEGIN');
  if(db.prepare('PRAGMA user_version').get().user_version!==43)throw Error(schemaError);
  return await read(db);
 }finally{if(db){try{db.exec('ROLLBACK');}catch{}db.close();}}
}
