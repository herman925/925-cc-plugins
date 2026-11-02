import {randomUUID} from 'node:crypto';
import {reference} from './writers.mjs';
import {databaseInteger} from './validation.mjs';
import {refusal} from './errors.mjs';
const fail=(code,message)=>{throw refusal(`API_${code}`,message);};

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
 if(member.team_id!==command.teamId||launch.controller_id!==approvalId||launch.machine_id!==actor.machineId||member.worktree!==actor.contextId||member.membership_state!=='active')fail('LAUNCH_SCOPE','This launch belongs to another controller or home.');
 if(launch.status!=='queued')return {claimed:false,launch};
 const [settings]=await db.query('SELECT max_open FROM team_settings WHERE team_id=:id',{id:command.teamId});
 // Bindings and uncertain starts consume capacity. Contact loss never frees it.
 const [used]=await db.query(`SELECT (SELECT COUNT(*) FROM member_bindings b JOIN members m ON m.member_id=b.member_id WHERE m.team_id=:team AND b.machine_id=:machine)
  +(SELECT COUNT(*) FROM member_launches l JOIN members m ON m.member_id=l.member_id WHERE m.team_id=:team AND l.machine_id=:machine AND l.status='claimed') AS total`,{team:command.teamId,machine:actor.machineId});
 const limit=databaseInteger(settings.max_open,'capacity');
 if(limit>0&&Number(used.total)>=limit)return {claimed:false,queued:true,launch};
 const changed=await db.query("UPDATE member_launches SET status='claimed',generation=generation+1 WHERE launch_id=:id AND status='queued' RETURNING launch_id",{id:command.launchId});
 return {claimed:changed.length===1,launch:{...launch,status:'claimed',generation:Number(launch.generation)+1},member,role:await reference(db,'role_documents','member_id',member.member_id)};
}
export async function attachLaunch(db,actor) {
 const [launch]=await db.query('SELECT * FROM member_launches WHERE conversation_id=:id AND machine_id=:machine',{id:actor.conversationId,machine:actor.machineId});
 if(!launch)return {attached:false};
 const member=await reference(db,'members','member_id',launch.member_id),approval=await reference(db,'controller_approvals','controller_id',launch.controller_id);
 if(member.membership_state!=='active'||member.worktree!==actor.contextId||member.home_original_path!==actor.projectRoot||member.home_execution_host_id!==actor.executionHostId)fail('LAUNCH_SCOPE','The reserved member home changed.');
 if(launch.status==='bound'){
  const binding=await reference(db,'member_bindings','member_id',member.member_id);
  if(binding.conversation_id!==actor.conversationId||binding.machine_id!==actor.machineId||binding.provider!==actor.provider)fail('LAUNCH_BOUND','This member was explicitly rebound elsewhere.');
  if(binding.terminal_handle!==actor.terminalHandle||binding.incarnation_id!==actor.incarnationId)await db.query('UPDATE member_bindings SET terminal_handle=:terminal,incarnation_id=:incarnation,generation=generation+1 WHERE member_id=:id',{id:member.member_id,terminal:actor.terminalHandle,incarnation:actor.incarnationId});
  return {attached:true,memberId:member.member_id};
 }
 if(Number(approval.revoked)!==0||launch.status!=='claimed')fail('LAUNCH_SCOPE','Launch approval or claim changed; this session cannot attach.');
 if((await db.query('SELECT 1 FROM member_bindings WHERE member_id=:id',{id:member.member_id})).length)fail('LAUNCH_BOUND','The member was bound elsewhere; no session was replaced.');
 await db.query(`INSERT INTO member_bindings VALUES (:member,:machine,:provider,:conversation,:host,:context,:terminal,:incarnation,1)`,{member:member.member_id,machine:actor.machineId,provider:actor.provider,conversation:actor.conversationId,host:actor.executionHostId,context:actor.contextId,terminal:actor.terminalHandle,incarnation:actor.incarnationId});
 await db.query("UPDATE member_launches SET status='bound',generation=generation+1 WHERE launch_id=:id AND status='claimed'",{id:launch.launch_id});
 return {attached:true,memberId:member.member_id,role:await reference(db,'role_documents','member_id',member.member_id)};
}
