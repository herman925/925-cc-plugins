import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './dispatch-fixture.mjs';
import {createDispatchService} from '../src/local/dispatch.mjs';

test('on-demand Codex gets its team/member sidebar name once across polling and restart',async t=>{
 const f=await fixture(t,{childKind:'terminal',workerAgent:'codex'}),renames=[];
 const rpc=async(method,params,...rest)=>{
  if(method==='terminal.rename'){renames.push(params);return {rename:{handle:params.terminal,tabId:'child-tab',title:params.title}};}
  return f.rpc(method,params,...rest);
 };
 const service=()=>createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service().check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service().check(f.work.id);
 assert.deepEqual(renames,[{terminal:'structworker_child',title:`${f.team.name}/Worker-1`}]);
 assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');
 await service().check(f.work.id);await f.restart();await service().check(f.work.id);
 assert.equal(renames.length,1);
});

test('lost rename response is cosmetic and cannot overwrite a later manual name on restart',async t=>{
 const f=await fixture(t,{childKind:'terminal',workerAgent:'codex'});let renames=0;
 const rpc=async(method,...args)=>{if(method==='terminal.rename'){renames++;throw Error('Response lost after native rename');}return f.rpc(method,...args);};
 const service=()=>createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service().check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service().check(f.work.id);
 const attempt=f.store.listDispatches(f.work.id)[0];assert.equal(attempt.status,'running');assert.equal(attempt.sidebarNaming.outcome,'unconfirmed');
 await f.restart();await service().check(f.work.id);assert.equal(renames,1);
});

test('changed terminal incarnation is not renamed; exact identity can be checked again without relaunch',async t=>{
 const f=await fixture(t,{childKind:'terminal',workerAgent:'codex'});let changed=true;const renames=[];
 const rpc=async(method,params,...rest)=>{
  if(method==='terminal.rename'){renames.push(params);return {rename:{handle:params.terminal,tabId:'child-tab',title:params.title}};}
  const value=await f.rpc(method,params,...rest);
  if(changed&&method==='terminal.show'&&params.terminal==='structworker_child')value.terminal.incarnationId='different';
  return value;
 };
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);assert.equal(renames.length,0);assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');
 changed=false;await service.check(f.work.id);assert.equal(renames.length,1);
 assert.equal(f.messages.filter(text=>text.startsWith('TEAM_DISPATCH_PERMIT')).length,1);
});

test('prepared members keep their existing custom title and structured sessions are not renamed',async t=>{
 for(const options of [{childKind:'terminal',prestarted:true,preparedKind:'terminal'},{childKind:'structured'}]){
  const f=await fixture(t,options);let renames=0;
  const rpc=async(method,...args)=>{if(method==='terminal.rename'){renames++;throw Error('Existing title must remain');}return f.rpc(method,...args);};
  const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
  await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
  f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
  await service.check(f.work.id);assert.equal(f.store.listDispatches(f.work.id)[0].status,'running');assert.equal(renames,0);
 }
});

test('a concurrent member observation fences stale naming until a fresh check',async t=>{
 const f=await fixture(t,{childKind:'terminal',workerAgent:'codex'});let advance=true;const renames=[];
 const rpc=async(method,params,...rest)=>{
  if(method==='terminal.rename'){renames.push(params);return {rename:{handle:params.terminal,tabId:'child-tab',title:params.title}};}
  const value=await f.rpc(method,params,...rest);
  if(advance&&method==='terminal.show'&&params.terminal==='structworker_child'){
   advance=false;const attempt=f.store.readMemberDispatch(f.member.id);
   f.store.updateDispatch(attempt.id,attempt.version,{recovery:{state:'confirmed_effect',liveness:'live'}});
  }
  return value;
 };
 const service=createDispatchService({store:f.store,rpc,userData:f.profile,consent:async()=>{},works:f.works});
 await service.check(f.work.id);f.createIntent(f.store.readDispatchProtocol(f.work.id));
 f.onInput(text=>{if(text.startsWith('TEAM_DISPATCH_PERMIT'))f.start(JSON.parse(text.split('\n').slice(1).join('\n')));});
 await service.check(f.work.id);assert.equal(renames.length,0);
 await service.check(f.work.id);assert.equal(renames.length,1);
});
