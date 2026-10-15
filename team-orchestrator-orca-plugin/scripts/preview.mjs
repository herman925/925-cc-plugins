// Development/test host only. The product is panel.html mounted by Orca.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.PORT || 4173);
const csp = "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Orca plugin test host</title><style>body{margin:0;background:#12161d}iframe{display:block;border:0;width:100%;height:100vh}</style></head><body><iframe id="panel" title="Team Orchestrator" sandbox="allow-scripts"></iframe><script>
const frame=document.getElementById('panel');
window.bridgeCalls=[];
let creates=0;
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow||event.data?.type!=='orca-panel-action')return;
 const {requestId,action,params}=event.data;
 window.bridgeCalls.push({action,params});
 const mode=new URLSearchParams(location.search).get('mode');
 const reply=(value,ok=true,errorCode,error)=>frame.contentWindow.postMessage({type:'orca-panel-action-result',requestId,ok,value,errorCode,error},'*');
 const message=params?.teamWorker;
 if(action!=='workspace.readContext'||message?.protocol!==1||!['team.control','team.initialise'].includes(message.commandId))return reply(null,false,'invalid_params','Unsupported worker envelope');
 if(mode==='unpatched')return reply({displayName:'Stock context'});
 if(mode==='timeout')return;
 if(message.commandId==='team.initialise')return reply({ready:true});
 if(mode==='unsupported-build')return reply({nonce:message.nonce,ready:false,platform:'darwin',workerPid:1234,code:'unsupported_build',detail:'Unsupported Orca build. Revalidate this package before enabling the compatibility layer.'});
 const {op,params:input={}}=message.args;
 if(op==='ping')return reply({nonce:message.nonce,ready:true,platform:'linux',appVersion:'1.4.224',workerPid:1234});
 if(op==='context')return reply(mode==='no-workspace'?null:{displayName:'Demo workspace',branch:'main',workspaceKey:'a'.repeat(64),nativeAgentLaunch:true});
 if(op==='start'){
  if(input.workspaceKey!=='a'.repeat(64)||!['codex','claude'].includes(input.agent)||!input.title||!input.brief)return reply(null,false,'invalid_params','Invalid launch request');
  if(mode==='create-timeout')return;
  creates++;
  const record=mode==='partial'&&creates===2?{status:'unknown',error:'Agent launch outcome unknown'}:{status:'created',handle:'created-member-'+creates,title:input.title,executionHostId:'ssh:demo',briefAccepted:true};
  localStorage.setItem('launch:'+input.requestId,JSON.stringify(record));
  return reply({status:'starting'});
 }
 if(op==='receipt')return reply(JSON.parse(localStorage.getItem('launch:'+input.requestId)||'null'));
 try{
  if(op==='load')reply({value:JSON.parse(localStorage.getItem('team-definitions-v1')||'null')});
  else if(op!=='save')reply(null,false,'invalid_params','Unknown operation');
  else if(mode==='write-error')reply(null,false,'action_failed','Disk full');
  else{localStorage.setItem('team-definitions-v1',JSON.stringify(input.value));reply({ok:true});}
 }catch(error){reply(null,false,'action_failed',error.message);}
});
fetch('/panel.html').then(r=>r.text()).then(html=>{frame.srcdoc=html.replace('<head>',${JSON.stringify(`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`)});});
</script></body></html>`;
http.createServer(async (req, res) => {
  if (req.url?.split('?')[0] === '/panel.html') {
    try { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(await readFile(new URL('../panel.html', import.meta.url))); }
    catch { res.writeHead(500); res.end('Run npm run build first.'); }
  } else if (req.url?.split('?')[0] === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }
  else { res.writeHead(404); res.end(); }
}).listen(port, '127.0.0.1', () => console.log(`Sandbox test host: http://127.0.0.1:${port}`));
