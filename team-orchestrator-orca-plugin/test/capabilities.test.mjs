import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAdapter } from '../src/local/adapter.mjs';
import { createExecutor } from '../src/local/executor.mjs';
import { openTeamStore } from '../src/local/store.mjs';
import { DEFAULT_FORM } from '../src/team.mjs';
async function fixture(t, hostId = 'local') {
 const profile = await mkdtemp(join(tmpdir(), 'capabilities-'));
 const store = await openTeamStore({ userData: profile });
 const calls = []; let gates = 0, budget = Infinity; const internalKey = 'trusted-worker-secret';
 const cli = async () => ({ worktree: { id: 'folder:/selected', hostId, displayName: 'Selected' } });
 const executor = createExecutor({}, cli, { store, internalKey });
 const context = await executor.execute({ op: 'context', workspaceId: 'folder:/selected' });
 const state = (await executor.execute({ op: 'createTeam', params: { form: DEFAULT_FORM, selectionToken: context.selectionToken, requestId: 'team', expectedRevision: 0 } })).value;
 const sender = { id: 1, mainFrame: {}, isDestroyed: () => false }; const event = { sender, senderFrame: sender.mainFrame };
 const handlers = new Map([
  ['plugins:readPanelEntry', async () => ({ sessionToken: 'panel-token' })],
  ['plugins:panelAction', async () => ++gates > budget ? { ok: false, code: 'rate_limited', error: 'Panel request limit exceeded' } : { ok: true, value: {} }],
  ['plugins:invokeCommand', async (_event, args) => executor.execute(args.args)],
  ['runtime:call', async (actual, { method, params }) => {
   assert.equal(actual, event); calls.push({ method, params });
   const result = method === 'status.get' ? { runtimeId: 'runtime-one', capabilities: ['agent.launch.v2', 'agent.launch.replay-required.v1', 'agent-session.structured.v1', 'agent-session.structured.registered-agents.v1'] }
    : method === 'settings.get' ? { settings: { defaultTuiAgent: 'claude', disabledTuiAgents: [], agentDefaultEnv: { claude: { SECRET: 'do-not-expose' } }, agentDefaultArgs: { claude: '--secret-arg' } } }
    : method === 'ssh.getState' ? { state: { status: 'connected', targetId: 'build host', connectionGeneration: 1 } }
    : method.startsWith('preflight.') ? ['codex', 'claude']
    : method === 'terminal.list' ? { terminals: [{ handle: 'existing-cli', incarnationId: 'existing-instance', worktreeId: 'folder:/selected', executionHostId: hostId, connected: true, agentIdentity: 'codex' }] }
    : method === 'terminal.agentStatus' ? { agentStatus: { handle: params.terminal, isRunningAgent: true, status: 'working' } }
    : method === 'session.tabs.list' ? { worktree: 'folder:/selected', tabs: [] }
    : method === 'agentSession.restartResumable' ? { sessions: [], failed: [] }
    : method === 'agentSession.agents' ? { agents: [{ agent: 'codex', capabilities: { contextUsage: true } }, { agent: 'claude', capabilities: {} }] }
    : method === 'agentSession.createSupport' ? { supported: true, seedOptions: { model: 'saved-pick' } }
    : method === 'agentSession.modelCatalog' ? { origin: 'probe', fetchedAt: Date.now(), models: [{ id: params.agent === 'codex' ? 'codex-model' : 'claude-model', label: 'Host model', isDefault: false, efforts: [{ value: params.agent === 'codex' ? 'ultra' : 'max', label: 'High effort' }] }] }
    : (() => { throw Error(`Unexpected native method ${method}`); })();
   return { id: 'desktop-ipc', ok: true, result };
  }]
 ]);
 const electron = { ipcMain: { _invokeHandlers: handlers, removeHandler: name => handlers.delete(name), handle: (name, fn) => handlers.set(name, fn) } };
 await installAdapter(electron, { identity: profile, version: 'test', internalKey });
 await handlers.get('plugins:readPanelEntry')(event, { pluginKey: 'herman925.team-orchestrator', panelId: 'team' });
 t.after(async () => { globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore(); store.close(); await rm(profile, { recursive: true, force: true }); });
 const send = args => handlers.get('plugins:panelAction')(event, { sessionToken: 'panel-token', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'nonce', commandId: 'team.control', args } } });
 return { store, executor, send, calls, team: state.teams[0], handlers, event, limit: value => { budget = value; gates = 0; } };
}
test('panel capability read uses its genuine event and saved scope, then validates member overrides against host-specific choices', async t => {
 const f = await fixture(t);
 const response = await f.send({ op: 'capabilities', params: { teamId: f.team.id } });
 assert.equal(response.ok, true, response.error);
 const caps = response.value;
 assert.equal(caps.executionHostId, 'local');
 assert.deepEqual(caps.agents.codex.models[0].efforts.map(row => row.value), ['ultra']);
 assert.deepEqual(caps.agents.claude.configured, {});
 assert.equal(caps.agents.claude.configuredSource, null);
 assert.equal(JSON.stringify(caps).includes('do-not-expose'), false);
 assert.equal(JSON.stringify(caps).includes('trusted-worker-secret'), false);
 assert.equal(f.calls.filter(row => row.method === 'agentSession.modelCatalog').every(row => row.params.worktree === 'folder:/selected'), true);
 const input = { requestId: 'override', expectedRevision: 1, teamId: f.team.id, memberId: f.team.members[1].id, agent: 'claude', model: 'claude-model', effort: 'max' };
 const updated = await f.send({ op: 'updateAgentPreferences', params: input });
 assert.equal(updated.ok, true, updated.error);
 assert.equal(updated.value.value.teams[0].members[1].effort, 'max');
 const invalid = await f.send({ op: 'updateAgentPreferences', params: { ...input, requestId: 'bad', expectedRevision: 2, effort: 'ultra' } });
 assert.equal(invalid.ok, false); assert.match(invalid.error, /effort.*not supported/i);
 await assert.rejects(f.executor.execute({ op: '_capabilityResult', params: { observationId: 'made-up', value: caps } }), /authority/i);
 const forged = await f.send({ op: '_capabilityResult', internalKey: 'trusted-worker-secret', params: {} });
 assert.equal(forged.ok, false);
});
test('SSH discovery follows the saved encoded target and keeps unknown model overrides separate from inherited defaults', async t => {
 const f = await fixture(t, 'ssh:build%20host');
 const result = await f.send({ op: 'capabilities', params: { teamId: f.team.id, workspaceId: 'another-focus' } });
 assert.equal(result.ok, true, result.error);
 assert.equal(result.value.agents.codex.catalogStatus, 'unknown');
 assert.equal(f.calls.some(row => row.method === 'agentSession.modelCatalog'), false);
 assert.equal(f.calls.find(row => row.method === 'preflight.detectRemoteAgents').params.connectionId, 'build host');
 const base = { requestId: 'default', expectedRevision: 1, teamId: f.team.id, memberId: f.team.members[1].id, agent: 'claude', model: 'default', effort: 'default' };
 assert.equal((await f.send({ op: 'updateAgentPreferences', params: base })).ok, true);
 const override = await f.send({ op: 'updateAgentPreferences', params: { ...base, requestId: 'remote-pick', expectedRevision: 2, model: 'desktop-only' } });
 assert.equal(override.ok, false); assert.match(override.error, /not verified/);
});
test('disconnected SSH and revoked panel authority never produce a usable capability proof', async t => {
 const f = await fixture(t, 'ssh:build');
 const runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, request) => request.method === 'ssh.getState' ? { ok: true, result: { state: { status: 'disconnected' } } } : runtime(event, request));
 const result = await f.send({ op: 'capabilities', params: { teamId: f.team.id } });
 assert.equal(result.value.connection, 'unavailable');
 assert.equal(result.value.agents.codex.availability, 'unknown');
 assert.equal(f.calls.some(row => row.method.startsWith('preflight.')), false);
 const denied = await f.send({ op: 'capabilities', params: { teamId: f.team.id }, internalKey: 'forged' });
 assert.equal(denied.ok, false);
});

test('capability refresh respects the pinned 30-call admission budget and preserves rate refusal codes', async t => {
 const f = await fixture(t); f.limit(30);
 for (let i = 0; i < 3; i++) assert.equal((await f.send({ op: 'capabilities', params: { teamId: f.team.id } })).ok, true);
 const denied = await f.send({ op: 'capabilities', params: { teamId: f.team.id } });
 assert.equal(denied.ok, false); assert.equal(denied.code, 'rate_limited');
 f.limit(4);
 const midway = await f.send({ op: 'capabilities', params: { teamId: f.team.id } });
 assert.equal(midway.ok, false); assert.equal(midway.code, 'rate_limited');
});
test('a failed refresh invalidates older host proof instead of allowing an explicit override with stale evidence', async t => {
 const f = await fixture(t);
 assert.equal((await f.send({ op: 'capabilities', params: { teamId: f.team.id } })).ok, true);
 f.limit(4);
 assert.equal((await f.send({ op: 'capabilities', params: { teamId: f.team.id } })).code, 'rate_limited');
 f.limit(Infinity);
 const saved = await f.send({ op: 'updateAgentPreferences', params: { requestId: 'after-failure', expectedRevision: 1, teamId: f.team.id, memberId: f.team.members[0].id, agent: 'codex', model: 'codex-model', effort: 'ultra' } });
 assert.equal(saved.ok, false); assert.match(saved.error, /unavailable|stale/);
});
test('changed host catalogs preserve saved requested choices and reject new unsupported requests without silently defaulting', async t => {
 const f = await fixture(t);
 await f.send({ op: 'capabilities', params: { teamId: f.team.id } });
 const input = { requestId: 'old-pick', expectedRevision: 1, teamId: f.team.id, memberId: f.team.members[0].id, agent: 'codex', model: 'codex-model', effort: 'ultra' };
 assert.equal((await f.send({ op: 'updateAgentPreferences', params: input })).ok, true);
 const runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, request) => request.method === 'agentSession.modelCatalog' ? { ok: true, result: { origin: 'probe', fetchedAt: Date.now(), models: [] } } : runtime(event, request));
 await f.send({ op: 'capabilities', params: { teamId: f.team.id } });
 const changed = await f.send({ op: 'updateAgentPreferences', params: { ...input, requestId: 'now-unsupported', expectedRevision: 2 } });
 assert.equal(changed.ok, false); assert.match(changed.error, /not supported/);
 assert.equal(f.store.readSnapshot().teams[0].members[0].model, 'codex-model');
 assert.equal((await f.send({ op: 'updateAgentPreferences', params: input })).ok, true, 'completed request replay precedes capability revalidation');
});

test('a model listing in progress stays unknown and allows inherited defaults only', async t => {
 const f = await fixture(t), runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, request) => request.method === 'agentSession.modelCatalog' ? {ok:true,result:{origin:'unknown',listingInProgress:true}} : runtime(event, request));
 const result = await f.send({op:'capabilities',params:{teamId:f.team.id}});
 assert.equal(result.value.agents.codex.listingInProgress,true);
 assert.equal(result.value.agents.codex.catalogStatus,'unknown');
 assert.deepEqual(result.value.agents.codex.models,[]);
 const input={requestId:'listing-default',expectedRevision:1,teamId:f.team.id,memberId:f.team.members[0].id,agent:'codex',model:'default',effort:'default'};
 assert.equal((await f.send({op:'updateAgentPreferences',params:input})).ok,true);
 const denied=await f.send({op:'updateAgentPreferences',params:{...input,requestId:'unverified-model',expectedRevision:2,model:'guessed-model'}});
 assert.equal(denied.ok,false);assert.match(denied.error,/not verified/);
});

for (const agent of ['codex', 'claude']) test(`a single busy ${agent} terminal warms Orca's catalog host and reads both launch-account catalogs without sending input`, async t => {
 const f = await fixture(t), runtime = f.handlers.get('runtime:call');
 let installed = false;
 f.handlers.set('runtime:call', async (event, request) => {
  if (request.method === 'terminal.list') return {ok:true,result:{terminals:[{handle:'busy-cli',incarnationId:'busy-instance',worktreeId:'folder:/selected',executionHostId:'local',connected:true,agentIdentity:agent,status:'working'}]}};
  if (request.method === 'agentSession.restartResumable') { installed = true; return {ok:true,result:{sessions:[{sessionId:'private-restart-offer'}],failed:[]}}; }
  if (request.method === 'agentSession.modelCatalog') {
   assert.equal(Object.hasOwn(request.params,'sessionId'),false);
   if (!installed) return {ok:false,error:{code:'runtime_error',message:'structured_agent_session_unsupported'}};
  }
  return runtime(event,request);
 });
 const result = await f.send({op:'capabilities',params:{teamId:f.team.id}});
 assert.equal(result.ok,true,result.error);
 assert.deepEqual(result.value.session,{status:'ready',kind:'terminal',agent});
 assert.deepEqual(Object.values(result.value.agents).map(a=>a.catalogStatus),['known','known']);
 assert.equal(JSON.stringify(result).includes('private-restart-offer'),false);
 assert.equal(f.calls.some(c=>/send|Continue|Dismiss|\.create$|\.ensure$/.test(c.method)),false);
});

for (const variant of ['missing','closed','wrong-project','wrong-host','orphaned','agent-exited']) test(`${variant} terminal cannot supply a session prerequisite or a model catalog`, async t => {
 const f=await fixture(t),runtime=f.handlers.get('runtime:call');
 f.handlers.set('runtime:call',async(event,request)=>request.method==='terminal.list'?{ok:true,result:{terminals:variant==='missing'?[]:[{handle:'stale-cli',incarnationId:'stale-instance',worktreeId:variant==='wrong-project'?'folder:/other':'folder:/selected',executionHostId:variant==='wrong-host'?'ssh:other':'local',connected:variant!=='closed',orphaned:variant==='orphaned',agentIdentity:'codex'}]}}:variant==='agent-exited'&&request.method==='terminal.agentStatus'?{ok:true,result:{agentStatus:{handle:request.params.terminal,isRunningAgent:false}}}:runtime(event,request));
 const result=await f.send({op:'capabilities',params:{teamId:f.team.id}});
 assert.equal(result.ok,true,result.error);assert.equal(result.value.session.status,'missing');
 assert.equal(f.calls.some(c=>['agentSession.modelCatalog','agentSession.restartResumable'].includes(c.method)),false);
 assert.deepEqual(result.value.agents.codex.models,[]);
 const selected=await f.executor.execute({op:'context',workspaceId:'folder:/selected'});
 await assert.rejects(f.executor.execute({op:'createTeam',params:{form:{...DEFAULT_FORM,name:'New-session-team',sessionMode:true},selectionToken:selected.selectionToken,requestId:'blocked-team',expectedRevision:1}}),/Open a Codex or Claude Code session/);
 assert.equal(f.store.readSnapshot().teams.length,1);
});

test('an open structured tab establishes the prerequisite without using its pinned account for a new team', async t=>{
 const f=await fixture(t),runtime=f.handlers.get('runtime:call');
 f.handlers.set('runtime:call',async(event,request)=>request.method==='terminal.list'?{ok:true,result:{terminals:[]}}:request.method==='session.tabs.list'?{ok:true,result:{worktree:'folder:/selected',tabs:[{type:'agent-session',sessionId:'claude:real-chat',agent:'claude'}]}}:runtime(event,request));
 const result=await f.send({op:'capabilities',params:{teamId:f.team.id}});
 assert.equal(result.ok,true,result.error);assert.deepEqual(result.value.session,{status:'ready',kind:'structured',agent:'claude'});
 assert.equal(f.calls.filter(c=>c.method==='agentSession.modelCatalog').every(c=>!Object.hasOwn(c.params,'sessionId')),true);
});

test('unverifiable inventories and a runtime change discard session and model evidence',async t=>{
 const f=await fixture(t),runtime=f.handlers.get('runtime:call');let reads=0;
 f.handlers.set('runtime:call',async(event,request)=>request.method==='status.get'&&++reads===2?{ok:true,result:{runtimeId:'new-runtime'}}:runtime(event,request));
 const result=await f.send({op:'capabilities',params:{teamId:f.team.id}});
 assert.equal(result.value.connection,'unavailable');assert.equal(result.value.session.status,'unknown');assert.deepEqual(result.value.agents.codex.models,[]);
 f.handlers.set('runtime:call',async(event,request)=>request.method==='terminal.list'?{ok:false,error:{code:'host_unavailable'}}:request.method==='session.tabs.list'?{ok:true,result:{worktree:'folder:/selected',tabs:[],agentSessionsUnverifiable:true}}:runtime(event,request));
 assert.equal((await f.send({op:'capabilities',params:{teamId:f.team.id}})).value.session.status,'unknown');
});

test('failed host initialization retains a diagnostic code and does not invent models or another session',async t=>{
 const f=await fixture(t),runtime=f.handlers.get('runtime:call');
 f.handlers.set('runtime:call',async(event,request)=>['agentSession.restartResumable','agentSession.modelCatalog'].includes(request.method)?{ok:false,error:{code:'runtime_error',message:'structured_agent_session_unsupported'}}:runtime(event,request));
 const result=await f.send({op:'capabilities',params:{teamId:f.team.id}});
 assert.equal(result.value.session.status,'ready');assert.equal(result.value.agents.codex.catalogStatus,'unknown');
 assert.equal(result.value.agents.codex.catalogError,'structured_agent_session_unsupported');assert.deepEqual(result.value.agents.codex.models,[]);
});

test('a session closed between new-team save and launch prevents reserving or starting a member',async t=>{
 const f=await fixture(t);
 await f.send({op:'capabilities',params:{teamId:f.team.id}});
 const selected=await f.executor.execute({op:'context',workspaceId:'folder:/selected'});
 const created=await f.executor.execute({op:'createTeam',params:{form:{...DEFAULT_FORM,name:'Session-required',sessionMode:true},selectionToken:selected.selectionToken,requestId:'new-team',expectedRevision:1}});
 const team=created.value.teams.at(-1),head=team.members.find(m=>!m.boss),runtime=f.handlers.get('runtime:call');
 f.handlers.set('runtime:call',async(event,request)=>request.method==='terminal.list'?{ok:true,result:{terminals:[]}}:runtime(event,request));
 const result=await f.send({op:'launchSupervisor',params:{teamId:team.id,memberId:head.id,requestId:'must-not-launch',configVersion:team.configVersion}});
 assert.equal(result.ok,false);assert.match(result.error,/Open a Codex or Claude Code session/);
 assert.equal(f.store.readOperation('must-not-launch'),null);assert.equal(f.calls.some(c=>c.method==='agent.launchReplay'),false);
});
