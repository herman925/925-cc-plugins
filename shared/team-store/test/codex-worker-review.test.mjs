import {test} from 'node:test';
import assert from 'node:assert/strict';
import {codexWorkerReview,workerNativeForm} from '../src/codex-worker-review.mjs';
function fixture(){
 const actor={projectRoot:'project',machineId:'machine',provider:'codex',conversationId:'head',executionHostId:'local',contextId:'context',terminalHandle:'head-terminal',incarnationId:'head-process'},identity={...actor,conversationId:'worker',terminalHandle:'worker-terminal'},requests=[{id:7,method:'mcpServer/elicitation/request',params:{threadId:'worker',serverName:'fixture',mode:'form',message:'Make this specific choice',requestedSchema:{type:'object',properties:{choice:{type:'string',enum:['one','two']}},required:['choice']}}}];
 let head=true,viewer=false,stale=false,closed=0,reply={action:'accept',content:{choice:'two'}},forms=0,receipts=new Map();const sent=[];
 const native={verifyCaller:async()=>actor,ownedWorkerRequest:async(type,input)=>{
  if(type==='inspect')return {identity,effectivePolicy:{approvalPolicy:'on-request'}};if(type==='pending')return structuredClone(requests);if(type==='reviewReceipt')return receipts.get(input.operationId)??{state:'unknown'};
  if(type==='respond'){assert.deepEqual(input.expected,requests[0]);sent.push(input);requests.shift();const receipt={state:'answer-submitted',operationId:input.operationId};receipts.set(input.operationId,receipt);return receipt;}throw Error('Unexpected private operation.');
 }};
 const binding={member_id:'worker',machine_id:identity.machineId,provider:identity.provider,conversation_id:identity.conversationId,execution_host_id:identity.executionHostId,context_id:identity.contextId,terminal_handle:identity.terminalHandle,incarnation_id:identity.incarnationId},launch={launch_id:'launch',member_id:'worker',status:'bound'};
 const createApi=async()=>({execute:async({command})=>({result:command.type==='inspectConfiguration'?{launches:[launch],bindings:[{...binding,incarnation_id:stale?'replacement':binding.incarnation_id}],members:[{member_id:'worker',boss_member_id:null}],managedLead:viewer?{memberId:'worker'}:null}:{member:viewer?null:head?{member_id:'head',team_id:'team',boss_member_id:null}:{member_id:'other',team_id:'team',boss_member_id:'head'},controllerGeneration:1,teams:[{team_id:'team'}]}}),launch:async()=>({result:{launches:[launch]}}),close:async()=>closed++});
 const connection={canElicit:true,elicit:async form=>{forms++;assert.equal(form.requestedSchema.type,'object');return reply;}};
 const run=args=>codexWorkerReview({args,actor,metadata:{},native,createApi,options:{},connection});
 return {run,sent,requests,setHead:value=>head=value,setViewer:value=>viewer=value,setStale:value=>stale=value,setReply:value=>reply=value,forms:()=>forms,closed:()=>closed};
}
test('only the approved top head can inspect or relay a worker request',async()=>{
 const f=fixture();f.setHead(false);await assert.rejects(f.run({action:'inspect',launchId:'launch'}),{code:'API_LAUNCH_SCOPE'});assert.equal(f.forms(),0);assert.equal(f.sent.length,0);assert.equal(f.closed(),1);
});
test('the approving controller can display its optional managed lead request without impersonating a member',async()=>{
 const f=fixture();f.setViewer(true);const result=await f.run({action:'inspect',launchId:'launch'});assert.equal(result.answersSubmitted,false);assert.equal(f.forms(),0);assert.equal(f.sent.length,0);
});
test('a replaced member binding rejects the old owned process even if its launch still says bound',async()=>{
 const f=fixture();f.setStale(true);await assert.rejects(f.run({action:'review',launchId:'launch',requestId:7,operationId:'stale'}),{code:'API_STALE_AUTHORITY'});assert.equal(f.forms(),0);assert.equal(f.sent.length,0);
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
test('Claude questions relay only actual native selections and replace model-provided answer fields',()=>{
 const questions=[{header:'Scope',question:'Which scope?',options:[{label:'One',description:'First'},{label:'Two',description:'Second'}],multiSelect:false},{header:'Parts',question:'Which parts?',options:[{label:'A'},{label:'B'}],multiSelect:true}],row={method:'claude/permission/request',params:{toolName:'AskUserQuestion',input:{questions,answers:{'Which scope?':'model-provided'},response:'unreviewed model reply'}}};
 const bridge=workerNativeForm(row);assert.deepEqual(bridge.form.requestedSchema.properties.answer0.enum,['One','Two','Other']);
 const result=bridge.response({action:'accept',content:{answer0:'Two',answer1:['A','B']}});assert.equal(result.behavior,'allow');assert.deepEqual(result.updatedInput.questions,questions);assert.deepEqual(result.updatedInput.answers,{'Which scope?':'Two','Which parts?':['A','B']});assert.ok(!Object.hasOwn(result.updatedInput,'response'));
 assert.throws(()=>bridge.response({action:'cancel'}),{code:'API_APPROVAL_REQUIRED'});
});
test('native tool permission review forwards original input once without a remembered permission grant',()=>{
 const input={command:'echo fixture',timeout:5000},bridge=workerNativeForm({method:'claude/permission/request',params:{toolName:'Bash',input}});assert.ok(bridge.form.message.includes('echo fixture'));
 assert.deepEqual(bridge.response({action:'accept',content:{decision:'Allow once'}}),{behavior:'allow',updatedInput:input});assert.equal(bridge.response({action:'accept',content:{decision:'Deny'}}).behavior,'deny');assert.throws(()=>bridge.response({action:'accept',content:{}}),{code:'API_INPUT_INVALID'});
 const codex=workerNativeForm({method:'item/commandExecution/requestApproval',params:{command:'echo fixture',availableDecisions:['accept','decline']}});assert.deepEqual(codex.response({action:'accept',content:{decision:'Allow once'}}),{decision:'accept'});
});
test('native file approval requires the exact pending turn/item diff and never invents session permission',()=>{
 const params={threadId:'thread',turnId:'turn',itemId:'patch'},row={method:'item/fileChange/requestApproval',params};assert.throws(()=>workerNativeForm(row),{code:'API_WORKER_REVIEW_UNSUPPORTED'});
 const bridge=workerNativeForm({...row,reviewDetails:{turnId:'turn',item:{id:'patch',type:'fileChange',changes:[{path:'fixture.txt',kind:{type:'add'},diff:'+fixture'}]}}});assert.ok(bridge.form.message.includes('+fixture'));assert.deepEqual(bridge.response({action:'accept',content:{decision:'Allow once'}}),{decision:'accept'});assert.throws(()=>bridge.response({action:'cancel'}),{code:'API_APPROVAL_REQUIRED'});
});
