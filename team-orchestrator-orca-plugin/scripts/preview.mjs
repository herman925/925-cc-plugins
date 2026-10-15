// Development/test host only: real plugin persistence/service, fake Orca boundary.
import http from 'node:http';
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
    let creates = 0; let title = ''; let host = 'ssh:demo';
    const cli = async args => {
      if (args[0] === 'worktree') { const id = args[3].replace(/^id:/, ''); return { worktree: { id, displayName: id.startsWith('folder:') ? 'Demo folder' : 'Demo workspace', hostId: host, branch: id.startsWith('folder:') ? '' : 'main' } }; }
      if (args[0] === 'agent-context') return { commands: [{ command: 'agent launch' }] };
      if (args[1] === 'launch') { creates++; if (mode === 'partial' && creates === 2) throw Error('Agent launch outcome unknown'); return { outcome: { handle: `created-member-${creates}` }, prompt: { outcome: 'journaled' } }; }
      if (args[1] === 'rename') title = args[5];
      return { terminal: { title, executionHostId: host } };
    };
    return { profile, store, executor: createExecutor({}, cli, { store }) };
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
      let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) throw Error('Fixture request too large'); }
      const { fixtureId, mode, message } = JSON.parse(body);
      const reply = value => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value })); };
      if (message.commandId === 'team.initialise') return reply({ ready: true });
      if (mode === 'unsupported-build') return reply({ nonce: message.nonce, ready: false, platform: 'darwin', workerPid: 1234, code: 'unsupported_build', detail: 'Unsupported Orca build. Revalidate this package before enabling the compatibility layer.' });
      const { op, params = {} } = message.args;
      if (op === 'ping') return reply({ nonce: message.nonce, ready: true, platform: 'darwin', appVersion: '1.4.222', workerPid: 1234 });
      if (mode === 'read-error' && op === 'load') throw Error('Team database damaged. Original data has been preserved.');
      if (mode === 'write-error' && ['createTeam', 'updateRole', 'updateSettings'].includes(op)) throw Error('Disk full');
      if (op === 'context' && mode === 'no-workspace') return reply(null);
      const f = await fixture(fixtureId, mode);
      return reply(await f.executor.execute({ op, params, workspaceId: mode === 'folder' ? 'folder:/fixture/folder' : 'repo::/fixture/project' }));
    } catch (error) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, errorCode: 'action_failed', error: error.message })); }
  } else if (path === '/panel.html') {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(new URL('../panel.html', import.meta.url))); }
    catch { res.writeHead(500); res.end('Run npm run build first.'); }
  } else if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Sandbox test host: http://127.0.0.1:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
  for (const promise of fixtures.values()) { const f = await promise; f.store.close(); await rm(f.profile, { recursive: true, force: true }); }
  process.exit(0);
});
