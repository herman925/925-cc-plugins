import { rmTemp } from './temp.mjs';
import { test } from 'node:test';import assert from 'node:assert/strict';
import { mkdtemp,readFile,rm } from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { readNativeRunEvidence } from '../src/local/native-run.mjs';
test('readonly Run evidence requires exact objective, native owner and matching consumer generation',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'native-run-')),file=join(profile,'orchestration.db');t.after(()=>rmTemp(profile));
 const db=new DatabaseSync(file);db.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY,objective TEXT,home_database TEXT,coordinator_handle TEXT,coordinator_pane_key TEXT,coordinator_orca_session_id TEXT,coordinator_orca_session_id_generation INTEGER,consumer_generation INTEGER,legacy INTEGER); PRAGMA user_version=43`);
 db.prepare('INSERT INTO runs VALUES (?,?,?,?,?,?,?,?,?)').run('run-one','issued objective','this_database',null,null,'head-root',2,2,0);db.close();const bytes=await readFile(file);
 const expected={objective:'issued objective',owner:{kind:'structured',sessionId:'head-root'}};
 const result=await readNativeRunEvidence(profile,expected);assert.equal(result.state,'verified');assert.equal(result.id,'run-one');assert.equal(result.consumerGeneration,2);
 assert.equal((await readNativeRunEvidence(profile,{...expected,owner:{kind:'structured',sessionId:'other'}})).state,'unverified');
 assert.equal((await readNativeRunEvidence(profile,{...expected,objective:'other'})).state,'unverified');
 assert.deepEqual(await readFile(file),bytes);
 const change=new DatabaseSync(file);change.exec('UPDATE runs SET consumer_generation=3');change.close();
 assert.equal((await readNativeRunEvidence(profile,expected)).state,'unverified');
});
