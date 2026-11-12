// Native human bridge for a project-owned worker. Models select an exact
// pending request; they never supply its answer. A head's ordinary text is not
// consent, and worker execution completion is not task acceptance.
import {randomUUID} from 'node:crypto';
import {exact} from './api-domain.mjs';
import {refusal} from './errors.mjs';
import {nativeReviewRefusal,HUMAN_REVIEW_FLOOR_MS} from './native-review.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(code,message)=>{throw refusal(code,message);};
export function workerNativeForm(row){
 const params=row.params;
 if(row.method==='mcpServer/elicitation/request'&&['form','openai/form','openaiForm'].includes(params?.mode)&&params.requestedSchema?.type==='object'&&typeof params.message==='string')return {
  form:{message:params.message,requestedSchema:structuredClone(params.requestedSchema)},
  response:answer=>({action:answer.action,...(answer.content===undefined?{}:{content:answer.content})}),
 };
 if(row.method==='item/tool/requestUserInput'&&Array.isArray(params?.questions)&&params.questions.length>0&&params.questions.length<=3){
  const properties={},required=[],mapping=[];
  for(const [index,q] of params.questions.entries()){
   if(typeof q.id!=='string'||typeof q.question!=='string'||q.isSecret)fail('API_WORKER_REVIEW_UNSUPPORTED','This worker request needs a supported private native input interface. No answer was sent.');
   const key='answer'+index,options=q.options?.map(option=>option.label);properties[key]={type:'string',title:q.question,...(!q.isOther&&options?.length?{enum:options}:{}),description:q.options?.map(option=>`${option.label}: ${option.description}`).join('\n')??q.header};required.push(key);mapping.push([q.id,key]);
  }
  return {form:{message:'Answer the exact pending questions from this worker.',requestedSchema:{type:'object',properties,required}},response:answer=>{if(answer.action!=='accept')fail('API_APPROVAL_REQUIRED','No answers were submitted; the worker request remains pending.');return {answers:Object.fromEntries(mapping.map(([id,key])=>{if(typeof answer.content?.[key]!=='string')fail('API_INPUT_INVALID','The native answer was incomplete. No answers were submitted.');return [id,{answers:[answer.content[key]]}];}))};}};
 }
 fail('API_WORKER_REVIEW_UNSUPPORTED','This native request type is retained for inspection but cannot yet be answered through this bridge. No permission or answer was sent.');
}
export async function codexWorkerReview({args,actor,metadata,native,createApi,options,connection}){
 exact(args,['action','launchId','requestId','operationId']);if(!['inspect','review','reconcile'].includes(args.action)||typeof args.launchId!=='string'||!args.launchId)fail('API_INPUT_INVALID','Select inspect, review or reconcile for one exact owned worker launch.');
 if(typeof native.ownedWorkerRequest!=='function')fail('API_WORKER_REVIEW_UNSUPPORTED','This host has no owned worker review bridge.');
 const authenticate=async()=>{const current=await native.verifyCaller(metadata);if(!same(current,actor))fail('API_STALE_AUTHORITY','The head conversation changed while the worker request was open.');return current;};
 const api=await createApi({...options,projectRoot:actor.projectRoot,machineId:actor.machineId,authenticate});
 const authority=async()=>{
  await authenticate();const info=(await api.execute({operationId:`worker-review-caller-${randomUUID()}`,command:{type:'inspectCaller'}})).result;
  if(!info.member||info.member.boss_member_id!==null||!info.controllerGeneration)fail('API_HEAD_REQUIRED','Only the current approved top head can relay this worker’s native human request.');
  const queue=(await api.launch({operationId:`worker-review-queue-${randomUUID()}`,command:{type:'inspectLaunchQueue',teamId:info.member.team_id,expectedControllerGeneration:info.controllerGeneration}})).result.launches;
  if(!queue.some(row=>row.launch_id===args.launchId&&row.status==='bound'))fail('API_LAUNCH_SCOPE','This is not a bound worker in this head’s reviewed launch queue.');
  return native.ownedWorkerRequest('inspect',{launchId:args.launchId},metadata);
 };
 try{
  const worker=await authority();
  if(args.action==='reconcile'){if(typeof args.operationId!=='string'||!args.operationId)fail('API_INPUT_INVALID','Preserve the original review operationId.');return native.ownedWorkerRequest('reviewReceipt',{launchId:args.launchId,operationId:args.operationId},metadata);}
  const pending=await native.ownedWorkerRequest('pending',{launchId:args.launchId},metadata);
  if(args.action==='inspect')return {launchId:args.launchId,effectivePolicy:worker.effectivePolicy,requests:pending.map(row=>({requestId:row.id,method:row.method,params:row.params})),answersSubmitted:false};
  if(typeof args.operationId!=='string'||!args.operationId||!['string','number'].includes(typeof args.requestId))fail('API_INPUT_INVALID','Review requires the original native requestId and a fresh stable operationId.');
  const prior=await native.ownedWorkerRequest('reviewReceipt',{launchId:args.launchId,operationId:args.operationId},metadata);if(prior.state!=='unknown')return prior;
  const row=pending.find(row=>row.id===args.requestId);if(!row||row.params?.threadId!==worker.identity?.conversationId)fail('API_STALE_AUTHORITY','The native request is no longer pending in that exact worker.');
  if(!connection?.canElicit||typeof connection.elicit!=='function')fail('API_REVIEW_UNAVAILABLE','A real native form is required to relay this worker request.');
  const bridge=workerNativeForm(row);bridge.form.message=`Worker ${args.launchId} (${worker.identity.conversationId}) requests your input. This answers only this pending request.\n\n`+bridge.form.message;
  const started=Date.now(),answer=await connection.elicit(bridge.form);
  if(!['accept','decline','cancel'].includes(answer?.action))fail('API_APPROVAL_UNVERIFIED','A native answer was not obtained. No answer was sent.');
  if(answer.action!=='accept'&&Date.now()-started<HUMAN_REVIEW_FLOOR_MS)throw nativeReviewRefusal(Date.now()-started,'No worker answer was obtained.');
  const result=bridge.response(answer);const after=await authority();if(!same(after.identity,worker.identity))fail('API_STALE_AUTHORITY','The worker identity changed during review.');
  return native.ownedWorkerRequest('respond',{launchId:args.launchId,requestId:row.id,operationId:args.operationId,expected:row,result},metadata);
 }finally{await api.close();}
}
