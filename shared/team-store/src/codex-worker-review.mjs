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
 const onceOnly=map=>({form:{message:'Review this exact native action. Allowing it applies once and grants no standing or session permission.\n'+JSON.stringify(params,null,2),requestedSchema:{type:'object',properties:{decision:{type:'string',title:'Decision for this action',enum:['Deny','Allow once'],default:'Deny'}},required:['decision']}},response:answer=>{if(answer.action==='cancel')fail('API_APPROVAL_REQUIRED','No decision was submitted. The native request remains pending.');if(answer.action==='decline')return map(false);if(answer.action!=='accept'||!['Deny','Allow once'].includes(answer.content?.decision))fail('API_INPUT_INVALID','The native decision was incomplete. No answer was sent.');return map(answer.content.decision==='Allow once');}});
 if(Buffer.byteLength(JSON.stringify(row),'utf8')>60000)fail('API_WORKER_REVIEW_UNSUPPORTED','This native request is too large to display completely. No answer was sent.');
 if(row.method==='claude/permission/request'&&params?.toolName==='AskUserQuestion'){
  const questions=params.input?.questions;if(!Array.isArray(questions)||!questions.length||questions.length>4)fail('API_WORKER_REVIEW_UNSUPPORTED','The native Claude question cannot be represented safely.');
  const properties={},required=[];
  questions.forEach((question,index)=>{if(typeof question.question!=='string'||question.isSecret||!Array.isArray(question.options)||question.options.some(option=>typeof option.label!=='string'))fail('API_WORKER_REVIEW_UNSUPPORTED','The native question needs a supported private input interface.');const key='answer'+index,choices=[...new Set([...question.options.map(option=>option.label),'Other'])];properties[key]=question.multiSelect?{type:'array',title:question.question,items:{type:'string',enum:choices},minItems:1,uniqueItems:true}:{type:'string',title:question.question,enum:choices};properties['other'+index]={type:'string',title:'Optional written answer to: '+question.question};required.push(key);});
  return {form:{message:'Answer the original pending questions from this Claude worker.',requestedSchema:{type:'object',properties,required}},response:answer=>{
   if(answer.action!=='accept')fail('API_APPROVAL_REQUIRED','No answers were submitted. The native question remains pending.');
   const answers=Object.fromEntries(questions.map((question,index)=>{const selected=answer.content?.['answer'+index],other=answer.content?.['other'+index],choices=question.options.map(option=>option.label);if(typeof other==='string'&&other.trim())return [question.question,other];if(question.multiSelect){if(!Array.isArray(selected)||!selected.length||selected.some(value=>!choices.includes(value)))fail('API_INPUT_INVALID','The native question answer is incomplete.');}else if(typeof selected!=='string'||!choices.includes(selected))fail('API_INPUT_INVALID','Choose an original option or supply a written answer.');return [question.question,selected];}));
   const updatedInput={...params.input,answers};delete updatedInput.response;return {behavior:'allow',updatedInput};
  }};
 }
 if(row.method==='claude/permission/request'&&typeof params?.toolName==='string'&&params.input&&typeof params.input==='object')return onceOnly(allow=>allow?{behavior:'allow',updatedInput:structuredClone(params.input)}:{behavior:'deny',message:'Native review did not allow this exact action.'});
 if(row.method==='item/commandExecution/requestApproval'&&typeof params?.command==='string'&&params.command){
  if(params.availableDecisions&&!params.availableDecisions.includes('accept'))fail('API_WORKER_REVIEW_UNSUPPORTED','The native policy does not offer one-time approval for this command.');
  return onceOnly(allow=>({decision:allow?'accept':'decline'}));
 }
 if(row.method==='item/fileChange/requestApproval'){
  const details=row.reviewDetails;
  if(!details||details.turnId!==params.turnId||details.item?.id!==params.itemId||details.item.type!=='fileChange'||!details.item.changes?.length||details.item.changes.some(change=>typeof change.path!=='string'||typeof change.diff!=='string'))fail('API_WORKER_REVIEW_UNSUPPORTED','The exact native file diff is unavailable. No blind file approval is permitted.');
  if(params.availableDecisions&&!params.availableDecisions.includes('accept'))fail('API_WORKER_REVIEW_UNSUPPORTED','The native policy does not offer one-time approval for these files.');
  const bridge=onceOnly(allow=>({decision:allow?'accept':'decline'}));bridge.form.message+='\nExact pending native file changes:\n'+JSON.stringify(details.item.changes,null,2);return bridge;
 }
 if(['mcpServer/elicitation/request','team/review/request'].includes(row.method)&&['form','openai/form','openaiForm'].includes(params?.mode)&&params.requestedSchema?.type==='object'&&typeof params.message==='string')return {
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
  if(!info.controllerGeneration)fail('API_HEAD_REQUIRED','An approved top head relays worker requests; the approving controller may view only its exact optional managed lead.');
  let allowed=false,binding;
  if(info.member?.boss_member_id===null){
   const config=(await api.execute({operationId:`worker-review-team-${randomUUID()}`,command:{type:'inspectConfiguration',teamId:info.member.team_id}})).result;
   const launch=config.launches.find(row=>row.launch_id===args.launchId&&row.status==='bound'&&row.member_id!==info.member.member_id);allowed=Boolean(launch);binding=config.bindings.find(row=>row.member_id===launch?.member_id);
  }
  if(!allowed)for(const team of info.teams??[]){
   const queue=(await api.launch({operationId:`head-viewer-queue-${randomUUID()}`,command:{type:'inspectLaunchQueue',teamId:team.team_id,expectedControllerGeneration:info.controllerGeneration}})).result.launches;
   const launch=queue.find(row=>row.launch_id===args.launchId&&row.status==='bound');if(!launch)continue;
   const config=(await api.execute({operationId:`head-viewer-team-${randomUUID()}`,command:{type:'inspectConfiguration',teamId:team.team_id}})).result;
   allowed=config.managedLead?.memberId===launch.member_id&&config.members.some(member=>member.member_id===launch.member_id&&member.boss_member_id===null);binding=config.bindings.find(row=>row.member_id===launch.member_id);break;
  }
  if(!allowed)fail('API_LAUNCH_SCOPE','This is neither a bound worker in this approved head’s team nor the exact optional managed lead in this controller’s own reviewed launch queue.');
  const worker=await native.ownedWorkerRequest('inspect',{launchId:args.launchId},metadata),fields={machineId:'machine_id',provider:'provider',conversationId:'conversation_id',executionHostId:'execution_host_id',contextId:'context_id',terminalHandle:'terminal_handle',incarnationId:'incarnation_id'};
  if(!binding||worker.identity?.projectRoot!==actor.projectRoot||Object.entries(fields).some(([nativeKey,savedKey])=>worker.identity?.[nativeKey]!==binding[savedKey]))fail('API_STALE_AUTHORITY','The owned session no longer matches the current member binding. No request was answered.');
  return worker;
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
  let reviewDetails;if(row.method==='item/fileChange/requestApproval'){reviewDetails=await native.ownedWorkerRequest('reviewInfo',{launchId:args.launchId,requestId:row.id},metadata);if(!same(reviewDetails.request,row))fail('API_STALE_AUTHORITY','The pending file request changed.');}
  const bridge=workerNativeForm(reviewDetails?{...row,reviewDetails:reviewDetails.details}:row);bridge.form.message=`Worker ${args.launchId} (${worker.identity.conversationId}) requests your input. This answers only this pending request.\n\n`+bridge.form.message;
  const started=Date.now(),answer=await connection.elicit(bridge.form);
  if(!['accept','decline','cancel'].includes(answer?.action))fail('API_APPROVAL_UNVERIFIED','A native answer was not obtained. No answer was sent.');
  if(answer.action!=='accept'&&Date.now()-started<HUMAN_REVIEW_FLOOR_MS)throw nativeReviewRefusal(Date.now()-started,'No worker answer was obtained.');
  const result=bridge.response(answer);const after=await authority();if(!same(after.identity,worker.identity))fail('API_STALE_AUTHORITY','The worker identity changed during review.');
  if(reviewDetails&&!same(await native.ownedWorkerRequest('reviewInfo',{launchId:args.launchId,requestId:row.id},metadata),reviewDetails))fail('API_STALE_AUTHORITY','The exact pending native file changes changed during review.');
  return native.ownedWorkerRequest('respond',{launchId:args.launchId,requestId:row.id,operationId:args.operationId,expected:row,result},metadata);
 }finally{await api.close();}
}
