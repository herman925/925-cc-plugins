import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {captureClassicSource,previewClassicImport} from './preview.mjs';
import {backupClassicSource} from './backup.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'team-migration-backup-'));t.after(async()=>{assert.equal(dirname(root),tmpdir());assert.ok(basename(root).startsWith('team-migration-backup-'));await rm(root,{recursive:true,force:true});});
 const projectRoot=join(root,'project'),source=join(projectRoot,'.claude','team-orchestrator'),privateRoot=join(root,'private');await mkdir(source,{recursive:true});
 await writeFile(join(source,'roster.json'),JSON.stringify([{name:'Head',team:'Demo',role:'Coordinate',boss:'user',allowWrite:true}]));await writeFile(join(source,'opaque.bin'),Buffer.from([0,255,3,128]));
 const snapshot=await captureClassicSource({projectRoot});return {root,projectRoot,source,privateRoot,snapshot};
}
test('a complete private source backup verifies every byte and repeat calls return the same receipt',async t=>{
 const f=await fixture(t),receipt=await backupClassicSource(f);assert.equal(receipt.verified,true);assert.equal(receipt.applyAuthorized,false);assert.deepEqual(await backupClassicSource(f),receipt);
 const stored=JSON.parse(await readFile(receipt.path,'utf8'));assert.equal(stored.projectRoot,f.projectRoot);assert.equal(stored.archive.fingerprint,f.snapshot.fingerprint);
 for(const file of stored.archive.files)assert.deepEqual(Buffer.from(file.base64,'base64'),await readFile(join(f.source,...file.path.split('/'))));
 await assert.rejects(access(join(f.projectRoot,'.team-orchestrator')),{code:'ENOENT'});
});
test('an independently changed or partial backup is preserved and refuses before any target write',async t=>{
 const f=await fixture(t),receipt=await backupClassicSource(f);await writeFile(receipt.path,'partial external edit');await assert.rejects(backupClassicSource(f),{code:'MIGRATION_BACKUP_UNVERIFIED'});assert.equal(await readFile(receipt.path,'utf8'),'partial external edit');assert.equal((await readFile(join(f.source,'opaque.bin'))).length,4);
});
test('a malformed classic roster can still be preserved in a complete backup while import remains refused',async t=>{
 const f=await fixture(t);await writeFile(join(f.source,'roster.json'),'broken original JSON');f.snapshot=await captureClassicSource({projectRoot:f.projectRoot});
 const receipt=await backupClassicSource(f),body=JSON.parse(await readFile(receipt.path,'utf8'));assert.equal(Buffer.from(body.archive.files.find(file=>file.path==='roster.json').base64,'base64').toString(),'broken original JSON');assert.throws(()=>previewClassicImport(f.snapshot),{code:'MIGRATION_SOURCE_INVALID'});
});
test('backup storage inside the source or through a redirected directory is refused',async t=>{
 const f=await fixture(t);await assert.rejects(backupClassicSource({...f,privateRoot:join(f.projectRoot,'backup')}),{code:'MIGRATION_BACKUP_UNVERIFIED'});await assert.rejects(access(join(f.projectRoot,'backup')),{code:'ENOENT'});
 await mkdir(f.privateRoot);const link=join(f.root,'redirected');await symlink(f.privateRoot,link,process.platform==='win32'?'junction':'dir');await assert.rejects(backupClassicSource({...f,privateRoot:link}),{code:'MIGRATION_BACKUP_UNVERIFIED'});
});
