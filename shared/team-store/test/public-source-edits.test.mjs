import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {codexGuard} from '../src/codex-guard.mjs';
async function fixture(t){const root=await realpath(await mkdtemp(join(tmpdir(),'team-source-guard-')));await mkdir(join(root,'shared/team-store/test'),{recursive:true});t.after(()=>rm(root,{recursive:true,force:true}));return {root,authority:{member:{home_original_path:root,allow_write:1,allow_agent:0},hasReports:true}};}
const patch=(path,body)=>`*** Begin Patch\n*** Add File: ${path}\n${body.split(/\r?\n/).map(line=>'+'+line).join('\n')}\n*** End Patch`;
test('verified nonmembers can patch public package source without receiving private execution or pending-worker authority',async t=>{
 const {root}=await fixture(t),body=await readFile(new URL('../api.mjs',import.meta.url),'utf8'),authority={projectRoot:root,member:null,hasReports:false},event={tool:'apply_patch',input:{command:patch(join(root,'shared/team-store/test/fixture.mjs'),body)}};
 assert.deepEqual(codexGuard(authority,event),{});
 assert.equal(codexGuard({...authority,staleBinding:true},event).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(codexGuard({...authority,pendingLaunchId:'reserved'},event).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(codexGuard(authority,{tool:'exec_command',input:{cmd:body}}).hookSpecificOutput.permissionDecision,'deny');
});
test('standing write permission permits editing actual public API source, without permitting its direct execution',async t=>{
 const {root,authority}=await fixture(t),body=await readFile(new URL('../api.mjs',import.meta.url),'utf8'),event={tool:'apply_patch',input:{command:patch(join(root,'shared/team-store/test/fixture.mjs'),body)}};
 assert.deepEqual(codexGuard(authority,event),{});
 assert.equal(codexGuard({...authority,member:{...authority.member,allow_write:0}},event).hookSpecificOutput.permissionDecision,'deny');
 assert.deepEqual(codexGuard({...authority,hasReports:false,member:{...authority.member,allow_write:0}},event),{});
 for(const extra of [{staleBinding:true},{pendingLaunchId:'reserved'}])assert.equal(codexGuard({...authority,...extra},event).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(codexGuard(authority,{tool:'exec_command',input:{cmd:body}}).hookSpecificOutput.permissionDecision,'deny');
});
test('source editing permission excludes external targets, unknown edit formats and source redirects',async t=>{
 const {root,authority}=await fixture(t),body=await readFile(new URL('../api.mjs',import.meta.url),'utf8'),outside=await realpath(await mkdtemp(join(tmpdir(),'team-source-outside-')));t.after(()=>rm(outside,{recursive:true,force:true}));
 for(const command of [patch(join(outside,'external.mjs'),body),body])assert.equal(codexGuard(authority,{tool:'apply_patch',input:{command}}).hookSpecificOutput.permissionDecision,'deny');
 for(const path of [join(root,'shared','.hidden','fixture.mjs'),join(root,'shared','fixture.db'),join(root,'unrelated','fixture.mjs')])assert.equal(codexGuard(authority,{tool:'apply_patch',input:{command:patch(path,body)}}).hookSpecificOutput.permissionDecision,'deny');
 const mixed=patch(join(root,'shared/team-store/test/fixture.mjs'),body).replace('*** End Patch',`*** Add File: ${join(outside,'external.mjs')}\n+outside\n*** End Patch`);
 assert.equal(codexGuard(authority,{tool:'apply_patch',input:{command:mixed}}).hookSpecificOutput.permissionDecision,'deny');
 const moved=patch(join(root,'shared/team-store/test/fixture.mjs'),body).replace('\n+import',`\n*** Move to: ${join(outside,'moved.mjs')}\n+import`);
 assert.equal(codexGuard(authority,{tool:'apply_patch',input:{command:moved}}).hookSpecificOutput.permissionDecision,'deny');
 await symlink(outside,join(root,'shared','redirect'),process.platform==='win32'?'junction':'dir');assert.equal(codexGuard(authority,{tool:'apply_patch',input:{command:patch(join(root,'shared/redirect/fixture.mjs'),body)}}).hookSpecificOutput.permissionDecision,'deny');
});
