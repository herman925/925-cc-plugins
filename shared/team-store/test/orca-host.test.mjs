import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createOrcaHost} from '../src/orca-host.mjs';
import {EventEmitter} from 'node:events';

test('a delivered complete frame cannot lose to close while the final epoch read is pending',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-host-frame-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const metadata={pid:process.pid,runtimeId:'epoch',authToken:randomUUID(),transport:{kind:process.platform==='win32'?'named-pipe':'unix',endpoint:process.platform==='win32'?'\\\\.\\pipe\\fixture':join(root,'fixture.sock')}};
 const path=join(root,'orca-runtime.json');await writeFile(path,JSON.stringify(metadata));
 const connect=()=>{
  const socket=new EventEmitter();socket.setEncoding=()=>socket;socket.destroy=()=>{};
  socket.write=bytes=>{const r=JSON.parse(bytes);socket.emit('data',JSON.stringify({id:r.id,ok:true,result:{verified:true},_meta:{runtimeId:'epoch'}})+'\n');socket.emit('close');return true;};
  queueMicrotask(()=>socket.emit('connect'));return socket;
 };
 let reads=0;
 const host=await createOrcaHost({env:{ORCA_USER_DATA_PATH:root}},{connect,execute:async()=>({stdout:JSON.stringify({ok:true,result:{app:{pid:process.pid},runtime:{runtimeId:'epoch'}}})}),readMetadata:async()=>{if(++reads===3)await new Promise(resolve=>setTimeout(resolve,30));return readFile(path,'utf8');}});
 assert.deepEqual(await host.rpc('terminal.show',{}),{verified:true});assert.equal(reads,3);
});

test('complete native replies wait for post-response epoch validation even after the peer closes',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-host-close-')));
 const endpoint=process.platform==='win32'?`\\\\.\\pipe\\team-host-close-${randomUUID()}`:join(root,'host.sock');
 const metadata={pid:process.pid,runtimeId:'epoch',authToken:randomUUID(),transport:{kind:process.platform==='win32'?'named-pipe':'unix',endpoint}};
 const path=join(root,'orca-runtime.json');await writeFile(path,JSON.stringify(metadata));
 const sockets=new Set();let mode='complete';
 const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.once('data',async bytes=>{
  const r=JSON.parse(bytes.toString());assert.equal(r.authToken,metadata.authToken);
  const value={id:mode==='wrong-id'?'other':r.id,ok:true,result:{terminal:{handle:'verified'}},_meta:{runtimeId:metadata.runtimeId}};
  if(mode==='epoch')await writeFile(path,JSON.stringify({...metadata,runtimeId:'replacement'}));
  socket.end(JSON.stringify(value)+(mode==='truncated'?'':'\n'));
 });});
 t.after(async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
 let reads=0;
 const host=await createOrcaHost({env:{ORCA_USER_DATA_PATH:root}},{execute:async()=>({stdout:JSON.stringify({ok:true,result:{app:{pid:process.pid},runtime:{runtimeId:'epoch'}}})}),readMetadata:async()=>{if(++reads>=3)await new Promise(resolve=>setTimeout(resolve,40));return readFile(path,'utf8');}});
 assert.deepEqual(await host.rpc('terminal.show',{terminal:'terminal'}),{terminal:{handle:'verified'}});
 for(const bad of ['truncated','wrong-id','epoch']){mode=bad;await assert.rejects(host.rpc('terminal.show',{terminal:'terminal'}),e=>e.code==='API_NATIVE_UNVERIFIED');}
});
