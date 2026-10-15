// Separate Electron host, genuine renderer IPC. No real Orca session/provider is used.
const { app, ipcMain, BrowserWindow } = require('electron');
const { fork } = require('node:child_process');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { join } = require('node:path');
const { readFileSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { createHash } = require('node:crypto');
app.setName('Orca');
app.on('window-all-closed', () => {}); // Keep the fixture host alive while its panel is closed.
app.setPath('appData', __dirname + '/redirected-app-data');
app.setPath('userData', __dirname + '/redirected-runtime-profile');
const KEY = 'herman925.team-orchestrator';
const questionSends = new Map(), notifications = [];
const data = new Map(); const leases = new Map(); const pending = new Map();
let child; let nextId = 0; let enabled = true; let admitted = true; let start;
const mainFrame = event => assert.equal(event.senderFrame, event.sender.mainFrame, 'must preserve genuine main-frame IPC');
function startWorker() {
  return start ??= new Promise((resolve, reject) => {
    child = fork(__dirname + '/out/main/plugin-host-entry.cjs', [], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    child.once('error', reject);
    child.on('message', message => {
      if (message.type === 'ready') { assert.deepEqual(message.commands.sort(), ['team.control', 'team.initialise']); resolve(); }
      else if (message.type === 'host') {
        try {
          if (!enabled) throw Error('plugin is not enabled with current consent');
          const { key, value } = message.params;
          let result;
          if (message.method === 'storage.get') result = { value: data.get(key) ?? null };
          else if (message.method === 'storage.set') { data.set(key, value); result = { ok: true }; }
          else if(message.method==='notifications.show'){assert.ok(message.params.title.length<=120);notifications.push(message.params);result={delivered:true};}
          else throw Error('Unknown host method');
          child.send({ type: 'hostResult', id: message.id, value: result });
        } catch (error) { child.send({ type: 'hostResult', id: message.id, error: error.message }); }
      } else if (message.type === 'result') {
        const request = pending.get(message.id); pending.delete(message.id);
        if (message.error) request?.reject(Error(message.error)); else request?.resolve(message.value);
      } else if (message.type === 'fatal') reject(Error(message.error));
    });
  });
}
const runtimeReads = [], launched = new Map(), objectiveSends = new Map();
let stopCalls=0;
let terminalStatus = 'permission', nativeDb, nativeSocket, objectiveAttempts = 0;
const nativeToken = 'fixture-private-runtime-token';
const history = new Map();
function savedWorks() {
  const db = new DatabaseSync(join(app.getPath('userData'), 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'), { readOnly: true, timeout: 1000 });
  try { return db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%'").all().map(row => JSON.parse(row.json)); } finally { db.close(); }
}
// Fixture supervisor/member writes native evidence; plugin may only observe it.
const protocolInputs = new Map(), permitInputs = new Map(), nativeStarts = new Set();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
function savedPrivate(prefix) {
  const db = new DatabaseSync(join(app.getPath('userData'), 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'), { readOnly: true, timeout: 1000 });
  try { return db.prepare('SELECT json FROM receipts WHERE id LIKE ?').all(prefix + ':%').map(row => JSON.parse(row.json)); } finally { db.close(); }
}
function nativeReceipt(work, requestId, method, params, value) {
  const stable = { ...params }; delete stable.waitSubmitMs;
  if (work.instance.kind === 'structured') stable.__orcaCallerOrcaSessionId = work.instance.sessionId;
  else for (const key of ['from', 'callerTerminalHandle']) if (stable[key]) stable[key] = { paneKey: work.instance.paneKey };
  const hash = createHash('sha256').update(JSON.stringify(canonical({ method, params: stable }))).digest('hex');
  nativeDb.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('fixture-local-caller', requestId, method, hash, 'completed', JSON.stringify(value));
}
function dispatchInput(text, params, envelope) {
  const operationId = params.envelope?.clientOperationId ?? envelope.orchestrationRequestId;
  const wire = JSON.parse(text.slice(text.indexOf('\n') + 1));
  const work = savedWorks().find(row => row.id === wire.workId);
  assert.ok(work, 'dispatch input belongs to existing TeamWork');
  const from = work.instance.kind === 'structured' ? 'orca_session_id:' + work.instance.sessionId : work.instance.handle;
  if (text.startsWith('TEAM_DISPATCH_PROTOCOL\n')) {
    const protocol = savedPrivate('dispatch-protocol').find(row => row.workId === work.id);
    assert.equal(protocol.state, 'sending', 'protocol commits before user input');
    assert.notEqual(protocol.token, work.protocolToken, 'dispatch authority token is bound after Run generation');
    assert.deepEqual(protocol.nativeSend.params, params);
    assert.equal(protocolInputs.has(work.id), false, 'protocol is never sent twice'); protocolInputs.set(work.id, operationId);
    const member = wire.children[0], taskId = 'native-task-' + work.id;
    const spec = JSON.stringify({ protocol: wire.protocol, workId: work.id, token: wire.token, generation: wire.generation, taskKey: 'fixture-task', memberId: member.memberId, configVersion: wire.configVersion, roleVersion: member.roleVersion, role: member.role, writeScope: [], instruction: 'Inspect the checkout and return evidence.' });
    const terminal = work.instance.kind === 'terminal';
    nativeDb.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(taskId, work.run.id, spec, 'ready', null, terminal ? work.instance.handle : null, terminal ? work.instance.paneKey : null, terminal ? work.instance.incarnationId : null, terminal ? wire.generation : null);
    nativeReceipt(work, 'create-' + work.id, 'orchestration.taskCreate', { spec, run: work.run.id, callerTerminalHandle: from }, { task: { id: taskId, run_id: work.run.id, spec, status: 'ready' } });
    const questionSpec=JSON.stringify({protocol:'team-questions/v1',kind:'user-question',workId:work.id,token:wire.token,generation:wire.generation,appQuestionId:'fixture-question',summary:'Choose fixture scope',options:['Focused','Full'],blockingTaskKeys:[]});
    const questionId='question-'+work.id;
    nativeDb.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?)').run(questionId,work.run.id,questionSpec,'ready',null,terminal?work.instance.handle:null,terminal?work.instance.paneKey:null,terminal?work.instance.incarnationId:null,terminal?wire.generation:null);
    nativeReceipt(work,'question-create-'+work.id,'orchestration.taskCreate',{spec:questionSpec,run:work.run.id,callerTerminalHandle:from},{task:{id:questionId,run_id:work.run.id,spec:questionSpec}});
    assert.equal(nativeDb.prepare('SELECT COUNT(*) AS n FROM dispatch_contexts WHERE task_id=?').get(taskId).n, 0, 'supervisor waits for committed admission');
  } else {
    const attempt = savedPrivate('dispatch').find(row => row.id === wire.attemptId);
    assert.ok(attempt, 'dispatch intent is readable from an independent connection before permit delivery');
    assert.equal(attempt.status, 'admitted'); assert.equal(attempt.permit.state, 'sending');
    assert.deepEqual(attempt.permit.nativeSend.params, params); assert.deepEqual(attempt.startParams, wire.startParams);
    assert.equal(attempt.memberId, wire.memberId); assert.equal(attempt.roleVersion, wire.roleVersion);
    assert.equal(savedPrivate('dispatch-member').some(row => row.id === attempt.id), true, 'exclusive member reservation commits before permit');
    assert.equal(permitInputs.has(attempt.id), false, 'no duplicate admission input'); permitInputs.set(attempt.id, operationId);
    const dispatchId = 'native-dispatch-' + work.id, handle = 'worker-' + work.id, paneKey = 'worker-tab:' + work.id;
    const terminal = work.instance.kind === 'terminal';
    nativeDb.prepare('INSERT INTO dispatch_contexts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(dispatchId, work.run.id, attempt.nativeTaskId, terminal ? work.instance.handle : null, terminal ? work.instance.paneKey : null, terminal ? null : work.instance.sessionId, null, handle, paneKey, null, 'worker-instance-' + work.id, JSON.stringify({ kind: 'ssh', targetId: 'fixture' }), 'dispatched', wire.generation);
    nativeDb.prepare('INSERT INTO worker_dispatches VALUES(?,?,?,?,?,?)').run(dispatchId, work.scope.workspaceId, handle, 'ready', 'fixture-runtime', JSON.stringify({ ...wire.startParams, resolvedWorktreeId: work.scope.workspaceId }));
    nativeDb.prepare("UPDATE tasks SET status='dispatched' WHERE id=?").run(attempt.nativeTaskId);
    nativeReceipt(work, 'start-' + work.id, 'orchestration.workerStart', { ...wire.startParams, from, devMode: false }, { runId: work.run.id, taskId: attempt.nativeTaskId, dispatchId, state: 'ready' });
    nativeStarts.add(dispatchId);
  }
  return params.body ? { ok: true, fence: 7, value: { clientMessageId: operationId, submission: { clientMessageId: operationId, dispatchState: 'accepted' } } } : { send: { handle: params.terminal, accepted: true, prompt: { requestId: operationId, processIncarnation: work.instance.incarnationId, stages: ['input_accepted'], observation: 'supported' } } };
}
function completeNativeDispatch(attempt) {
  const dispatch = nativeDb.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(attempt.dispatchId);
  const messageId = 'report-' + attempt.id, factId = 'worker_report:' + messageId;
  nativeDb.prepare("UPDATE dispatch_contexts SET status='completed' WHERE id=?").run(dispatch.id);
  nativeDb.prepare("UPDATE worker_dispatches SET state='succeeded' WHERE dispatch_id=?").run(dispatch.id);
  nativeDb.prepare("UPDATE tasks SET status='completed' WHERE id=?").run(attempt.nativeTaskId);
  nativeDb.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(messageId, dispatch.run_id, dispatch.assignee_handle, dispatch.assignee_pane_key, 'worker_done', 'Fixture member completed inspection with evidence.', JSON.stringify({ taskId: attempt.nativeTaskId, dispatchId: dispatch.id, outcome: 'succeeded' }));
  nativeDb.prepare('INSERT INTO attempt_observation_facts VALUES(?,?,?,?,?,?)').run(factId, dispatch.id, attempt.nativeTaskId, 'run_home:' + dispatch.run_id, 'worker_report', JSON.stringify({ status: 'accepted', outcome: 'succeeded', reportId: factId }));
}
function reviewNativeDispatch(attempt,decision) {
  const work=savedWorks().find(row=>row.id===attempt.workId),from=work.instance.kind==='structured'?'orca_session_id:'+work.instance.sessionId:work.instance.handle;
  const result=JSON.stringify({protocol:'team-review/v1',workId:work.id,token:attempt.token,generation:attempt.generation,taskKey:attempt.taskKey,attemptId:attempt.id,nativeTaskId:attempt.nativeTaskId,dispatchId:attempt.dispatchId,reviewToken:attempt.reviewToken,reviewerMemberId:work.supervisorMemberId,decision,evidenceRefs:[attempt.evidenceId,'fixture:inspection'],summary:'Scripted direct supervisor inspected validation evidence.'});
  const task={...nativeDb.prepare('SELECT * FROM tasks WHERE id=?').get(attempt.nativeTaskId),result};
  nativeDb.prepare('UPDATE tasks SET result=? WHERE id=?').run(result,task.id);
  nativeReceipt(work,'review-'+attempt.id,'orchestration.taskUpdate',{id:task.id,status:task.status,result,run:work.run.id,callerTerminalHandle:from},{task});
}
function createSupervisorRun(work) {
  const instance = work.instance;
  nativeDb.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run-' + work.id, work.nativeObjective, 'this_database', instance.kind === 'terminal' ? instance.handle : null, instance.paneKey ?? null, instance.kind === 'structured' ? instance.sessionId : null, 1, 1, 0);
}
async function startNativeSocket() {
  nativeDb = new DatabaseSync(join(app.getPath('userData'), 'orchestration.db'));
  nativeDb.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER); PRAGMA user_version=43');
  nativeDb.exec(`
    CREATE TABLE tasks(id TEXT PRIMARY KEY,run_id TEXT,spec TEXT,status TEXT,result TEXT,created_by_terminal_handle TEXT,created_by_pane_key TEXT,created_by_process_incarnation TEXT,created_by_run_generation INTEGER);
    CREATE TABLE mutation_caller_identities(transport TEXT PRIMARY KEY,caller_fingerprint TEXT);
    INSERT INTO mutation_caller_identities VALUES('local_authenticated_transport','fixture-local-caller');
    CREATE TABLE mutation_receipts(caller_fingerprint TEXT,request_id TEXT,method TEXT,payload_hash TEXT,state TEXT,receipt TEXT,PRIMARY KEY(caller_fingerprint,request_id));
    CREATE TABLE dispatch_contexts(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,creator_handle TEXT,creator_pane_key TEXT,creator_orca_session_id TEXT,creator_dispatch_id TEXT,assignee_handle TEXT,assignee_pane_key TEXT,assignee_orca_session_id TEXT,process_incarnation TEXT,host_scope TEXT,status TEXT,consumer_generation INTEGER);
    CREATE TABLE worker_dispatches(dispatch_id TEXT PRIMARY KEY,worktree_id TEXT,agent_terminal_handle TEXT,state TEXT,runtime_epoch TEXT,start_options TEXT);
    CREATE TABLE attempt_observation_facts(id TEXT PRIMARY KEY,dispatch_id TEXT,task_id TEXT,authority_id TEXT,facet TEXT,payload TEXT);
    CREATE TABLE messages(id TEXT PRIMARY KEY,run_id TEXT,from_handle TEXT,sender_pane_key TEXT,type TEXT,body TEXT,payload TEXT);
  `);
  // Short path stays within macOS Unix-domain socket limits; metadata remains in the verified profile.
  const endpoint = '/tmp/orca-fixture-' + process.pid + '.sock';
  nativeSocket = createServer(socket => {
    socket.setEncoding('utf8'); let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk; const index = buffer.indexOf('\n'); if (index < 0) return;
      const request = JSON.parse(buffer.slice(0, index)); buffer = buffer.slice(index + 1);
      void (async () => {
        try {
          assert.equal(request.authToken, nativeToken);
          for (const forbidden of ['clientKind', 'sessionIdentity', 'orchestrationCompatibilityEvidence', 'from']) assert.equal(Object.hasOwn(request, forbidden), false, 'use native local-user authority');
          const result = await runtimeResult(request.method, request.params, request, 'socket');
          socket.end(JSON.stringify({ id: request.id, ok: true, result, _meta: { runtimeId: 'fixture-runtime' } }) + '\n');
        } catch (error) { socket.end(JSON.stringify({ id: request.id, ok: false, error: { message: error.message }, _meta: { runtimeId: 'fixture-runtime' } }) + '\n'); }
      })();
    });
  });
  await new Promise(resolve => nativeSocket.listen(endpoint, resolve));
  writeFileSync(join(app.getPath('userData'), 'orca-runtime.json'), JSON.stringify({ runtimeId: 'fixture-runtime', pid: process.pid, transports: [{ kind: 'unix', endpoint }], authToken: nativeToken, startedAt: Date.now() }));
}
function savedOperation(nativeId) {
  const db = new DatabaseSync(join(app.getPath('userData'), 'plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite'), { readOnly: true, timeout: 1000 });
  try { const row = db.prepare("SELECT json FROM receipts WHERE id LIKE 'operation:%' AND json_extract(json,'$.nativeRequest.operationId')=?").get(nativeId); return row && JSON.parse(row.json); } finally { db.close(); }
}
async function runtimeResult(method, params, envelope = {}, transport = 'ipc') {
  runtimeReads.push({ method, params, transport });
  let result;
  if(method==='orchestration.workerStop'){
    assert.equal(transport,'socket');assert.match(envelope.orchestrationRequestId,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(params),['dispatch']);
    const intent=savedPrivate('stop').find(row=>row.nativeRequestId===envelope.orchestrationRequestId);assert.equal(intent.state,'submitted');assert.equal(intent.target.dispatchId,params.dispatch);
    stopCalls++;result={dispatchId:params.dispatch,state:stopCalls===1?'stopped':'stop_unknown',processAction:'closed_agent_terminal',close:{ptyKilled:stopCalls===1}};
    nativeDb.prepare('INSERT INTO mutation_receipts VALUES(?,?,?,?,?,?)').run('fixture-local-caller',envelope.orchestrationRequestId,method,createHash('sha256').update(JSON.stringify(canonical({method,params}))).digest('hex'),'completed',JSON.stringify(result));
  }
  else if (method === 'status.get') result = { runtimeId: 'fixture-runtime', capabilities: ['orchestration.contract.v1', 'agent-session.structured.v1', 'terminal.prompt-delivery.v1', 'agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1', 'agent-session.structured.registered-agents.v1'] };
  else if (method === 'worktree.show') result = { worktree: { id: 'repo::/remote/project', hostId: 'ssh:fixture' } };
  else if (method === 'settings.get') result = { settings: { agentDefaultEnv: { codex: { SECRET: 'must-not-leak' } } } };
  else if (method === 'ssh.getState') result = { state: { status: 'connected', connectionGeneration: 1 } };
  else if (method === 'preflight.detectRemoteAgents') result = ['codex', 'claude'];
  else if (method === 'agentSession.agents') result = { agents: [] };
  else if (method === 'agentSession.createSupport') result = { supported: false, reason: 'remote' };
  else if (method === 'agent.launchReplay') {
    assert.equal(transport, 'ipc', 'initial launch preserves the genuine renderer event');
    const operation = savedOperation(params.operationId);
    assert.equal(operation.status, 'unknown', 'intent must commit before native launch');
    assert.equal(operation.roleVersion > 0, true); assert.equal(Object.hasOwn(params, 'agentArgs'), false);
    if (launched.has(params.operationId)) result = launched.get(params.operationId);
    else {
      const n = launched.size + 1, kind = n === 1 ? 'terminal' : 'structured';
      result = { worktreeId: 'repo::/remote/project', outcome: kind === 'terminal' ? { kind, handle: 'fixture-terminal', paneKey: 'fixture-tab:fixture-leaf' } : { kind, handle: n===2?'fixture-chat':'fixture-chat-'+n, sessionId: n===2?'codex:fixture-chat':'codex:fixture-chat-'+n, tabId: 'chat-tab-'+n }, receipt: { mode: kind, preferred: kind, reason: 'user_default', detail: 'Fixture native choice' }, prompt: { delivery: 'submit', outcome: kind === 'terminal' ? 'handed-to-terminal' : 'journaled', ...(kind === 'structured' ? { messageId: 'fixture-message' } : {}) } };
      launched.set(params.operationId, result);
    }
    const { nativeLaunchFingerprint } = await import(process.env.ORCA_TEST_PLUGIN + '/src/local/native-launch-ledger.mjs');
    const db = new DatabaseSync(join(app.getPath('userData'), 'agent-session-journal.db'));
    db.exec('PRAGMA user_version=4; CREATE TABLE IF NOT EXISTS agent_session_operations (operation_key TEXT PRIMARY KEY,row_json TEXT NOT NULL)');
    db.prepare('INSERT OR REPLACE INTO agent_session_operations VALUES (?,?)').run(`trusted-local:desktop\0${params.operationId}`, JSON.stringify({ callerKey: 'trusted-local:desktop', operationId: params.operationId, fingerprint: nativeLaunchFingerprint(params), operationTimestamp: Number(params.operationId.split('-')[0]), recordedAt: Date.now(), expiresAt: Date.now() + 86400000, outcome: { status: 'succeeded', sessionId: result.outcome.sessionId ?? '', launch: result } })); db.close();
  } else if (method === 'terminal.show') result = { terminal: { handle: 'fixture-terminal', worktreeId: 'repo::/remote/project', executionHostId: 'ssh:fixture', tabId: 'fixture-tab', leafId: 'fixture-leaf', incarnationId: 'fixture-incarnation', agentIdentity: 'codex', connected: true, writable: true } };
  else if (method === 'terminal.rename') { const nativeId = [...launched.keys()][0]; assert.equal(savedOperation(nativeId).status, 'created', 'identity commit must precede rename'); result = { rename: { handle: params.terminal, tabId: 'fixture-tab', title: params.title } }; }
  else if (method === 'terminal.agentStatus') result = { agentStatus: { handle: params.terminal, isRunningAgent: true, status: terminalStatus } };
  else if (method === 'terminal.focus') result = { focus: { handle: params.terminal } };
  else if (method === 'orchestration.sessionAddress') result = { orcaSessionId: 'orca_session_id:fixture-chat' };
  else if (method === 'orchestration.partyLocation') result = { location: { kind: 'chat', sessionId: 'codex:fixture-chat', worktreeId: 'repo::/remote/project' } };
  else if (method === 'agentSession.reveal') result = { ok: true, sessionId: params.sessionId, workspaceId: 'repo::/remote/project', agent: 'codex', readable: true };
  else if (method === 'agentSession.history') result = { ok: true, page: { sessionId: params.sessionId, fence: 7, items: [], submissions: [], ...history.get(params.sessionId) } };
  else if (method === 'agentSession.send' || method === 'terminal.send') {
    const text = params.body?.blocks?.[0]?.text ?? params.text;
    if(text?.startsWith('TEAM_USER_ANSWER\n')){
      assert.equal(transport,'socket');assert.equal(params.body?.role??'user','user');assert.equal(params.from,undefined);
      const wire=JSON.parse(text.slice(text.indexOf('\n')+1)),q=savedPrivate('question').find(q=>q.workId===wire.workId&&q.id===wire.appQuestionId),answer=q.answers.find(a=>a.id===wire.answerId),work=savedWorks().find(w=>w.id===wire.workId);
      assert.equal(answer.state,'sending','answer committed before native user input');assert.deepEqual(answer.nativeSend.params,params);assert.equal(questionSends.has(answer.id),false);questionSends.set(answer.id,wire.workId);
      const operationId=params.envelope?.clientOperationId??envelope.orchestrationRequestId;
      return params.body?{ok:true,fence:7,value:{clientMessageId:operationId,submission:{dispatchState:'accepted'}}}:{send:{handle:params.terminal,accepted:true,prompt:{requestId:operationId,processIncarnation:work.instance.incarnationId}}};
    }
    if (text?.startsWith('TEAM_DISPATCH_')) {
      assert.equal(transport, 'socket', 'dispatch protocol uses ordinary native local-user input');
      assert.equal(params.body?.role ?? 'user', 'user');
      assert.equal(params.from, undefined);
      return dispatchInput(text, params, envelope);
    }
    objectiveAttempts++;
    assert.equal(transport, 'socket', 'objectives use genuine native local RPC, never synthesized IPC events');
    const operationId = params.envelope?.clientOperationId ?? envelope.orchestrationRequestId;
    const work = savedWorks().find(row => row.nativeSend?.params.envelope?.clientOperationId === operationId || row.nativeSend?.envelope.orchestrationRequestId === operationId);
    assert.ok(work, 'SQLite objective intent must commit before input');
    assert.equal(work.input.state, 'sending');
    assert.deepEqual(work.nativeSend.params, params, 'frozen native input survives the process boundary');
    assert.equal(objectiveSends.has(operationId), false, 'no duplicate native user input');
    objectiveSends.set(operationId, work.id);
    if (method === 'agentSession.send') {
      assert.deepEqual(Object.keys(params).sort(), ['body', 'envelope']);
      assert.deepEqual(Object.keys(params.body).sort(), ['blocks', 'kind', 'role']);
      assert.equal(params.body.kind, 'message'); assert.equal(params.body.role, 'user');
      assert.deepEqual(Object.keys(params.envelope).sort(), ['clientOperationId', 'expectedRuntimeFence', 'payloadFingerprint', 'sessionId']);
      assert.equal(params.body.blocks.length, 1); assert.equal(params.body.blocks[0].type, 'text');
      assert.equal(params.body.blocks[0].text.includes(JSON.stringify(work.nativeObjective)), true, 'supervisor receives its exact issued Run objective');
      assert.equal(params.envelope.expectedRuntimeFence, 7);
      assert.equal(params.envelope.sessionId, 'codex:fixture-chat');
      assert.match(params.envelope.payloadFingerprint, /^[a-f0-9]{64}$/);
      result = { ok: true, fence: 7, value: { clientMessageId: operationId, submission: { clientMessageId: operationId, dispatchState: 'pending' } } };
    } else {
      assert.match(envelope.orchestrationRequestId, /^[a-f0-9-]{36}$/);
      assert.equal(params.orchestrationRequestId, undefined);
      assert.equal(params.terminal, 'fixture-terminal'); assert.equal(params.enter, true); assert.equal(params.agentPrompt, true);
      assert.deepEqual(params.client, { id: 'team-orchestrator', type: 'desktop' });
      assert.equal(params.from, undefined);
      assert.equal(params.text.includes(JSON.stringify(work.nativeObjective)), true, 'terminal supervisor receives the same versioned Run contract');
      result = { send: { handle: params.terminal, accepted: true, prompt: { requestId: operationId, processIncarnation: 'fixture-incarnation', stages: ['input_accepted'], observation: 'supported' } } };
    }
  } else if (method === 'orchestration.runShow') result = { run: nativeDb.prepare('SELECT id,objective,consumer_generation FROM runs WHERE id=?').get(params.id) };
  else if (method === 'orchestration.workerRead') result = { dispatchId: params.dispatch, source: 'terminal', sourceIdentity: 'fixture-output', sourceExact: true, contentComplete: false, warnings: ['SSH fixture output is incomplete'], archived: true };
  else if (method === 'orchestration.workerShow') {
    const d = nativeDb.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(params.dispatch);
    const w = nativeDb.prepare('SELECT * FROM worker_dispatches WHERE dispatch_id=?').get(params.dispatch);
    result = { dispatch: { id: d.id, runId: d.run_id, taskId: d.task_id, assigneeHandle: d.assignee_handle, assigneePaneKey: d.assignee_pane_key, processIncarnation: d.process_incarnation, hostScope: JSON.parse(d.host_scope), status: d.status }, worker: { dispatchId: d.id, worktreeId: w.worktree_id, agentTerminalHandle: w.agent_terminal_handle, state: w.state, runtimeEpoch: w.runtime_epoch, startOptions: JSON.parse(w.start_options) }, observation: { status: 'live', exactWorker: true }, projection: {} };
  }
  else if (method === 'orchestration.taskList') { assert.ok(nativeDb.prepare('SELECT id FROM runs WHERE id=?').get(params.run)); assert.equal(params.from, undefined); result = { tasks: nativeDb.prepare('SELECT id,run_id,status FROM tasks WHERE run_id=?').all(params.run) }; }
  else throw Error('Unexpected runtime read ' + method);
  return result;
}
ipcMain.handle('runtime:call', async (event, { method, params }) => {
  mainFrame(event); return { id: 'desktop-ipc', ok: true, result: await runtimeResult(method, params) };
});
ipcMain.handle('session:get', async event => { mainFrame(event); return { activeWorktreeId: 'repo::/remote/project' }; });
ipcMain.handle('plugins:readPanelEntry', async (event, args) => {
  mainFrame(event); assert.equal(args.pluginKey, KEY); assert.equal(args.panelId, 'team');
  if (!enabled) throw Error('Consent required');
  const sessionToken = 'panel-' + event.sender.id; leases.set(sessionToken, event.sender.id); return { sessionToken };
});
ipcMain.handle('plugins:panelAction', async (event, args) => {
  mainFrame(event);
  if (!enabled || leases.get(args.sessionToken) !== event.sender.id) return { ok: false, code: 'consent_required' };
  if (!admitted) return { ok: false, code: 'rate_limited' };
  if (Object.keys(args.params || {}).length) return { ok: false, code: 'invalid_params' };
  return { ok: true, value: { displayName: 'Remote', terminals: [] } };
});
ipcMain.handle('plugins:invokeCommand', async (event, args) => {
  mainFrame(event); assert.equal(args.pluginKey, KEY);
  if (!enabled) throw Error('Consent revoked');
  if (!['team.control', 'team.initialise'].includes(args.commandId)) throw Error('Undeclared command');
  await startWorker();
  return new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); child.send({ type: 'command', id, commandId: args.commandId, args: args.args }); });
});
ipcMain.handle('plugins:setEnabled', async (event, args) => { mainFrame(event); enabled = args.enabled; return []; });
ipcMain.handle('plugins:remove', async event => { mainFrame(event); enabled = false; return []; });
app.whenReady().then(async () => {
  await startNativeSocket();
  let window = new BrowserWindow({ show: false, webPreferences: { preload: __dirname + '/preload.cjs', contextIsolation: true, sandbox: false, nodeIntegrationInSubFrames: true } });
  await window.loadFile(__dirname + '/index.html');
  const ipc = (channel, args, frame = window.webContents.mainFrame) => frame.executeJavaScript(`window.fixture.invoke(${JSON.stringify(channel)},${JSON.stringify(args)})`);
  const watchdog = setTimeout(() => { console.error('Electron proof timed out'); child?.kill(); nativeSocket?.close(); nativeDb?.close(); app.exit(1); }, 40000);
  try {
    let entry = await ipc('plugins:readPanelEntry', { pluginKey: KEY, panelId: 'team' });
    assert.equal(child, undefined, 'panel load must not imply worker activation');
    const envelope = (commandId = 'team.control', op = 'ping', sessionToken = entry.sessionToken) => ({ sessionToken, action: 'workspace.readContext', params: { teamWorker: { protocol: 1, nonce: 'panel-nonce', commandId, args: { op } } } });
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'invalid_params');
    const init = await ipc('plugins:invokeCommand', { pluginKey: KEY, commandId: 'team.initialise' });
    assert.equal(init.ready, true, JSON.stringify(init)); assert.equal(init.cliPaths, undefined);
    const firstHandler = ipcMain._invokeHandlers.get('plugins:panelAction');
    const ping = await ipc('plugins:panelAction', envelope());
    assert.equal(ping.value.nonce, 'panel-nonce'); assert.equal(ping.value.workerPid, child.pid);
    assert.equal(ping.value.cliPaths, undefined); assert.equal(ping.value.liveProviderVerified, false);
    const control = async (op, params) => {
      const request = envelope('team.control', op); request.params.teamWorker.args.params = params;
      const result = await ipc('plugins:panelAction', request);
      assert.equal(result.ok, true, JSON.stringify(result)); return result.value;
    };
    const selection = await control('context', {});
    assert.equal(selection.executionHostId, 'ssh:fixture'); assert.equal(selection.kind, 'git');
    const form = { name: 'Saved-Team', structure: 'team', levels: 2, fan: 3, groups: '', purpose: '', agents: ['codex','claude','claude'], models: ['default','default','default'], efforts: ['default','default','default'] };
    const create = { requestId: 'electron-create', expectedRevision: 0, selectionToken: selection.selectionToken, form };
    const saved = (await control('createTeam', create)).value;
    assert.equal(saved.teams.length, 1); assert.equal(saved.teams[0].launch, undefined);
    assert.equal(JSON.stringify(saved).includes('/remote/project'), false);
    assert.equal(readFileSync(__dirname + '/cli-calls.jsonl','utf8').trim().split('\n').map(JSON.parse).every(args => args[0] === 'worktree'), true, 'save must not launch');
    let edited = (await control('updateRole', { requestId: 'electron-role', expectedRevision: 1, teamId: saved.teams[0].id, memberId: saved.teams[0].members[0].id, brief: 'Review evidence', habits: 'Read results first', collaboration: 'Escalate blockers' })).value;
    assert.equal(edited.teams[0].members[0].roleVersion, 2);
    const capabilities = await control('capabilities', { teamId: saved.teams[0].id });
    assert.equal(capabilities.executionHostId, 'ssh:fixture');
    assert.equal(capabilities.agents.codex.availability, 'detected');
    assert.equal(capabilities.agents.codex.catalogStatus, 'unknown');
    assert.equal(JSON.stringify(capabilities).includes('must-not-leak'), false);
    assert.equal(runtimeReads.find(row => row.method === 'preflight.detectRemoteAgents').params.connectionId, 'fixture');
    assert.equal(runtimeReads.some(row => row.method === 'agentSession.modelCatalog'), false);
    assert.equal((await ipc('plugins:panelAction', envelope('team.control', '_capabilityResult'))).code, 'invalid_params');
    await assert.rejects(ipc('plugins:invokeCommand', { pluginKey: KEY, commandId: 'team.control', args: { op: '_capabilityResult', internalKey: 'forged', params: {} } }), /authority/);

    const exported = await control('exportTemplate', { teamId: saved.teams[0].id });
    assert.equal(JSON.stringify(exported.template).includes(saved.teams[0].id), false);
    const preview = await control('previewTemplate', { template: exported.template });
    const importRequest = { requestId: 'electron-import', expectedRevision: edited.revision, template: preview.template, previewToken: preview.previewToken, selectionToken: selection.selectionToken };
    edited = (await control('importTemplate', importRequest)).value;
    assert.equal(edited.teams.length, 2); assert.notEqual(edited.teams[0].id, edited.teams[1].id);
    assert.equal(edited.teams[1].members[0].brief, 'Review evidence');
    assert.equal(edited.teams[1].members[0].roleVersion, 1); assert.equal(edited.teams[1].launch, undefined);
    const imported = edited;
    const launchInputs = edited.teams.map((team, index) => ({ requestId: `electron-launch-${index}`, teamId: team.id, memberId: team.members[0].id, configVersion: team.configVersion }));
    const first = await control('launchSupervisor', launchInputs[0]);
    assert.equal(first.kind, 'terminal'); assert.equal(first.observation.state, 'permission');
    const second = await control('launchSupervisor', launchInputs[1]);
    assert.equal(second.kind, 'structured'); assert.equal(second.prompt.outcome, 'journaled'); assert.equal(second.observation.state, 'unknown');
    for (const input of launchInputs) { const { configVersion, ...binding } = input; assert.equal((await control('openMember', binding)).opened, true); }
    assert.equal(launched.size, 2);
    assert.equal((await control('launchSupervisor', launchInputs[0])).handle, first.handle); assert.equal(launched.size, 2);
    assert.equal(runtimeReads.filter(row => row.method === 'terminal.rename').length, 1, 'structured rename must not use terminal methods');
    edited = (await control('load', {})).value;
    terminalStatus = 'idle';
    const objectiveRequests = edited.teams.map((team, index) => ({ requestId: `electron-objective-${index}`, teamId: team.id, expectedRevision: edited.revision, objective: `Verify native objective ${index}` }));
    const terminalWork = (await control('submitWork', objectiveRequests[0])).work;
    assert.equal(terminalWork.input.state, 'accepted', JSON.stringify(terminalWork));
    assert.equal(terminalWork.run.state, 'unverified', 'accepted input does not create a Run');
    assert.equal(terminalWork.processing.state, 'unknown', 'input receipt does not prove a turn');
    assert.equal((await control('submitWork', objectiveRequests[0])).work.id, terminalWork.id);
    objectiveRequests[1].expectedRevision = (await control('load', {})).value.revision;
    const structuredWork = (await control('submitWork', objectiveRequests[1])).work;
    assert.equal(structuredWork.input.state, 'accepted', JSON.stringify(structuredWork));
    assert.equal(structuredWork.processing.state, 'unknown', 'journaled input is not observed processing');
    assert.equal(structuredWork.run.state, 'unverified');
    assert.equal(objectiveSends.size, 2);
    // The fixture supervisor creates Runs only after input. Native SQLite is the owner-evidence boundary.
    for (const work of savedWorks()) createSupervisorRun(work);
    const structuredIntent = savedWorks().find(work => work.id === structuredWork.id);
    const messageId = structuredIntent.nativeSend.params.envelope.clientOperationId;
    history.set('codex:fixture-chat', { submissions: [{ clientMessageId: messageId, dispatchState: 'accepted' }], latestTurn: { turn: { userItemId: 'orca:' + encodeURIComponent(messageId), turnId: 'fixture-objective-turn', state: 'running' } } });
    // Close the genuine renderer; the worker must reconcile through the local socket without any IPC event.
    window.destroy();
    const reconcileDeadline = Date.now() + 12000;
    while (savedWorks().some(work => work.run.state !== 'verified') && Date.now() < reconcileDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(savedWorks().every(work => work.run.state === 'verified'), true, 'closed panel still permits background Run reconciliation');
    const dispatchDeadline = Date.now() + 12000;
    while ((savedPrivate('dispatch').length !== 2 || savedPrivate('dispatch').some(row => row.status !== 'running')) && Date.now() < dispatchDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(savedPrivate('dispatch').length, 2, JSON.stringify(savedPrivate('dispatch-protocol')));
    assert.equal(savedPrivate('dispatch').every(row => row.status === 'running'), true, JSON.stringify(savedPrivate('dispatch')));
    assert.equal(nativeStarts.size, 2, 'only scripted supervisors start native members after admission');
    for (const attempt of savedPrivate('dispatch')) completeNativeDispatch(attempt);
    const completionDeadline = Date.now() + 8000;
    while (savedPrivate('dispatch').some(row => row.status !== 'pending_acceptance') && Date.now() < completionDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(savedPrivate('dispatch').every(row => row.status === 'pending_acceptance'), true, 'native execution requires separate business acceptance');
    window = new BrowserWindow({ show: false, webPreferences: { preload: __dirname + '/preload.cjs', contextIsolation: true, sandbox: false, nodeIntegrationInSubFrames: true } });
    await window.loadFile(__dirname + '/index.html');
    entry = await ipc('plugins:readPanelEntry', { pluginKey: KEY, panelId: 'team' });
    edited = (await control('load', {})).value;
    assert.equal(edited.works.length, 2);
    assert.equal(edited.works.find(work => work.id === terminalWork.id).processing.state, 'unknown');
    assert.equal(edited.works.find(work => work.id === structuredWork.id).processing.state, 'observed');
    for (const work of edited.works) {
      assert.equal(work.run.state, 'verified'); assert.equal(work.snapshot.tasks.length, 2, 'native member Task plus Head-authored user-question Task');
      assert.equal(work.supervisorMemberId, edited.teams.find(team => team.id === work.teamId).members[0].id);
      assert.equal(work.tasks.length, 1); assert.equal(work.tasks[0].status, 'pending_acceptance');
      assert.equal(work.tasks[0].recovery.state, 'confirmed_effect'); assert.equal(work.tasks[0].recovery.incomplete, true); assert.equal(work.tasks[0].recovery.output.archived, true);
      assert.equal(work.tasks[0].outcome, 'succeeded'); assert.match(work.tasks[0].result, /completed inspection/);
      assert.equal(work.nativeSend, undefined); assert.equal(work.protocolToken, undefined);
    }
    const answers=edited.works.map(work=>({workId:work.id,questionId:'fixture-question',questionRevision:1,answerId:'answer-'+work.id,body:'Focused',supplement:false}));
    for(const input of answers){const result=await control('answerQuestion',input);const q=result.value.works.find(w=>w.id===input.workId).questions[0];assert.equal(q.status,'pending');assert.equal(q.answers[0].state,'accepted');assert.equal(q.answers[0].processed,'unconfirmed');await control('answerQuestion',input);}
    assert.equal(questionSends.size,2);assert.equal(notifications.length,2,'one real host capability call per decision');
    // Independent scripted supervisors mutate native Tasks; product transport cannot taskUpdate.
    for(const attempt of savedPrivate('dispatch'))reviewNativeDispatch(attempt,attempt.workId===terminalWork.id?'accept':'rework');
    const reviewDeadline=Date.now()+8000;
    while(savedPrivate('dispatch').some(row=>!row.review)&&Date.now()<reviewDeadline)await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal(savedPrivate('dispatch').every(row=>row.review),true,'background worker verifies native supervisor review receipts');
    edited=(await control('load',{})).value;
    for(const work of edited.works){const task=work.tasks[0];assert.equal(task.status,work.id===terminalWork.id?'accepted':'rework');assert.match(task.result,/completed inspection/);assert.equal(task.review.reviewerMemberId,work.supervisorMemberId);assert.ok(task.review.evidenceRefs.includes(task.evidenceId));}
    for (const secret of [nativeToken, app.getPath('userData'), '/remote/project', structuredIntent.protocolToken]) assert.equal(JSON.stringify(edited).includes(secret), false, 'private runtime and correlation evidence stays private');
    const stableSnapshot = value => ({ revision: value.revision, teams: value.teams.map(team => ({...team, ...(team.launch ? {launch:{...team.launch,members:Object.fromEntries(Object.entries(team.launch.members).map(([id,{recovery,...member}])=>[id,member]))}} : {})})), works: value.works.map(work => ({ id: work.id, teamId: work.teamId, supervisorMemberId: work.supervisorMemberId, objective: work.objective, configVersion: work.configVersion, roleVersion: work.roleVersion, input: work.input, processing: work.processing, runId: work.run.id, consumerGeneration: work.run.consumerGeneration })) });

    assert.equal((await ipc('plugins:panelAction', envelope('foreign.command'))).code, 'invalid_params');
    assert.equal((await ipc('plugins:panelAction', envelope('team.control', 'arbitrary.runtime'))).code, 'invalid_params');
    assert.equal((await ipc('plugins:panelAction', envelope('team.control', 'ping', 'foreign-token'))).code, 'invalid_request');
    const subframe = window.webContents.mainFrame.frames[0];
    assert.equal((await ipc('plugins:panelAction', envelope(), subframe)).code, 'invalid_request');
    admitted = false;
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'rate_limited'); admitted = true;
    enabled = false;
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'consent_required'); enabled = true;
    await new Promise(resolve => setTimeout(resolve, 800));
    const retry = await ipc('plugins:panelAction', envelope('team.initialise'));
    assert.equal(retry.value.reused, true); assert.equal(ipcMain._invokeHandlers.get('plugins:panelAction'), firstHandler);
    assert.deepEqual(stableSnapshot((await control('load', {})).value), stableSnapshot(edited));
    // Recycle only this isolated fixture worker: real SQLite persists, old KV is untouched.
    await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
    start = undefined;
    assert.deepEqual(stableSnapshot((await control('load', {})).value), stableSnapshot(edited));
    assert.deepEqual((await control('createTeam', create)).value, saved, 'recover completed save after worker restart');
    assert.deepEqual((await control('importTemplate', importRequest)).value, imported, 'recover completed import after worker restart');
    assert.deepEqual(stableSnapshot((await control('load', {})).value), stableSnapshot(edited), 'replay never overwrites the latest snapshot');
    assert.equal((await control('launchSupervisor', launchInputs[0])).handle, first.handle);
    assert.equal(launched.size, 2, 'worker restart cannot relaunch a bound member');
    for(const input of answers){await control('answerQuestion',input);assert.equal((await control('load',{})).value.works.find(w=>w.id===input.workId).questions[0].answers.length,1);}
    assert.equal(questionSends.size,2,'answer replay after restart never resends native input');
    assert.equal(notifications.length,2,'reopening and restart never repeats notification');
    for (const request of objectiveRequests) assert.equal((await control('submitWork', request)).work.id, edited.works.find(work => work.teamId === request.teamId).id);
    assert.equal(objectiveSends.size, 2, 'original native input identities remain stable');
    for(const work of (await control('load',{})).value.works){assert.equal(work.tasks[0].status,work.id===terminalWork.id?'accepted':'rework');assert.match(work.tasks[0].result,/completed inspection/);}
    assert.equal(protocolInputs.size, 2); assert.equal(permitInputs.size, 2); assert.equal(nativeStarts.size, 2);
    assert.equal(runtimeReads.some(row => /workerStart|taskCreate|taskUpdate|runCreate|orchestration.send/.test(row.method)), false, 'plugin never impersonates supervisor or emits worker_done');
    assert.equal(objectiveAttempts, 2, 'duplicate submit and worker restart must not repeat user input');
    assert.equal(data.size, 0, 'new format must not write legacy KV');
    await new Promise(resolve => setTimeout(resolve, 800));
    let inspectorOpen = true;
    try { await fetch('http://127.0.0.1:9229/json/list', { signal: AbortSignal.timeout(500) }); } catch { inspectorOpen = false; }
    assert.equal(inspectorOpen, false, 'temporary inspector must close');
    // #114 user-initiated roster preparation remains real renderer IPC and never invents workers.
    const rosterState=(await control('load',{})).value;
    const all=(await control('createTeam',{requestId:'all-roster',expectedRevision:rosterState.revision,selectionToken:(await control('context',{})).selectionToken,form:{...form,name:'All-Roster',launchMode:'all'}})).value.teams.at(-1);
    const beforeRoster=launched.size;
    for(const member of all.members){
      const input={teamId:all.id,memberId:member.id,configVersion:all.configVersion,requestId:'all-'+member.id};
      assert.equal((await control('launchSupervisor',input)).status,'created');
      await control('launchSupervisor',input);
    }
    assert.equal(launched.size-beforeRoster,4,'all preparation opens exactly the four saved members once');
    const prepared=(await control('load',{})).value.teams.find(row=>row.id===all.id);
    assert.deepEqual(Object.keys(prepared.launch.members).sort(),all.members.map(row=>row.id).sort());
    assert.equal(runtimeReads.filter(row=>row.method==='agent.launchReplay').every(row=>row.params.target.kind==='existing'&&row.params.target.worktree==='id:repo::/remote/project'),true,'every roster member uses the exact existing shared Git workspace');
    const stoppedWorks=(await control('load',{})).value.works;
    for(const [index,work] of stoppedWorks.entries()){
      const attempt=savedPrivate('dispatch').find(row=>row.workId===work.id);
      nativeDb.prepare("UPDATE worker_dispatches SET state='ready' WHERE dispatch_id=?").run(attempt.dispatchId);
      const input={requestId:'explicit-stop-'+work.id,teamId:work.teamId,memberId:attempt.memberId,workId:work.id,attemptId:attempt.id};
      const result=await control('stopMember',input);assert.equal(result.value.stops.find(row=>row.requestId===input.requestId).state,index===0?'stopped':'unknown');
      await control('stopMember',input);
    }
    assert.equal(stopCalls,2,'duplicate stops must not repeat the native effect');
    const admission=(await control('load',{})).value;
    await control('setAdmission',{requestId:'pause-team',teamId:all.id,paused:true,expectedRevision:admission.revision});
    const paused=(await control('load',{})).value;assert.equal(paused.teams.find(row=>row.id===all.id).admission.paused,true);
    await control('setAdmission',{requestId:'resume-team',teamId:all.id,paused:false,expectedRevision:paused.revision});
    await ipc('plugins:setEnabled', { pluginKey: KEY, enabled: false });
    assert.notEqual(ipcMain._invokeHandlers.get('plugins:panelAction'), firstHandler);
    assert.equal((await ipc('plugins:panelAction', envelope())).code, 'consent_required');
    console.log('REAL_ELECTRON_WORKER_PASS: exact Dispatch stop UUID over native socket, positive death versus unknown, duplicate suppression, admission pause/resume; genuine main-frame native launch/structured reveal/terminal focus; native local-user Unix RPC for terminal and structured objectives, schema43 owner binding, input/processing/Run separation, native Task author receipts, durable Head questions and answer-before-native-user-input across terminal/structured socket transports and restart, consent-bound notifications, independently committed admission before permit, scripted supervisor worker-start projections and member completion separated from authenticated supervisor accept/rework with immutable originals, panel-closed reconciliation, scoped incomplete archived worker output and restart input deduplication; durable intent-before-effect and identity-before-naming, two objective supervisors plus exactly four additional saved roster sessions with replay deduplication, authenticated runtime capability reads, SQLite save/role/template-copy/restart/replay with confirmed SSH scope, lazy activation, nonce, exact fixture build, retry without duplicate wrappers, foreign command/token/subframe denial, live consent/admission gates, inspector cleanup and disable restoration. Fixture metadata mirrors the pinned build; this is not actual Orca/provider acceptance.');
    clearTimeout(watchdog); child.kill(); nativeSocket.close(); nativeDb.close(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(watchdog); child?.kill(); nativeSocket?.close(); nativeDb?.close(); app.exit(1); }
});
