import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexWorkerReview,workerNativeForm} from '../src/codex-worker-review.mjs';
function fixture(){
 const actor={projectRoot:'project',machineId:'machine',provider:'codex',conversationId:'head',executionHostId:'local',contextId:'context',terminalHandle:'head-terminal',incarnationId:'head-process'},identity={...actor,conversationId:'worker',terminalHandle:'worker-terminal'},requests=[{id:7,method:'mcpServer/elicitation/request',params:{threadId:'worker',serverName:'fixture',mode:'form',message:'Make this specific choice',requestedSchema:{type:'object',properties:{choice:{type:'string',enum:['one','two']}},required:['choice']}}}];
 let head=true,closed=0,reply={action:'accept',content:{choice:'two'}},forms=0,receipts=new Map();const sent=[];
 const native={verifyCaller:async()=>actor,ownedWorkerRequest:async(type,input)=>{
  if(type==='inspect')return {identity,effectivePolicy:{approvalPolicy:'on-request'}};if(type==='pending')return structuredClone(requests);if(type==='reviewReceipt')return receipts.get(input.operationId)??{state:'unknown'};
  if(type==='respond'){assert.deepEqual(input.expected,requests[0]);sent.push(input);requests.shift();const receipt={state:'answer-submitted',operationId:input.operationId};receipts.set(input.operationId,receipt);return receipt;}throw Error('Unexpected private operation.');
 }};
 const createApi=async()=>({execute:async()=>({result:{member:head?{team_id:'team',boss_member_id:null}:{team_id:'team',boss_member_id:'head'},controllerGeneration:1}}),launch:async()=>({result:{launches:[{launch_id:'launch',status:'bound'}]}}),close:async()=>closed++});
 const connection={canElicit:true,elicit:async form=>{forms++;assert.equal(form.requestedSchema.type,'object');return reply;}};
 const run=args=>codexWorkerReview({args,actor,metadata:{},native,createApi,options:{},connection});
 return {run,sent,requests,setHead:value=>head=value,setReply:value=>reply=value,forms:()=>forms,closed:()=>closed};
}
test('only the approved top head can inspect or relay a worker request',async()=>{
 const f=fixture();f.setHead(false);await assert.rejects(f.run({action:'inspect',launchId:'launch'}),{code:'API_HEAD_REQUIRED'});assert.equal(f.forms(),0);assert.equal(f.sent.length,0);assert.equal(f.closed(),1);
});
test('a model cannot supply a worker answer; native input is relayed only to the exact pending request',async()=>{
 const f=fixture();await assert.rejects(f.run({action:'review',launchId:'launch',requestId:7,operationId:'response',result:{action:'accept'}}),{code:'API_INPUT_INVALID'});
 const before=await f.run({action:'inspect',launchId:'launch'});assert.equal(before.answersSubmitted,false);assert.equal(f.forms(),0);
 assert.equal((await f.run({action:'review',launchId:'launch',requestId:7,operationId:'response'})).state,'answer-submitted');assert.equal(f.forms(),1);assert.deepEqual(f.sent[0].result,{action:'accept',content:{choice:'two'}});
 assert.equal((await f.run({action:'reconcile',launchId:'launch',operationId:'response'})).state,'answer-submitted');assert.equal(f.forms(),1);assert.equal(f.sent.length,1);
});
test('an immediate client decline remains unverified and leaves the worker question pending',async()=>{
 const f=fixture();f.setReply({action:'decline'});await assert.rejects(f.run({action:'review',launchId:'launch',requestId:7,operationId:'response'}),{code:'API_APPROVAL_UNVERIFIED'});assert.equal(f.sent.length,0);assert.equal(f.requests.length,1);
});
test('unsupported permission and secret-input requests remain unanswered',()=>{
 for(const row of [{method:'item/commandExecution/requestApproval',params:{}},{method:'item/tool/requestUserInput',params:{questions:[{id:'q',question:'Secret?',isSecret:true}]}}])assert.throws(()=>workerNativeForm(row),{code:'API_WORKER_REVIEW_UNSUPPORTED'});
});
test('native worker multiple-choice questions preserve human-selected option labels and question IDs',()=>{
 const bridge=workerNativeForm({method:'item/tool/requestUserInput',params:{questions:[{id:'choice',header:'Scope',question:'Which scope?',options:[{label:'One',description:'First scope'},{label:'Two',description:'Second scope'}]}]}});
 assert.deepEqual(bridge.form.requestedSchema.properties.answer0.enum,['One','Two']);assert.deepEqual(bridge.response({action:'accept',content:{answer0:'Two'}}),{answers:{choice:{answers:['Two']}}});assert.throws(()=>bridge.response({action:'cancel'}),{code:'API_APPROVAL_REQUIRED'});
});
