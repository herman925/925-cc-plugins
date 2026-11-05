import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createCodexNativeIdentity} from '../codex-native.mjs';

const refused=error=>error.code==='API_NATIVE_UNVERIFIED';
test('Codex native identity requires the exact OS parent, fixed project and explicit host thread/incarnation',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-codex-proof-'))),profile=join(root,'profile');await mkdir(profile);
 const binary=join(root,'codex.exe');await writeFile(binary,'fixture executable identity, never run');
 const endpoint=process.platform==='win32'?`\\\\.\\pipe\\team-codex-proof-${randomUUID()}`:join(root,'host.sock');
 const meta={pid:process.pid,runtimeId:'epoch',authToken:randomUUID(),transport:{kind:process.platform==='win32'?'named-pipe':'unix',endpoint}};
 const metadataPath=join(profile,'orca-runtime.json');await writeFile(metadataPath,JSON.stringify(meta));
 const threadId=randomUUID(),scope={projectRoot:root,contextId:'context',terminalHandle:'terminal'};
 await mkdir(join(root,'thread-writer-locks'));await writeFile(join(root,'thread-writer-locks',`${threadId}.lock`),'');
 let mode='normal',birth='12345',parentPath=binary,parentPid=process.ppid,checks=0;
 let owners=[{pid:process.ppid,createdAt:'12345'}];
 const sockets=new Set();
 const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.once('data',async bytes=>{
  const r=JSON.parse(bytes.toString());assert.equal(r.authToken,meta.authToken);
  const terminal={handle:'terminal',connected:true,executionHostId:'local',worktreeId:'context',worktreePath:root,incarnationId:'inc'};
  if(mode==='remote')terminal.executionHostId='remote';if(mode==='disconnected')terminal.connected=false;if(mode==='context')terminal.worktreeId='other';
  const tab={type:'terminal',incarnationId:mode==='incarnation'?'old':'inc',agentStatus:{terminalHandle:'terminal',agentType:mode==='provider'?'claude':'codex',providerSession:{id:mode==='thread'?randomUUID():threadId}}};
  if(mode==='missing-thread')delete tab.agentStatus.providerSession;
  if(mode==='epoch')await writeFile(metadataPath,JSON.stringify({...meta,runtimeId:'new-epoch'}));
  socket.end(JSON.stringify({id:r.id,ok:true,result:r.method==='terminal.show'?{terminal}:{tabs:mode==='duplicate'?[tab,tab]:[tab]},_meta:{runtimeId:meta.runtimeId}})+'\n');
 });});
 t.after(async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
 const sends=[];
 const dependencies={execute:async(_command,args)=>{if(args[0]==='orchestration')sends.push(args);return {stdout:JSON.stringify({ok:true,result:{app:{pid:process.pid},runtime:{runtimeId:'epoch'}}})};},inspectParent:async()=>{checks++;return {pid:parentPid,executable:parentPath,createdAt:birth};},threadOwners:async()=>owners};
 const options={scope,codexExecutable:binary,codexHome:root,env:{ORCA_USER_DATA_PATH:profile}};
 const identity=await createCodexNativeIdentity(options,dependencies);
 const actor=await identity.verifyCaller({threadId,progressToken:1});assert.equal(actor.provider,'codex');assert.equal(actor.conversationId,threadId);assert.equal(actor.projectRoot,root);assert.equal(actor.terminalHandle,'terminal');assert.equal(identity.hostKind,'orca');
 scope.terminalHandle='mutated';scope.contextId='mutated';assert.equal((await identity.verifyCaller({threadId})).contextId,'context');
 const recipient={machine_id:actor.machineId,execution_host_id:'local',provider:'codex',conversation_id:threadId,terminal_handle:'terminal',context_id:'context',incarnation_id:'inc'};
 assert.equal((await identity.wake([{noticeId:'own-deadline',recipient}],{threadId}))[0]?.queued,true);
 assert.equal(sends.length,1);assert.ok(sends[0].includes('terminal'));assert.match(sends[0].at(-2),/own-deadline/);
 for(const bad of [undefined,{},Object.create({threadId}),{threadId:'------------------------------------'},{threadId:threadId.toUpperCase()}])await assert.rejects(identity.verifyCaller(bad),refused);
 for(const bad of ['provider','thread','missing-thread','incarnation','duplicate','remote','disconnected','context'])await t.test(`refuses ${bad} host evidence`,async()=>{mode=bad;await assert.rejects(identity.verifyCaller({threadId}),refused);});
 mode='normal';birth='new-process';await assert.rejects(identity.verifyCaller({threadId}),refused);birth='12345';parentPid=process.pid;await assert.rejects(identity.verifyCaller({threadId}),refused);parentPid=process.ppid;parentPath=process.execPath;await assert.rejects(identity.verifyCaller({threadId}),refused);parentPath=binary;
 for(const changed of [[],[{pid:process.pid,createdAt:'12345'}],[{pid:process.ppid,createdAt:'99999'}],[...owners,...owners]]){
  const original=owners;owners=changed;await assert.rejects(identity.verifyCaller({threadId}),refused);owners=original;
 }
 let lockReads=0;const loseLock=await createCodexNativeIdentity({...options,scope:{projectRoot:root,contextId:'context',terminalHandle:'terminal'}},{...dependencies,threadOwners:async()=>++lockReads===2?[]:owners});
 await assert.rejects(loseLock.verifyCaller({threadId}),refused);assert.equal(lockReads,2);
 // The second parent check occurs after host I/O: a replacement cannot win a
 // race between the first process observation and the returned native actor.
 let parentReads=0;
 const race=await createCodexNativeIdentity({...options,scope:{projectRoot:root,contextId:'context',terminalHandle:'terminal'}},{...dependencies,inspectParent:async()=>({pid:process.ppid,executable:binary,createdAt:++parentReads===3?'99999':'12345'})});
 await assert.rejects(race.verifyCaller({threadId}),refused);
 assert.equal(parentReads,3);
 mode='epoch';await assert.rejects(identity.verifyCaller({threadId}),refused);
});
