// Development/test host only. The product is panel.html mounted by Orca.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.env.PORT || 4173);
const csp = "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Orca plugin test host</title><style>body{margin:0;background:#12161d}iframe{display:block;border:0;width:100%;height:100vh}</style></head><body><iframe id="panel" title="Team Orchestrator" sandbox="allow-scripts"></iframe><script>
const frame=document.getElementById('panel');
window.bridgeCalls=[];
window.addEventListener('message',event=>{
 if(event.source!==frame.contentWindow||event.data?.type!=='orca-panel-action')return;
 const {requestId,action,params}=event.data;
 window.bridgeCalls.push({action,params});
 const mode=new URLSearchParams(location.search).get('mode');
 const reply=(value,ok=true,errorCode,error)=>frame.contentWindow.postMessage({type:'orca-panel-action-result',requestId,ok,value,errorCode,error},'*');
 if(action==='workspace.readContext')return reply({displayName:'Demo workspace',branch:'main',terminals:mode==='no-tabs'?[]:[{id:'coordinator-demo'}]});
 if(action==='terminal.sendText'){
  if(params?.terminalId!=='coordinator-demo'||typeof params.text!=='string'||params.text.length>4096||params.enter!==true)return reply(null,false,'invalid_params','Invalid terminal request');
  if(mode==='send-timeout')return;
  return reply({accepted:mode!=='send-reject'});
 }
 if(mode==='unpatched')return reply(null,false,'panel_forbidden','Storage is not panel-callable.');
 if(mode==='timeout')return;
 if(!['storage.get','storage.set'].includes(action)||params?.key!=='team-definitions-v1')return reply(null,false,'invalid_params','Unsupported request.');
 try{
  if(action==='storage.get')reply({value:JSON.parse(localStorage.getItem(params.key)||'null')});
  else if(mode==='write-error')reply(null,false,'action_failed','Disk full');
  else{localStorage.setItem(params.key,JSON.stringify(params.value));reply({ok:true});}
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
