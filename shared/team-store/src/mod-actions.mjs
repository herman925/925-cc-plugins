// Private native-panel evidence. Never exposed as a model tool or request field.
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {SCHEMA_VERSION} from '../contract.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export async function verifyModAction({action,id,actor,configRoot,request,now=Date.now()}){
 try{
  if(!/^[a-f0-9]{32}$/.test(id??''))return false;
  const path=join(configRoot,'team-orchestrator','controller-actions',`${id}.json`),info=await lstat(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>(action==='editTeam'?65536:8192))return false;
  const ticket=JSON.parse(await readFile(path,'utf8'));
  if(ticket.action!==action||ticket.id!==id||ticket.conversationId!==actor.conversationId||ticket.terminalHandle!==actor.terminalHandle||ticket.contextId!==actor.contextId||ticket.projectRoot.replaceAll('\\','/')!==actor.projectRoot.replaceAll('\\','/')||!Number.isSafeInteger(ticket.createdAt)||ticket.createdAt>now||now-ticket.createdAt>=60000)return false;
  if(action==='upgradeStore')return [5,6,7,8,9].includes(ticket.fromVersion)&&ticket.fromVersion<SCHEMA_VERSION&&ticket.toVersion===SCHEMA_VERSION;
  if(action==='editTeam')return request?.command?.type==='editTeam'&&JSON.stringify(canonical(ticket.request))===JSON.stringify(canonical(request));
  return action==='approveController';
 }catch{return false;}
}
