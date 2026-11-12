import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createConnection} from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createProjectDispatcher} from '../src/project-dispatcher.mjs';
import {dispatcherLocation,serveProjectDispatcher,connectProjectReceiver,projectOwnedRequest} from '../src/dispatcher-service.mjs';

function fixture(options={}){let time=0;const persisted=[],sent=[];const dispatcher=createProjectDispatcher({now:()=>time,intervalMs:30,persist:async value=>persisted.push(structuredClone(value)),...options});return {dispatcher,persisted,sent,advance:n=>time+=n,register:async(id,pid=1)=>dispatcher.register({id,pid,send:row=>sent.push({id,...row})})};}
test('one scheduler serializes receivers and durably records intent before a callback',async()=>{
 const f=fixture();await f.register('claude');await f.register('codex');f.advance(30);
 await Promise.all([f.dispatcher.tick(),f.dispatcher.tick()]);assert.equal(f.sent.length,1);assert.equal(f.persisted[0].passId,f.sent[0].passId);
 const first=f.sent[0];await f.dispatcher.complete(first.id,first.passId,{teamId:'one',head:true});await f.dispatcher.tick();assert.equal(f.sent.length,2);
 await f.dispatcher.complete(f.sent[1].id,f.sent[1].passId,{teamId:'one'});await f.dispatcher.tick();assert.equal(f.sent.length,2);
 f.advance(30);await f.dispatcher.tick();assert.equal(f.sent.length,3);assert.equal(f.sent[2].id,'claude');
});
test('a manual request wakes the team scheduler without a second poller',async()=>{
 const f=fixture();await f.register('head');await f.dispatcher.request('head');await f.dispatcher.tick();assert.equal(f.sent.length,1);
 await f.dispatcher.complete('head',f.sent[0].passId,{teamId:'team'});await f.dispatcher.request('head');await f.dispatcher.tick();assert.equal(f.sent.length,2);
});
test('a timed-out connected or disconnected pass stays blocked until exact completion',async()=>{
 const f=fixture();await f.register('one');await f.register('two');f.advance(30);await f.dispatcher.tick();const pass=f.sent[0];
 f.advance(100);await f.dispatcher.disconnect('one');await f.dispatcher.tick();assert.equal(f.sent.length,1);assert.equal(f.dispatcher.status().state,'needs-attention');
 await assert.rejects(f.dispatcher.complete('two',pass.passId));await assert.rejects(f.dispatcher.complete('one','wrong'));
 await f.dispatcher.complete('one',pass.passId);await f.dispatcher.tick();assert.equal(f.sent.length,2);
});
test('a crashed owner releases the scheduler but never manufactures a read or pickup receipt',async()=>{
 let living=true;const f=fixture({isAlive:()=>living});await f.register('one');await f.register('two');f.advance(30);await f.dispatcher.tick();await f.dispatcher.disconnect('one');living=false;await f.dispatcher.tick();assert.equal(f.sent.length,2);assert.equal(f.persisted[1],null);
});
test('a restart preserves a live outstanding pass and reconciles the original receiver only',async()=>{
 const recovered={passId:'original',receiverId:'old',pid:77,startedAt:1},f=fixture({recovered});await f.register('new',88);f.advance(100);await f.dispatcher.tick();assert.equal(f.sent.length,0);
 await f.dispatcher.register({id:'old',pid:77,completedPassId:'original',send:()=>{}});await f.dispatcher.tick();assert.equal(f.sent.length,1);
});
test('persistence failure cannot start an unrecorded pass or free an uncertain one',async()=>{
 const f=fixture({persist:async()=>{throw Error('disk failed');}});await f.register('one');f.advance(30);await assert.rejects(f.dispatcher.tick(),/disk failed/);assert.equal(f.sent.length,0);await f.dispatcher.tick();assert.equal(f.dispatcher.status().state,'checking');
});
test('suspended receivers do not busy-loop and can be reactivated explicitly',async()=>{
 const f=fixture();await f.register('one');await f.dispatcher.request('one');await f.dispatcher.tick();await f.dispatcher.complete('one',f.sent[0].passId,{suspended:true});f.advance(100);await f.dispatcher.tick();assert.equal(f.sent.length,1);await f.dispatcher.request('one');await f.dispatcher.tick();assert.equal(f.sent.length,2);
});
test('different teams retain independent cadence and a disconnected head can fail over',async()=>{
 const f=fixture();await f.register('head');await f.register('worker');await f.register('other');f.advance(30);
 for(const [id,team] of [['head','a'],['worker','a'],['other','b']]){await f.dispatcher.tick();const pass=f.sent.at(-1);assert.equal(pass.id,id);await f.dispatcher.complete(id,pass.passId,{teamId:team,head:id==='head'});}
 await f.dispatcher.disconnect('head');f.advance(30);await f.dispatcher.tick();assert.equal(f.sent.at(-1).id,'worker');
});
test('headless teams schedule every sender rather than starving worker-to-lead mail',async()=>{
 const f=fixture();await f.register('worker-a');await f.register('worker-b');f.advance(30);
 for(let i=0;i<2;i++){await f.dispatcher.tick();const pass=f.sent.at(-1);await f.dispatcher.complete(pass.id,pass.passId,{teamId:'one'});}
 f.advance(30);for(let i=0;i<2;i++){await f.dispatcher.tick();const pass=f.sent.at(-1);await f.dispatcher.complete(pass.id,pass.passId,{teamId:'one'});}
 assert.deepEqual(f.sent.map(r=>r.id),['worker-a','worker-b','worker-a','worker-b']);
});
async function until(condition){for(let i=0;i<500;i++){if(await condition())return;await delay(20);}assert.fail('Timed out waiting for dispatcher fixture.');}
test('a submitted owned request with a lost reply is never automatically resent or assigned another owner',async t=>{
 const projectRoot=await mkdtemp(join(tmpdir(),'team-owned-ipc-')),root=join(projectRoot,'private'),location=await dispatcherLocation({projectRoot,root});let attempts=0,active=true,closed=0;
 const service=await serveProjectDispatcher(location,{tickMs:5,idleMs:10,createOwnedManager:()=>({prepare:async()=>{attempts++;await delay(70);return {state:'prepared'};},inspect:async()=>({attempts}),active:()=>active,close:async()=>closed++})});t.after(()=>service.close());
 await assert.rejects(projectOwnedRequest({projectRoot,root,launch:false,timeoutMs:25,operation:{type:'prepare',input:{}}}),{code:'API_OWNED_EXECUTION_UNKNOWN'});await delay(100);assert.equal(attempts,1);assert.equal(closed,0,'An owned worker keeps the dispatcher alive without any head receiver.');
 assert.deepEqual(await projectOwnedRequest({projectRoot,root,launch:false,operation:{type:'inspect',input:{}}}),{attempts:1});active=false;
});
test('real local IPC elects one owner, authenticates receivers and serializes Claude/Codex callbacks',async t=>{
 const root=await mkdtemp(join(tmpdir(),'team-single-dispatch-')),location=await dispatcherLocation({projectRoot:root,root:join(root,'private')});
 const service=await serveProjectDispatcher(location,{intervalMs:50,tickMs:5,idleMs:10000});assert.equal(service.owner,true);t.after(()=>service.close());
 const second=await serveProjectDispatcher(location,{tickMs:5});assert.equal(second.owner,false);
 const entries=[];let active=0,max=0;
 const receiver=id=>connectProjectReceiver({projectRoot:root,root:join(root,'private'),id,launch:false,retryMs:10,onPass:async({assertCurrent})=>{assertCurrent();max=Math.max(max,++active);entries.push(id);await delay(15);assertCurrent();active--;return {teamId:'one',head:id==='claude'};}});
 const a=receiver('claude'),b=receiver('codex');t.after(()=>a.close());t.after(()=>b.close());await until(()=>a.status().connected&&b.status().connected);
 a.request();b.request();await until(()=>entries.length>=2);assert.equal(max,1);assert.equal(service.dispatcher.status().receiverCount,2);
 const unauth=createConnection(location.endpoint);t.after(()=>unauth.destroy());unauth.on('error',()=>{});unauth.on('connect',()=>unauth.write(JSON.stringify({type:'hello',protocol:1,token:'wrong',mode:'receiver',id:'intruder',pid:process.pid})+'\n'));
 await new Promise(resolve=>unauth.on('close',resolve));assert.equal(service.dispatcher.status().receiverCount,2);
 const persisted=JSON.parse(await readFile(join(location.directory,'access.json'),'utf8'));assert.equal(persisted.endpoint,location.endpoint);assert.equal(persisted.token.length,64);
});
test('native child service starts on demand and restarts after an owned process exit',async t=>{
 const root=await mkdtemp(join(tmpdir(),'team-dispatch-child-')),privateRoot=join(root,'private'),children=[];let callbacks=0;
 const location=await dispatcherLocation({projectRoot:root,root:privateRoot});
 const launchService=async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../src/dispatcher-service.mjs',import.meta.url)),'serve',root,location.machineId,privateRoot,'50'],{windowsHide:true,stdio:'ignore'});children.push(child);
 };
 const receiver=connectProjectReceiver({projectRoot:root,root:privateRoot,id:'codex-owned-fixture',onPass:async()=>{callbacks++;return {teamId:'team'};},retryMs:20,launchService});
 t.after(async()=>{await receiver.close();for(const child of children)child.kill();});
 receiver.request();await until(()=>callbacks>=1);const first=JSON.parse(await readFile(join(location.directory,'access.json'),'utf8'));
 const owner=children.find(child=>child.pid===first.pid);assert.ok(owner);const exited=new Promise(resolve=>owner.once('exit',resolve));owner.kill();await exited;
 if(process.platform==='win32'){
  receiver.request();await until(async()=>{try{return JSON.parse(await readFile(join(location.directory,'access.json'),'utf8')).pid!==first.pid&&callbacks>=2;}catch{return false;}});
  assert.equal(receiver.status().connected,true);
 }
});
test('closing a receiver during a pass does not lock out a still-live MCP process',async t=>{
 const root=await mkdtemp(join(tmpdir(),'team-dispatch-close-')),privateRoot=join(root,'private'),location=await dispatcherLocation({projectRoot:root,root:privateRoot});
 const service=await serveProjectDispatcher(location,{intervalMs:40,tickMs:5,idleMs:10000});t.after(()=>service.close());
 let entered=false,release,other=0;const blocked=new Promise(resolve=>release=resolve);
 const a=connectProjectReceiver({projectRoot:root,root:privateRoot,id:'old-scope',launch:false,retryMs:10,onPass:async()=>{entered=true;await blocked;}});
 const b=connectProjectReceiver({projectRoot:root,root:privateRoot,id:'new-scope',launch:false,retryMs:10,onPass:async()=>{other++;return {teamId:'one'};}});
 t.after(()=>a.close());t.after(()=>b.close());a.request();await until(()=>entered);const closing=a.close();release();await closing;b.request();await until(()=>other>0);assert.equal(b.status().connected,true);
});
