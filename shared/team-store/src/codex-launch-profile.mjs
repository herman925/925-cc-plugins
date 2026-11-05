// Private bootstrap configuration, never an approval token. The database and
// native terminal proof must still authorize the exact reserved attachment.
import {mkdir,realpath,lstat,open,readFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {text,integer} from './validation.mjs';
import {refusal} from './errors.mjs';
const invalid=()=>refusal('API_LAUNCH_PROFILE_INVALID','The reserved worker startup profile could not be verified. No unbound work or alternate store is allowed.');
const fields=['projectRoot','machineId','contextId','projectId','launchId','memberId'];
function scope(value){
 const result=Object.fromEntries(fields.map(k=>[k,text(value[k],`reserved ${k}`)]));
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(result.projectId))throw invalid();return result;
}
export async function writeReservedLaunchProfile({root,actor,projectId,launchId,memberId,postgres}){
 if(!root||!isAbsolute(root))throw invalid();
 const fixed=scope({...actor,projectId,launchId,memberId});
 const data={format:'925-codex-reserved-launch',version:1,...fixed,engine:postgres?'postgres':'sqlite'};
 if(postgres){
  if(postgres.loadDriver&&!postgres.driverModule)throw invalid();
  const locator=postgres.driverModule??import.meta.resolve('pg');
  if(new URL(locator).protocol!=='file:')throw invalid();
  const driverModule=pathToFileURL(await realpath(fileURLToPath(locator))).href;
  data.postgres={connectionString:text(postgres.connectionString,'reserved PostgreSQL connection'),connectionTimeoutMs:integer(postgres.connectionTimeoutMs??5000,'connection timeout',{min:1,max:60000}),driverModule};
 }
 await mkdir(root,{recursive:true,mode:0o700});const canonical=await realpath(root),relation=relative(actor.projectRoot,canonical);
 if(canonical.toLowerCase()!==resolve(root).toLowerCase()||(await lstat(root)).isSymbolicLink()||relation===''||relation!=='..'&&!relation.startsWith('..'+sep)&&!isAbsolute(relation))throw invalid();
 const name=createHash('sha256').update(JSON.stringify([projectId,launchId,memberId,actor.machineId])).digest('hex')+'.json',path=join(canonical,name),body=JSON.stringify(data);
 const file=await open(path,'wx',0o600).catch(error=>{if(error.code!=='EEXIST')throw error;});
 if(file){try{await file.writeFile(body);await file.sync();}finally{await file.close();}}
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||await readFile(path,'utf8')!==body)throw invalid();return path;
}
export async function readReservedLaunchProfile(path,projectRoot){
 try{
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw invalid();
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>65536||await realpath(dirname(path))!==dirname(path))throw invalid();
  const data=JSON.parse(await readFile(path,'utf8'));
  if(data.format!=='925-codex-reserved-launch'||data.version!==1||Object.keys(data).some(k=>!['format','version',...fields,'engine','postgres'].includes(k)))throw invalid();
  const fixed=scope(data);fixed.projectRoot=await realpath(fixed.projectRoot);if(fixed.projectRoot!==await realpath(projectRoot))throw invalid();
  if(data.engine==='sqlite'){if(data.postgres!==undefined)throw invalid();return {reservedLaunch:fixed};}
  if(data.engine!=='postgres'||!data.postgres||Object.keys(data.postgres).some(k=>!['connectionString','connectionTimeoutMs','driverModule'].includes(k)))throw invalid();
  const connectionString=text(data.postgres.connectionString,'reserved PostgreSQL connection'),driverModule=text(data.postgres.driverModule,'reserved driver');
  if(new URL(driverModule).protocol!=='file:')throw invalid();
  const connectionTimeoutMs=integer(data.postgres.connectionTimeoutMs,'connection timeout',{min:1,max:60000});
  return {reservedLaunch:fixed,postgres:{connectionString,connectionTimeoutMs,driverModule,loadDriver:()=>import(driverModule)}};
 }catch{throw invalid();}
}
