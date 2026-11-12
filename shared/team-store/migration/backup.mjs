// Native-only source backup primitive. A backup is integrity evidence, not
// permission to import, bind a session, grant access or replay unfinished work.
import {createHash} from 'node:crypto';
import {lstat,realpath,mkdir,open,readFile} from 'node:fs/promises';
import {join,resolve,dirname,relative,isAbsolute,sep} from 'node:path';
import {classicArchive} from './preview.mjs';
const fail=message=>{throw Object.assign(Error(message),{code:'MIGRATION_BACKUP_UNVERIFIED'});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const inside=(parent,child)=>{const path=relative(parent,child);return path===''||path!=='..'&&!path.startsWith('..'+sep)&&!isAbsolute(path);};
async function canonicalRoot(path){
 let ancestor=path;
 while(true){try{const info=await lstat(ancestor);if(!info.isDirectory()||info.isSymbolicLink()||await realpath(ancestor)!==ancestor)fail('Migration backup storage is redirected or is not a directory.');return;}catch(error){if(error.code!=='ENOENT')throw error;const parent=dirname(ancestor);if(parent===ancestor)fail('Migration backup storage has no verifiable parent.');ancestor=parent;}}
}
export async function backupClassicSource({snapshot,projectRoot,privateRoot}){
 if(typeof projectRoot!=='string'||!isAbsolute(projectRoot)||typeof privateRoot!=='string'||!isAbsolute(privateRoot))fail('Native migration backup requires explicit project and private storage roots.');
 const root=await realpath(projectRoot),target=resolve(privateRoot);
 if(snapshot?.projectRoot!==root||inside(root,target)||inside(target,root))fail('Migration backup storage must be separate from the verified source project.');
 const archive=classicArchive(snapshot),body=Buffer.from(JSON.stringify({format:'925-classic-backup',version:1,projectRoot:root,archive})+'\n'),sha256=digest(body),id=digest(JSON.stringify([root,archive.fingerprint]));
 await canonicalRoot(target);await mkdir(target,{recursive:true,mode:0o700});if(await realpath(target)!==target)fail('Migration backup storage changed.');
 const path=join(target,id+'.json');
 const handle=await open(path,'wx',0o600).catch(error=>{if(error.code!=='EEXIST')throw error;return null;});
 if(handle){try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}}
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size!==body.length||await realpath(path)!==path||!body.equals(await readFile(path)))fail('The migration backup is incomplete, changed or redirected. Preserve it and inspect before any target write.');
 return Object.freeze({backupId:id,path,sha256,sourceFingerprint:archive.fingerprint,fileCount:archive.files.length,verified:true,applyAuthorized:false});
}
