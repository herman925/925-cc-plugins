import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,open,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectWindowsProcess,windowsFileOwners} from '../src/windows-native.mjs';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

test('native Windows process fingerprints retain exactly the resource-owner FILETIME ticks',{skip:process.platform!=='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-filetime-'))),path=join(root,'writer.lock');
 await writeFile(path,'fixture');const handle=await open(path,'r');
 t.after(async()=>{await handle.close();await rm(root,{recursive:true,force:true});});
 const processInfo=await inspectWindowsProcess(process.pid),owners=await windowsFileOwners(path);
 const current=owners.find(p=>p.pid===process.pid);assert.ok(current,'the OS observes this test process holding its fixture file');
 assert.equal(current.createdAt,processInfo.createdAt);assert.equal(processInfo.pid,process.pid);assert.equal(await realpath(processInfo.executable),await realpath(process.execPath));
 await assert.rejects(inspectWindowsProcess(0),e=>e.code==='API_NATIVE_UNVERIFIED');
});

test('overlapping native resource inspections do not become each other\'s file owners',{skip:process.platform!=='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-owner-overlap-'))),path=join(root,'writer.lock');await writeFile(path,'fixture');const handle=await open(path,'r');
 t.after(async()=>{await handle.close();await rm(root,{recursive:true,force:true});});
 const expected=await inspectWindowsProcess(process.pid);
 for(let batch=0;batch<3;batch++){
  const samples=await Promise.all([windowsFileOwners(path),windowsFileOwners(path)]);
  for(const owners of samples)assert.deepEqual(owners,[{pid:process.pid,createdAt:expected.createdAt}],'Inspectors must not pollute another concurrent query\'s ownership evidence');
 }
});

test('native ownership observation still returns both genuine file holders',{skip:process.platform!=='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-owner-ambiguous-'))),path=join(root,'writer.lock');await writeFile(path,'fixture');const handle=await open(path,'r');
 const script="import {open} from 'node:fs/promises';const handle=await open(process.argv[1],'r');process.stdout.write('ready\\n');process.stdin.resume();process.stdin.on('end',async()=>{await handle.close();process.exit(0);});";
 const child=spawn(process.execPath,['--input-type=module','-e',script,path],{windowsHide:true,stdio:['pipe','pipe','ignore']});const exited=new Promise(resolve=>child.once('close',resolve));
 t.after(async()=>{child.stdin.end();const timer=setTimeout(()=>child.kill(),2000);await exited;clearTimeout(timer);await handle.close();await rm(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned file-holder fixture did not become ready')),5000);child.once('error',reject);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
 const owners=await windowsFileOwners(path),expected=await Promise.all([inspectWindowsProcess(process.pid),inspectWindowsProcess(child.pid)]);
 assert.deepEqual(owners.map(o=>[o.pid,o.createdAt]).sort((a,b)=>a[0]-b[0]),expected.map(p=>[p.pid,p.createdAt]).sort((a,b)=>a[0]-b[0]));
});

test('owner-inspection contention is bounded and denied; later calls query fresh ownership',{skip:process.platform!=='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'team-owner-contention-'))),path=join(root,'writer.lock');await writeFile(path,'fixture');const handle=await open(path,'r');
 const name='Local\\925TeamThreadOwners-'+createHash('sha256').update(path.toUpperCase()).digest('hex').toUpperCase();
 const script=`$gate=New-Object System.Threading.Mutex($false,'${name}');try{[void]$gate.WaitOne();[Console]::Out.WriteLine('ready');[void][Console]::In.ReadLine()}finally{$gate.ReleaseMutex();$gate.Dispose()}`;
 const child=spawn(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','ignore']});const exited=new Promise(resolve=>child.once('close',resolve));
 t.after(async()=>{child.stdin.end();const timer=setTimeout(()=>child.kill(),2000);await exited;clearTimeout(timer);await handle.close();await rm(root,{recursive:true,force:true});});
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Owned inspection-gate fixture did not become ready')),5000);child.once('error',reject);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});});
 await assert.rejects(windowsFileOwners(path),{code:'API_NATIVE_UNVERIFIED'});
 child.stdin.end();await exited;const expected=await inspectWindowsProcess(process.pid);assert.deepEqual(await windowsFileOwners(path),[{pid:process.pid,createdAt:expected.createdAt}]);
});
