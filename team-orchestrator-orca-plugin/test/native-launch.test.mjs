import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installAdapter } from '../src/local/adapter.mjs';
import { createExecutor } from '../src/local/executor.mjs';
import { openTeamStore } from '../src/local/store.mjs';
import { nativeLaunchFingerprint } from '../src/local/native-launch-ledger.mjs';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_FORM } from '../src/team.mjs';
async function fixture(t, { kind = 'terminal', agent = 'codex', launchMode = 'on-demand', form = {}, depth = 1 } = {}) {
 const profile = await mkdtemp(join(tmpdir(), 'native-launch-'));
 let store = await openTeamStore({ userData: profile });
 const calls = [], cliCalls = []; const internalKey = 'private-launch-key';
 const cli = async argv => { cliCalls.push(argv); assert.equal(argv[0], 'worktree'); return { worktree: { id: 'folder:/saved', hostId: 'local', displayName: 'Saved' } }; };
 let executor = createExecutor({call:async()=>{}}, cli, { store, internalKey, userData: profile });
 const selected = await executor.execute({ op: 'context', workspaceId: 'folder:/saved' });
 const state = (await executor.execute({ op: 'createTeam', params: { form: { ...DEFAULT_FORM, ...form, launchMode, agents: [agent, 'codex', 'codex'] }, selectionToken: selected.selectionToken, requestId: 'create', expectedRevision: 0 } })).value;
 const team = state.teams[0], member = team.members.find(row => !row.boss);
 const input = { teamId: team.id, memberId: member.id, requestId: 'launch-root', configVersion: team.configVersion };
 const notifications=[];
 const sender = { id: 1, mainFrame: {}, isDestroyed: () => false,send:(channel,value)=>notifications.push({channel,value}) }, event = { sender, senderFrame: sender.mainFrame };
 const recordNative = (request, result) => {
  const db = new DatabaseSync(join(profile, 'agent-session-journal.db'));
  db.exec('PRAGMA user_version=4; CREATE TABLE IF NOT EXISTS agent_session_operations (operation_key TEXT PRIMARY KEY,row_json TEXT NOT NULL)');
  const row = { callerKey: 'trusted-local:desktop', operationId: request.operationId, fingerprint: nativeLaunchFingerprint(request), operationTimestamp: Number(request.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 86400000, outcome: { status: 'succeeded', sessionId: result.outcome?.sessionId ?? '', launch: result } };
  db.prepare('INSERT OR REPLACE INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${request.operationId}`, JSON.stringify(row)); db.close();
 };
 let effect = async params => ({ worktreeId: 'folder:/saved', outcome: kind === 'structured' ? { kind, handle: 'session-handle', sessionId: 'codex:fixture-session', tabId: 'chat-tab' } : { kind, handle: 'native-handle', paneKey: 'native-tab:native-leaf' }, receipt: { mode: kind, preferred: kind, reason: 'user_default', detail: 'Orca chose saved mode' }, prompt: { delivery: 'submit', outcome: kind === 'structured' ? 'journaled' : 'handed-to-terminal', ...(kind === 'structured' ? { messageId: 'native-message' } : {}) } });
 let enabled = true, gates = 0, budget = Infinity;let depthSettings={nestedWorkerMaxDepth:depth,keepSetting:'unchanged'};
 const handlers = new Map([
  ['settings:get', actual=>{assert.equal(actual,event);calls.push({method:'settings:get'});return {...depthSettings};}],
  ['settings:set', async(actual,params)=>{assert.equal(actual,event);assert.deepEqual(params,{nestedWorkerMaxDepth:2});calls.push({method:'settings:set',params});depthSettings={...depthSettings,...params};return {...depthSettings};}],
  ['plugins:readPanelEntry', async () => ({ sessionToken: 'token' })],
  ['plugins:panelAction', async () => ++gates > budget ? { ok: false, code: 'rate_limited' } : enabled ? { ok: true } : { ok: false, code: 'consent_required' }],
  ['plugins:invokeCommand', async (actual, args) => { assert.equal(actual, event); return executor.execute(args.args); }],
  ['runtime:call', async (actual, { method, params }) => {
   assert.equal(actual, event); calls.push({ method, params });
   let result;
   if (method === 'status.get') result = { runtimeId: 'runtime', capabilities: ['agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1', 'agent-session.structured.registered-agents.v1'] };
   else if (method === 'settings.get') result = { settings: {} };
   else if (method === 'terminal.list') result = { terminals: [{ handle: 'existing-cli', incarnationId: 'existing-instance', worktreeId: 'folder:/saved', executionHostId: 'local', connected: true, agentIdentity: agent }] };
   else if (method === 'preflight.detectAgents') result = ['codex', 'claude'];
   else if (method === 'agentSession.agents') result = { agents: [] };
   else if (method === 'agentSession.createSupport') result = { supported: true };
   else if (method === 'agentSession.modelCatalog') result = { origin: 'unknown' };
   else if (method === 'agent.launchReplay') { const saved = store.readSnapshot().teams[0].launch.members; const operation=Object.values(saved).map(row=>store.readOperation(row.requestId)).find(row=>row.nativeRequest.operationId===params.operationId); assert.equal(operation.nativeRequest.operationId, params.operationId, 'intent must be durable before native effect'); assert.equal(operation.status, 'unknown'); result = await effect(params); recordNative(params, result); }
   else if (method === 'terminal.rename') { assert.equal(store.readOperation(input.requestId).status, 'created', 'identity must be durable before naming'); result = { rename: { handle: params.terminal, tabId: 'native-tab', title: params.title } }; }
   else if (method === 'terminal.show') result = { terminal: { handle: 'native-handle', worktreeId: 'folder:/saved', executionHostId: 'local', tabId: 'native-tab', leafId: 'native-leaf', agentWait: null } };
   else if (method === 'terminal.agentStatus') result = { agentStatus: { handle: params.terminal, isRunningAgent: true, status: 'permission' } };
   else if (method === 'terminal.focus') result = { focus: { handle: params.terminal } };
   else if (method === 'agentSession.reveal') result = { ok: true, sessionId: params.sessionId, workspaceId: 'folder:/saved', agent, readable: true };
   else if (method === 'orchestration.sessionAddress') result = { orcaSessionId: 'orca_session_id:fixture' };
   else if (method === 'orchestration.partyLocation') result = { location: { kind: 'chat', sessionId: 'codex:fixture-session', worktreeId: 'folder:/saved' } };
   else throw Error(`Unexpected method ${method}`);
   return { ok: true, result };
  }]
 ]);
 await installAdapter({ ipcMain: { _invokeHandlers: handlers, removeHandler: name => handlers.delete(name), handle: (name, fn) => handlers.set(name, fn) } }, { identity: profile, internalKey, version: 'test' });
 t.after(async () => { globalThis[Symbol.for('herman925.team-orchestrator.adapter')]?.restore(); store.close(); await rm(profile, { recursive: true, force: true }); });
 const send = (op, params = input) => handlers.get('plugins:panelAction')(event, { sessionToken: 'token', action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'nonce', commandId: 'team.control', args: { op, params } } } });
 return { send, calls, notifications, cliCalls, input, team, profile, handlers, recordNative, settings:()=>({...depthSettings}), budget: value => { budget = value; gates = 0; }, gateCount: () => gates, executor: () => executor, store: () => store, effect: fn => { effect = fn; }, revoke: () => { enabled = false; }, restart: async () => { store.close(); store = await openTeamStore({ userData: profile }); executor = createExecutor({call:async()=>{}}, cli, { store, internalKey, userData: profile }); } };
}
test('three-level launch raises native depth before reserving or opening the first member',async t=>{
 const f=await fixture(t,{launchMode:'all',form:{levels:3,leadCount:2,workersPerLead:4}});
 const original=f.handlers.get('settings:set');f.handlers.set('settings:set',(event,params)=>{assert.equal(f.store().listOperations().length,0);return original(event,params);});
 const result=await f.send('launchSupervisor');assert.equal(result.ok,true,result.error);assert.equal(f.team.members.length,11);
 assert.equal(f.settings().nestedWorkerMaxDepth,2);assert.equal(f.settings().keepSetting,'unchanged');
 assert.deepEqual(f.notifications,[{channel:'settings:changed',value:{nestedWorkerMaxDepth:2}}]);
 assert.ok(f.calls.findIndex(c=>c.method==='settings:set')<f.calls.findIndex(c=>c.method==='agent.launchReplay'));
 assert.equal(f.calls.filter(c=>c.method==='settings:set').length,1);
 const repeated=await f.send('launchSupervisor');assert.equal(repeated.ok,true);assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').length,1);
 await f.send('recoverLaunch');assert.equal(f.calls.filter(c=>c.method==='settings:set').length,1);
});
test('a higher native depth is preserved when preparing a three-level roster',async t=>{
 const f=await fixture(t,{depth:5,form:{levels:3,leadCount:2,workersPerLead:1}});
 const result=await f.send('launchSupervisor');assert.equal(result.ok,true,result.error);assert.equal(f.settings().nestedWorkerMaxDepth,5);assert.equal(f.calls.some(c=>c.method==='settings:set'),false);
});
test('missing or unconfirmed native depth prevents reservations and provider launches',async t=>{
 for(const mode of ['missing','unconfirmed','denied']){
  const f=await fixture(t,{form:{levels:3,leadCount:2,workersPerLead:1}});
  if(mode==='missing')f.handlers.delete('settings:set');else if(mode==='denied')f.handlers.set('settings:set',()=>{throw Error('Native settings refused');});else f.handlers.set('settings:set',()=>({nestedWorkerMaxDepth:1}));
  const result=await f.send('launchSupervisor');assert.equal(result.ok,false);assert.match(result.error,/dispatch depth/);assert.equal(result.code,'dispatch_depth_unavailable');
  assert.equal(f.store().listOperations().length,0);assert.equal(f.calls.some(c=>c.method==='agent.launchReplay'),false);
 }
});
test('an already-prepared team can repair its depth without relaunching or changing its roster',async t=>{
 const f=await fixture(t,{form:{levels:3,leadCount:2,workersPerLead:1}}),before=f.store().readSnapshot();
 const result=await f.send('ensureTeamDepth',{teamId:f.team.id,configVersion:f.team.configVersion});assert.equal(result.ok,true,result.error);assert.equal(result.value.observedDepth,2);
 assert.deepEqual(f.store().readSnapshot(),before);assert.equal(f.store().listOperations().length,0);assert.equal(f.calls.some(c=>c.method==='agent.launchReplay'),false);
 const again=await f.send('ensureTeamDepth',{teamId:f.team.id,configVersion:f.team.configVersion});assert.equal(again.value.adjusted,false);assert.equal(f.calls.filter(c=>c.method==='settings:set').length,1);
});
test('invalid or stale team selections cannot authorize a settings mutation',async t=>{
 const f=await fixture(t,{form:{levels:3,leadCount:2,workersPerLead:1}});
 for(const params of [{teamId:'missing',configVersion:1},{teamId:f.team.id,configVersion:0},{teamId:f.team.id,configVersion:1,requiredDepth:9}])assert.equal((await f.send('ensureTeamDepth',params)).ok,false);
 assert.equal(f.calls.some(c=>c.method==='settings:set'),false);
});
test('saved supervisor launches through genuine native IPC after durable intent, inherits configuration and persists identity before followups', async t => {
 const f = await fixture(t);
 const response = await f.send('launchSupervisor');
 assert.equal(response.ok, true, response.error);
 assert.equal(response.value.status, 'created');
 const request = f.calls.find(row => row.method === 'agent.launchReplay').params;
 assert.match(request.operationId, /^\d{13}-[a-f0-9]{32}$/);
 assert.equal(request.agent, 'codex'); assert.equal(request.target.worktree, 'folder:/saved');
 assert.equal(Object.hasOwn(request, 'agentArgs'), false); assert.equal(Object.hasOwn(request, 'sessionOptions'), false);
 assert.match(request.prompt.text, /Role version: 1/);
 assert.equal(response.value.observation.state, 'permission');
 assert.equal(JSON.stringify(response).includes('private-launch-key'), false);
 assert.equal((await f.send('launchSupervisor')).value.handle, 'native-handle');
 assert.equal(f.calls.filter(row => row.method === 'agent.launchReplay').length, 1);
 assert.equal(f.store().readSnapshot().teams[0].launch.members[f.input.memberId].terminalId, 'native-handle');
});
for (const agent of ['codex', 'claude']) test(`${agent} structured receipt preserves its actual session and opens only that saved session`, async t => {
 const f = await fixture(t, { kind: 'structured', agent });
 const result = await f.send('launchSupervisor');
 assert.equal(result.value.kind, 'structured'); assert.equal(result.value.observation.state, 'unknown');
 assert.equal(result.value.prompt.outcome, 'journaled');
 assert.equal(f.calls.some(row => row.method === 'terminal.rename'), false);
 assert.equal((await f.send('openMember', { teamId: f.input.teamId, memberId: f.input.memberId, requestId: f.input.requestId })).value.opened, true);
 assert.equal(f.calls.find(row => row.method === 'agentSession.reveal').params.sessionId, result.value.sessionId);
});
test('ambiguous effect survives restart and explicit recovery reads the original native receipt without effects', async t => {
 const f = await fixture(t); let operationId;
 const nativeResult = { worktreeId: 'folder:/saved', outcome: { kind: 'terminal', handle: 'native-handle', paneKey: 'native-tab:native-leaf' }, receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'recovered' }, prompt: { delivery: 'submit', outcome: 'unconfirmed' } };
 f.effect(async request => { operationId = request.operationId; f.recordNative(request, nativeResult); throw Error('native response lost'); });
 const lost = await f.send('launchSupervisor'); assert.equal(lost.value.status, 'unknown');
 await f.restart();
 assert.equal((await f.send('launchSupervisor')).value.status, 'unknown');
 assert.equal(f.calls.filter(row => row.method === 'agent.launchReplay').length, 1);
 f.effect(async request => { assert.equal(request.operationId, operationId); return { worktreeId: 'folder:/saved', outcome: { kind: 'terminal', handle: 'native-handle', paneKey: 'native-tab:native-leaf' }, receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'replayed' }, prompt: { delivery: 'submit', outcome: 'unconfirmed' } }; });
 const recovered = await f.send('recoverLaunch');
 assert.equal(recovered.value.status, 'created'); assert.equal(recovered.value.prompt.outcome, 'unconfirmed'); assert.equal(recovered.value.briefAccepted, false);
 assert.equal((await f.send('launchSupervisor', { ...f.input, requestId: 'duplicate-member' })).ok, false);
 assert.equal((await f.send('launchSupervisor', { ...f.input, configVersion: 9 })).ok, false);
});
test('native mismatch stays unknown; forged fields and non-supervisor requests never reach effects', async t => {
 const f = await fixture(t);
 assert.equal((await f.send('launchSupervisor', { ...f.input, memberId: f.team.members[1].id })).ok, false);
 assert.equal((await f.send('launchSupervisor', { ...f.input, nativeRequest: { method: 'arbitrary' } })).ok, false);
 await assert.rejects(f.executor().execute({ op: '_launchSettle', params: { phaseId: 'forged', result: {} } }), /authority/);
 await assert.rejects(f.executor().execute({ op: 'start', params: f.input }), /Unknown/);
 f.effect(async () => ({ worktreeId: 'foreign', outcome: { kind: 'terminal', handle: 'foreign-handle' }, receipt: { mode: 'terminal', preferred: 'terminal', reason: 'user_default', detail: 'foreign' } }));
 const mismatch = await f.send('launchSupervisor'); assert.equal(mismatch.value.status, 'unknown');
 assert.equal(f.calls.some(row => row.method === 'terminal.rename'), false);
});
test('native intent preserves omitted versus explicit-null arguments and per-member requested options', async () => {
 const { nativeLaunchIntent } = await import('../src/local/native-launch.mjs');
 const team = { id: 'team', name: 'Team', members: [{ id: 'head', name: 'Head', role: 'head', boss: null, agent: 'claude', model: 'opus', effort: 'max', brief: 'lead', roleVersion: 3 }], configVersion: 4 };
 const scope = { workspaceId: 'folder:/saved', workspaceKey: 'a'.repeat(64) };
 const omitted = nativeLaunchIntent(team, team.members[0], scope);
 assert.equal(Object.hasOwn(omitted, 'agentArgs'), false); assert.deepEqual(omitted.sessionOptions, { model: 'opus', effort: 'max' });
 const cleared = nativeLaunchIntent(team, { ...team.members[0], agentArgs: null }, scope);
 assert.equal(cleared.agentArgs, null); assert.match(cleared.prompt.text, /Role version: 3; configuration version: 4/);
});
test('SQLite failure before intent prevents effects and rolls back the member reservation', async t => {
 const f = await fixture(t); const { DatabaseSync } = await import('node:sqlite');
 const db = new DatabaseSync(join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite')); t.after(() => db.close());
 db.exec("CREATE TRIGGER deny_intent BEFORE INSERT ON receipts WHEN NEW.id LIKE 'operation:%' BEGIN SELECT RAISE(ABORT,'intent disk full'); END");
 const failed = await f.send('launchSupervisor'); assert.equal(failed.ok, false); assert.match(failed.error, /disk full/);
 assert.equal(f.calls.some(row => row.method === 'agent.launchReplay'), false); assert.equal(f.store().readSnapshot().teams[0].launch, undefined);
 db.exec('DROP TRIGGER deny_intent'); assert.equal((await f.send('launchSupervisor')).value.status, 'created');
});
test('receipt persistence failure keeps an unknown reservation and prevents naming until exact replay recovers', async t => {
 const f = await fixture(t); const { DatabaseSync } = await import('node:sqlite');
 const db = new DatabaseSync(join(f.profile, 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite')); t.after(() => db.close());
 db.exec("CREATE TRIGGER deny_receipt BEFORE UPDATE ON receipts WHEN NEW.id LIKE 'operation:%' AND json_extract(NEW.json,'$.status')='created' BEGIN SELECT RAISE(ABORT,'receipt disk full'); END");
 const failed = await f.send('launchSupervisor'); assert.equal(failed.ok, false); assert.equal(f.store().readOperation(f.input.requestId).status, 'unknown');
 assert.equal(f.calls.some(row => row.method === 'terminal.rename'), false);
 const operationId = f.calls.find(row => row.method === 'agent.launchReplay').params.operationId;
 db.exec('DROP TRIGGER deny_receipt'); await f.restart();
 assert.equal((await f.send('recoverLaunch')).value.status, 'created');
 assert.deepEqual(f.calls.filter(row => row.method === 'agent.launchReplay').map(row => row.params.operationId), [operationId]);
});
test('concurrent clicks reserve one member and native capability loss before effect cannot launch', async t => {
 const f = await fixture(t);
 let statusCalls = 0; const runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, args) => args.method === 'status.get' && ++statusCalls > 1 ? { ok: true, result: { runtimeId: 'changed-runtime', capabilities: [] } } : runtime(event, args));
 const lost = await f.send('launchSupervisor'); assert.equal(lost.ok, false);
 assert.equal(f.calls.some(row => row.method === 'agent.launchReplay'), false);
 f.handlers.set('runtime:call', runtime);
 // The runtime changed during discovery, before an intent was admitted.
 assert.equal(f.store().readOperation(f.input.requestId),null);
 const results = await Promise.all([f.send('recoverLaunch'), f.send('recoverLaunch')]);
 assert.ok(results.every(row => !row.ok)); assert.equal(f.calls.filter(row => row.method === 'agent.launchReplay').length, 0);
});
test('structured navigation refuses changed native scope before reveal', async t => {
 const f = await fixture(t, { kind: 'structured' }); await f.send('launchSupervisor');
 const runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, args) => args.method === 'orchestration.partyLocation' ? { ok: true, result: { location: { kind: 'chat', sessionId: 'codex:fixture-session', worktreeId: 'foreign' } } } : runtime(event, args));
 const opened = await f.send('openMember', { teamId: f.input.teamId, memberId: f.input.memberId, requestId: f.input.requestId });
 assert.equal(opened.ok, false); assert.equal(f.calls.some(row => row.method === 'agentSession.reveal'), false);
});
test('an unknown operation remains reserved after runtime identity changes instead of risking a fresh native ledger', async t => {
 const f = await fixture(t); f.effect(async () => { throw Error('response lost'); });
 await f.send('launchSupervisor');
 const runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, args) => { const result = await runtime(event, args); if (args.method === 'status.get') result.result.runtimeId = 'replacement-runtime'; return result; });
 const recovered = await f.send('recoverLaunch'); assert.equal(recovered.value.status, 'unknown');
 assert.match(recovered.value.error, /ledger/i);
 assert.equal(f.calls.filter(row => row.method === 'agent.launchReplay').length, 1);
});
test('missing runtime identity refuses launch before reserving a member', async t => {
 const f = await fixture(t), runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, args) => { const result = await runtime(event, args); if (args.method === 'status.get') delete result.result.runtimeId; return result; });
 assert.equal((await f.send('launchSupervisor')).ok, false);
 assert.equal(f.store().readOperation(f.input.requestId), null);
 assert.equal(f.calls.some(row => row.method === 'agent.launchReplay'), false);
});
test('missing, pending, wrong-namespace and mismatched native rows never trigger a second launch even in the same runtime', async t => {
 const f = await fixture(t); f.effect(async () => { throw Error('response lost before native evidence could be read'); });
 await f.send('launchSupervisor');
 const db = new DatabaseSync(join(f.profile, 'agent-session-journal.db')); t.after(() => db.close());
 db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_operations (operation_key TEXT PRIMARY KEY,row_json TEXT NOT NULL)');
 for (const outcome of [null, { status: 'pending' }, { status: 'unknown' }]) {
  const request = f.store().readOperation(f.input.requestId).nativeRequest;
  const row = { callerKey: 'trusted-local:desktop', operationId: request.operationId, fingerprint: nativeLaunchFingerprint(request), operationTimestamp: Number(request.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 60000, outcome };
  if (outcome) db.prepare('INSERT OR REPLACE INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${request.operationId}`, JSON.stringify(row));
  assert.equal((await f.send('recoverLaunch')).value.status, 'unknown');
 }
 const request = f.store().readOperation(f.input.requestId).nativeRequest;
 for (const change of [{ callerKey: 'trusted-local:runtime' }, { fingerprint: 'wrong' }]) {
  const row = { callerKey: 'trusted-local:desktop', operationId: request.operationId, fingerprint: nativeLaunchFingerprint(request), operationTimestamp: Number(request.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 60000, outcome: { status: 'succeeded', sessionId: '', launch: {} }, ...change };
  db.prepare('INSERT OR REPLACE INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${request.operationId}`, JSON.stringify(row));
  assert.equal((await f.send('recoverLaunch')).value.status, 'unknown');
 }
 assert.equal(f.calls.filter(row => row.method === 'agent.launchReplay').length, 1);
});
test('checking an absent saved launch never creates a new operation or session', async t => {
 const f = await fixture(t);
 const result = await f.send('recoverLaunch');
 assert.equal(result.ok, false);
 assert.equal(f.store().readOperation(f.input.requestId), null);
 assert.equal(f.calls.some(row => row.method === 'agent.launchReplay'), false);
});
for (const cold of [false, true]) test(`load, ${cold ? 'cold' : 'warm'} capability-confirm, save and launch plus reread fit the actual 30-call panel admission budget`, async t => {
 const f = await fixture(t); f.budget(30);
 let installed = !cold; const runtime = f.handlers.get('runtime:call');
 f.handlers.set('runtime:call', async (event, request) => {
  if (request.method === 'agentSession.restartResumable') { installed = true; return {ok:true,result:{sessions:[],failed:[]}}; }
  if (request.method === 'agentSession.modelCatalog' && !installed) return {ok:false,error:{code:'runtime_error',message:'structured_agent_session_unsupported'}};
  const response = await runtime(event,request);
  if (request.method === 'status.get') response.result.capabilities.push('agent-session.structured.v1');
  return response;
 });
 // Initial ping/load/context and the save each cost one admission. The fixture invokes equivalent harmless reads.
 for (let i = 0; i < 3; i++) assert.equal((await f.send('load', {})).ok, true);
 assert.equal((await f.send('capabilities', { teamId: f.input.teamId })).ok, true);
 assert.equal((await f.send('load', {})).ok, true);
 const launched = await f.send('launchSupervisor'); assert.equal(launched.ok, true, launched.error);
 assert.equal(launched.value.observation.state, 'permission');
 assert.equal((await f.send('load', {})).ok, true);
 assert.ok(f.gateCount() <= 30);
});
test('late conflicting structured settlement cannot replace the saved session identity', async t => {
 const f = await fixture(t, { kind: 'structured' }); await f.send('launchSupervisor');
 const saved = f.store().readOperation(f.input.requestId);
 assert.throws(() => f.store().settleOperation(saved.requestId, saved.nativeRequest.operationId, { status: 'created', kind: 'structured', handle: 'other-handle', sessionId: 'other-session' }), /conflict/);
 assert.equal(f.store().readOperation(saved.requestId).sessionId, saved.sessionId);
});

test('all-at-start prepares precisely four saved members and preserves independent launches after one unknown', async t => {
 const f=await fixture(t,{launchMode:'all',kind:'structured'}); let count=0;
 f.effect(async()=>{count++;if(count===2)throw Error('member refused');return {worktreeId:'folder:/saved',outcome:{kind:'structured',handle:'chat-'+count,sessionId:'session-'+count},receipt:{mode:'structured',preferred:'structured',reason:'user_default',detail:'Native configured surface'},prompt:{delivery:'submit',outcome:'journaled',messageId:'message-'+count}};});
 const outcomes=[];
 for(const member of f.team.members) outcomes.push(await f.send('launchSupervisor',{...f.input,memberId:member.id,requestId:'prepare-'+member.id}));
 assert.deepEqual(outcomes.map(row=>row.value?.status),['created','unknown','created','created']);
 assert.equal(f.calls.filter(row=>row.method==='agent.launchReplay').length,4);
 assert.deepEqual(Object.keys(f.store().readSnapshot().teams[0].launch.members),f.team.members.map(row=>row.id));
 for(const member of f.team.members) await f.send('launchSupervisor',{...f.input,memberId:member.id,requestId:'prepare-'+member.id});
 assert.equal(f.calls.filter(row=>row.method==='agent.launchReplay').length,4);
 assert.ok(f.calls.filter(row=>row.method==='agent.launchReplay').every(row=>row.params.target.worktree==='folder:/saved'));
});
test('queued goal launch uses actual panel broker and new native identity, never old preparation authority',async t=>{
 const f=await fixture(t,{kind:'structured'});await f.send('launchSupervisor');const store=f.store();
 let w=store.prepareWork({teamId:f.team.id,requestId:'work-one',expectedRevision:store.readSnapshot().revision,objective:'First goal'}).work;
 w=store.updateWork(w.id,w.version,{status:'active',run:{state:'verified',id:'first-run',consumerGeneration:1},instance:{kind:'structured',sessionId:'first-root',liveSessionId:w.binding.sessionId,fence:1}});
 store.enqueueGoal({teamId:f.team.id,requestId:'queue',expectedRevision:store.readSnapshot().revision,objective:'Second goal'});
 store.recordDelivery(w.id,{id:'native-delivery',summary:'Handoff checked',evidenceRefs:['report.md'],attemptIds:[],generation:1,proof:{requestId:'native-proof',payloadHash:'a'.repeat(64)}});w=store.readWork(w.id);
 store.decideWork({requestId:'accept-first',workId:w.id,deliveryId:'native-delivery',expectedWorkVersion:w.version,decision:'accept'});
 f.effect(async()=>({worktreeId:'folder:/saved',outcome:{kind:'structured',handle:'new-chat',sessionId:'new-session',tabId:'new-tab'},receipt:{mode:'structured',preferred:'structured',reason:'user_default',detail:'Orca chose saved mode'},prompt:{delivery:'submit',outcome:'journaled',messageId:'new-role'}}));
 const stale=await f.send('startNextGoal',{teamId:f.team.id,goalId:'different-transition'});assert.equal(stale.ok,true);assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').length,1,'old action cannot advance another transition');
 const response=await f.send('startNextGoal',{teamId:f.team.id});assert.equal(response.ok,true,response.error);
 assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').length,2);const ops=store.listOperations();assert.notEqual(ops[0].nativeRequest.operationId,ops[1].nativeRequest.operationId);assert.equal(ops[1].scope.workspaceId,'folder:/saved');assert.equal(Object.hasOwn(ops[1].nativeRequest,'reuseTerminal'),false);
 assert.equal(store.listWorks().length,2);const next=store.listWorks().find(row=>row.id!==w.id);assert.equal(next.binding.sessionId,'new-session');assert.equal(next.handoff.summary,'Handoff checked');assert.equal(store.readWork(w.id).status,'completed');
 await f.send('startNextGoal',{teamId:f.team.id});assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').length,2);
 f.executor().stopWork();
});

test('four-member on-demand hierarchy prepares root and department manager, retaining workers for first assignment',async t=>{
 const f=await fixture(t,{kind:'structured',form:{structure:'organisation',groups:'Development',fan:2}});let count=0;
 f.effect(async()=>{count++;return {worktreeId:'folder:/saved',outcome:{kind:'structured',handle:'manager-'+count,sessionId:'session-'+count},receipt:{mode:'structured',preferred:'structured',reason:'user_default',detail:'Native'},prompt:{delivery:'submit',outcome:'journaled',messageId:'role-'+count}};});
 assert.equal(f.team.members.length,4);
 for(const member of f.team.members){const response=await f.send('launchSupervisor',{...f.input,memberId:member.id,requestId:'manager-'+member.id});assert.equal(response.ok,member.role!=='worker');}
 assert.equal(f.calls.filter(row=>row.method==='agent.launchReplay').length,2);
 assert.deepEqual(Object.keys(f.store().readSnapshot().teams[0].launch.members),f.team.members.filter(row=>row.role!=='worker').map(row=>row.id));
});
test('approved full-roster staffing reuses genuine launch IPC and member reservation; failure and repeated panel confirmation retain one member',async t=>{
 const f=await fixture(t,{launchMode:'all'});await f.send('launchSupervisor');
 const store=f.store(),work=store.prepareWork({requestId:'staffing-goal',teamId:f.team.id,objective:'Review',expectedRevision:store.readSnapshot().revision}).work;
 const input={requestId:'staffing-add',workId:work.id,expectedRevision:store.readSnapshot().revision,configVersion:1,member:{name:'New reviewer',boss:f.team.members[0].id,brief:'Review findings.',habits:'',collaboration:'Use direct supervisor.',agent:'claude',model:'default',effort:'default'}};
 f.budget(30);f.effect(async()=>{throw Error('Native launch outcome lost.');});
 const response=await f.send('saveStaffing',input);assert.equal(response.ok,true,response.error);
 assert.equal(response.value.staffing.decision,'approved');assert.equal(response.value.preparation.status,'unknown');
 const saved=store.readSnapshot();assert.equal(saved.teams[0].members.length,5);const member=saved.teams[0].members.at(-1);assert.equal(store.readMemberOperation(member.id).status,'unknown');
 assert.ok(f.gateCount()<=30);f.budget(30);const again=await f.send('saveStaffing',input);assert.equal(again.ok,true,again.error);assert.equal(again.value.staffing.memberId,member.id);
 assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').length,2);
 assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').at(-1).params.target.worktree,'folder:/saved');
});
test('staffing validates explicit model against the fixed Work host before saving a member',async t=>{
 const f=await fixture(t);await f.send('launchSupervisor');const store=f.store(),work=store.prepareWork({requestId:'staffing-model-goal',teamId:f.team.id,objective:'Review',expectedRevision:store.readSnapshot().revision}).work;
 const result=await f.send('saveStaffing',{requestId:'invalid-model-add',workId:work.id,expectedRevision:store.readSnapshot().revision,configVersion:1,member:{name:'Reviewer',boss:f.team.members[0].id,brief:'Review',habits:'',collaboration:'Report',agent:'claude',model:'unverified-model',effort:'default'}});
 assert.equal(result.ok,false);assert.match(result.error,/model|overrides/i);assert.equal(store.readSnapshot().teams[0].members.length,4);assert.equal(f.calls.filter(c=>c.method==='agent.launchReplay').length,1);
});

test('public launch observation keeps private PTY process identity out of the panel projection',async()=>{
 const {publicOperation}=await import('../src/local/native-launch.mjs');
 const observed=publicOperation({requestId:'launch',observation:{state:'idle',incarnationId:'raw-incarnation',ptyId:'repo::/private/work@@pty',processIncarnation:'repo::/private/work@@pty:raw-incarnation'}});
 assert.deepEqual(observed.observation,{state:'idle',incarnationId:'raw-incarnation'});
});

test('successful native launch clears an absent-ledger warning observed while its receipt was still in flight',async t=>{
 const f=await fixture(t);
 const db=new DatabaseSync(join(f.profile,'agent-session-journal.db'));db.exec('PRAGMA user_version=4; CREATE TABLE agent_session_operations(operation_key TEXT PRIMARY KEY,row_json TEXT NOT NULL)');db.close();
 let release,entered;const pending=new Promise(resolve=>{release=resolve;}),inFlight=new Promise(resolve=>{entered=resolve;});t.after(()=>release());
 f.effect(async()=>{entered();await pending;return {worktreeId:'folder:/saved',outcome:{kind:'terminal',handle:'native-handle',paneKey:'native-tab:native-leaf'},receipt:{mode:'terminal',preferred:'terminal',reason:'user_default',detail:'Native creation confirmed'},prompt:{delivery:'submit',outcome:'handed-to-terminal'}};});
 const launch=f.send('launchSupervisor');await inFlight;
 const observed=await f.send('recoverLaunch');assert.equal(observed.value.status,'unknown');assert.match(observed.value.error,/ledger row is absent/);
 release();const result=await launch;assert.equal(result.value.status,'created');
 assert.equal(result.value.error,undefined);assert.equal(result.value.recovery,undefined);
 assert.equal(f.store().readOperation(f.input.requestId).error,undefined);
 assert.equal(f.calls.filter(row=>row.method==='agent.launchReplay').length,1);
});

test('matching launch settlement retains a current incomplete recovery warning instead of claiming liveness',async t=>{
 const f=await fixture(t);let release,entered;const pending=new Promise(resolve=>{release=resolve;}),inFlight=new Promise(resolve=>{entered=resolve;});t.after(()=>release());
 const nativeResult={worktreeId:'folder:/saved',outcome:{kind:'terminal',handle:'native-handle',paneKey:'native-tab:native-leaf'},receipt:{mode:'terminal',preferred:'terminal',reason:'user_default',detail:'Created'},prompt:{delivery:'submit',outcome:'unconfirmed'}};
 f.effect(async request=>{f.recordNative(request,nativeResult);entered();await pending;return nativeResult;});
 const launch=f.send('launchSupervisor');await inFlight;
 const observed=await f.send('recoverLaunch');assert.equal(observed.value.status,'created');assert.equal(observed.value.recovery.incomplete,true);
 const warning=observed.value.recovery.detail;release();const result=await launch;
 assert.equal(result.value.status,'created');assert.equal(result.value.recovery.incomplete,true);assert.equal(result.value.recovery.detail,warning);assert.equal(result.value.recovery.liveness,'unknown');
 assert.equal(f.calls.filter(row=>row.method==='agent.launchReplay').length,1);
});
