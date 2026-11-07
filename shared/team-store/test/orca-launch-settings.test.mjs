import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {openOrcaLaunchSettings,prepareOrcaMcpLaunch,applyOrcaMcpLaunch,codexMcpLaunchArguments} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/orca-launch-settings.mjs';

const settings=()=>({settings:{agentDefaultArgs:{codex:'--dangerously-bypass-approvals-and-sandbox',claude:'keep-other-agent'},agentPermission:{default:'full-access',overrides:{},userArgs:{codex:''}},agentChoices:{defaults:{codex:{model:'keep-model',options:{effort:'high'}}}}}});
test('MCP launch setup preserves Full access execution and all other agent preferences',()=>{
 const original=settings(),before=structuredClone(original),plan=prepareOrcaMcpLaunch(original);
 assert.deepEqual(original,before);assert.equal(plan.before,'');assert.equal(plan.summary.executionPermissionsChanged,false);
 assert.match(plan.after,/--sandbox danger-full-access/);assert.ok(!plan.after.includes('--dangerously-bypass'));
 assert.match(plan.after,/sandbox_approval=false,rules=false,mcp_elicitations=true,request_permissions=false,skill_approval=false/);
 assert.equal(plan.summary.otherPromptCategoriesEnabled,false);
 original.settings.agentPermission.userArgs.codex=plan.after;
 assert.equal(prepareOrcaMcpLaunch(original).summary.orcaLaunchConfigurationChanged,false);
 assert.equal(prepareOrcaMcpLaunch(original).summary.activeSessionPolicy,'not-inspected');
 assert.equal(prepareOrcaMcpLaunch(original).summary.requiresEffectivePolicyVerification,true);
});
test('unknown, narrower, or custom execution recipes are refused instead of overwritten',()=>{
 for(const change of [s=>s.agentPermission.default='ask',s=>s.agentPermission.overrides.codex='own',s=>s.agentPermission.userArgs.codex='-m custom-model',s=>s.agentDefaultArgs.codex='--full-auto']){
  const original=settings();change(original.settings);assert.throws(()=>prepareOrcaMcpLaunch(original),{code:'SETUP_ORCA_LAUNCH_REFUSED'});
 }
});
test('typed Orca launch update has an owned backup, readback, and no duplicate mutation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'orca-launch-setup-test-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const value=settings(),plan=prepareOrcaMcpLaunch(value);let mutations=0;
 const client={read:async()=>structuredClone(value),setCodexArguments:async args=>{mutations++;value.settings.agentPermission.userArgs.codex=args;}};
 const result=await applyOrcaMcpLaunch(plan,{client,backupRoot:root,projectRoot:'fixture-project'});
 assert.equal(result.status,'complete');assert.equal(mutations,1);
 const files=await readdir(root),backup=JSON.parse(await readFile(join(root,files[0]),'utf8'));
 assert.equal(backup.phase,'installed');assert.equal(backup.before,'');assert.equal(backup.after,codexMcpLaunchArguments);
 await applyOrcaMcpLaunch(prepareOrcaMcpLaunch(value),{client,backupRoot:root,projectRoot:'fixture-project'});assert.equal(mutations,1);
 await assert.rejects(applyOrcaMcpLaunch(plan,{client,backupRoot:root,projectRoot:'fixture-project'}),{code:'SETUP_ORCA_LAUNCH_REFUSED'});
 assert.equal(value.settings.agentDefaultArgs.claude,'keep-other-agent');assert.equal(value.settings.agentChoices.defaults.codex.model,'keep-model');
});
test('Orca settings integration uses fixed typed operations and refuses a changed native epoch',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'orca-launch-rpc-test-'));t.after(()=>rm(profile,{recursive:true,force:true}));
 const metadata={pid:42,runtimeId:'fixture-epoch',authToken:'fixture-only',transport:{kind:'named-pipe',endpoint:'\\\\.\\pipe\\fixture-only'}},seen=[];
 const value=settings();value.settings.agentPermission.userArgs.codex=codexMcpLaunchArguments;
 const connect=()=>{
  const socket=new EventEmitter();socket.setEncoding=()=>{};socket.destroy=()=>{};
  socket.write=line=>{const request=JSON.parse(line);assert.equal(request.authToken,'fixture-only');seen.push(request);
   queueMicrotask(()=>socket.emit('data',JSON.stringify({id:request.id,ok:true,result:request.method==='settings.getAgentLaunch'?value:{accepted:true},_meta:{runtimeId:metadata.runtimeId}})+'\n'));
  };queueMicrotask(()=>socket.emit('connect'));return socket;
 };
 const client=await openOrcaLaunchSettings({env:{ORCA_USER_DATA_PATH:profile,ORCA_WORKTREE_ID:'fixture-context'},read:async()=>JSON.stringify(metadata),connect,
  createHost:async()=>({runtimeId:'fixture-epoch',capabilities:['settings.agent-launch.v1'],cli:async()=>({app:{pid:42}})}),
 });
 await client.read();await client.setCodexArguments(codexMcpLaunchArguments);await client.resumeCodex('01a18fc1-a164-76b0-b83d-5421ca7db4a9');
 assert.deepEqual(seen.map(r=>r.method),['settings.getAgentLaunch','settings.mutateAgentLaunch','settings.getAgentLaunch','terminal.ensureAgentSession']);
 assert.deepEqual(seen[1].params,{type:'user-arguments',agent:'codex',value:codexMcpLaunchArguments});
 assert.equal(seen[3].params.providerSession.id,'01a18fc1-a164-76b0-b83d-5421ca7db4a9');assert.equal(seen[3].params.providerSession.key,'session_id');assert.equal(seen[3].params.worktree,'id:fixture-context');
 metadata.runtimeId='replaced';await assert.rejects(client.read(),{code:'SETUP_ORCA_LAUNCH_REFUSED'});
 await assert.rejects(client.resumeCodex('--invalid'),{code:'SETUP_ORCA_LAUNCH_REFUSED'});
});
