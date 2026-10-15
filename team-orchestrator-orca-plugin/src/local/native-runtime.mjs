import { createConnection } from 'node:net';
import { randomUUID } from 'node:crypto';
import { realpath,readFile } from 'node:fs/promises';
import { join,relative,isAbsolute,sep } from 'node:path';
const METHODS=new Set(['status.get','worktree.show','ssh.getState','terminal.show','terminal.agentStatus','terminal.send','agentSession.history','agentSession.send','orchestration.sessionAddress','orchestration.partyLocation','orchestration.runShow','orchestration.taskList','orchestration.workerList','orchestration.dispatchShow','orchestration.workerShow']);
export function createNativeRpc({userData,parentPid,consent,timeoutMs=15000,maxBytes=2*1024*1024}) {
 return async (method,params,envelope={})=>{
  if(!METHODS.has(method))throw Error('Native method is not allowed for team work.');
  if(Object.keys(envelope).some(key=>!['orchestrationRequestId'].includes(key)))throw Error('Native caller overrides are not allowed.');
  await consent();
  let metadata,transport,profile;
  try{
   if(!isAbsolute(userData||''))throw Error();
   profile=await realpath(userData);const path=await realpath(join(profile,'orca-runtime.json')),rel=relative(profile,path);
   if(rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel))throw Error();
   const content=await readFile(path,'utf8');if(Buffer.byteLength(content)>65536)throw Error();metadata=JSON.parse(content);
   transport=(metadata.transports??[metadata.transport]).find(item=>['unix','named-pipe'].includes(item?.kind));
   if(metadata.pid!==parentPid||typeof metadata.runtimeId!=='string'||!metadata.runtimeId||typeof metadata.authToken!=='string'||!metadata.authToken||!transport||typeof transport.endpoint!=='string'||(transport.kind==='unix'?!isAbsolute(transport.endpoint):!transport.endpoint.startsWith('\\\\.\\pipe\\')))throw Error();
  }catch{throw Error('Verified Orca runtime metadata is unavailable or belongs to another process. Reconnect the plugin.');}
  await consent();
  return new Promise((resolve,reject)=>{
   const id=randomUUID(),socket=createConnection(transport.endpoint);let buffer='',finished=false;
   const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);socket.destroy();error?reject(error):resolve(result);};
   const timer=setTimeout(()=>finish(Error('Native runtime timed out; any submitted objective remains unconfirmed.')),timeoutMs);
   socket.setEncoding('utf8');
   socket.on('connect',async()=>{try{await consent();if(!finished)socket.write(JSON.stringify({id,authToken:metadata.authToken,method,...(params===undefined?{}:{params}),...envelope})+'\n');}catch(error){finish(error);}});
   socket.on('error',()=>finish(Error('Native runtime connection failed; delivery is unconfirmed.')));
   socket.on('close',()=>finish(Error('Native runtime closed before a receipt; delivery is unconfirmed.')));
   const publicError = value => [metadata.authToken,transport.endpoint,profile,userData].reduce((message,secret)=>secret?message.split(secret).join('[private runtime data]'):message,String(value||'Native operation refused')).slice(0,1500);
   socket.on('data',chunk=>{
    buffer+=chunk;if(Buffer.byteLength(buffer)>maxBytes)return finish(Error('Native runtime response exceeded its bounded limit.'));
    for(let index;(index=buffer.indexOf('\n'))>=0;){
     const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
     let response;try{response=JSON.parse(line);}catch{return finish(Error('Native runtime returned malformed evidence.'));}
     if(response?._keepalive===true)continue;
     if(response?.id!==id||response?._meta?.runtimeId!==metadata.runtimeId)return finish(Error('Native response identity or runtime changed; evidence is unverified.'));
     if(response.ok!==true)return finish(Object.assign(Error(publicError(response.error?.message)),{code:response.error?.code,native:true}));
     finish(null,response.result);return;
    }
   });
  });
 };
}
