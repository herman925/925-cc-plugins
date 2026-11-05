import {test} from 'node:test';
import assert from 'node:assert/strict';
import {interviewForm} from '../src/codex-interview.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
test('native action and member forms collect draft data without permission fields',()=>{
 const actions=interviewForm({step:'action'});assert.deepEqual(actions.requestedSchema.properties.action.enum,['create-team','edit-team','connect-session','launch-workers','status','meeting','diagnose']);
 const member=interviewForm({step:'member',bossNames:['Head']});assert.deepEqual(member.requestedSchema.properties.reportsTo.enum,['You (top member)','Head']);assert.ok(!Object.hasOwn(member.requestedSchema.properties,'confirm'));
 assert.throws(()=>interviewForm({step:'arbitrary',approval:true}),e=>e.code==='API_INPUT_INVALID');assert.throws(()=>interviewForm({step:'member',bossNames:['Duplicate','Duplicate']}),e=>e.code==='API_INPUT_INVALID');
});
test('interview answers do not open a team API or approve any controller',async()=>{
 const actor={provider:'codex'},adapter=await createCodexAdapter({},{createIdentity:async()=>({verifyCaller:async()=>actor}),createApi:async()=>{throw Error('Interview must not open the management API.');}});
 const answer={action:'accept',content:{action:'create-team'}};assert.deepEqual(await adapter.call('shared_team_interview',{step:'action'},{},{canElicit:true,elicit:async()=>answer}),{draftOnly:true,response:answer});
 await assert.rejects(adapter.call('shared_team_interview',{step:'action'},{},{canElicit:false}),e=>e.code==='API_REVIEW_UNAVAILABLE');
});
