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
   const result = method === 'status.get' ? { runtimeId: 'runtime-one', capabilities: ['agent.launch.v2', 'agent.launch.replay-required.v1', 'agent-session.structured.registered-agents.v1'] }
    : method === 'settings.get' ? { settings: { defaultTuiAgent: 'claude', disabledTuiAgents: [], agentDefaultEnv: { claude: { SECRET: 'do-not-expose' } }, agentDefaultArgs: { claude: '--secret-arg' } } }
    : method === 'ssh.getState' ? { state: { status: 'connected', targetId: 'build host', connectionGeneration: 1 } }
    : method.startsWith('preflight.') ? ['codex', 'claude']
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
 assert.equal(caps.agents.claude.configured.model, 'saved-pick');
 assert.equal(JSON.stringify(caps).includes('do-not-expose'), false);
 assert.equal(JSON.stringify(caps).includes('trusted-worker-secret'), false);
 assert.equal(f.calls.filter(row => row.method === 'agentSession.createSupport').every(row => row.params.worktree === 'folder:/selected'), true);
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
