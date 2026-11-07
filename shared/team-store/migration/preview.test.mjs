import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {captureClassicSource,previewClassicImport} from './preview.mjs';
const marker='<!-- END OF THE GENERATED PART. The Team Orchestrator rewrites everything above this line when the team changes. Write your own notes below it. -->';
async function fixture(t,mutate=rows=>rows){
 const root=await mkdtemp(join(tmpdir(),'team-migration-preview-'));t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())+'\\team-migration-preview-')||resolve(root).startsWith(resolve(tmpdir())+'/team-migration-preview-'));await rm(root,{recursive:true,force:true});});
 const source=join(root,'.claude','team-orchestrator');await mkdir(join(source,'roles'),{recursive:true});await mkdir(join(source,'queue'));
 const roster=mutate([{name:'Head',team:'Demo',role:'Coordinate',boss:'user',sessionId:'old-head',handle:'old-terminal',allowWrite:true,allowAgent:false},{name:'Worker',team:'Demo',role:'Verify',boss:'Head',cli:'codex',note:'Unfinished: verify the fixture',sessionId:'old-worker',machine:'old-machine'}]);
 await writeFile(join(source,'roster.json'),JSON.stringify(roster));await writeFile(join(source,'settings.json'),JSON.stringify({secretReference:'external-variable',autoClose:false}));
 await writeFile(join(source,'roles','Worker.md'),'OLD GENERATED CLI COMMANDS\r\n'+marker+'\r\nKeep this exact personal note.\r\n');
 await writeFile(join(source,'queue','pending.json'),JSON.stringify({to:'Worker',from:'Head',message:'Original pending brief',state:'pending'}));
 return {root,source,roster,capture:()=>captureClassicSource({projectRoot:root})};
}
test('a classic capture preserves every source byte and imports unfinished work for review without live authority',async t=>{
 const f=await fixture(t),snapshot=await f.capture(),before=await readFile(join(f.source,'roster.json'));
 const {preview,archive}=previewClassicImport(snapshot);
 assert.equal(preview.execution,'review-only');assert.equal(preview.requiresNativeReview,true);
 for(const key of ['bindings','assignments','deliveries','deadlines'])assert.deepEqual(preview[key],[]);
 assert.equal(preview.reviewItems.length,2);for(const item of preview.reviewItems){assert.equal(item.status,'head_review_required');assert.equal(item.requiresFreshAssignment,true);}
 const worker=preview.members.find(m=>m.name==='Worker');assert.equal(worker.advisoryNotes,'Keep this exact personal note.\r\n');assert.equal(worker.officialDraft,'Verify');assert.ok(!worker.officialDraft.includes('OLD GENERATED'));
 assert.equal(worker.binding,null);assert.equal(worker.previousSession.sessionId,'old-worker');assert.equal(preview.members[0].previousPermissions.allowWrite,true);
 assert.equal(preview.permissionPolicy,'start-disabled');for(const member of preview.members){assert.equal(member.preferences.allowWrite,false);assert.equal(member.preferences.allowAgent,false);}
 assert.equal(archive.files.length,snapshot.files.length);for(const file of archive.files)assert.deepEqual(Buffer.from(file.base64,'base64'),await readFile(join(f.source,...file.path.split('/'))));
 assert.deepEqual(await readFile(join(f.source,'roster.json')),before);assert.equal(preview.requiresSourceRecheck,true);assert.equal(preview.requiresBackup,true);
});
test('changing source invalidates its earlier fingerprint instead of silently updating the reviewed plan',async t=>{
 const f=await fixture(t),original=await f.capture();await writeFile(join(f.source,'roles','Worker.md'),'Changed official and personal notes');
 const changed=await f.capture();assert.notEqual(changed.fingerprint,original.fingerprint);
 const forged=structuredClone(original);forged.files[0].base64=Buffer.from('changed').toString('base64');assert.throws(()=>previewClassicImport(forged),{code:'MIGRATION_SOURCE_CHANGED'});
 assert.equal(previewClassicImport(original).preview.sourceFingerprint,original.fingerprint);
});
test('explicitly pruned mail stays archived and an uncertain send requires outcome reconciliation',async t=>{
 const f=await fixture(t);await writeFile(join(f.source,'queue','pruned.json'),JSON.stringify({names:['pending.json']}));
 await writeFile(join(f.source,'queue','uncertain.json'),JSON.stringify({to:'Worker',message:'Do not blindly repeat this effect',state:'sending'}));
 const {preview,archive}=previewClassicImport(await f.capture());assert.ok(!preview.reviewItems.some(item=>item.source==='queue/pending.json'));
 const uncertain=preview.reviewItems.find(item=>item.source==='queue/uncertain.json');assert.equal(uncertain.requiresOutcomeReconciliation,true);assert.equal(uncertain.requiresFreshAssignment,true);assert.ok(archive.files.some(file=>file.path==='queue/pending.json'));assert.deepEqual(preview.deliveries,[]);
});
test('cycles, unsupported providers and named-team mapping stay visible instead of being repaired or dropped',async t=>{
 const f=await fixture(t,rows=>[rows[0],{...rows[1],boss:'Other',cli:'hermes'},{name:'Other',team:'Second team',boss:'Worker',role:'Review'}]);
 const {preview}=previewClassicImport(await f.capture());assert.equal(preview.members.length,3);
 for(const code of ['REPORTING_CYCLE','CLI_NOT_INTEGRATED'])assert.ok(preview.blockers.some(b=>b.code===code));
 assert.ok(preview.warnings.some(w=>w.code==='TEAM_LABEL_MAPPING_REQUIRED'));assert.equal(preview.members.find(m=>m.name==='Worker').cli,'hermes');
});
test('ambiguous names, multiple heads and missing bosses never acquire inferred identity',async t=>{
 const duplicate=await fixture(t,rows=>[rows[0],{...rows[1],name:'head'}]),duplicateSnapshot=await duplicate.capture();assert.throws(()=>previewClassicImport(duplicateSnapshot),{code:'MIGRATION_SOURCE_INVALID'});
 const f=await fixture(t,rows=>[rows[0],{...rows[1],boss:'Missing'}, {name:'Second',team:'Elsewhere',boss:'user',role:'Coordinate'}]);
 const {preview}=previewClassicImport(await f.capture());assert.ok(preview.blockers.some(b=>b.code==='HEAD_SELECTION_REQUIRED'));assert.ok(preview.blockers.some(b=>b.code==='BOSS_UNMAPPED'));assert.equal(preview.bindings.length,0);
});
test('redirected classic directories are refused and the external fixture stays untouched',async t=>{
 const f=await fixture(t),outside=join(f.root,'external-fixture');await mkdir(outside);await writeFile(join(outside,'kept.txt'),'keep');await symlink(outside,join(f.source,'redirected'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(f.capture(),{code:'MIGRATION_SOURCE_REDIRECTED'});assert.equal(await readFile(join(outside,'kept.txt'),'utf8'),'keep');
});
test('missing and oversized sources refuse without creating or changing a target store',async t=>{
 const f=await fixture(t);await writeFile(join(f.source,'oversized.txt'),Buffer.alloc(1048577));await assert.rejects(f.capture(),{code:'MIGRATION_SOURCE_TOO_LARGE'});
 const absent=join(f.root,'empty-project');await mkdir(absent);await assert.rejects(captureClassicSource({projectRoot:absent}),{code:'MIGRATION_SOURCE_NOT_FOUND'});
 await assert.rejects(lstat(join(absent,'.claude')),{code:'ENOENT'});assert.equal(await readFile(join(f.source,'oversized.txt')).then(b=>b.length),1048577);
});
test('a roster above the current import limit is preserved in full with an explicit blocker',async t=>{
 const f=await fixture(t,rows=>[rows[0],...Array.from({length:31},(_,i)=>({name:'Worker'+i,team:'Demo',boss:'Head',role:'Verify'}))]),{preview,archive}=previewClassicImport(await f.capture());
 assert.equal(preview.members.length,32);assert.ok(preview.blockers.some(item=>item.code==='MEMBER_LIMIT_UNSUPPORTED'));assert.equal(JSON.parse(Buffer.from(archive.files.find(file=>file.path==='roster.json').base64,'base64')).length,32);
});
