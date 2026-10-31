import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createModNative} from '../mod-native.mjs';

test('native proof uses exact conversation/incarnation, live registry and runtime epoch; bridge proof also requires its parent',async t=>{
 let server;const sockets=new Set();
 t.after(async()=>{for(const s of sockets)s.destroy();if(server?.listening)await new Promise(resolve=>server.close(resolve));});
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-mod-proof-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const config=join(root,'claude'),profile=join(root,'orca');await mkdir(join(config,'sessions'),{recursive:true});await mkdir(profile);
 const endpoint=process.platform==='win32'?`\\\\.\\pipe\\team-mod-proof-${randomUUID()}`:join(root,'runtime.sock');
 const metadata={pid:process.pid,runtimeId:'epoch',authToken:randomUUID(),transport:{kind:process.platform==='win32'?'named-pipe':'unix',endpoint}};
 const metadataPath=join(profile,'orca-runtime.json');await writeFile(metadataPath,JSON.stringify(metadata));
 const registryPath=join(config,'sessions',`${process.ppid}.json`);
 const registryRow={pid:process.ppid,sessionId:'conversation',cwd:root,procStart:'123456789'};
 await writeFile(registryPath,JSON.stringify(registryRow));
 const terminal={handle:'terminal',connected:true,executionHostId:'local',worktreeId:'context',worktreePath:root,incarnationId:'instance'};
 const tab={type:'terminal',incarnationId:'instance',agentStatus:{terminalHandle:'terminal',providerSession:{id:'conversation'},agentType:'claude'}};
 let mode='normal';
 server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.once('data',async bytes=>{
  const request=JSON.parse(bytes.toString());assert.equal(request.authToken,metadata.authToken);
  if(mode==='epoch')await writeFile(metadataPath,JSON.stringify({...metadata,runtimeId:'replacement'}));
  const shown=mode==='wrong-conversation'?{...tab,agentStatus:{...tab.agentStatus,providerSession:{id:'other'}}}:mode==='wrong-incarnation'?{...tab,incarnationId:'old'}:mode==='idle'?{...tab,agentStatus:{terminalHandle:'terminal',agentType:'claude'}}:tab;
  const result=request.method==='terminal.show'?{terminal}:{tabs:mode==='duplicate'?[shown,shown]:mode==='absent'?[]:[shown]};
  socket.end(JSON.stringify({id:request.id,ok:true,result,_meta:{runtimeId:metadata.runtimeId}})+'\n');
 });});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
 const env={ORCA_USER_DATA_PATH:profile,CLAUDE_CONFIG_DIR:config,ORCA_TERMINAL_HANDLE:'terminal',ORCA_WORKTREE_ID:'context'};
 let birth='123456789';
 const dependencies={execute:async()=>({stdout:JSON.stringify({ok:true,result:{app:{pid:process.pid},runtime:{runtimeId:'epoch'}}})}),processStart:async()=>birth};
 const native=await createModNative({env},dependencies);
 const reference={projectRoot:root,conversationId:'conversation',terminalHandle:'terminal',contextId:'context'};
 assert.equal((await native.verifyCaller(reference)).incarnationId,'instance');
 for(const bad of ['wrong-conversation','wrong-incarnation','duplicate','absent'])await t.test(`refuses ${bad} native evidence for caller and target`,async()=>{mode=bad;await assert.rejects(native.verify(reference),e=>e.code==='API_NATIVE_UNVERIFIED');await assert.rejects(native.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');});
 await t.test('idle caller requires its exact parent process creation fingerprint',async()=>{
  mode='idle';assert.equal((await native.verifyCaller(reference)).conversationId,'conversation');
  await assert.rejects(native.verify(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
  birth='replacement';await assert.rejects(native.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
  birth=null;await assert.rejects(native.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');birth=registryRow.procStart;
  await writeFile(registryPath,JSON.stringify({...registryRow,procStart:undefined}));await assert.rejects(native.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
  await writeFile(registryPath,JSON.stringify(registryRow));
 });
 await t.test('idle caller cannot substitute another parent or inherited terminal context',async()=>{
  mode='idle';await writeFile(registryPath,JSON.stringify({...registryRow,pid:process.pid}));await assert.rejects(native.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
  await writeFile(registryPath,JSON.stringify(registryRow));
  const wrong=await createModNative({env:{...env,ORCA_TERMINAL_HANDLE:'different'}},dependencies);
  await assert.rejects(wrong.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
 });
 mode='normal';await writeFile(registryPath,JSON.stringify({pid:process.pid,sessionId:'conversation',cwd:root}));
 assert.equal((await native.verify(reference)).conversationId,'conversation');
 await assert.rejects(native.verifyCaller(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
 mode='epoch';await assert.rejects(native.verify(reference),e=>e.code==='API_NATIVE_UNVERIFIED');
});
