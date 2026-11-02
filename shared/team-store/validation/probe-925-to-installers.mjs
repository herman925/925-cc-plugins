// All installs, updates and removals are confined to fresh temporary consumers.
import {spawnSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,cp,readFile,writeFile,access} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createInterface} from 'node:readline';
import {pathToFileURL,fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const executable=process.argv[2];if(!executable)throw Error('Supply the native Codex executable.');
const repo=fileURLToPath(new URL('../../../',import.meta.url)),root=await mkdtemp(join(tmpdir(),'team-orchestration-925-distribution-')),market=join(root,'market'),home=join(root,'codex-home'),consumer=join(root,'plugin-consumer'),npxConsumer=join(root,'npx-consumer');
for(const dir of [join(market,'.agents','plugins'),join(market,'.claude-plugin'),home,consumer,npxConsumer])await mkdir(dir,{recursive:true});
await cp(join(repo,'team-orchestration-925'),join(market,'team-orchestration-925'),{recursive:true});await cp(join(repo,'.agents/plugins/marketplace.json'),join(market,'.agents/plugins/marketplace.json'));await cp(join(repo,'.claude-plugin/marketplace.json'),join(market,'.claude-plugin/marketplace.json'));
const evidence={root,modelTurnsStarted:0,checks:[],commands:[]},env={...process.env,CODEX_HOME:home};
function run(bin,args,cwd=consumer){const r=spawnSync(bin,args,{cwd,env,encoding:'utf8',windowsHide:true,timeout:90000});evidence.commands.push({program:bin===executable?'codex':'npx',args,exit:r.status,stdout:r.stdout,stderr:r.stderr});assert.equal(r.status,0,r.stderr);return r.stdout;}
try{
 const added=JSON.parse(run(executable,['plugin','marketplace','add',market,'--json']));assert.equal(added.marketplaceName,'herman925-codex');evidence.checks.push('Codex selected the Codex marketplace while the Claude marketplace also existed');
 const installed=JSON.parse(run(executable,['plugin','add','team-orchestration-925@herman925-codex','--json']));assert.equal(installed.version,'0.1.1');
 const installedSkill=join(installed.installedPath,'skills','team-orchestration-925');assert.deepEqual(await readFile(join(installedSkill,'scripts/runtime/codex-mcp.mjs')),await readFile(join(repo,'shared/team-store/codex-mcp.mjs')));await import(pathToFileURL(join(installedSkill,'scripts/setup.mjs')).href);evidence.checks.push('native plugin installation contains a relocatable matching runtime and setup helper');
 // No model turn: query actual Codex skill discovery for the installed package.
 const child=spawn(executable,['app-server','--listen','stdio://'],{cwd:consumer,env,windowsHide:true,stdio:['pipe','pipe','ignore']});let seq=0;const pending=new Map();const timer=setTimeout(()=>child.kill(),30000);
 const reader=(async()=>{for await(const line of createInterface({input:child.stdout})){let row;try{row=JSON.parse(line);}catch{continue;}if(!row.method&&pending.has(row.id)){const p=pending.get(row.id);pending.delete(row.id);row.error?p.reject(Error(JSON.stringify(row.error))):p.resolve(row.result);}}})();child.on('exit',()=>{for(const p of pending.values())p.reject(Error('Owned app-server exited.'));pending.clear();});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 try{await rpc('initialize',{clientInfo:{name:'925_to_distribution_probe',version:'0.1.0'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');const listed=await rpc('skills/list',{cwds:[consumer],forceReload:true});const matches=listed.data.flatMap(d=>d.skills).filter(s=>s.name==='team-orchestration-925'||s.name.endsWith(':team-orchestration-925'));assert.equal(matches.length,1);assert.equal(matches[0].name,'team-orchestration-925:team-orchestration-925');evidence.skills=matches.map(s=>({name:s.name,path:s.path}));evidence.checks.push('actual Codex skills/list discovers the installed skill');}
 finally{child.stdin.end();const stop=setTimeout(()=>child.kill(),2000);await reader;clearTimeout(stop);clearTimeout(timer);}
 const npx=join(dirname(process.execPath),'node_modules/npm/bin/npx-cli.js');await access(npx);run(process.execPath,[npx,'--yes','skills@1.7.4','add',join(market,'team-orchestration-925'),'--skill','team-orchestration-925','--agent','codex','--copy','--yes'],npxConsumer);
 const copied=join(npxConsumer,'.agents/skills/team-orchestration-925');assert.deepEqual(await readFile(join(copied,'scripts/runtime/codex-mcp.mjs')),await readFile(join(repo,'shared/team-store/codex-mcp.mjs')));await import(pathToFileURL(join(copied,'scripts/setup.mjs')).href);evidence.checks.push('pinned npx installer copies the same standalone skill/runtime');
 for(const name of ['plugin.json','.codex-plugin/plugin.json']){const path=join(market,'team-orchestration-925',name),json=JSON.parse(await readFile(path,'utf8'));json.version='0.1.2';await writeFile(path,JSON.stringify(json,null,2));}
 const updated=JSON.parse(run(executable,['plugin','add','team-orchestration-925@herman925-codex','--json']));assert.equal(updated.version,'0.1.2');evidence.checks.push('native plugin reinstall updates to the changed local release');
 run(executable,['plugin','remove','team-orchestration-925@herman925-codex','--json']);assert.equal(JSON.parse(run(executable,['plugin','list','--json'])).installed.length,0);evidence.checks.push('native plugin removal removes its installed entry');evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);process.exitCode=1;}
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({root,passed:evidence.passed,checks:evidence.checks,error:evidence.error}));
