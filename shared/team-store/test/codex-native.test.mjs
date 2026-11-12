import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createCodexNativeIdentity} from '../codex-native.mjs';
import {FENCED_WAKE_CAPABILITY} from '../src/wake-journal.mjs';

const refused=error=>error.code==='API_NATIVE_UNVERIFIED';
test('Codex native identity requires the exact OS parent, fixed project and explicit host thread/incarnation',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-codex-proof-'))),profile=join(root,'profile');await mkdir(profile);
 const binary=join(root,'codex.exe');await writeFile(binary,'fixture executable identity, never run');
 const endpoint=process.platform==='win32'?`\\\\.\\pipe\\team-codex-proof-${randomUUID()}`:join(root,'host.sock');
 const meta={pid:process.pid,runtimeId:'epoch',authToken:randomUUID(),transport:{kind:process.platform==='win32'?'named-pipe':'unix',endpoint}};
 const metadataPath=join(profile,'orca-runtime.json');await writeFile(metadataPath,JSON.stringify(meta));
 const threadId=randomUUID(),scope={projectRoot:root,contextId:'context',terminalHandle:'terminal'};
 await mkdir(join(root,'thread-writer-locks'));await writeFile(join(root,'thread-writer-locks',`${threadId}.lock`),'');
 let mode='normal',birth='12345',parentPath=binary,parentPid=process.ppid,checks=0,created=false;
 let owners=[{pid:process.ppid,createdAt:'12345'}];
 const sockets=new Set(),nativeWake=[];
 const server=createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.once('data',async bytes=>{
  const r=JSON.parse(bytes.toString());assert.equal(r.authToken,meta.authToken);
  const terminal={handle:'terminal',connected:true,executionHostId:'local',worktreeId:'context',worktreePath:root,incarnationId:'inc'};
  if(r.method==='terminal.show'&&r.params.terminal==='created'){terminal.handle='created';terminal.incarnationId='created-inc';}
  if(r.method==='terminal.show'&&r.params.terminal==='claude-target'){terminal.handle='claude-target';terminal.incarnationId='claude-inc';}
  if(mode==='remote')terminal.executionHostId='remote';if(mode==='disconnected')terminal.connected=false;if(mode==='context')terminal.worktreeId='other';
  const tab={type:'terminal',incarnationId:mode==='incarnation'?'old':'inc',agentStatus:{terminalHandle:'terminal',agentType:mode==='provider'?'claude':'codex',providerSession:{id:mode==='thread'?randomUUID():threadId}}};
  if(mode==='missing-thread')delete tab.agentStatus.providerSession;
  if(mode==='epoch')await writeFile(metadataPath,JSON.stringify({...meta,runtimeId:'new-epoch'}));
  const claudeTab={type:'terminal',incarnationId:'claude-inc',agentStatus:{terminalHandle:'claude-target',agentType:'claude',providerSession:{id:'claude-thread'}}};
  let result=r.method==='terminal.show'?{terminal}:{tabs:mode==='duplicate'?[tab,tab]:[tab,claudeTab]};
  if(r.method==='terminal.agentStatus')result={agentStatus:{handle:r.params.terminal,isRunningAgent:true,status:'idle'}};
  if(r.method==='terminal.promptReceipt'){
   const previous=nativeWake.find(row=>row.orchestrationRequestId===r.params.requestId);
   result={promptReceipt:{journalId:'journal-fixture',requestId:r.params.requestId,authoritative:true,state:previous?'accepted':'absent',targetState:'active',expectedBinding:r.params.expectedBinding,bodyDigest:r.params.bodyDigest,...(previous?{send:{handle:previous.params.terminal,accepted:true,prompt:{requestId:r.params.requestId,processIncarnation:previous.params.expectedBinding.incarnationId,observation:'supported',stages:['input_accepted','turn_started']}}}:{})}};
  }
  if(r.method==='terminal.send'){
   nativeWake.push(r);assert.equal(r.params.agentPrompt,true);assert.equal(r.params.enter,true);assert.equal(r.params.interrupt,undefined);assert.equal(r.params.expectedBinding.incarnationId,r.params.terminal==='claude-target'?'claude-inc':'inc');assert.equal(r.params.expectedBinding.conversationId,r.params.terminal==='claude-target'?'claude-thread':threadId);assert.equal(r.params.journalId,'journal-fixture');
   result={send:{handle:r.params.terminal,accepted:true,prompt:{requestId:r.orchestrationRequestId,processIncarnation:r.params.expectedBinding.incarnationId,observation:'supported',stages:['input_accepted','turn_started']}}};
  }
  socket.end(JSON.stringify({id:r.id,ok:true,result,_meta:{runtimeId:meta.runtimeId}})+'\n');
 });});
 t.after(async()=>{for(const socket of sockets)socket.destroy();if(server.listening)await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(endpoint,resolve);});
 const sends=[];
 const dependencies={execute:async(_command,args)=>{if(args[0]==='orchestration'||args[0]==='terminal'&&args[1]==='send')sends.push(args);if(args[0]==='terminal'&&args[1]==='list')return {stdout:JSON.stringify({ok:true,result:{terminals:[{handle:'terminal'},...(created?[{handle:'created'}]:[])],truncated:false}})};if(args[0]==='terminal'&&args[1]==='create'){created=true;assert.ok(!args.includes('--command'));assert.ok(args.includes('powershell.exe'));return {stdout:JSON.stringify({ok:true,result:{terminal:{handle:'created'}}})};}return {stdout:JSON.stringify({ok:true,result:{app:{pid:process.pid},runtime:{runtimeId:'epoch',promptDeliveryJournalId:'journal-fixture',capabilities:['terminal.prompt-delivery.v1',FENCED_WAKE_CAPABILITY]}}})};},inspectParent:async()=>{checks++;return {pid:parentPid,executable:parentPath,createdAt:birth};},threadOwners:async()=>owners};
 const options={scope,codexExecutable:binary,codexHome:root,env:{ORCA_USER_DATA_PATH:profile}};
 const identity=await createCodexNativeIdentity(options,{...dependencies,wakeJournalRoot:join(root,'wake-receipts')});
 const actor=await identity.verifyCaller({threadId,progressToken:1});assert.equal(actor.provider,'codex');assert.equal(actor.conversationId,threadId);assert.equal(actor.projectRoot,root);assert.equal(actor.terminalHandle,'terminal');assert.equal(identity.hostKind,'orca');
 assert.equal(identity.inboxWake.state,'available');
 scope.terminalHandle='mutated';scope.contextId='mutated';assert.equal((await identity.verifyCaller({threadId})).contextId,'context');
 const recipient={member_id:'member',generation:1,machine_id:actor.machineId,execution_host_id:'local',provider:'codex',conversation_id:threadId,terminal_handle:'terminal',context_id:'context',incarnation_id:'inc'};
 const wakeContext={teamId:'team',api:{inspectWake:async()=>({result:{eligible:true,binding:recipient}})}};
 assert.equal((await identity.wake([{noticeId:'own-deadline',recipient}],{threadId},wakeContext))[0]?.state,'turn-started');
 await identity.wake([{noticeId:'own-deadline',recipient}],{threadId},wakeContext);
 assert.equal(nativeWake.length,1);assert.equal(sends.length,0);assert.match(nativeWake[0].params.text,/own-deadline/);
 await t.test('Codex to Claude uses the same fenced native prompt and never an orchestration notification',async()=>{
  const claudeRecipient={...recipient,member_id:'claude-member',provider:'claude',conversation_id:'claude-thread',terminal_handle:'claude-target',incarnation_id:'claude-inc'};
  const context={teamId:'team',api:{inspectWake:async()=>({result:{eligible:true,binding:claudeRecipient}})}};
  const result=await identity.wake([{noticeId:'claude-notice',recipient:claudeRecipient}],{threadId},context);
  assert.equal(result[0].state,'turn-started');assert.equal(nativeWake.length,2);assert.equal(nativeWake[1].params.expectedBinding.provider,'claude');assert.equal(sends.length,0);
 });
 await t.test('legacy prompt capability without managed enrollment never sends or launches',async()=>{
  const execute=dependencies.execute;
  const legacy=await createCodexNativeIdentity({...options,scope:{projectRoot:root,contextId:'context',terminalHandle:'terminal'}},{...dependencies,wakeJournalRoot:join(root,'legacy-receipts'),execute:async(command,args,init)=>{
   const response=await execute(command,args,init);if(args[0]!=='status')return response;
   const value=JSON.parse(response.stdout);value.result.runtime.capabilities=['terminal.prompt-delivery.v1'];delete value.result.runtime.promptDeliveryJournalId;return {stdout:JSON.stringify(value)};
  }});
  assert.equal(legacy.inboxWake.state,'host-update-required');
  assert.equal(legacy.inboxWake.managedFallback.state,'not-enrolled');
  const result=await legacy.wake([{noticeId:'legacy',recipient}],{threadId},wakeContext);
  assert.equal(result[0].state,'fallback-setup-required');assert.equal(nativeWake.length,2);assert.equal(sends.length,0);
 });
 await t.test('only a private verified managed backend can service an unsupported primary',async()=>{
  const execute=dependencies.execute;let managed=0;
  const enrolled=await createCodexNativeIdentity({...options,scope:{projectRoot:root,contextId:'context',terminalHandle:'terminal'}},{...dependencies,wakeJournalRoot:join(root,'enrolled-receipts'),execute:async(command,args,init)=>{
   const response=await execute(command,args,init);if(args[0]!=='status')return response;const value=JSON.parse(response.stdout);value.result.runtime.capabilities=[];delete value.result.runtime.promptDeliveryJournalId;return {stdout:JSON.stringify(value)};
  },createManagedWakeBackend:async context=>{assert.equal(context.actor.conversationId,threadId);assert.equal(context.teamId,'team');assert.equal(context.api,wakeContext.api);return {id:'orca-managed',availability:async()=>({state:'available'}),wake:async()=>{managed++;return {state:'input-accepted',requestId:'managed-fixture'};}};}});
  assert.equal(enrolled.inboxWake.managedFallback.state,'target-check-required');const result=await enrolled.wake([{noticeId:'managed-notice',recipient}],{threadId},wakeContext);assert.equal(result[0].selectedRoute,'orca-managed');assert.equal(result[0].usingFallback,true);assert.equal(managed,1);assert.equal(nativeWake.length,2);assert.equal(sends.length,0);
 });
 await t.test('explicit optional managed-team creation uses the owned dispatcher without sending to Orca terminals',async()=>{
  const ownedCalls=[],target={projectRoot:root,machineId:actor.machineId,executionHostId:'local',contextId:'context',terminalHandle:'codex-thread:new-owned',incarnationId:'owned-process'};
  const managed=await createCodexNativeIdentity({...options,scope:{projectRoot:root,contextId:'context',terminalHandle:'terminal'}},{...dependencies,inspectClaudeProvider:async()=>({state:'setup-required'}),requestOwned:async value=>{ownedCalls.push(value.operation);if(value.operation.type==='prepare'){assert.equal(value.operation.input.actor.conversationId,threadId);return {state:'prepared',target};}if(value.operation.type==='inspect')return {target};if(value.operation.type==='start')return {bootstrap:{turnId:'owned-bootstrap'}};throw Error('Unexpected owned operation');}});
  assert.equal(ownedCalls.length,0);assert.deepEqual(managed.managedLaunchNative.launchProviders,['codex']);
  const receipt=await managed.managedLaunchNative.createLaunchTarget({member:{cli:'codex',model:'default',effort:'default'},launchId:'reviewed-new-lead',launchProfile:'fixture-profile',workerToolPolicy:'team-worker-v1'},{threadId});assert.deepEqual(receipt,target);assert.equal(created,false);
  assert.equal(await managed.verifyLaunchTarget(receipt,{threadId}),receipt);await assert.rejects(managed.verifyLaunchTarget({...receipt},{threadId}),refused);
  await managed.managedLaunchNative.startLaunchTarget(receipt,{threadId});assert.equal(ownedCalls.filter(row=>row.type==='prepare').length,1);assert.equal(ownedCalls.filter(row=>row.type==='start').length,1);assert.equal(sends.length,0);assert.equal(created,false);
 });
 const target=await identity.createLaunchTerminal({title:'Reviewed worker'},{threadId});assert.equal(created,true);assert.equal(target.terminalHandle,'created');assert.equal(target.conversationId,undefined);
 await assert.rejects(identity.createLaunchTerminal({title:'No reused terminal'},{threadId}),refused);
 assert.equal(await identity.verifyLaunchTarget(target,{threadId}),target);await assert.rejects(identity.verifyLaunchTarget({...target},{threadId}),refused);
 await identity.startLaunchTerminal(target,'fixed reviewed bootstrap',{threadId});assert.equal(sends.length,1);assert.ok(sends[0].includes('fixed reviewed bootstrap'));
 await assert.rejects(identity.startLaunchTerminal(target,'fixed reviewed bootstrap',{threadId}),refused);assert.equal(sends.length,1);
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
