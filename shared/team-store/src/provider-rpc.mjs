// Private JSON-RPC connection to one already-owned provider child. No global
// daemon lookup, terminal input, automatic approval answer or mutation replay.
import {randomUUID} from 'node:crypto';
const attached=new WeakSet();
export function connectOwnedProviderRpc({child,onNotification=()=>{},onRequest=()=>{},maxBytes=2*1024*1024,requestTimeoutMs=null}){
 if(!child?.stdin?.write||!child?.stdout?.on||typeof child.on!=='function'||attached.has(child))throw Error('An unclaimed owned provider pipe is required.');
 attached.add(child);
 const pending=new Map(),requests=new Map();let ended=false,buffer='',failure=null;
 const unavailable=()=>Object.assign(Error('The owned provider connection is unavailable; preserve any submitted operation.'),{code:'API_PROVIDER_CONNECTION_LOST'});
 const fail=error=>{if(ended)return;ended=true;failure=error;for(const item of pending.values()){clearTimeout(item.timer);item.reject(error);}pending.clear();};
 const write=row=>{if(ended||child.stdin.destroyed||!child.stdin.writable)throw unavailable();child.stdin.write(JSON.stringify(row)+'\n',error=>{if(error)fail(unavailable());});};
 const notify=(handler,value)=>{try{Promise.resolve(handler(value)).catch(()=>fail(unavailable()));}catch{fail(unavailable());}};
 child.stdout.setEncoding?.('utf8');
 const data=chunk=>{
  if(ended)return;buffer+=chunk;
  if(Buffer.byteLength(buffer)>maxBytes){fail(Object.assign(Error('Owned provider frame exceeds the limit.'),{code:'API_PROVIDER_PROTOCOL'}));return;}
  for(let at;(at=buffer.indexOf('\n'))>=0;){
   const line=buffer.slice(0,at);buffer=buffer.slice(at+1);if(!line.trim())continue;
   let row;try{row=JSON.parse(line);}catch{fail(Object.assign(Error('Malformed owned provider frame.'),{code:'API_PROVIDER_PROTOCOL'}));return;}
   if(!row||typeof row!=='object'||Array.isArray(row)){fail(unavailable());return;}
   if(typeof row.method==='string'){
    if(row.id!==undefined){
     if((typeof row.id!=='string'&&typeof row.id!=='number')||requests.has(row.id)||requests.size>=128){fail(unavailable());return;}
     requests.set(row.id,structuredClone(row));notify(onRequest,structuredClone(row));
    }else{
     if(row.method==='serverRequest/resolved'){
      const request=requests.get(row.params?.requestId);if(request&&request.params?.threadId===row.params?.threadId)requests.delete(row.params.requestId);
     }
     notify(onNotification,structuredClone(row));
    }
    continue;
   }
   const item=pending.get(row.id);if(!item)continue;clearTimeout(item.timer);pending.delete(row.id);
   if(Object.hasOwn(row,'error'))item.reject(Object.assign(Error('The owned provider refused the request.'),{code:'API_PROVIDER_REFUSED',details:row.error}));
   else if(Object.hasOwn(row,'result'))item.resolve(row.result);
   else{item.reject(unavailable());fail(unavailable());return;}
  }
 };
 child.stdout.on('data',data);
 child.stdout.on('end',()=>fail(unavailable()));child.on('exit',()=>fail(unavailable()));child.on('error',()=>fail(unavailable()));child.stdin.on?.('error',()=>fail(unavailable()));
 return Object.freeze({
  call(method,params,{timeoutMs=requestTimeoutMs}={}){
   if(ended)return Promise.reject(unavailable());
   if(typeof method!=='string'||!method||pending.size>=128||timeoutMs!==null&&(!Number.isSafeInteger(timeoutMs)||timeoutMs<1))return Promise.reject(Error('Invalid owned provider request.'));
   return new Promise((resolve,reject)=>{
    const id=randomUUID(),timer=timeoutMs===null?null:setTimeout(()=>{
     pending.delete(id);reject(Object.assign(Error('Owned provider reply is unknown; never retry a mutation as a new request.'),{code:'API_PROVIDER_REPLY_UNKNOWN',requestId:id}));
    },timeoutMs);
    pending.set(id,{resolve,reject,timer});try{write({id,method,params});}catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
   });
  },
  notify(method,params){write({method,...(params===undefined?{}:{params})});},
  // This is a private UI/approval bridge hook, not a tool or default handler.
  // Receiving a request never invokes it; the integration must obtain a real
  // answer through its existing reviewed human-facing path before calling it.
  respond(id,result){if(!requests.has(id))throw Error('Native provider request is no longer pending.');write({id,result});requests.delete(id);},
  pendingRequests(){return [...requests.values()].map(row=>structuredClone(row));},
  status(){return {connected:!ended,pendingCalls:pending.size,pendingRequests:requests.size,error:failure?.code??null};},
  alive(){return !ended&&child.exitCode==null&&!child.killed;},
  disconnect(){fail(unavailable());child.stdout.off?.('data',data);},
 });
}
