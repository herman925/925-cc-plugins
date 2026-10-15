import { mediateOperation } from '../src/local/native-broker.mjs';
// Development/test host only: real plugin persistence/service, fake Orca boundary.
import http from 'node:http';
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
    let creates = 0; let title = ''; const launches = new Map(); const sessionIds = new Set(); let host = mode === 'capabilities-local' ? 'local' : 'ssh:demo';
    const cli = async args => {
      if (args[0] === 'worktree') { const id = args[3].replace(/^id:/, ''); return { worktree: { id, displayName: id.startsWith('folder:') ? 'Demo folder' : 'Demo workspace', hostId: host, branch: id.startsWith('folder:') ? '' : 'main' } }; }
      throw Error('CLI launch fallback is forbidden');
    };
    const internalKey = `fixture-${id}`;
    let executor; const history = new Map(); const agents = new Map();
    const nativeDb = new DatabaseSync(join(profile, 'orchestration.db'));
    nativeDb.exec('CREATE TABLE runs(id TEXT PRIMARY KEY,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER); PRAGMA user_version=43');
    const runtime = async (method, params, envelope) => {
      if (method === 'status.get') return { runtimeId: 'fixture-runtime', capabilities: ['orchestration.contract.v1', 'agent-session.structured.v1', 'terminal.prompt-delivery.v1', 'agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1', 'agent-session.structured.registered-agents.v1'] };
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
        if (mode === 'partial' || mode === 'launch-unknown') throw Error('Agent launch outcome unknown');
        const structured = mode === 'structured';
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
      if (method === 'agentSession.reveal' && launch) return { ok: true, sessionId: params.sessionId, workspaceId: launch.worktreeId, agent: 'codex', readable: true };
      if (method === 'agentSession.history') return { ok: true, page: { sessionId: params.sessionId, fence: 7, submissions: [], items: [], ...history.get(params.sessionId) } };
      if (method === 'agentSession.send' || method === 'terminal.send') {
        const work = store.listWorks().find(row => row.input.state === 'sending' && (row.binding.sessionId === params.envelope?.sessionId || row.binding.handle === params.terminal));
        if (!work) throw Error('No durable objective intent');
        const instance = work.instance;
        if (mode !== 'objective-no-run') nativeDb.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run-' + work.id, work.nativeObjective, 'this_database', instance.kind === 'terminal' ? instance.handle : null, instance.paneKey ?? null, instance.kind === 'structured' ? instance.sessionId : null, 1, 1, 0);
        if (mode === 'objective-unknown') throw Error('Objective delivery outcome unknown');
        if (method === 'agentSession.send') {
          const messageId = params.envelope.clientOperationId;
          history.set(params.envelope.sessionId, { submissions: [{ clientMessageId: messageId, dispatchState: 'accepted', providerItemId: 'provider-item' }], latestTurn: { turn: { userItemId: 'orca:' + messageId, turnId: 'turn-one', state: 'running' } } });
          return { ok: true, fence: 7, value: { clientMessageId: messageId, submission: { clientMessageId: messageId, dispatchState: 'pending', providerItemId: null } } };
        }
        return { send: { handle: params.terminal, accepted: true, prompt: { requestId: envelope.orchestrationRequestId, processIncarnation: instance.incarnationId, stages: ['input_accepted', 'turn_started'], observation: 'supported' } } };
      }
      if (method === 'orchestration.runShow') return { run: nativeDb.prepare('SELECT id,objective,consumer_generation FROM runs WHERE id=?').get(params.id) };
      if (method === 'orchestration.taskList') return { tasks: [] };
      throw Error('Unknown fixture read');
    };
    executor = createExecutor({ call: async () => ({ value: null }) }, cli, { store, internalKey, userData: profile, nativeRpc: runtime });
    return { profile, store, executor, nativeDb, async mediate(op, input) {
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
      if (['capabilities', 'launchSupervisor', 'recoverLaunch', 'openMember'].includes(op)) return reply(await f.mediate(op, params));
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
