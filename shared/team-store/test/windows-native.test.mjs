import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,open,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectWindowsProcess,windowsFileOwners} from '../src/windows-native.mjs';

test('native Windows process fingerprints retain exactly the resource-owner FILETIME ticks',{skip:process.platform!=='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-filetime-'))),path=join(root,'writer.lock');
 await writeFile(path,'fixture');const handle=await open(path,'r');
 t.after(async()=>{await handle.close();await rm(root,{recursive:true,force:true});});
 const processInfo=await inspectWindowsProcess(process.pid),owners=await windowsFileOwners(path);
 const current=owners.find(p=>p.pid===process.pid);assert.ok(current,'the OS observes this test process holding its fixture file');
 assert.equal(current.createdAt,processInfo.createdAt);assert.equal(processInfo.pid,process.pid);assert.equal(await realpath(processInfo.executable),await realpath(process.execPath));
 await assert.rejects(inspectWindowsProcess(0),e=>e.code==='API_NATIVE_UNVERIFIED');
});
