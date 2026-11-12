import {randomUUID} from 'node:crypto';
import {refusal} from './errors.mjs';
import {text,nextInteger} from './validation.mjs';
import {WORKER_TOOL_POLICY,WORKER_TOOL_BUNDLE_JSON} from './worker-policy.mjs';
import {headConsent,managedHeadOption,HEAD_TOOL_POLICY,HEAD_TOOL_BUNDLE_JSON} from './managed-head.mjs';
const fail=(code,message)=>{throw refusal(`API_${code}`,message);};
const proofFields=['launchId','planId','policyId','runtimeEpoch','nativeExecutionKey'];
export function normalizeRuntimeProof(input){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!proofFields.includes(k)))fail('WORKER_PROOF_REQUIRED','A private native worker runtime proof is required.');
 return Object.freeze(Object.fromEntries(proofFields.map(k=>[k,text(input[k],`native runtime ${k}`)])));
}
export async function workerConsent(db,launchId,planId){
 const [row]=await db.query(`SELECT c.*,r.member_generation,r.official_generation,r.notes_generation FROM worker_tool_consents c
 JOIN launch_plans p ON p.plan_id=c.plan_id JOIN launch_plan_members r ON r.plan_id=c.plan_id AND r.launch_id=c.launch_id
 WHERE c.launch_id=:id ${planId?'AND c.plan_id=:plan':''} ORDER BY p.created_at_ms DESC LIMIT 1`,{id:launchId,...(planId?{plan:planId}:{})});return row;
}
async function currentConsent(db,member,launch,planId){
 const consent=await workerConsent(db,launch.launch_id,planId),[role]=await db.query('SELECT * FROM role_documents WHERE member_id=:id',{id:member.member_id});
 if(!consent||consent.policy_id!==WORKER_TOOL_POLICY||consent.tools_json!==WORKER_TOOL_BUNDLE_JSON||Number(consent.member_generation)!==Number(member.generation)||Number(consent.official_generation)!==Number(role?.official_generation)||Number(consent.notes_generation)!==Number(role?.notes_generation))return null;
 if(member.boss_member_id===null){const option=await managedHeadOption(db,member.member_id),head=await headConsent(db,launch.launch_id,consent.plan_id);if(!option||option.team_id!==member.team_id||head?.policy_id!==HEAD_TOOL_POLICY||head?.tools_json!==HEAD_TOOL_BUNDLE_JSON)return null;}
 return consent;
}
export async function workerReadiness(db,memberId,now){
 const [member]=await db.query('SELECT * FROM members WHERE member_id=:id',{id:memberId});
 if(!member||!['claude','codex'].includes(member.cli))return {state:'external',covered:false};
 const [launch]=await db.query('SELECT * FROM member_launches WHERE member_id=:id',{id:memberId});
 if(member.cli==='claude'&&(!launch||!(await db.query('SELECT 1 FROM launch_plan_members WHERE launch_id=:id',{id:launch.launch_id})).length))return {state:'external',covered:false};
 // Existing explicitly connected sessions keep their existing workflow; this
 // consent contract governs workers created by the native launch workflow.
 if(!launch)return {state:'external',covered:false,reason:'Connected session; native-launch readiness is not attested.'};
 if(launch.status!=='bound')return {state:launch.status==='queued'?'queued':'starting',covered:true};
 const [r]=await db.query('SELECT * FROM worker_readiness WHERE member_id=:id',{id:memberId});
 const consent=await currentConsent(db,member,launch,r?.plan_id);
 if(!consent)return {state:'setup_required',covered:true,reason:'Review this worker and its current team-tool access. A process-only launch approval is insufficient.'};
 const [binding]=await db.query('SELECT * FROM member_bindings WHERE member_id=:id',{id:memberId});
 if(!binding||!r||r.plan_id!==consent.plan_id||Number(r.binding_generation)!==Number(binding.generation)||r.conversation_id!==binding.conversation_id||r.incarnation_id!==binding.incarnation_id)return {state:'checking',covered:true,reason:'Verify team tools in the current native worker execution.'};
 if(r.state==='disconnected')return {state:'disconnected',covered:true};
 if(now-Number(r.last_verified_at_ms)>90000)return {state:'checking',covered:true,reason:'Native readiness observation expired; wait for a fresh verified check.'};
 const latest=await workerConsent(db,launch.launch_id),setupPending=latest?.plan_id!==consent.plan_id;
 return {state:r.state,covered:true,setupPending,policyId:consent.policy_id,bindingGeneration:Number(binding.generation),missing:['status','api','inbox','seen'].filter(k=>Number(r[k+'_checked'])!==1)};
}
export async function requireWorkerReady(db,memberId,now){
 const readiness=await workerReadiness(db,memberId,now);
 if(readiness.covered&&(readiness.state!=='ready'||readiness.setupPending))fail('WORKER_NOT_READY',`The worker is ${readiness.setupPending?'awaiting reviewed setup':readiness.state}. Complete its reviewed team-tool setup and native readiness handshake before admitting work. No task or pickup deadline was created.`);
}
export async function workerReadinessSnapshot(db,teamId){
 const states=[];const now=await db.now();
 for(const {member_id} of await db.query("SELECT member_id FROM members WHERE team_id=:id AND cli IN ('claude','codex') AND membership_state='active' ORDER BY member_id",{id:teamId})){
  const state=await workerReadiness(db,member_id,now);if(state.covered)states.push({memberId:member_id,...state});
 }
 return states;
}
async function scope(db,actor,proof){
 if(!['claude','codex'].includes(actor.provider)||proof.policyId!==WORKER_TOOL_POLICY)fail('WORKER_PROOF_REQUIRED','This is not a verified native worker policy.');
 const [binding]=await db.query('SELECT * FROM member_bindings WHERE machine_id=:machine AND provider=:provider AND conversation_id=:conversation',{machine:actor.machineId,provider:actor.provider,conversation:actor.conversationId});
 if(!binding||binding.context_id!==actor.contextId||binding.terminal_handle!==actor.terminalHandle||binding.incarnation_id!==actor.incarnationId||binding.execution_host_id!==actor.executionHostId)fail('STALE_BINDING','The worker runtime does not match its native member binding.');
 const [member]=await db.query('SELECT * FROM members WHERE member_id=:id',{id:binding.member_id}),[launch]=await db.query('SELECT * FROM member_launches WHERE launch_id=:id',{id:proof.launchId});
 if(!member||member.cli!==actor.provider||member.membership_state!=='active'||member.home_original_path!==actor.projectRoot||member.machine_id!==actor.machineId||!launch||launch.member_id!==member.member_id||launch.status!=='bound'||launch.conversation_id!==actor.conversationId)fail('WORKER_PROOF_REQUIRED','The runtime is not this member’s bound native launch.');
 const consent=await currentConsent(db,member,launch,proof.planId);if(!consent)fail('WORKER_ACCESS_REQUIRED','The native worker profile does not match its reviewed tool-access plan.');
 return {binding,member,launch,consent};
}
export async function applyWorkerRuntime(db,c,actor,proof,now){
 const {binding,member,launch}=await scope(db,actor,proof),[old]=await db.query('SELECT * FROM worker_readiness WHERE member_id=:id',{id:member.member_id});
 const same=old&&old.runtime_epoch===proof.runtimeEpoch&&old.native_execution_key===proof.nativeExecutionKey&&old.plan_id===proof.planId&&Number(old.binding_generation)===Number(binding.generation)&&old.conversation_id===actor.conversationId&&old.incarnation_id===actor.incarnationId;
 if(c.type==='closeWorkerRuntime'){
  if(!same)return {closed:false};await db.query("UPDATE worker_readiness SET state='disconnected',generation=generation+1,last_verified_at_ms=:now WHERE member_id=:id AND runtime_epoch=:epoch",{now,id:member.member_id,epoch:proof.runtimeEpoch});return {closed:true};
 }
 if(c.type==='beginWorkerRuntime'){
  if(same)return {state:old.state};
  const values={member:member.member_id,launch:launch.launch_id,plan:proof.planId,epoch:proof.runtimeEpoch,key:proof.nativeExecutionKey,binding:Number(binding.generation),conversation:actor.conversationId,incarnation:actor.incarnationId,receipt:`bootstrap-read-${randomUUID()}`,now};
  if(!old)await db.query("INSERT INTO worker_readiness VALUES (:member,:launch,:plan,:epoch,:key,:binding,:conversation,:incarnation,:receipt,'checking',0,0,0,0,1,:now,:now)",values);
  else await db.query("UPDATE worker_readiness SET plan_id=:plan,runtime_epoch=:epoch,native_execution_key=:key,binding_generation=:binding,conversation_id=:conversation,incarnation_id=:incarnation,receipt_id=:receipt,state='checking',status_checked=0,api_checked=0,inbox_checked=0,seen_checked=0,generation=generation+1,last_verified_at_ms=:now WHERE member_id=:member",values);
  return {state:'checking'};
 }
 if(!same||old.state==='disconnected')fail('WORKER_RUNTIME_STALE','This readiness observation belongs to an older native execution or binding.');
 if(!['status','api','inbox','seen','heartbeat'].includes(c.step))fail('INPUT_INVALID','Unsupported native readiness step.');
 if(c.step==='seen'&&(Number(old.inbox_checked)!==1||c.receiptId!==old.receipt_id))fail('WORKER_RECEIPT_REQUIRED','Confirm the exact bootstrap receipt returned to this worker through its inbox tool.');
 const flags=Object.fromEntries(['status','api','inbox','seen'].map(k=>[k,Number(old[k+'_checked'])]));if(c.step!=='heartbeat')flags[c.step]=1;
 const state=Object.values(flags).every(v=>v===1)?'ready':'checking';
 await db.query('UPDATE worker_readiness SET state=:state,status_checked=:status,api_checked=:api,inbox_checked=:inbox,seen_checked=:seen,generation=:generation,last_verified_at_ms=:now WHERE member_id=:id AND runtime_epoch=:epoch',{state,...flags,generation:nextInteger(Number(old.generation),'worker readiness generation'),now,id:member.member_id,epoch:proof.runtimeEpoch});
 return {state,missing:Object.keys(flags).filter(k=>flags[k]!==1),...(c.step==='inbox'&&state!=='ready'?{bootstrap:{kind:'worker_tool_readiness',instructions:'This is a tool-readiness receipt, not a task or mail acknowledgement. Confirm this exact readReceiptId with shared_inbox_seen and inspect your team/official role through shared_team. Wait for Ready before task work.'},message:null,readReceiptId:old.receipt_id}:{})};
}
