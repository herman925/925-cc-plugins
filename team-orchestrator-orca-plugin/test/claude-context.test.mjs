import { rmTemp } from './temp.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { statuslineSample, saveStatuslineSample, readStatuslineContext, registerStatuslineBinding, statuslineBinding, claudeContextFile, claudeContextDirectory } from '../src/local/claude-context.mjs';
import { createClaudeStatuslineSettings } from '../src/local/claude-statusline-settings.mjs';
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
const shown={handle:'term',ptyId:'pty',incarnationId:'instance',tabId:'tab',leafId:'leaf',worktreePath:'/work'};
const provider={sessionId:'session',path:'/work/session.jsonl'};
const payload=(overrides={})=>({session_id:'session',transcript_path:provider.path,cwd:'/work',model:{id:'custom[1m]'},context_window:{context_window_size:1000000,used_percentage:4,current_usage:{input_tokens:1000,cache_creation_input_tokens:0,cache_read_input_tokens:39000,output_tokens:2000}},...overrides});
test('statusline fields preserve declared 1M window and input-only percentage, without model guessing',()=>{
 const sample=statuslineSample(payload(),'tab:leaf',1000);assert.equal(sample.context.limit,1000000);assert.equal(sample.context.used,40000);assert.equal(sample.context.percent,4);assert.equal(sample.context.estimated,false);
 assert.equal(statuslineSample(payload({context_window:{...payload().context_window,context_window_size:200000,used_percentage:20}}),'tab:leaf').context.percent,20);
 assert.equal(statuslineSample(payload({context_window:{current_usage:null}}),'tab:leaf').context,null);
 for(const context_window of [{},{...payload().context_window,context_window_size:0},{...payload().context_window,used_percentage:90},{...payload().context_window,current_usage:{input_tokens:-1}}])assert.equal(statuslineSample(payload({context_window}),'tab:leaf'),null);
 assert.equal(statuslineSample(payload(),''),null);
});
async function area(t){const root=await mkdtemp(join(tmpdir(),'claude-context-'));t.after(()=>rmTemp(root));return root;}
test('sample freshness and exact session, pane, PTY and transcript counts fence the reading',async t=>{
 const directory=await area(t),binding=statuslineBinding(provider,shown),sample={...statuslineSample(payload(),'tab:leaf',2000),binding,transcriptFile:{dev:1,ino:2}};
 const args={directory,provider,shown,transcript:{used:40000,capturedAt:1000},transcriptStat:{dev:1,ino:2},now:3000};
 await saveStatuslineSample(directory,sample);assert.equal((await readStatuslineContext(args)).percent,4);
 for(const key of ['handle','ptyId','incarnationId'])assert.equal(await readStatuslineContext({...args,shown:{...shown,[key]:'other'}}),undefined,key);
 assert.equal(await readStatuslineContext({...args,shown:{...shown,worktreePath:'/other'}}),undefined);
 assert.equal(await readStatuslineContext({...args,transcript:{used:41000,capturedAt:1000}}),undefined);
 assert.equal(await readStatuslineContext({...args,transcript:{used:40000,capturedAt:2500}}),undefined);
 assert.equal(await readStatuslineContext({...args,transcriptStat:{dev:1,ino:3}}),undefined);
 assert.equal(await readStatuslineContext({...args,transcript:null}),undefined);
 await saveStatuslineSample(directory,{...sample,context:null});assert.equal(await readStatuslineContext(args),null);
});
async function settingsFixture(t,originalStatusLine){
 const root=await area(t),configDir=join(root,'claude'),userData=join(root,'orca'),settingsPath=join(configDir,'settings.json');await mkdir(configDir);
 const original={theme:'dark',env:{KEEP_SETTING:'unchanged'},...(originalStatusLine?{statusLine:originalStatusLine}:{})};await writeFile(settingsPath,JSON.stringify(original)+'\n');
 const options={userData,configDir,helperPath:resolve('claude-statusline.cjs'),executable:process.execPath,electron:false,platform:'darwin',consent:async()=>{}};
 return {root,configDir,userData,settingsPath,original,options,service:createClaudeStatuslineSettings(options)};
}
test('connect preserves the full original statusline and other settings, is idempotent, and disconnect restores it',async t=>{
 const original={type:'command',command:'printf "original $value"',padding:3,refreshInterval:7};const f=await settingsFixture(t,original);
 assert.equal((await f.service.status()).enabled,false);assert.equal((await f.service.configure(true)).enabled,true);
 const once=JSON.parse(await readFile(f.settingsPath));assert.equal(once.statusLine.padding,3);assert.equal(once.statusLine.refreshInterval,7);assert.deepEqual(once.env,f.original.env);
 await f.service.configure(true);assert.deepEqual(JSON.parse(await readFile(f.settingsPath)),once);
 const config=JSON.parse(await readFile(join(f.configDir,'team-orchestrator-orca','bridge.json')));assert.deepEqual(config.originalStatusLine,original);assert.equal(config.directory,claudeContextDirectory(f.userData));
 await f.service.configure(false);assert.deepEqual(JSON.parse(await readFile(f.settingsPath)),f.original);assert.equal((await f.service.status()).enabled,false);
 await f.service.configure(true);assert.equal((await f.service.status()).enabled,true);
});
test('connect to an empty statusline restores absence, and outside changes are never overwritten',async t=>{
 const f=await settingsFixture(t);await f.service.configure(true);await f.service.configure(false);assert.equal(Object.hasOwn(JSON.parse(await readFile(f.settingsPath)),'statusLine'),false);
 await f.service.configure(true);const edited={...f.original,statusLine:{type:'command',command:'echo new-user-status'}};await writeFile(f.settingsPath,JSON.stringify(edited));
 await assert.rejects(f.service.configure(false),/changed outside/);await assert.rejects(f.service.configure(true),/changed outside/);assert.deepEqual(JSON.parse(await readFile(f.settingsPath)),edited);
});
test('concurrent settings changes and revoked consent stop installation without replacing user edits',async t=>{
 const f=await settingsFixture(t,{type:'command',command:'echo before'});let count=0;
 const service=createClaudeStatuslineSettings({...f.options,consent:async()=>{if(++count===3)await writeFile(f.settingsPath,JSON.stringify({...f.original,newSetting:true}));}});
 await assert.rejects(service.configure(true),/changed during/);assert.equal(JSON.parse(await readFile(f.settingsPath)).newSetting,true);
 assert.equal((await f.service.status()).enabled,false);
 assert.equal((await f.service.configure(true)).enabled,true);
 const denied=createClaudeStatuslineSettings({...f.options,consent:async()=>{throw Error('revoked');}});await assert.rejects(denied.configure(false),/revoked/);assert.equal((await f.service.status()).enabled,true);
});
function run(command,input,env={}){return new Promise((resolve,reject)=>{const child=spawn('/bin/sh',['-c',command],{env:{...process.env,...env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr}));child.stdin.end(input);});}
test('installed helper forwards exact stdin, original stdout and exit code while collecting only bound context',{skip:process.platform==='win32'?'the status line bridge runs only on macOS, and this test executes its shell command':false},async t=>{
 const f=await settingsFixture(t);const originalScript=join(f.root,'original.mjs'),inputPath=join(f.root,'input.txt');
 await writeFile(originalScript,`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(inputPath)},fs.readFileSync(0));process.stdout.write('existing status Ω');process.exitCode=7;`);
 const original={...f.original,statusLine:{type:'command',command:quote(process.execPath)+' '+quote(originalScript)}};await writeFile(f.settingsPath,JSON.stringify(original));
 await f.service.configure(true);const command=JSON.parse(await readFile(f.settingsPath)).statusLine.command;
 const path=join(f.root,'session.jsonl');await writeFile(path,'{}\n');const p={...provider,path},s={...shown,worktreePath:f.root},directory=claudeContextDirectory(f.userData);
 await registerStatuslineBinding(directory,statuslineBinding(p,s));
 const data=JSON.stringify(payload({transcript_path:path,cwd:f.root,unusedSecret:'must-not-be-recorded'}))+'\n';
 const result=await run(command,data,{ORCA_PANE_KEY:'tab:leaf',CLAUDE_JOB_DIR:''});assert.deepEqual(result,{code:7,stdout:'existing status Ω',stderr:''});assert.equal(await readFile(inputPath,'utf8'),data);
 const stored=await readFile(claudeContextFile(directory,{...p,paneKey:'tab:leaf'}),'utf8');assert.equal(stored.includes('must-not-be-recorded'),false);assert.equal(JSON.parse(stored).context.percent,4);
 assert.equal((await stat(claudeContextFile(directory,{...p,paneKey:'tab:leaf'}))).mode&0o777,0o600);
 // Invalid payloads still reach the user's command and cannot manufacture a reading.
 assert.equal((await run(command,'bad JSON',{ORCA_PANE_KEY:'tab:leaf'})).stdout,'existing status Ω');assert.equal(await readFile(inputPath,'utf8'),'bad JSON');
 assert.equal((await readFile(claudeContextFile(directory,{...p,paneKey:'tab:leaf'}),'utf8')),stored);
 await run(command,data,{ORCA_PANE_KEY:'another:pane',CLAUDE_JOB_DIR:''});assert.equal((await readdir(directory)).filter(n=>!n.startsWith('binding-')).length,1);
});
