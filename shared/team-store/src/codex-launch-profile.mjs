// Private bootstrap configuration, never an approval token. The database and
// native terminal proof must still authorize the exact reserved attachment.
import {mkdir,realpath,lstat,open,readFile} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {text,integer} from './validation.mjs';
import {refusal} from './errors.mjs';
import {requireWorkerToolPolicy} from './worker-policy.mjs';
import {requireHeadPolicy} from './managed-head.mjs';
import {postgresReference,resolvePostgresReference} from './postgres-reference.mjs';
const invalid=()=>refusal('API_LAUNCH_PROFILE_INVALID','The reserved worker startup profile could not be verified. No unbound work or alternate store is allowed.');
const fields=['projectRoot','machineId','contextId','projectId','launchId','memberId'];
function scope(value){
 const result=Object.fromEntries(fields.map(k=>[k,text(value[k],`reserved ${k}`)]));
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(result.projectId))throw invalid();return result;
}
export async function writeReservedLaunchProfile({root,actor,projectId,launchId,memberId,postgres,workerAccess}){
 if(!root||!isAbsolute(root))throw invalid();
 const fixed=scope({...actor,projectId,launchId,memberId});
 const data={format:'925-codex-reserved-launch',version:1,...fixed,engine:postgres?'postgres':'sqlite'};
 if(workerAccess){data.version=2;data.workerAccess={planId:text(workerAccess.planId,'reviewed worker plan'),policyId:requireWorkerToolPolicy(workerAccess.policyId),...(workerAccess.headPolicyId!==undefined?{headPolicyId:requireHeadPolicy(workerAccess.headPolicyId)}:{})};}
 if(postgres){
  // New hosted profiles contain only an external environment reference. Old
  // private profiles remain readable below but are never copied into new ones.
  const reference=postgresReference({connectionEnvironment:postgres.connectionEnvironment,connectionTimeoutMs:postgres.connectionTimeoutMs});
  resolvePostgresReference(reference);
  data.version=3;
  if(postgres.loadDriver&&!postgres.driverModule)throw invalid();
  const locator=postgres.driverModule??import.meta.resolve('pg');
  if(new URL(locator).protocol!=='file:')throw invalid();
  const driverModule=pathToFileURL(await realpath(fileURLToPath(locator))).href;
  data.postgres={...reference,driverModule};
 }
 await mkdir(root,{recursive:true,mode:0o700});const canonical=await realpath(root),relation=relative(actor.projectRoot,canonical);
 if(canonical.toLowerCase()!==resolve(root).toLowerCase()||(await lstat(root)).isSymbolicLink()||relation===''||relation!=='..'&&!relation.startsWith('..'+sep)&&!isAbsolute(relation))throw invalid();
 if(data.workerAccess?.headPolicyId)data.version=4;
 const name=createHash('sha256').update(JSON.stringify([projectId,launchId,memberId,actor.machineId,...(workerAccess?[data.workerAccess.planId,data.workerAccess.policyId,...(data.workerAccess.headPolicyId?[data.workerAccess.headPolicyId]:[])]:[])])).digest('hex')+'.json',path=join(canonical,name),body=JSON.stringify(data);
 const file=await open(path,'wx',0o600).catch(error=>{if(error.code!=='EEXIST')throw error;});
 if(file){try{await file.writeFile(body);await file.sync();}finally{await file.close();}}
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||await readFile(path,'utf8')!==body)throw invalid();return path;
}
export async function readReservedLaunchProfile(path,projectRoot){
 try{
  if(typeof path!=='string'||!isAbsolute(path)||path.includes('\0'))throw invalid();
  const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>65536||await realpath(dirname(path))!==dirname(path))throw invalid();
  const data=JSON.parse(await readFile(path,'utf8'));
  if(data.format!=='925-codex-reserved-launch'||![1,2,3,4].includes(data.version)||Object.keys(data).some(k=>!['format','version',...fields,'engine','postgres','workerAccess'].includes(k)))throw invalid();
  if(data.version===1&&data.workerAccess!==undefined)throw invalid();
  let access={};
  if(data.version===2||data.version>=3&&data.workerAccess!==undefined){if(!data.workerAccess||Object.keys(data.workerAccess).some(k=>!['planId','policyId',...(data.version===4?['headPolicyId']:[])].includes(k)))throw invalid();access={workerAccess:{planId:text(data.workerAccess.planId,'reviewed worker plan'),policyId:requireWorkerToolPolicy(data.workerAccess.policyId),...(data.version===4?{headPolicyId:requireHeadPolicy(data.workerAccess.headPolicyId)}:{})}};}
  if(data.version===4&&!access.workerAccess?.headPolicyId)throw invalid();
  const fixed=scope(data);fixed.projectRoot=await realpath(fixed.projectRoot);if(fixed.projectRoot!==await realpath(projectRoot))throw invalid();
  if(data.engine==='sqlite'){if(data.postgres!==undefined||data.version===3)throw invalid();return {reservedLaunch:fixed,...access};}
  if(data.version===3||data.version===4){
   if(data.engine!=='postgres'||!data.postgres||Object.keys(data.postgres).some(k=>!['connectionEnvironment','connectionTimeoutMs','driverModule'].includes(k)))throw invalid();
   const {driverModule,...input}=data.postgres,reference=postgresReference(input);if(new URL(driverModule).protocol!=='file:')throw invalid();resolvePostgresReference(reference);
   return {reservedLaunch:fixed,...access,postgres:{...reference,driverModule,loadDriver:()=>import(driverModule)}};
  }
  if(data.engine!=='postgres'||!data.postgres||Object.keys(data.postgres).some(k=>!['connectionString','connectionTimeoutMs','driverModule'].includes(k)))throw invalid();
  const connectionString=text(data.postgres.connectionString,'reserved PostgreSQL connection'),driverModule=text(data.postgres.driverModule,'reserved driver');
  if(new URL(driverModule).protocol!=='file:')throw invalid();
  const connectionTimeoutMs=integer(data.postgres.connectionTimeoutMs,'connection timeout',{min:1,max:60000});
  return {reservedLaunch:fixed,...access,postgres:{connectionString,connectionTimeoutMs,driverModule,loadDriver:()=>import(driverModule)}};
 }catch(error){if(['STORE_CONNECTION_ENV_MISSING','STORE_TLS_REQUIRED'].includes(error.code))throw error;throw invalid();}
}
