import {test} from 'node:test';
import assert from 'node:assert/strict';
import {declaredWriteScope,scopeConflict,scopeBlocker} from '../src/scheduling.mjs';
test('scope coordination handles directory boundaries, Windows aliases and explicit read-only work',()=>{
 const src=declaredWriteScope([{path:'src/',kind:'directory'}]);
 assert.equal(scopeConflict(src,declaredWriteScope([{path:'SRC\\app.js',kind:'file'}])),true);
 assert.equal(scopeConflict(src,declaredWriteScope([{path:'src-other/app.js',kind:'file'}])),false);
 assert.equal(scopeConflict(src,[]),false);
 for(const path of ['../escape','/outside','C:\\outside','src/../escape','src/*'])assert.throws(()=>declaredWriteScope([{path,kind:'directory'}]));
 assert.throws(()=>declaredWriteScope(undefined));
});
test('accepted corrected attempt releases the earlier rework scope but unknown attempts reserve it',()=>{
 const writeScope=[{path:'src',kind:'directory'}],old={taskKey:'fix',status:'rework',writeScope};
 assert.equal(scopeBlocker([old,{...old,status:'accepted'}],'next',writeScope),undefined);
 assert.equal(scopeBlocker([old,{...old,status:'unknown'}],'next',writeScope).status,'unknown');
});
