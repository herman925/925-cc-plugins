// Real Windows resource observation, using only a disposable held fixture.
// No Codex/Orca session, approval, team store or model turn is created.
import assert from 'node:assert/strict';
import {mkdtemp,realpath,writeFile,open,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {inspectWindowsProcess,windowsFileOwners} from '../src/windows-native.mjs';
import {windowsFileOwners as modOwners} from '../../../team-orchestrator/store/src/windows-native.mjs';
import {windowsFileOwners as codexOwners} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/runtime/src/windows-native.mjs';
if(process.platform!=='win32')throw Error('This probe measures the native Windows query.');
const root=await realpath(await mkdtemp(join(tmpdir(),'team-owner-overlap-validation-'))),path=join(root,'writer.lock');await writeFile(path,'disposable fixture');const handle=await open(path,'r');
const expected=await inspectWindowsProcess(process.pid),evidence={root,modelTurnsStarted:0,concurrentInspectors:3,batches:20,samples:0,extraOwners:0};
try{
 for(let batch=0;batch<evidence.batches;batch++){
  const results=await Promise.all([windowsFileOwners,modOwners,codexOwners].map(query=>query(path)));
  for(const owners of results){evidence.samples++;if(owners.length!==1)evidence.extraOwners++;assert.deepEqual(owners,[{pid:process.pid,createdAt:expected.createdAt}]);}
 }
 evidence.passed=true;
}catch(error){evidence.passed=false;evidence.error=String(error);process.exitCode=1;}
finally{await handle.close();await unlink(path);await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));}
console.log(JSON.stringify(evidence));
