import {createServer,createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,open,rename,chmod,lstat,realpath,unlink} from 'node:fs/promises';
import {homedir,hostname} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProjectDispatcher} from './project-dispatcher.mjs';

const protocol=1,maxBytes=8192;
const implementation=createHash('sha256').update(await readFile(new URL('./dispatcher-service.mjs',import.meta.url))).update(await readFile(new URL('./project-dispatcher.mjs',import.meta.url))).digest('hex');
const alive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
const read=async path=>{try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
async function atomic(path,value){const temp=`${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,file=await open(temp,'wx',0o600);try{await file.writeFile(JSON.stringify(value));await file.sync();}finally{await file.close();}await rename(temp,path);}
const completedPath=(location,passId)=>{if(!/^[a-f0-9-]{36}$/.test(passId))throw Error('Invalid pass identity.');return join(location.directory,`completed-${passId}.json`);};
export async function dispatcherLocation({projectRoot,machineId=hostname(),root=join(homedir(),'.team-orchestrator','dispatchers')}={}){
 const project=await realpath(projectRoot);
 const key=createHash('sha256').update(JSON.stringify([process.platform==='win32'?project.toLowerCase():project,machineId,homedir()])).digest('hex');
 const directory=join(root,key);await mkdir(directory,{recursive:true,mode:0o700});
 if((await lstat(directory)).isSymbolicLink())throw Error('Dispatcher storage cannot be a link.');
 const endpoint=process.platform==='win32'?`\\\\.\\pipe\\925-team-dispatch-${key}`:join(directory,'dispatcher.sock');
 return {directory,endpoint,key,projectRoot:project,machineId};
}
function lines(socket,receive){
 let buffer='';socket.setEncoding('utf8');
 socket.on('data',chunk=>{buffer+=chunk;if(Buffer.byteLength(buffer)>maxBytes){socket.destroy();return;}
  for(let i;(i=buffer.indexOf('\n'))>=0;){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const value=JSON.parse(line);Promise.resolve(receive(value)).catch(()=>socket.destroy());}catch{socket.destroy();return;}}
 });
}
const send=(socket,row)=>{if(socket.destroyed||!socket.writable)throw Error('Receiver disconnected.');socket.write(JSON.stringify(row)+'\n');};
const sameToken=(a,b)=>typeof a==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function serveProjectDispatcher(location,{intervalMs=30000,idleMs=90000,tickMs=250}={}){
 const statePath=join(location.directory,'active-pass.json'),accessPath=join(location.directory,'access.json');
 const recovered=await read(statePath);
 if(recovered&&(!Number.isSafeInteger(recovered.pid)||typeof recovered.passId!=='string'||typeof recovered.receiverId!=='string'||!Number.isFinite(recovered.startedAt)))throw Error('Dispatcher recovery receipt is invalid; preserve it for inspection.');
 let recorded=recovered;
 const dispatcher=createProjectDispatcher({intervalMs,recovered,persist:async value=>{
  await atomic(statePath,value);const prior=recorded;recorded=value;
  if(!value&&prior)await unlink(completedPath(location,prior.passId)).catch(()=>{}); // Receipt cleanup cannot undo a durable settlement.
 },isAlive:alive,isComplete:async pass=>{
  const receipt=await read(completedPath(location,pass.passId));return receipt?.passId===pass.passId&&receipt.receiverId===pass.receiverId&&receipt.pid===pass.pid;
 }});
 const token=randomBytes(32).toString('hex'),sockets=new Set(),authenticated=new Set();let idleSince=Date.now(),stopped=false,lastStatus='';
 const server=createServer(socket=>{
  if(sockets.size>=128){socket.destroy();return;}
  sockets.add(socket);let id=null,hello=false,queue=Promise.resolve();
  const timeout=setTimeout(()=>{if(!hello)socket.destroy();},5000);timeout.unref();
  lines(socket,row=>{queue=queue.then(async()=>{
   if(!hello){
    if(row?.type!=='hello'||row.protocol!==protocol||!sameToken(row.token,token))throw Error('Dispatcher authentication failed.');
    if(row.implementation!==implementation){hello=true;send(socket,{type:'incompatible'});socket.end();return;}
    if(typeof row.id!=='string'||!Number.isSafeInteger(row.pid))throw Error('Invalid receiver.');
    if(row.mode==='status'){hello=true;send(socket,{type:'status',status:dispatcher.status()});socket.end();return;}
    if(row.mode!=='receiver')throw Error('Unsupported dispatcher connection.');
    await dispatcher.register({id:row.id,pid:row.pid,completedPassId:row.completedPassId,send:value=>send(socket,value)});id=row.id;hello=true;authenticated.add(socket);
    send(socket,{type:'ready',protocol,status:dispatcher.status()});return;
   }
   if(row.type==='request')await dispatcher.request(id);
   else if(row.type==='complete'){await dispatcher.complete(id,row.passId,{teamId:row.teamId,head:row.head,suspended:row.suspended,failed:row.failed});send(socket,{type:'completed',passId:row.passId});}
   else throw Error('Unsupported dispatcher message.');
  });return queue;});
  socket.on('error',()=>{});
  socket.on('close',()=>{clearTimeout(timeout);sockets.delete(socket);authenticated.delete(socket);if(id)void queue.catch(()=>{}).then(()=>dispatcher.disconnect(id));});
 });
 // listen is the cross-process election. Never remove a live owner's socket.
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(location.endpoint,resolve);});}
 catch(error){await dispatcher.close();if(error.code==='EADDRINUSE')return {owner:false};throw error;}
 if(process.platform!=='win32')await chmod(location.endpoint,0o600);
 await atomic(accessPath,{protocol,token,pid:process.pid,endpoint:location.endpoint});
 const interval=setInterval(()=>{void dispatcher.tick().then(status=>{const text=JSON.stringify(status);if(text!==lastStatus){lastStatus=text;for(const socket of authenticated)try{send(socket,{type:'project-status',status});}catch{socket.destroy();}}}).catch(()=>{stopped=true;for(const socket of sockets)socket.destroy();server.close();});
  if(sockets.size)idleSince=Date.now();
  if(!stopped&&!sockets.size&&!dispatcher.status().active&&Date.now()-idleSince>=idleMs)void close();
 },tickMs);
 async function close(){if(stopped)return;stopped=true;clearInterval(interval);for(const socket of sockets)socket.destroy();await dispatcher.close();await new Promise(resolve=>server.close(resolve));}
 return {owner:true,dispatcher,close,closed:new Promise(resolve=>server.once('close',()=>{clearInterval(interval);resolve();}))};
}

export function connectProjectReceiver({projectRoot,machineId,id,onPass,root,intervalMs=30000,retryMs=1000,launch=true,launchService}={}){
 if(typeof id!=='string'||typeof onPass!=='function')throw Error('A receiver identity and callback are required.');
 let closed=false,socket=null,retry=null,ready=false,pending=false,completedPassId=null,completedOutcome={},running=null,location=null,lastError=null;
 let state='connecting',projectStatus=null;
 const completionWrites=new Map();
 const recordCompletion=passId=>{
  if(!completionWrites.has(passId))completionWrites.set(passId,atomic(completedPath(location,passId),{passId,receiverId:id,pid:process.pid}));
  return completionWrites.get(passId);
 };
 const launchDefault=async()=>{
  const access=await read(join(location.directory,'access.json'));
  // Never unlink a Unix socket based on an old discovery file: another owner
  // may already be publishing a new epoch. A retained stale socket needs
  // explicit local repair rather than racing a second live owner.
  if(process.platform!=='win32'&&access&&!alive(access.pid)){
   try{if((await lstat(location.endpoint)).isSocket()){lastError='dispatcher-stale-endpoint';return;}}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  const child=spawn(process.execPath,[fileURLToPath(new URL('./dispatcher-service.mjs',import.meta.url)),'serve',location.projectRoot,location.machineId,root??'',String(intervalMs)],{detached:true,windowsHide:true,stdio:'ignore'});child.on('error',()=>{});child.unref();
 };
 const schedule=()=>{if(closed||retry)return;retry=setTimeout(()=>{retry=null;void connect();},retryMs);retry.unref?.();};
 const connect=async()=>{
  if(closed)return;
  try{
   location??=await dispatcherLocation({projectRoot,machineId,root});
   const access=await read(join(location.directory,'access.json'));
   if(!access||access.protocol!==protocol||access.endpoint!==location.endpoint||typeof access.token!=='string')throw Error('Dispatcher is not ready.');
   const current=createConnection(location.endpoint);socket=current;current.unref();
   let receivedReady=false,incompatible=false;
   const handshake=setTimeout(()=>current.destroy(),5000);handshake.unref();
   current.on('connect',()=>send(current,{type:'hello',protocol,implementation,token:access.token,mode:'receiver',id,pid:process.pid,completedPassId}));
   lines(current,async row=>{
    if(row.type==='incompatible'){incompatible=true;state='update-required';lastError='dispatcher-update-required';current.end();return;}
    if(row.type==='ready'){
     clearTimeout(handshake);receivedReady=true;ready=true;state='connected';lastError=null;projectStatus=row.status;
     // The daemon can exit between persisting a pass and putting its frame on
     // the socket. Once that connection is gone, a receiver with no callback
     // in flight can settle its exact orphaned grant without executing it.
     if(!running&&row.status?.active?.receiverId===id&&row.status.active.passId!==completedPassId){completedPassId=row.status.active.passId;completedOutcome={failed:true};}
     // A reconnect can settle a pass completed while no server was reachable.
     if(completedPassId&&row.status?.active?.passId===completedPassId)send(current,{type:'complete',passId:completedPassId,...completedOutcome});
     if(pending){pending=false;send(current,{type:'request'});}return;
    }
    if(row.type==='project-status'&&receivedReady){projectStatus=row.status;return;}
    if(row.type==='completed'&&receivedReady){if(row.passId===completedPassId)completedPassId=null;completionWrites.delete(row.passId);return;}
    if(row.type!=='pass'||!receivedReady||typeof row.passId!=='string'||running)throw Error('Unexpected dispatcher pass.');
    const passId=row.passId;
    // The callback checks this fence again before API/native operations.
    const fence=()=>{if(closed||socket!==current||current.destroyed)throw Error('Dispatcher pass connection changed.');};
    running=Promise.resolve().then(()=>onPass({passId,assertCurrent:fence}));
    let outcome;try{outcome=await running??{};}catch{outcome={failed:true};}
    finally{running=null;completedPassId=passId;}
    completedOutcome={teamId:outcome.teamId,head:outcome.head,suspended:outcome.suspended,failed:outcome.failed};
    // A scope change may close the socket while its API callback unwinds. This
    // exact, durable completion lets the daemon release that pass even though
    // the MCP process is still alive. It grants no team or provider authority.
    if(closed||!ready||socket!==current||current.destroyed)await recordCompletion(passId);
    if(!closed&&ready&&socket&&!socket.destroyed)send(socket,{type:'complete',passId,...completedOutcome});
   });
   current.on('error',()=>{});
   current.on('close',()=>{clearTimeout(handshake);if(socket!==current)return;socket=null;ready=false;if(!incompatible){state=closed?'stopped':'reconnecting';lastError='dispatcher-disconnected';}
    if(!closed&&!receivedReady&&!incompatible&&launch)void (launchService??launchDefault)().catch(()=>{lastError='dispatcher-start-failed';});schedule();});
  }catch{
   lastError='dispatcher-unavailable';state='reconnecting';
   if(launch)try{await (launchService??launchDefault)();}catch{lastError='dispatcher-start-failed';}
   schedule();
  }
 };
 void connect();
 return Object.freeze({
  request(){if(closed)return;pending=true;if(ready&&socket){try{send(socket,{type:'request'});pending=false;}catch{socket.destroy();}}},
  status(){return {state,lastError,intervalMs,receiverId:id,connected:ready,project:ready?projectStatus:null};},
  async close(){closed=true;ready=false;state='stopped';if(retry)clearTimeout(retry);await running?.catch(()=>{});if(completedPassId&&location)await recordCompletion(completedPassId);socket?.destroy();},
 });
}

if(process.argv[1]===fileURLToPath(import.meta.url)&&process.argv[2]==='serve'){
 try{const location=await dispatcherLocation({projectRoot:process.argv[3],machineId:process.argv[4],...(process.argv[5]?{root:process.argv[5]}:{})});const service=await serveProjectDispatcher(location,{intervalMs:Number(process.argv[6])||30000});if(service.owner)await service.closed;}
 catch{process.exitCode=1;}
}
