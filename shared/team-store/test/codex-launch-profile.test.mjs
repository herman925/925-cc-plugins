import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {writeReservedLaunchProfile,readReservedLaunchProfile} from '../src/codex-launch-profile.mjs';
test('reserved profiles are private, immutable for their launch and reject malformed engine selection',async t=>{
 const root=await mkdtemp(join(tmpdir(),'reserved-profile-test-'));t.after(()=>rm(root,{recursive:true,force:true}));const projectRoot=join(root,'project');await mkdir(projectRoot);
 const config={root:join(root,'private'),actor:{projectRoot,machineId:'machine',contextId:'context'},projectId:randomUUID(),launchId:'launch',memberId:'worker'};
 const path=await writeReservedLaunchProfile(config);assert.equal(await writeReservedLaunchProfile(config),path);
 await assert.rejects(writeReservedLaunchProfile({...config,actor:{...config.actor,contextId:'changed'}}),{code:'API_LAUNCH_PROFILE_INVALID'});
 await assert.rejects(writeReservedLaunchProfile({...config,root:join(projectRoot,'private')}),{code:'API_LAUNCH_PROFILE_INVALID'});
 const data=JSON.parse(await readFile(path,'utf8'));data.engine='postgres';await writeFile(path,JSON.stringify(data));
 await assert.rejects(readReservedLaunchProfile(path,projectRoot),{code:'API_LAUNCH_PROFILE_INVALID'});
});
test('invalid reserved startup keeps the MCP hook registered and returns a valid deny',async t=>{
 const root=await mkdtemp(join(tmpdir(),'reserved-profile-startup-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const frames=[{jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18'}},{jsonrpc:'2.0',id:2,method:'tools/list'},{jsonrpc:'2.0',id:3,method:'tools/call',params:{name:'team_guard',arguments:{tool:'exec_command',input:{cmd:'task work'}}}}];
 const child=spawn(process.execPath,[fileURLToPath(new URL('../codex-mcp.mjs',import.meta.url))],{env:{...process.env,TEAM_PROJECT_ROOT:root,TEAM_CODEX_EXECUTABLE:process.execPath,TEAM_RESERVED_LAUNCH_PROFILE:join(root,'missing.json')},windowsHide:true,stdio:['pipe','pipe','pipe']});
 const timer=setTimeout(()=>child.kill(),15000);t.after(()=>clearTimeout(timer));let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
 child.stdin.end(frames.map(JSON.stringify).join('\n')+'\n');const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 assert.equal(code,0,stderr);const rows=stdout.trim().split('\n').map(JSON.parse);assert.ok(rows[1].result.tools.some(t=>t.name==='team_guard'));
 const decision=JSON.parse(rows[2].result.content[0].text).hookSpecificOutput;assert.equal(decision.permissionDecision,'deny');assert.match(decision.permissionDecisionReason,/API_LAUNCH_PROFILE_INVALID/);
});
