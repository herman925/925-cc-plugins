import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpath,mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {nativeProjectRoot,verifySetupHost,setupHostMode} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-host.mjs';
const env={ORCA_TERMINAL_HANDLE:'term-fixture',ORCA_WORKTREE_ID:'context-fixture',CODEX_THREAD_ID:'conversation-fixture'};
test('host access denial keeps its cause and stage instead of saying the project was not found',async()=>{for(const code of ['EPERM','EACCES'])await assert.rejects(nativeProjectRoot({env,createHost:async()=>{throw Object.assign(Error('private metadata must not leak'),{code});}}),e=>e.code==='SETUP_HOST_ACCESS_DENIED'&&e.message.includes('project discovery')&&!e.message.includes('private metadata'));});
test('missing host installation and native verification refusals remain distinct',async()=>{await assert.rejects(nativeProjectRoot({env,createHost:async()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});}}),e=>e.code==='SETUP_HOST_UNAVAILABLE');await assert.rejects(verifySetupHost('fixture',{env,createHost:async()=>{throw Object.assign(Error('Orca runtime changed during verification.'),{code:'API_NATIVE_UNVERIFIED'});}}),e=>e.code==='SETUP_HOST_UNVERIFIED'&&e.message.includes('runtime changed')&&e.message.includes('conversation/project'));});
test('a failed host subprocess preserves denied/exit classification without printing private stderr',async()=>{for(const stderr of ['runtime_access_denied: private-token','Access is denied: private-token'])await assert.rejects(nativeProjectRoot({env,createHost:async()=>{throw Object.assign(Error('failed'),{code:1,stderr});}}),e=>e.code==='SETUP_HOST_ACCESS_DENIED'&&!e.message.includes('private-token'));await assert.rejects(nativeProjectRoot({env,createHost:async()=>{throw Object.assign(Error('failed'),{code:2,stderr:'private-token'});}}),e=>e.code==='SETUP_HOST_COMMAND_FAILED'&&e.message.includes('exit 2')&&!e.message.includes('private-token'));});
test('project discovery refuses a changed or incomplete local terminal scope',async()=>{for(const patch of [{worktreeId:'other'},{connected:false},{handle:'other'},{executionHostId:'remote'}])await assert.rejects(nativeProjectRoot({env,createHost:async()=>({rpc:async()=>({terminal:{handle:env.ORCA_TERMINAL_HANDLE,connected:true,executionHostId:'local',worktreeId:env.ORCA_WORKTREE_ID,worktreePath:process.cwd(),...patch}})})}),e=>e.code==='SETUP_HOST_SCOPE');});
test('verified host discovery retains exact project/conversation authority and requires native scope',async()=>{const root=await realpath(process.cwd());const createHost=async()=>({rpc:async(method,params)=>{assert.equal(method,'terminal.show');assert.equal(params.terminal,env.ORCA_TERMINAL_HANDLE);return {terminal:{handle:env.ORCA_TERMINAL_HANDLE,connected:true,executionHostId:'local',worktreeId:env.ORCA_WORKTREE_ID,worktreePath:root}};},verifyTerminal:async(input,provider)=>{assert.equal(provider,'codex');assert.deepEqual(input,{projectRoot:root,conversationId:env.CODEX_THREAD_ID,terminalHandle:env.ORCA_TERMINAL_HANDLE,contextId:env.ORCA_WORKTREE_ID});}});assert.equal(await nativeProjectRoot({env,createHost}),root);await verifySetupHost(root,{env,createHost});await assert.rejects(verifySetupHost(root,{env:{},createHost}),e=>e.code==='SETUP_HOST_UNSUPPORTED');});

test('partial Orca scope is never treated as independent fallback',async()=>{
 assert.equal(setupHostMode({env:{}}),'independent');
 for(const partial of [{ORCA_TERMINAL_HANDLE:'partial'},{ORCA_WORKTREE_ID:'partial'}]){assert.equal(setupHostMode({env:partial}),'orca');await assert.rejects(nativeProjectRoot({env:partial}),{code:'SETUP_HOST_UNSUPPORTED'});}
 assert.equal(setupHostMode({env,hostMode:'independent'}),'independent');assert.throws(()=>setupHostMode({hostMode:'guess'}),{code:'SETUP_INPUT'});
});
async function independentFixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-setup-identity-'))),project=join(root,'project'),home=join(root,'home'),executable=join(root,'codex.exe'),threadId=randomUUID();
 await mkdir(project);await mkdir(join(home,'thread-writer-locks'),{recursive:true});await writeFile(executable,'not executable; process proof is injected');await writeFile(join(home,'thread-writer-locks',threadId+'.lock'),'');
 let birth='123',reads=0,closed=0;const options={env:{CODEX_HOME:home,CODEX_THREAD_ID:threadId},codexExecutable:executable,discoverExecutable:async()=>executable,threadOwners:async()=>[{pid:123,createdAt:birth}],inspectProcess:async()=>({pid:123,createdAt:birth,executable}),createInspector:()=>({inspect:async id=>{reads++;assert.equal(id,threadId);return {threadId,projectRoot:project};},close:async()=>closed++})};
 return {root,project,options,reads:()=>reads,closed:()=>closed,setBirth:value=>birth=value};
}
test('independent setup uses the native writer and metadata inspector instead of environment cwd',async()=>{
 const f=await independentFixture();assert.equal(await nativeProjectRoot(f.options),f.project);assert.equal(f.closed(),1);
 const proof=await verifySetupHost(f.project,f.options);assert.equal(proof.hostMode,'independent');assert.match(proof.contextId,/^project:[a-f0-9]{64}$/);assert.equal(f.closed(),2);
 await assert.rejects(verifySetupHost(f.root,f.options),{code:'SETUP_HOST_SCOPE'});assert.equal(f.closed(),3);
});
test('independent setup refuses ownership changes while inspecting and always closes its inspector',async()=>{
 const f=await independentFixture(),createInspector=f.options.createInspector;
 f.options.createInspector=()=>{const inspector=createInspector();return {...inspector,inspect:async id=>{const result=await inspector.inspect(id);f.setBirth('456');return result;}};};
 await assert.rejects(nativeProjectRoot(f.options),{code:'SETUP_HOST_UNVERIFIED'});assert.equal(f.closed(),1);
});
