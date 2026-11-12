import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {codexGuard} from '../src/codex-guard.mjs';
test('public adapter source can be read without admitting its execution, private state or redirected targets',async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-source-read-')));assert.equal(dirname(root),await realpath(tmpdir()));assert.ok(basename(root).startsWith('team-source-read-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'shared/team-store'),{recursive:true});const file=join(root,'shared/team-store/mod-bridge.mjs');await writeFile(file,'// public source only');
 await mkdir(join(root,'.codex'),{recursive:true});const privateFile=join(root,'.codex/config.toml');await writeFile(privateFile,'fixture private state');
 const authority={projectRoot:root,member:null,hasReports:false};
 for(const command of [`Get-Content -LiteralPath "${file}" -TotalCount 20`,`cat "${file}"`])assert.deepEqual(codexGuard(authority,{tool:'exec_command',input:{cmd:command}}),{});
 for(const command of [`node "${file}"`,`Get-Content "${privateFile}"`,`Get-Content "${file}"; node "${file}"`,`Get-Content "${file}" > output.txt`])assert.equal(codexGuard(authority,{tool:'exec_command',input:{cmd:command}}).hookSpecificOutput.permissionDecision,'deny');
 assert.equal(codexGuard(authority,{tool:'exec_command',input:{cmd:`Get-Content "${file}"`,shell:'custom-shell'}}).hookSpecificOutput.permissionDecision,'deny');
 await writeFile(join(root,'.codex/mod-bridge.mjs'),'private fixture');
 const linkDir=join(root,'shared/team-store/redirected');await symlink(join(root,'.codex'),linkDir,process.platform==='win32'?'junction':'dir');const link=join(linkDir,'mod-bridge.mjs');
 assert.equal(codexGuard(authority,{tool:'exec_command',input:{cmd:`Get-Content "${link}"`}}).hookSpecificOutput.permissionDecision,'deny');
});
