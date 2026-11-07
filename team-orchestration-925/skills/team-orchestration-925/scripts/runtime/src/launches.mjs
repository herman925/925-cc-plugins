import {randomUUID} from 'node:crypto';
import {reference} from './writers.mjs';
import {databaseInteger,nextInteger,integer} from './validation.mjs';
import {refusal} from './errors.mjs';
import {WORKER_TOOL_POLICY,WORKER_TOOL_BUNDLE_JSON,requireWorkerToolPolicy} from './worker-policy.mjs';
import {workerConsent} from './worker-readiness.mjs';
const fail=(code,message)=>{throw refusal(`API_${code}`,message);};
const localMember=(m,actor)=>m.membership_state==='active'&&m.machine_id===actor.machineId&&m.worktree===actor.contextId&&m.home_original_path===actor.projectRoot&&m.home_execution_host_id===actor.executionHostId;
async function reviewedWorker(db,launch,member,requireAccess=false){
 if(member.cli!=='codex')return;
 const [review]=await db.query('SELECT r.* FROM launch_plan_members r JOIN launch_plans p ON p.plan_id=r.plan_id WHERE r.launch_id=:id AND p.controller_id=:controller ORDER BY p.created_at_ms DESC LIMIT 1',{id:launch.launch_id,controller:launch.controller_id});
 const role=await reference(db,'role_documents','member_id',member.member_id);
 if(!review)fail('APPROVAL_REQUIRED','A native-reviewed worker launch plan is required.');
 const consent=await workerConsent(db,launch.launch_id);
 if(requireAccess&&(!consent||consent.policy_id!==WORKER_TOOL_POLICY||consent.tools_json!==WORKER_TOOL_BUNDLE_JSON))fail('WORKER_ACCESS_REQUIRED','Review this worker and its team-tool access before starting it.');
 if(Number(member.generation)!==Number(review.member_generation)||Number(role.official_generation)!==Number(review.official_generation)||Number(role.notes_generation)!==Number(review.notes_generation))fail('STALE_AUTHORITY','The reviewed worker or role changed; review a new plan before starting it.');
}

export async function approveLaunchPlan(db,c,actor,approvalId,now){
 requireWorkerToolPolicy(c.workerToolPolicy);
 const [last]=await db.query('SELECT MAX(created_at_ms) AS latest FROM launch_plans');
 const created=integer(Math.max(now,nextInteger(databaseInteger(last.latest??0,'latest launch approval'),'launch approval time')),'launch approval time'),review=[];
 for(const s of c.selections){
  const m=await reference(db,'members','member_id',s.memberId),role=await reference(db,'role_documents','member_id',s.memberId);
  if(m.team_id!==c.teamId||m.cli!=='codex'||m.boss_member_id===null||!localMember(m,actor))fail('LAUNCH_SCOPE','Select active local Codex workers at this exact project home.');
  if(Number(m.generation)!==s.expectedMemberGeneration||Number(role.official_generation)!==s.expectedOfficialGeneration||Number(role.notes_generation)!==s.expectedNotesGeneration)fail('STALE_AUTHORITY','The reviewed worker or role changed.');
  const [binding]=await db.query('SELECT generation FROM member_bindings WHERE member_id=:id',{id:m.member_id});
  if(binding&&Number(binding.generation)!==s.expectedBindingGeneration)fail('LAUNCH_BOUND','Setup adoption requires the exact current binding generation; it never launches or replaces this worker.');
  if(!binding&&Number(s.expectedBindingGeneration??0)!==0)fail('STALE_AUTHORITY','The reviewed member binding changed.');
  const [old]=await db.query('SELECT * FROM member_launches WHERE member_id=:id',{id:m.member_id});
  if(old&&(old.launch_id!==s.launchId||old.controller_id!==approvalId||(binding?old.status!=='bound':old.status!=='queued')))fail('LAUNCH_BOUND','An existing start cannot be replaced; only an unchanged queued reservation or explicitly selected bound worker can be reviewed again.');
  if(binding&&!old)fail('LAUNCH_BOUND','This connected session has no native launch to adopt; use its separate existing-session setup.');
  review.push({selection:s,member:m,role});
 }
 await db.query('INSERT INTO launch_plans VALUES (:id,:team,:controller,:machine,:version,:selection,:now)',{id:c.planId,team:c.teamId,controller:approvalId,machine:actor.machineId,version:c.expectedConfigVersion,selection:JSON.stringify(review),now:created});
 for(const {selection:s} of review){
  if(!(await db.query('SELECT 1 FROM member_launches WHERE launch_id=:id',{id:s.launchId})).length)await db.query("INSERT INTO member_launches VALUES (:launch,:member,:controller,:machine,NULL,'queued',1,:now)",{launch:s.launchId,member:s.memberId,controller:approvalId,machine:actor.machineId,now:created});
  await db.query('INSERT INTO launch_plan_members VALUES (:launch,:plan,:member,:official,:notes)',{launch:s.launchId,plan:c.planId,member:s.expectedMemberGeneration,official:s.expectedOfficialGeneration,notes:s.expectedNotesGeneration});
  await db.query('INSERT INTO worker_tool_consents VALUES (:launch,:plan,:policy,:tools,:now)',{launch:s.launchId,plan:c.planId,policy:WORKER_TOOL_POLICY,tools:WORKER_TOOL_BUNDLE_JSON,now:created});
 }
 return {planId:c.planId,launchIds:c.selections.map(s=>s.launchId),setupRequiredMemberIds:review.filter(r=>Number(r.selection.expectedBindingGeneration??0)>0).map(r=>r.member.member_id)};
}
export async function inspectLaunchQueue(db,c,actor,approvalId){
 return {launches:await db.query("SELECT l.*,t.terminal_handle,(SELECT policy_id FROM worker_tool_consents c WHERE c.launch_id=l.launch_id ORDER BY c.created_at_ms DESC LIMIT 1) AS worker_tool_policy FROM member_launches l JOIN members m ON m.member_id=l.member_id LEFT JOIN launch_targets t ON t.launch_id=l.launch_id WHERE m.team_id=:team AND l.controller_id=:controller AND l.machine_id=:machine AND m.cli='codex' ORDER BY l.created_at_ms,l.launch_id",{team:c.teamId,controller:approvalId,machine:actor.machineId})};
}
export async function recordLaunchTarget(db,c,actor,approvalId,target,now){
 const l=await reference(db,'member_launches','launch_id',c.launchId),m=await reference(db,'members','member_id',l.member_id);
 if(l.controller_id!==approvalId||l.status!=='claimed'||m.cli!=='codex'||m.team_id!==c.teamId||!localMember(m,actor)||l.machine_id!==actor.machineId)fail('LAUNCH_SCOPE','This is not the current local claimed worker.');
 await reviewedWorker(db,l,m);
 if(!target||target.projectRoot!==actor.projectRoot||target.machineId!==actor.machineId||target.executionHostId!=='local'||target.contextId!==actor.contextId||target.terminalHandle===actor.terminalHandle)fail('TARGET_UNVERIFIED','Native terminal creation does not match this launch home.');
 await db.query('INSERT INTO launch_targets VALUES (:id,:terminal,:context,:incarnation,:host,:root,:machine,:now)',{id:c.launchId,terminal:target.terminalHandle,context:target.contextId,incarnation:target.incarnationId,host:target.executionHostId,root:target.projectRoot,machine:target.machineId,now});
 return {launchId:c.launchId,terminalHandle:target.terminalHandle,recorded:true};
}

export async function reserveLaunch(db,command,actor,approvalId,now) {
 const member=await reference(db,'members','member_id',command.memberId);
 if(member.team_id!==command.teamId||member.membership_state!=='active'||member.cli!=='claude'||member.machine_id!==actor.machineId||member.worktree!==actor.contextId||member.home_original_path!==actor.projectRoot||member.home_execution_host_id!==actor.executionHostId)fail('LAUNCH_SCOPE','Only an active local Claude member at this exact project home can be launched.');
 if(databaseInteger(member.generation,'member generation')!==command.expectedMemberGeneration)fail('STALE_AUTHORITY','Member generation changed.');
 if((await db.query('SELECT 1 FROM member_bindings WHERE member_id=:id',{id:member.member_id})).length)fail('LAUNCH_BOUND','This member already has a session. Launch never replaces or duplicates it.');
 const [old]=await db.query('SELECT * FROM member_launches WHERE member_id=:id',{id:member.member_id});
 if(old)return {launch:old,member,role:await reference(db,'role_documents','member_id',member.member_id)};
 const launch={launch_id:command.launchId,member_id:member.member_id,controller_id:approvalId,machine_id:actor.machineId,conversation_id:randomUUID(),status:'queued',generation:1,created_at_ms:now};
 await db.query('INSERT INTO member_launches VALUES (:launch_id,:member_id,:controller_id,:machine_id,:conversation_id,:status,:generation,:created_at_ms)',launch);
 return {launch,member,role:await reference(db,'role_documents','member_id',member.member_id)};
}
export async function claimLaunch(db,command,actor,approvalId) {
 const launch=await reference(db,'member_launches','launch_id',command.launchId),member=await reference(db,'members','member_id',launch.member_id);
 if(member.team_id!==command.teamId||launch.controller_id!==approvalId||launch.machine_id!==actor.machineId||!localMember(member,actor))fail('LAUNCH_SCOPE','This launch belongs to another controller or home.');
 if(launch.status!=='queued')return {claimed:false,launch};
 if((await db.query('SELECT 1 FROM member_bindings WHERE member_id=:id',{id:member.member_id})).length)fail('LAUNCH_BOUND','This worker was explicitly connected; the queued start cannot duplicate it.');
 await reviewedWorker(db,launch,member,true);
 const [settings]=await db.query('SELECT max_open FROM team_settings WHERE team_id=:id',{id:command.teamId});
 // Bindings and uncertain starts consume capacity. Contact loss never frees it.
 const [used]=await db.query(`SELECT (SELECT COUNT(*) FROM member_bindings b JOIN members m ON m.member_id=b.member_id WHERE m.team_id=:team AND b.machine_id=:machine)
  +(SELECT COUNT(*) FROM member_launches l JOIN members m ON m.member_id=l.member_id WHERE m.team_id=:team AND l.machine_id=:machine AND l.status='claimed') AS total`,{team:command.teamId,machine:actor.machineId});
 const limit=databaseInteger(settings.max_open,'capacity');
 if(limit>0&&Number(used.total)>=limit)return {claimed:false,queued:true,launch};
 const changed=await db.query("UPDATE member_launches SET status='claimed',generation=generation+1 WHERE launch_id=:id AND status='queued' RETURNING launch_id",{id:command.launchId});
 const consent=member.cli==='codex'?await workerConsent(db,launch.launch_id):null;
 return {claimed:changed.length===1,launch:{...launch,status:'claimed',generation:Number(launch.generation)+1},member,role:await reference(db,'role_documents','member_id',member.member_id),...(consent?{workerAccess:{planId:consent.plan_id,policyId:consent.policy_id}}:{})};
}
export async function attachLaunch(db,actor,expected={}) {
 if(expected.projectId){const [project]=await db.query('SELECT project_id FROM project_identity WHERE singleton=1');if(project?.project_id!==expected.projectId)fail('LAUNCH_SCOPE','The reserved worker belongs to a different project store.');}
 let [launch]=await db.query('SELECT * FROM member_launches WHERE conversation_id=:id AND machine_id=:machine',{id:actor.conversationId,machine:actor.machineId});
 if(!launch){
  const [target]=await db.query('SELECT * FROM launch_targets WHERE terminal_handle=:terminal AND machine_id=:machine AND context_id=:context',{terminal:actor.terminalHandle,machine:actor.machineId,context:actor.contextId});
  if(target){
   if(target.incarnation_id!==actor.incarnationId||target.project_root!==actor.projectRoot||target.execution_host_id!==actor.executionHostId||actor.provider!=='codex')fail('LAUNCH_SCOPE','The reserved native terminal incarnation changed.');
   launch=await reference(db,'member_launches','launch_id',target.launch_id);
   if(launch.conversation_id!==null&&launch.conversation_id!==actor.conversationId)fail('LAUNCH_BOUND','The reserved terminal belongs to another conversation.');
  }
 }
 if(!launch)return {attached:false};
 if(expected.launchId&&(launch.launch_id!==expected.launchId||launch.member_id!==expected.memberId))fail('LAUNCH_SCOPE','The native terminal is reserved for a different launch or member.');
 const member=await reference(db,'members','member_id',launch.member_id),approval=await reference(db,'controller_approvals','controller_id',launch.controller_id);
 if(member.membership_state!=='active'||member.worktree!==actor.contextId||member.home_original_path!==actor.projectRoot||member.home_execution_host_id!==actor.executionHostId)fail('LAUNCH_SCOPE','The reserved member home changed.');
 if(launch.status==='bound'){
  const binding=await reference(db,'member_bindings','member_id',member.member_id);
  if(binding.conversation_id!==actor.conversationId||binding.machine_id!==actor.machineId||binding.provider!==actor.provider)fail('LAUNCH_BOUND','This member was explicitly rebound elsewhere.');
  if(binding.terminal_handle!==actor.terminalHandle||binding.incarnation_id!==actor.incarnationId){
   if(expected.launchId)fail('STALE_BINDING','A resumed reserved Codex worker needs an explicit reviewed reconnect.');
   await db.query('UPDATE member_bindings SET terminal_handle=:terminal,incarnation_id=:incarnation,generation=generation+1 WHERE member_id=:id',{id:member.member_id,terminal:actor.terminalHandle,incarnation:actor.incarnationId});
  }
  return {attached:true,memberId:member.member_id};
 }
 if(Number(approval.revoked)!==0||launch.status!=='claimed')fail('LAUNCH_SCOPE','Launch approval or claim changed; this session cannot attach.');
 if(actor.provider!==(member.cli??'claude'))fail('LAUNCH_SCOPE','The native provider does not match the reserved member.');
 await reviewedWorker(db,launch,member);
 if((await db.query('SELECT 1 FROM member_bindings WHERE member_id=:id',{id:member.member_id})).length)fail('LAUNCH_BOUND','The member was bound elsewhere; no session was replaced.');
 await db.query(`INSERT INTO member_bindings VALUES (:member,:machine,:provider,:conversation,:host,:context,:terminal,:incarnation,1)`,{member:member.member_id,machine:actor.machineId,provider:actor.provider,conversation:actor.conversationId,host:actor.executionHostId,context:actor.contextId,terminal:actor.terminalHandle,incarnation:actor.incarnationId});
 await db.query("UPDATE member_launches SET status='bound',conversation_id=:conversation,generation=generation+1 WHERE launch_id=:id AND status='claimed'",{id:launch.launch_id,conversation:actor.conversationId});
 return {attached:true,memberId:member.member_id,role:await reference(db,'role_documents','member_id',member.member_id)};
}
