import { mediateOperation } from '../src/local/native-broker.mjs';
// Development/test host only: real plugin persistence/service, fake Orca boundary.
import http from 'node:http';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTeamStore } from '../src/local/store.mjs';
import { createExecutor } from '../src/local/executor.mjs';
const port = Number(process.env.PORT || 4173);
const fixtures = new Map();
async function fixture(id, mode) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid fixture identity');
  if (!fixtures.has(id)) fixtures.set(id, (async () => {
    const profile = await mkdtemp(join(tmpdir(), 'orca-panel-fixture-'));
    const store = await openTeamStore({ userData: profile });
    let creates = 0; let title = ''; const launches = new Map(); const sessionIds = new Set(); let host = mode === 'goal-lifecycle' || mode === 'capabilities-local' || mode?.startsWith('dispatch-') ? 'local' : 'ssh:demo';
    const cli = async args => {
      if (args[0] === 'worktree') { const id = args[3].replace(/^id:/, ''); return { worktree: { id, displayName: id.startsWith('folder:') ? 'Demo folder' : 'Demo workspace', hostId: host, branch: id.startsWith('folder:') ? '' : 'main' } }; }
      throw Error('CLI launch fallback is forbidden');
    };
    const internalKey = `fixture-${id}`;
    let executor; const history = new Map(); const agents = new Map();
    const nativeDb = new DatabaseSync(join(profile, 'orchestration.db'));
    nativeDb.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER); PRAGMA user_version=43');
    nativeDb.exec(`
      CREATE TABLE tasks(id TEXT PRIMARY KEY,run_id TEXT,spec TEXT,status TEXT,result TEXT,created_by_terminal_handle TEXT,created_by_pane_key TEXT,created_by_process_incarnation TEXT,created_by_run_generation INTEGER);
      CREATE TABLE mutation_caller_identities(transport TEXT PRIMARY KEY,caller_fingerprint TEXT);
      INSERT INTO mutation_caller_identities VALUES('local_authenticated_transport','fixture-fingerprint');
      CREATE TABLE mutation_receipts(caller_fingerprint TEXT,request_id TEXT,method TEXT,payload_hash TEXT,state TEXT,receipt TEXT,PRIMARY KEY(caller_fingerprint,request_id));
      CREATE TABLE dispatch_contexts(id TEXT PRIMARY KEY,run_id TEXT,task_id TEXT,creator_handle TEXT,creator_pane_key TEXT,creator_orca_session_id TEXT,creator_dispatch_id TEXT,assignee_handle TEXT,assignee_pane_key TEXT,assignee_orca_session_id TEXT,process_incarnation TEXT,host_scope TEXT,status TEXT,consumer_generation INTEGER);
      CREATE TABLE worker_dispatches(dispatch_id TEXT PRIMARY KEY,worktree_id TEXT,agent_terminal_handle TEXT,state TEXT,runtime_epoch TEXT,start_options TEXT);
      CREATE TABLE attempt_observation_facts(id TEXT PRIMARY KEY,dispatch_id TEXT,task_id TEXT,authority_id TEXT,facet TEXT,payload TEXT);
      CREATE TABLE messages(id TEXT PRIMARY KEY,run_id TEXT,from_handle TEXT,sender_pane_key TEXT,type TEXT,body TEXT,payload TEXT);
    `);
    // Scripted supervisor/provider acts only at the fake native boundary. Product service,
    // SQLite admission and native evidence reader remain real; no public snapshot injection.
    const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value;
    const receipt = (work, requestId, method, params, value) => {
      const owner = work.instance, normalized = { ...params };
      if (owner.kind === 'structured') normalized.__orcaCallerOrcaSessionId = owner.sessionId;
      if (owner.paneKey) for (const key of ['from', 'callerTerminalHandle']) if (typeof normalized[key] === 'string') normalized[key] = { paneKey: owner.paneKey };
      const hash = createHash('sha256').update(JSON.stringify(canonical({ method, params: normalized }))).digest('hex');
      nativeDb.prepare('INSERT INTO mutation_receipts VALUES (?,?,?,?,?,?)').run('fixture-fingerprint', requestId, method, hash, 'completed', JSON.stringify(value));
    };
    const supervisorInput = (work, text) => {
      if(mode==='goal-lifecycle'){
        if(!text.startsWith('TEAM_DISPATCH_PROTOCOL\n')&&!text.startsWith('TEAM_GOAL_REWORK\n'))return;
        const p=store.readDispatchProtocol(work.id),previous=store.deliveryProjection(work.id).delivery;
        const id='delivery-'+work.id+'-'+(previous?previous.revision+1:1),spec=JSON.stringify({protocol:'team-delivery/v1',workId:work.id,token:p.token,generation:p.generation,supervisorMemberId:work.supervisorMemberId,previousDeliveryId:previous?.id??null,summary:previous?'Corrected audit <script>':'Audit delivered <script>',evidenceRefs:['report.md','tests:passed'],attemptIds:[]}),task={id,run_id:work.run.id,spec,status:'ready'};
        const owner=work.instance,from=owner.kind==='structured'?'orca_session_id:'+owner.sessionId:owner.handle;
        nativeDb.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)').run(id,work.run.id,spec,'ready',null,owner.kind==='terminal'?owner.handle:null,owner.kind==='terminal'?owner.paneKey:null,owner.kind==='terminal'?owner.incarnationId:null,owner.kind==='terminal'?p.generation:null);
        receipt(work,'create-'+id,'orchestration.taskCreate',{spec,run:work.run.id,callerTerminalHandle:from},{task});return;
      }
      if (!mode?.startsWith('dispatch-')) return;
      const owner = work.instance, from = owner.kind === 'structured' ? 'orca_session_id:' + owner.sessionId : owner.handle;
      if (text.startsWith('TEAM_DISPATCH_PROTOCOL\n')) {
        const protocol = JSON.parse(text.slice('TEAM_DISPATCH_PROTOCOL\n'.length));
        const children=mode==='dispatch-scheduling'?protocol.children:protocol.children.slice(0,1);
        for(const [index,member] of children.entries()){
        const spec = JSON.stringify({ protocol: protocol.protocol, workId: work.id, token: protocol.token, generation: protocol.generation, taskKey: mode==='dispatch-scheduling'?['edit-source','overlap-source','independent-docs'][index]:'inspect-checkout', memberId: member.memberId, configVersion: protocol.configVersion, roleVersion: member.roleVersion, role: member.role, writeScope: mode==='dispatch-scheduling'?[{path:index===0?'src':index===1?'src/app.js':'docs/readme.md',kind:index===0?'directory':'file'}]:[], instruction: 'Inspect checkout <script> safely' });
        const task = { id: 'native-task-fixture-'+index, run_id: work.run.id, spec, status: 'ready', result: null };
        nativeDb.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)').run(task.id, work.run.id, spec, 'ready', null, owner.kind === 'terminal' ? owner.handle : null, owner.kind === 'terminal' ? owner.paneKey : null, owner.kind === 'terminal' ? owner.incarnationId : null, owner.kind === 'terminal' ? protocol.generation : null);
        receipt(work, 'create-task-fixture-'+index, 'orchestration.taskCreate', { spec, run: work.run.id, callerTerminalHandle: from }, { task });
        }
      }
      if(mode==='dispatch-staffing'&&text.startsWith('TEAM_DISPATCH_PROTOCOL\n')){
        const p=JSON.parse(text.slice(text.indexOf('\n')+1)),spec=JSON.stringify({protocol:'team-questions/v1',kind:'staffing-proposal',workId:work.id,token:p.token,generation:p.generation,appQuestionId:'reviewer-proposal',configVersion:p.configVersion,roleVersion:1,proposingManagerId:work.supervisorMemberId,member:{name:'Independent reviewer <script>',boss:work.supervisorMemberId,brief:'Review sources.',habits:'',collaboration:'Report directly.',agent:'claude',model:'default',effort:'default'},rationale:'Need independent review.',affectedTaskKeys:[]}),task={id:'staffing-fixture',run_id:work.run.id,spec,status:'ready'};
        nativeDb.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)').run(task.id,work.run.id,spec,'ready',null,owner.kind==='terminal'?owner.handle:null,owner.kind==='terminal'?owner.paneKey:null,owner.kind==='terminal'?owner.incarnationId:null,owner.kind==='terminal'?p.generation:null);
        receipt(work,'staffing-fixture-create','orchestration.taskCreate',{spec,run:work.run.id,callerTerminalHandle:from},{task});
      }
      if (mode.startsWith('dispatch-question') && text.startsWith('TEAM_DISPATCH_PROTOCOL\n')) {
        const p=JSON.parse(text.slice(text.indexOf('\n')+1)),spec=JSON.stringify({protocol:'team-questions/v1',kind:'user-question',workId:work.id,token:p.token,generation:p.generation,appQuestionId:'scope-choice',summary:'Choose scope <script>',options:['Focused','Full'],blockingTaskKeys:[]});
        const task={id:'question-fixture',run_id:work.run.id,spec,status:'ready'};
        nativeDb.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?)').run(task.id,work.run.id,spec,'ready',null,owner.kind==='terminal'?owner.handle:null,owner.kind==='terminal'?owner.paneKey:null,owner.kind==='terminal'?owner.incarnationId:null,owner.kind==='terminal'?p.generation:null);
        receipt(work,'question-fixture-create','orchestration.taskCreate',{spec,run:work.run.id,callerTerminalHandle:from},{task});
      }
      if (mode==='dispatch-question-unknown' && text.startsWith('TEAM_USER_ANSWER\n')) throw Error('Lost answer receipt');
      if (text.startsWith('TEAM_DISPATCH_PERMIT\n')) {
        const permit = JSON.parse(text.slice('TEAM_DISPATCH_PERMIT\n'.length));
        const attempt = store.listDispatches(work.id).find(row => row.id === permit.attemptId);
        assert.equal(attempt.status, 'admitted', 'Admission must be durable before the fake supervisor receives permission');
        assert.equal(attempt.memberId, permit.memberId);
        if(mode==='dispatch-queued')return;
        if (mode === 'dispatch-unknown') throw Error('Native start evidence unavailable');
        const dispatchId = 'dispatch-'+permit.nativeTaskId, handle = 'structworker_'+permit.nativeTaskId, paneKey = 'child-tab:'+permit.nativeTaskId;
        const complete = !['dispatch-running','dispatch-scheduling','dispatch-stop-success','dispatch-stop-unknown','dispatch-stop-unsupported'].includes(mode), outcome = mode === 'dispatch-failed' ? 'failed' : 'succeeded';
        nativeDb.prepare('INSERT INTO dispatch_contexts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(dispatchId, work.run.id, permit.nativeTaskId, owner.kind === 'terminal' ? owner.handle : null, owner.kind === 'terminal' ? owner.paneKey : null, owner.kind === 'structured' ? owner.sessionId : null, null, handle, paneKey, permit.startParams.agent + '_child_'+permit.nativeTaskId, 'child-instance', JSON.stringify({ kind: 'local', hostId: 'local' }), complete ? outcome === 'succeeded' ? 'completed' : 'failed' : 'dispatched', permit.generation);
        nativeDb.prepare('INSERT INTO worker_dispatches VALUES (?,?,?,?,?,?)').run(dispatchId, work.scope.workspaceId, handle, complete ? outcome : 'ready', 'fixture-runtime', JSON.stringify({ resolvedWorktreeId: work.scope.workspaceId, agent: permit.startParams.agent, worktree: work.scope.workspaceId }));
        nativeDb.prepare("UPDATE tasks SET status='dispatched' WHERE id=?").run(permit.nativeTaskId);
        receipt(work, 'start-'+permit.nativeTaskId, 'orchestration.workerStart', { ...permit.startParams, from, devMode: false }, { runId: work.run.id, taskId: permit.nativeTaskId, dispatchId, state: 'ready' });
        if (complete) {
          nativeDb.prepare('INSERT INTO messages VALUES (?,?,?,?,?,?,?)').run('report-fixture', work.run.id, handle, paneKey, 'worker_done', outcome === 'succeeded' ? 'Checkout evidence <b>verified</b>' : 'Checkout verification failed', JSON.stringify({ taskId: permit.nativeTaskId, dispatchId, outcome }));
          nativeDb.prepare('INSERT INTO attempt_observation_facts VALUES (?,?,?,?,?,?)').run('worker_report:report-fixture', dispatchId, permit.nativeTaskId, 'run_home:' + work.run.id, 'worker_report', JSON.stringify({ status: 'accepted', outcome, reportId: 'worker_report:report-fixture' }));
          if (['dispatch-accepted','dispatch-rework','dispatch-missing-review'].includes(mode)) {
            const result = JSON.stringify({protocol:'team-review/v1',workId:work.id,token:attempt.token,generation:permit.generation,taskKey:attempt.taskKey,attemptId:attempt.id,nativeTaskId:attempt.nativeTaskId,dispatchId,reviewToken:permit.reviewToken,reviewerMemberId:work.supervisorMemberId,decision:mode==='dispatch-rework'?'rework':'accept',evidenceRefs:mode==='dispatch-missing-review'?[]:['worker_report:report-fixture','test:checkout'],summary:'Supervisor checked <b>validation</b>.'});
            const task={...nativeDb.prepare('SELECT * FROM tasks WHERE id=?').get(attempt.nativeTaskId),status:'completed',result};
            nativeDb.prepare('UPDATE tasks SET status=?,result=? WHERE id=?').run('completed',result,attempt.nativeTaskId);
            receipt(work,'review-task-fixture','orchestration.taskUpdate',{id:attempt.nativeTaskId,status:'completed',result,run:work.run.id,callerTerminalHandle:from},{task});
          }

        }
      }
    };
    const runtime = async (method, params, envelope) => {
      if(method==='orchestration.workerStop'){
        if(mode==='dispatch-stop-unsupported')throw Object.assign(Error('Native worker stop is unsupported by this host.'),{native:true,code:'method_not_supported'});
        assert.match(envelope.orchestrationRequestId,/^[a-f0-9-]{36}$/);assert.deepEqual(Object.keys(params),['dispatch']);
        return {dispatchId:params.dispatch,state:mode==='dispatch-stop-unknown'?'stop_unknown':'stopped',processAction:'closed_agent_terminal',close:{ptyKilled:mode!=='dispatch-stop-unknown'}};
      }
      if (method === 'status.get') return { runtimeId: 'fixture-runtime', capabilities: [...(mode==='dispatch-queued'?['agent-session.queued-messages.v1']:[]),'orchestration.contract.v1', 'agent-session.structured.v1', 'terminal.prompt-delivery.v1', 'agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1', 'agent-session.structured.registered-agents.v1'] };
      if (method === 'worktree.show') return { worktree: { id: params.worktree.replace(/^id:/, ''), hostId: host } };
      if (method === 'settings.get') return { settings: { disabledTuiAgents: [] } };
      if (method === 'ssh.getState') return { state: { status: 'connected', connectionGeneration: 1 } };
      if (method.startsWith('preflight.')) return ['codex', 'claude'];
      if (method === 'agentSession.agents') return { agents: [] };
      if (method === 'agentSession.createSupport') return { supported: true, seedOptions: {} };
      if (method === 'agentSession.modelCatalog') return { origin: 'probe', fetchedAt: Date.now(), models: [{ id: params.agent === 'claude' ? 'claude-model' : 'my-model', label: 'Fixture host model', isDefault: false, efforts: (params.agent === 'claude' ? ['low', 'max'] : ['high', 'ultra']).map(value => ({ value, label: value })) }] };
      if (method === 'agent.launchReplay') {
        if (launches.has(params.operationId)) return launches.get(params.operationId);
        creates++;
        if (mode === 'partial' || mode === 'launch-unknown' || mode === 'roster-partial' && creates === 2) throw Error('Agent launch outcome unknown');
        const structured = mode === 'goal-lifecycle' || mode === 'structured' || (mode?.startsWith('dispatch-') && mode !== 'dispatch-reverse');
        const result = { worktreeId: params.target.worktree.replace(/^id:/, ''), outcome: structured ? { kind: 'structured', handle: `chat-${creates}`, sessionId: `codex:fixture-${creates}` } : { kind: 'terminal', handle: `created-member-${creates}`, paneKey: `tab-${creates}:leaf-${creates}` }, receipt: { mode: structured ? 'structured' : 'terminal', preferred: structured ? 'structured' : 'terminal', reason: 'user_default', detail: 'Fixture native mode' }, prompt: { delivery: 'submit', outcome: structured ? 'journaled' : 'handed-to-terminal', ...(structured ? { messageId: 'message-1' } : {}) } };
        launches.set(params.operationId, result); agents.set(result.outcome.handle, params.agent); if (structured) sessionIds.add(result.outcome.sessionId); return result;
      }
      const launch = [...launches.values()].find(row => row.outcome.handle === params?.terminal || row.outcome.sessionId === params?.sessionId);
      if (method === 'terminal.show' && launch) { const [tabId, leafId] = launch.outcome.paneKey.split(':'); return { terminal: { handle: params.terminal, worktreeId: launch.worktreeId, executionHostId: host, tabId, leafId, connected: true, writable: true, incarnationId: 'instance-' + params.terminal, agentIdentity: agents.get(params.terminal) } }; }
      if (method === 'terminal.rename') { title = params.title; return { rename: { handle: params.terminal, title, tabId: 'tab-1' } }; }
      if (method === 'terminal.agentStatus') return { agentStatus: { handle: params.terminal, isRunningAgent: true, status: mode === 'permission' ? 'permission' : 'idle' } };
      if (method === 'terminal.focus') return { focus: { handle: params.terminal } };
      if (method === 'orchestration.sessionAddress') return { orcaSessionId: `orca_session_id:${params.sessionId}` };
      if (method === 'orchestration.partyLocation') { const sessionId = params.address.slice('orca_session_id:'.length), row = [...launches.values()].find(row => row.outcome.sessionId === sessionId); return { location: row ? { kind: 'chat', sessionId, worktreeId: row.worktreeId } : null }; }
      if (method === 'agentSession.reveal' && launch) return { ok: true, sessionId: params.sessionId, workspaceId: launch.worktreeId, agent: agents.get(launch.outcome.handle), readable: true };
      if (method === 'agentSession.history') return { ok: true, page: { sessionId: params.sessionId, fence: 7, submissions: [], items: [], ...history.get(params.sessionId) } };
      if (method === 'agentSession.send' || method === 'terminal.send') {
        const text = params.body?.blocks?.[0]?.text ?? params.text;
        const dispatchInput = text?.startsWith('TEAM_ROSTER_DELTA\n') || text?.startsWith('TEAM_GOAL_REWORK\n') || text?.startsWith('TEAM_DISPATCH_') || text?.startsWith('TEAM_USER_ANSWER\n') || text?.startsWith('TEAM_FAILURE_SUMMARY_NEEDED\n');
        const work = store.listWorks().find(row => (dispatchInput || row.input.state === 'sending') && (row.binding.sessionId === params.envelope?.sessionId || row.binding.handle === params.terminal));
        if (!work) throw Error('No durable objective intent');
        const instance = work.instance;
        if (!dispatchInput && mode !== 'objective-no-run') nativeDb.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run-' + work.id, work.nativeObjective, 'this_database', instance.kind === 'terminal' ? instance.handle : null, instance.paneKey ?? null, instance.kind === 'structured' ? instance.sessionId : null, 1, 1, 0);
        if (dispatchInput) supervisorInput(work, text);
        if (mode === 'objective-unknown') throw Error('Objective delivery outcome unknown');
        if (method === 'agentSession.send') {
          const messageId = params.envelope.clientOperationId;
          if(mode==='dispatch-queued'&&text.startsWith('TEAM_DISPATCH_PERMIT')){assert.equal(params.delivery,'queue-if-active');return {ok:true,value:{clientMessageId:messageId,queued:{messageId:'queue-'+messageId,state:'waiting',position:1}}};}
          if (!dispatchInput) history.set(params.envelope.sessionId, { submissions: [{ clientMessageId: messageId, dispatchState: 'accepted', providerItemId: 'provider-item' }], latestTurn: { turn: { userItemId: 'orca:' + messageId, turnId: 'turn-one', state: 'running' } } });
          return { ok: true, fence: 7, value: { clientMessageId: messageId, submission: { clientMessageId: messageId, dispatchState: 'pending', providerItemId: null } } };
        }
        return { send: { handle: params.terminal, accepted: true, prompt: { requestId: envelope.orchestrationRequestId, processIncarnation: instance.incarnationId, stages: ['input_accepted', 'turn_started'], observation: 'supported' } } };
      }
      if (method === 'orchestration.runShow') return { run: nativeDb.prepare('SELECT id,objective,consumer_generation FROM runs WHERE id=?').get(params.id) };
      if (method === 'orchestration.taskList') return { tasks: nativeDb.prepare('SELECT id,run_id,status FROM tasks WHERE run_id=?').all(params.run) };
      if (method === 'orchestration.workerRead') return { dispatchId: params.dispatch, source: 'terminal', sourceIdentity: 'fixture-output', sourceExact: true, contentComplete: false, warnings: ['SSH output clipped <img src=x onerror=alert(1)>'], archived: true };
      if (method === 'orchestration.workerShow') {
        const d = nativeDb.prepare('SELECT * FROM dispatch_contexts WHERE id=?').get(params.dispatch), w = nativeDb.prepare('SELECT * FROM worker_dispatches WHERE dispatch_id=?').get(params.dispatch);
        return { dispatch: { id: d.id, runId: d.run_id, taskId: d.task_id, assigneeHandle: d.assignee_handle, assigneePaneKey: d.assignee_pane_key, processIncarnation: d.process_incarnation, hostScope: JSON.parse(d.host_scope), status: d.status }, worker: { dispatchId: d.id, worktreeId: w.worktree_id, agentTerminalHandle: w.agent_terminal_handle, state: w.state, runtimeEpoch: w.runtime_epoch, startOptions: JSON.parse(w.start_options) }, observation: { status: 'live', exactWorker: true }, projection: {} };
      }
      throw Error('Unknown fixture read');
    };
    executor = createExecutor({ call: async () => ({ value: null }) }, cli, { store, internalKey, userData: profile, nativeRpc: runtime });
    return { profile, store, executor, nativeDb, async mediate(op, input) {
      if(op==='stopMember'){
        const row=await executor.execute({op:'_stopPrepare',params:input,internalKey}),plan=await executor.execute({op:'_stopValidate',params:{requestId:row.requestId},internalKey});
        if(plan){let receipt,error;try{receipt=await runtime(plan.method,plan.params,plan.envelope);}catch(e){error={message:e.message,native:e.native===true,code:e.code};}await executor.execute({op:'_stopSettle',params:{requestId:row.requestId,receipt,error},internalKey});}
        return executor.execute({op:'load'});
      }
      const result = await mediateOperation({ op, input, invoke: args => executor.execute({ ...args, internalKey }), rpc: runtime, authority: async () => {} });
      return result.value;
    } };
  })());
  return fixtures.get(id);
}
const csp = "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Orca plugin test host</title><style>body{margin:0;background:#12161d}iframe{display:block;border:0;width:100%;height:100vh}</style></head><body><iframe id="panel" title="Team Orchestrator" sandbox="allow-scripts"></iframe><script>
const frame=document.getElementById('panel');window.bridgeCalls=[];
const fixtureId=localStorage.getItem('fixtureId')||crypto.randomUUID();localStorage.setItem('fixtureId',fixtureId);
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.data?.type!=='orca-panel-action')return;
 const {requestId,action,params}=event.data;window.bridgeCalls.push({action,params});
 const mode=new URLSearchParams(location.search).get('mode');
 const reply=result=>frame.contentWindow.postMessage({type:'orca-panel-action-result',requestId,...result},'*');
 const message=params?.teamWorker;
 if(action!=='workspace.readContext'||message?.protocol!==1||!['team.control','team.initialise'].includes(message.commandId))return reply({ok:false,errorCode:'invalid_params',error:'Unsupported worker envelope'});
 if(mode==='unpatched')return reply({ok:true,value:{displayName:'Stock context'}});
 if(mode==='timeout'||(mode==='create-timeout'&&message.args?.op==='start'))return;
 try{const result=await fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({fixtureId,mode,message})});reply(await result.json());}
 catch(error){reply({ok:false,error:error.message});}
});
fetch('/panel.html').then(r=>r.text()).then(html=>{frame.srcdoc=html.replace('<head>',${JSON.stringify(`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)});});
</script></body></html>`;
http.createServer(async (req, res) => {
  const path = req.url?.split('?')[0];
  if (path === '/rpc' && req.method === 'POST') {
    try {
      let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1024 * 1024 + 8192) throw Error('Fixture request too large'); }
      const { fixtureId, mode, message } = JSON.parse(body);
      const reply = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value })); };
      if (message.commandId === 'team.initialise') return reply({ ready: true });
      if (mode === 'unsupported-build') return reply({ nonce: message.nonce, ready: false, platform: 'darwin', workerPid: 1234, code: 'unsupported_build', detail: 'Unsupported Orca build. Revalidate this package before enabling the compatibility layer.' });
      const { op, params = {} } = message.args;
      if (op === 'ping') return reply({ nonce: message.nonce, ready: true, platform: 'darwin', appVersion: '1.4.222', workerPid: 1234 });
      if (mode === 'read-error' && op === 'load') throw Error('Team database damaged. Original data has been preserved.');
      if (mode === 'write-error' && ['createTeam', 'updateRole', 'updateSettings', 'importTemplate'].includes(op)) throw Error('Disk full');
      if (op === 'context' && mode === 'no-workspace') return reply(null);
      const f = await fixture(fixtureId, mode);
      if (['saveStaffing','stopMember','decideWork', 'startNextGoal', 'capabilities', 'launchSupervisor', 'recoverLaunch', 'openMember'].includes(op)) return reply(await f.mediate(op, params));
      return reply(await f.executor.execute({ op, params, workspaceId: mode === 'folder' ? 'folder:/fixture/folder' : 'repo::/fixture/project' }));
    } catch (error) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, errorCode: 'action_failed', error: error.message })); }
  } else if (path === '/panel.html') {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(new URL('../panel.html', import.meta.url))); }
    catch { res.writeHead(500); res.end('Run npm run build first.'); }
  } else if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Sandbox test host: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  for (const promise of fixtures.values()) { const f = await promise; f.executor.stopWork(); f.nativeDb.close(); f.store.close(); await rm(f.profile, { recursive: true, force: true }); }
  process.exit(0);
});
