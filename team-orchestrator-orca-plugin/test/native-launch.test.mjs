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
async function fixture(t, { kind = 'terminal', agent = 'codex', launchMode = 'on-demand' } = {}) {
 const profile = await mkdtemp(join(tmpdir(), 'native-launch-'));
 let store = await openTeamStore({ userData: profile });
 const calls = [], cliCalls = []; const internalKey = 'private-launch-key';
 const cli = async argv => { cliCalls.push(argv); assert.equal(argv[0], 'worktree'); return { worktree: { id: 'folder:/saved', hostId: 'local', displayName: 'Saved' } }; };
 let executor = createExecutor({}, cli, { store, internalKey, userData: profile });
 const selected = await executor.execute({ op: 'context', workspaceId: 'folder:/saved' });
 const state = (await executor.execute({ op: 'createTeam', params: { form: { ...DEFAULT_FORM, launchMode, agents: [agent, 'codex', 'codex'] }, selectionToken: selected.selectionToken, requestId: 'create', expectedRevision: 0 } })).value;
 const team = state.teams[0], member = team.members.find(row => !row.boss);
 const input = { teamId: team.id, memberId: member.id, requestId: 'launch-root', configVersion: team.configVersion };
 const sender = { id: 1, mainFrame: {}, isDestroyed: () => false }, event = { sender, senderFrame: sender.mainFrame };
 const recordNative = (request, result) => {
  const db = new DatabaseSync(join(profile, 'agent-session-journal.db'));
  db.exec('PRAGMA user_version=4; CREATE TABLE IF NOT EXISTS agent_session_operations (operation_key TEXT PRIMARY KEY,row_json TEXT NOT NULL)');
  const row = { callerKey: 'trusted-local:desktop', operationId: request.operationId, fingerprint: nativeLaunchFingerprint(request), operationTimestamp: Number(request.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 86400000, outcome: { status: 'succeeded', sessionId: result.outcome?.sessionId ?? '', launch: result } };
  db.prepare('INSERT OR REPLACE INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${request.operationId}`, JSON.stringify(row)); db.close();
 };
 let effect = async params => ({ worktreeId: 'folder:/saved', outcome: kind === 'structured' ? { kind, handle: 'session-handle', sessionId: 'codex:fixture-session', tabId: 'chat-tab' } : { kind, handle: 'native-handle', paneKey: 'native-tab:native-leaf' }, receipt: { mode: kind, preferred: kind, reason: 'user_default', detail: 'Orca chose saved mode' }, prompt: { delivery: 'submit', outcome: kind === 'structured' ? 'journaled' : 'handed-to-terminal', ...(kind === 'structured' ? { messageId: 'native-message' } : {}) } });
 let enabled = true, gates = 0, budget = Infinity;
 const handlers = new Map([
  ['plugins:readPanelEntry', async () => ({ sessionToken: 'token' })],
  ['plugins:panelAction', async () => ++gates > budget ? { ok: false, code: 'rate_limited' } : enabled ? { ok: true } : { ok: false, code: 'consent_required' }],
  ['plugins:invokeCommand', async (actual, args) => { assert.equal(actual, event); return executor.execute(args.args); }],
  ['runtime:call', async (actual, { method, params }) => {
   assert.equal(actual, event); calls.push({ method, params });
   let result;
   if (method === 'status.get') result = { runtimeId: 'runtime', capabilities: ['agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1', 'agent-session.structured.registered-agents.v1'] };
   else if (method === 'settings.get') result = { settings: {} };
   else if (method === 'preflight.detectAgents') result = ['codex', 'claude'];
   else if (method === 'agentSession.agents') result = { agents: [] };
   else if (method === 'agentSession.createSupport') result = { supported: true };
   else if (method === 'agentSession.modelCatalog') result = { origin: 'unknown' };
   else if (method === 'agent.launchReplay') { const saved = store.readSnapshot().teams[0].launch.members; const operation=Object.values(saved).map(row=>store.readOperation(row.requestId)).find(row=>row.nativeRequest.operationId===params.operationId); assert.equal(operation.nativeRequest.operationId, params.operationId, 'intent must be durable before native effect'); assert.equal(operation.status, 'unknown'); result = await effect(params); recordNative(params, result); }
   else if (method === 'terminal.rename') { assert.equal(store.readOperation(input.requestId).status, 'created', 'identity must be durable before naming'); result = { rename: { handle: params.terminal, tabId: 'native-tab', title: params.title } }; }
   else if (method === 'terminal.show') result = { terminal: { handle: 'native-handle', worktreeId: 'folder:/saved', executionHostId: 'local', tabId: 'native-tab', leafId: 'native-leaf', agentWait: null } };
   else if (method === 'terminal.agentStatus') result = { agentStatus: { handle: 'native-handle', isRunningAgent: true, status: 'permission' } };
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
 return { send, calls, cliCalls, input, team, profile, handlers, recordNative, budget: value => { budget = value; gates = 0; }, gateCount: () => gates, executor: () => executor, store: () => store, effect: fn => { effect = fn; }, revoke: () => { enabled = false; }, restart: async () => { store.close(); store = await openTeamStore({ userData: profile }); executor = createExecutor({}, cli, { store, internalKey, userData: profile }); } };
}
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
 const lost = await f.send('launchSupervisor'); assert.equal(lost.value.status, 'unknown');
 assert.equal(f.calls.some(row => row.method === 'agent.launchReplay'), false);
 f.handlers.set('runtime:call', runtime);
 const results = await Promise.all([f.send('recoverLaunch'), f.send('launchSupervisor')]);
 assert.ok(results.every(row => row.ok)); assert.equal(f.calls.filter(row => row.method === 'agent.launchReplay').length, 0);
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
test('load, capability-confirm, save and launch plus reread fit the actual 30-call panel admission budget', async t => {
 const f = await fixture(t); f.budget(30);
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
