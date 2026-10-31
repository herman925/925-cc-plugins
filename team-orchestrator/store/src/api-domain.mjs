// Private transaction implementation. Only the trusted API adapter supplies actor
// facts; no model-facing request accepts an actor, policy, path or SQL.
import { createHash } from 'node:crypto';
import { text, integer, databaseInteger, nextInteger, snapshot } from './validation.mjs';
import { refusal } from './errors.mjs';
import { normalizeConfigurationMutation, applyConfigurationMutation } from './configuration.mjs';
import { checkWriter, reference } from './writers.mjs';

const fail = (code, message) => { throw refusal(`API_${code}`, message); };
export function exact(input, fields) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !fields.includes(k))) fail('INPUT_INVALID', 'Unexpected API field or shape.');
}
export const controllerId = actor => createHash('sha256').update(JSON.stringify([actor.machineId, actor.provider, actor.conversationId])).digest('hex');
const gen = (v, field) => databaseInteger(v, field, { min: 1 });
export function apiResult(value) {
  if (Array.isArray(value)) return value.map(apiResult);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,item!==null && /^(?:generation|config_version|level|.*_generation|.*_at_ms|.*_deadline_ms|task_window_minutes)$/.test(key) ? databaseInteger(item,key) : apiResult(item)]));
}
const expected = (value, actual, field) => { if (value !== gen(actual, field)) fail('STALE_AUTHORITY', `${field} changed; inspect the current state before a new operation.`); };
const fields = {
  approveController: [], revokeController: ['controllerId', 'expectedControllerGeneration'],
  createFreshTeam: ['teamId', 'name', 'functionText', 'settings', 'members', 'expectedControllerGeneration'],
  bindMember: ['teamId', 'memberId', 'expectedConfigVersion', 'expectedMemberGeneration', 'expectedBindingGeneration', 'expectedControllerGeneration'],
  inspectTeam: ['teamId'],
  inspectCaller: [],
  inspectAssignment: ['teamId','assignmentId'],
  admitAssignment: ['teamId', 'runId', 'taskId', 'assignmentId', 'memberId', 'instructions', 'expectedResult', 'expectedConfigVersion', 'expectedMemberGeneration', 'expectedBindingGeneration', 'expectedTargetGeneration', 'expectedTargetBindingGeneration'],
  verifyAssignment: ['teamId', 'assignmentId', 'expectedConfigVersion', 'expectedMemberGeneration', 'expectedBindingGeneration', 'expectedAttemptGeneration'],
  reportOutcome: ['teamId', 'assignmentId', 'outcome', 'summary', 'evidence', 'expectedConfigVersion', 'expectedMemberGeneration', 'expectedBindingGeneration', 'expectedAttemptGeneration'],
  acceptTask: ['teamId', 'assignmentId', 'decision', 'reason', 'expectedConfigVersion', 'expectedMemberGeneration', 'expectedBindingGeneration', 'expectedAttemptGeneration'],
};

export function normalizeApiCommand(input, { privileged = false } = {}) {
  if (!Object.hasOwn(fields, input?.type) || (input.type === 'approveController' && !privileged)) fail('OPERATION_DENIED', 'This is not a model-facing API operation.');
  const names = fields[input.type];
  exact(input, ['type', ...names]);
  const out = { type: input.type };
  for (const k of names) {
    const v = input[k];
    if (k === 'settings' || k === 'members') continue;
    out[k] = /(?:Generation|Version)$/.test(k) ? integer(v, k, { min: k === 'expectedBindingGeneration' && input.type === 'bindMember' ? 0 : 1 })
      : text(v, k, { allowEmpty: k === 'functionText' });
  }
  if (input.type === 'createFreshTeam') {
    out.settings = normalizeConfigurationMutation({ type: 'createTeam', teamId: out.teamId, name: out.name, functionText: out.functionText, settings: input.settings }).settings;
    if (out.settings.exemptMemberIds.length) fail('INPUT_INVALID', 'Fresh-team exemptions must start empty.');
    if (!Array.isArray(input.members) || !input.members.length || input.members.length > 30) fail('INPUT_INVALID', 'Supply 1–30 fresh members ordered boss-first.');
    const seen = new Map();
    out.members = input.members.map(m => {
      exact(m, ['memberId', 'name', 'bossMemberId', 'role', 'officialText']);
      const value = { memberId: text(m.memberId, 'memberId'), name: text(m.name, 'name'), bossMemberId: m.bossMemberId === null ? null : text(m.bossMemberId, 'bossMemberId'), role: text(m.role, 'role'), officialText: text(m.officialText, 'officialText') };
      if (seen.has(value.memberId) || (value.bossMemberId !== null && !seen.has(value.bossMemberId))) fail('INPUT_INVALID', 'Fresh members must be unique and ordered boss-first.');
      seen.set(value.memberId, value); return value;
    });
    if (out.members.filter(m => m.bossMemberId === null).length !== 1) fail('INPUT_INVALID', 'A fresh team requires exactly one top member.');
  }
  if (out.outcome && !['succeeded', 'failed'].includes(out.outcome)) fail('INPUT_INVALID', 'An explicit succeeded or failed outcome is required.');
  if (out.decision && !['accepted', 'rejected'].includes(out.decision)) fail('INPUT_INVALID', 'Choose accepted or rejected.');
  return snapshot(out);
}

export function normalizeActor(input) {
  exact(input, ['projectRoot', 'machineId', 'provider', 'conversationId', 'executionHostId', 'contextId', 'terminalHandle', 'incarnationId']);
  return snapshot(Object.fromEntries(['projectRoot', 'machineId', 'provider', 'conversationId', 'executionHostId', 'contextId', 'terminalHandle', 'incarnationId'].map(k => [k, text(input[k], `verified ${k}`)])));
}

async function controller(db, actor, generation) {
  const [row] = await db.query('SELECT * FROM controller_approvals WHERE controller_id=:id', { id: controllerId(actor) });
  if (!row || Number(row.revoked) !== 0) fail('CONTROLLER_REQUIRED', 'This project/conversation has no active explicit controller approval.');
  if (generation !== undefined) expected(generation, row.generation, 'controller generation');
  return row;
}

async function memberActor(db, actor, command, requireGeneration = true) {
  const [binding] = await db.query('SELECT * FROM member_bindings WHERE machine_id=:machine AND provider=:provider AND conversation_id=:conversation', { machine: actor.machineId, provider: actor.provider, conversation: actor.conversationId });
  if (!binding) fail('BINDING_REQUIRED', 'This verified conversation has no member binding.');
  for (const [column, key] of [['execution_host_id','executionHostId'],['context_id','contextId'],['terminal_handle','terminalHandle'],['incarnation_id','incarnationId']]) {
    if (binding[column] !== actor[key]) fail('STALE_BINDING', 'The current native runtime does not match the active member binding. Ask an approved controller to rebind.');
  }
  const member = await reference(db, 'members', 'member_id', binding.member_id);
  if (member.membership_state !== 'active' || member.team_id !== command.teamId) fail('MEMBER_SCOPE', 'The caller is not an active member of this team.');
  if (member.home_execution_host_id !== actor.executionHostId || member.home_original_path !== actor.projectRoot || member.machine_id !== actor.machineId || member.worktree !== actor.contextId) fail('STALE_BINDING', 'The member home no longer matches the verified caller.');
  if (requireGeneration) {
    expected(command.expectedMemberGeneration, member.generation, 'member generation');
    expected(command.expectedBindingGeneration, binding.generation, 'binding generation');
  }
  return { member, binding };
}
async function teamVersion(db, command) {
  const team = await reference(db, 'teams', 'team_id', command.teamId);
  expected(command.expectedConfigVersion, team.config_version, 'configuration version');
  return team;
}

export async function assertApiCaller(db, command, actor) {
  if (command.type === 'approveController') return;
  if (command.type === 'inspectCaller') return;
  if (['revokeController','createFreshTeam','bindMember'].includes(command.type)) { await controller(db,actor); return; }
  if (command.type === 'inspectTeam') {
    const [row] = await db.query('SELECT revoked FROM controller_approvals WHERE controller_id=:id',{id:controllerId(actor)});
    if (row && Number(row.revoked) === 0) return;
  }
  await memberActor(db,actor,command,false);
}

// Runs only after the store has locked and validated its lease. The host has
// already been contacted outside this transaction; all mutable authority is read
// again here. No arbitrary client callback executes under the lock.
export async function applyApiCommand(db, command, actor, writer, now, target) {
  await checkWriter(db, writer, { advance: true });
  const type = command.type;
  if (type === 'approveController') {
    const id = controllerId(actor);
    const [old] = await db.query('SELECT * FROM controller_approvals WHERE controller_id=:id', { id });
    if (old && Number(old.revoked) === 1) fail('CONTROLLER_REVOKED', 'A revoked approval cannot be silently resurrected.');
    if (!old) await db.query(`INSERT INTO controller_approvals (controller_id,machine_id,provider,conversation_id,generation,approved_at_ms,revoked) VALUES (:id,:machine,:provider,:conversation,1,:now,0)`, { id, machine: actor.machineId, provider: actor.provider, conversation: actor.conversationId, now });
    return { controllerId: id, controllerGeneration: old ? gen(old.generation, 'controller generation') : 1 };
  }
  if (type === 'inspectCaller') {
    const [approval] = await db.query('SELECT generation,revoked FROM controller_approvals WHERE controller_id=:id',{id:controllerId(actor)});
    const [binding] = await db.query('SELECT * FROM member_bindings WHERE machine_id=:machine AND provider=:provider AND conversation_id=:conversation',{machine:actor.machineId,provider:actor.provider,conversation:actor.conversationId});
    if (!binding) return {controllerGeneration:approval&&Number(approval.revoked)===0?gen(approval.generation,'controller generation'):null,member:null};
    const row = await reference(db,'members','member_id',binding.member_id);
    const {member} = await memberActor(db,actor,{teamId:row.team_id},false);
    const team = await reference(db,'teams','team_id',member.team_id);
    const reports = await db.query("SELECT member_id FROM members WHERE boss_member_id=:id AND membership_state='active'",{id:member.member_id});
    return {controllerGeneration:approval&&Number(approval.revoked)===0?gen(approval.generation,'controller generation'):null,member,binding,configVersion:gen(team.config_version,'config version'),hasReports:reports.length>0};
  }
  if (['revokeController','createFreshTeam','bindMember'].includes(type)) await controller(db, actor, command.expectedControllerGeneration);
  if (type === 'revokeController') {
    // Self-revocation only in this slice; approving another never revokes it.
    if (command.controllerId !== controllerId(actor)) fail('OPERATION_DENIED', 'Only self-revocation is supported by this slice.');
    const next = nextInteger(command.expectedControllerGeneration, 'controller generation');
    await db.query('UPDATE controller_approvals SET revoked=1,generation=:next WHERE controller_id=:id AND generation=:expected', { next, id: command.controllerId, expected: command.expectedControllerGeneration });
    return { controllerId: command.controllerId, controllerGeneration: next, revoked: true };
  }
  if (type === 'createFreshTeam') {
    await applyConfigurationMutation(db, { type:'createTeam', teamId:command.teamId, name:command.name, functionText:command.functionText, settings:command.settings }, writer);
    let configVersion = 1;
    const levels = new Map();
    for (const m of command.members) {
      const level = m.bossMemberId === null ? 1 : levels.get(m.bossMemberId) + 1;
      levels.set(m.memberId,level);
      await applyConfigurationMutation(db, { type:'putMember', teamId:command.teamId, expectedConfigVersion:configVersion++, expectedGeneration:0,
        member: { ...m, level, model:'default', effort:'default', worktree:actor.contextId, registeredHome:{contextKind:'unknown',executionHostId:actor.executionHostId,originalPath:actor.projectRoot}, machineId:actor.machineId, location:'local', membershipState:'active', address:null, shortName:null, cli:actor.provider, allowAgent:false, allowWrite:false } }, writer);
      await applyConfigurationMutation(db, { type:'createRoleDocument', teamId:command.teamId, expectedConfigVersion:configVersion++, memberId:m.memberId, officialText:m.officialText, advisoryNotes:'' }, writer);
    }
    return { teamId:command.teamId, configVersion, memberIds:command.members.map(m=>m.memberId) };
  }
  if (type === 'inspectTeam') {
    // A controller may inspect; a member may inspect its own team only.
    const [approval] = await db.query('SELECT revoked FROM controller_approvals WHERE controller_id=:id', { id:controllerId(actor) });
    if (!approval || Number(approval.revoked) !== 0) await memberActor(db,actor,command,false);
    const team = await reference(db,'teams','team_id',command.teamId);
    return { team, members:await db.query('SELECT * FROM members WHERE team_id=:id ORDER BY member_id',{id:command.teamId}), bindings:await db.query('SELECT b.* FROM member_bindings b JOIN members m ON m.member_id=b.member_id WHERE m.team_id=:id ORDER BY b.member_id',{id:command.teamId}), roles:await db.query('SELECT d.* FROM role_documents d JOIN members m ON m.member_id=d.member_id WHERE m.team_id=:id ORDER BY d.member_id',{id:command.teamId}) };
  }
  if (type === 'inspectAssignment') {
    const {member} = await memberActor(db,actor,command,false);
    const assignment = await reference(db,'assignments','assignment_id',command.assignmentId);
    const task = await reference(db,'tasks','task_id',assignment.task_id);
    const run = await reference(db,'runs','run_id',task.run_id);
    const report = await reference(db,'members','member_id',assignment.member_id);
    if (run.team_id !== command.teamId || (assignment.member_id !== member.member_id && (assignment.assigned_by_member_id !== member.member_id || report.boss_member_id !== member.member_id))) fail('ASSIGNEE_REQUIRED','Only the assignee or its current admitting head may inspect this attempt.');
    const [acceptance] = await db.query('SELECT * FROM task_acceptances WHERE task_id=:id',{id:task.task_id});
    return {assignment,task,brief:await reference(db,'task_briefs','task_id',task.task_id),attempt:await reference(db,'assignment_attempts','assignment_id',command.assignmentId),acceptance:acceptance??null};
  }
  await teamVersion(db,command);
  if (type === 'bindMember') {
    const m = await reference(db,'members','member_id',command.memberId);
    if (m.team_id !== command.teamId || m.membership_state !== 'active') fail('MEMBER_SCOPE','Only an active member of this team can be bound.');
    expected(command.expectedMemberGeneration,m.generation,'member generation');
    if (!target || target.projectRoot !== actor.projectRoot || target.machineId !== actor.machineId || target.executionHostId !== actor.executionHostId || target.contextId !== m.worktree || target.projectRoot !== m.home_original_path || target.executionHostId !== m.home_execution_host_id) fail('TARGET_UNVERIFIED','Target native project, context, machine and home must agree.');
    const [old] = await db.query('SELECT * FROM member_bindings WHERE member_id=:id',{id:m.member_id});
    if ((old ? gen(old.generation,'binding generation') : 0) !== command.expectedBindingGeneration) fail('STALE_AUTHORITY','Binding generation changed.');
    const generation = nextInteger(command.expectedBindingGeneration,'binding generation');
    await db.query(`INSERT INTO member_bindings (member_id,machine_id,provider,conversation_id,execution_host_id,context_id,terminal_handle,incarnation_id,generation)
      VALUES (:id,:machine,:provider,:conversation,:host,:context,:terminal,:incarnation,:generation)
      ON CONFLICT (member_id) DO UPDATE SET machine_id=:machine,provider=:provider,conversation_id=:conversation,execution_host_id=:host,context_id=:context,terminal_handle=:terminal,incarnation_id=:incarnation,generation=:generation`, {id:m.member_id,machine:target.machineId,provider:target.provider,conversation:target.conversationId,host:target.executionHostId,context:target.contextId,terminal:target.terminalHandle,incarnation:target.incarnationId,generation});
    return { memberId:m.member_id,bindingGeneration:generation };
  }
  const {member} = await memberActor(db,actor,command);
  if (type === 'admitAssignment') {
    const report = await reference(db,'members','member_id',command.memberId);
    if (report.team_id !== command.teamId || report.membership_state !== 'active' || report.boss_member_id !== member.member_id) fail('DIRECT_REPORT_REQUIRED','Only a current direct report may receive this assignment.');
    expected(command.expectedTargetGeneration,report.generation,'target member generation');
    const [binding] = await db.query('SELECT generation FROM member_bindings WHERE member_id=:id',{id:report.member_id});
    if (!binding) fail('BINDING_REQUIRED','Bind the target before admitting work.');
    expected(command.expectedTargetBindingGeneration,binding.generation,'target binding generation');
    const [run] = await db.query('SELECT * FROM runs WHERE run_id=:id',{id:command.runId});
    if (run && run.team_id !== command.teamId) fail('MEMBER_SCOPE','The Run belongs to another team.');
    if (!run) await db.query('INSERT INTO runs (run_id,consumer_generation,team_id) VALUES (:id,1,:team)',{id:command.runId,team:command.teamId});
    const settings = await reference(db,'team_settings','team_id',command.teamId);
    const pickupDeadlineMs = integer(now + gen(settings.pickup_window_minutes,'pickup window') * 60000,'pickup deadline');
    await db.query('INSERT INTO tasks (task_id,run_id) VALUES (:id,:run)',{id:command.taskId,run:command.runId});
    await db.query('INSERT INTO task_briefs (task_id,instructions,expected_result) VALUES (:id,:instructions,:result)',{id:command.taskId,instructions:command.instructions,result:command.expectedResult});
    await db.query(`INSERT INTO assignments (assignment_id,task_id,member_id,admitted_at_ms,assigned_by_member_id,pickup_deadline_ms,task_window_minutes)
      VALUES (:id,:task,:member,:now,:head,:deadline,:window)`,{id:command.assignmentId,task:command.taskId,member:report.member_id,now,head:member.member_id,deadline:pickupDeadlineMs,window:settings.task_window_minutes});
    await db.query('INSERT INTO assignment_attempts (assignment_id,generation) VALUES (:id,1)',{id:command.assignmentId});
    return { assignmentId:command.assignmentId,taskId:command.taskId,attemptGeneration:1,pickupDeadlineMs };
  }
  const assignment = await reference(db,'assignments','assignment_id',command.assignmentId);
  const task = await reference(db,'tasks','task_id',assignment.task_id);
  const run = await reference(db,'runs','run_id',task.run_id);
  if (run.team_id !== command.teamId) fail('MEMBER_SCOPE','Assignment belongs to another team.');
  const attempt = await reference(db,'assignment_attempts','assignment_id',command.assignmentId);
  expected(command.expectedAttemptGeneration,attempt.generation,'attempt generation');
  const [settled] = await db.query('SELECT task_id FROM task_acceptances WHERE task_id=:id',{id:task.task_id});
  if (settled || task.status !== 'open') fail('ATTEMPT_SETTLED','This task has already been decided or is not open.');
  const next = nextInteger(gen(attempt.generation,'attempt generation'),'attempt generation');
  if (type === 'verifyAssignment' || type === 'reportOutcome') {
    if (assignment.member_id !== member.member_id) fail('ASSIGNEE_REQUIRED','Only the admitted assignee can verify or report this attempt.');
    if (attempt.outcome !== null) fail('ATTEMPT_SETTLED','An explicit outcome was already recorded.');
    if (type === 'verifyAssignment') {
      if (assignment.pickup_observed_at_ms !== null) fail('ALREADY_PICKED_UP','This assignment has already been verified.');
      if (now >= gen(assignment.pickup_deadline_ms,'pickup deadline') || assignment.pickup_expired_at_ms !== null) fail('PICKUP_EXPIRED','The pickup window has expired.');
      const deadline = assignment.task_window_minutes === null ? null : integer(now+gen(assignment.task_window_minutes,'task window')*60000,'task deadline');
      await db.query('UPDATE assignments SET pickup_observed_at_ms=:now,task_deadline_ms=:deadline WHERE assignment_id=:id AND pickup_observed_at_ms IS NULL',{now,deadline,id:command.assignmentId});
      await db.query('UPDATE assignment_attempts SET generation=:next WHERE assignment_id=:id AND generation=:expected',{next,id:command.assignmentId,expected:command.expectedAttemptGeneration});
      return {assignmentId:command.assignmentId,attemptGeneration:next,taskDeadlineMs:deadline,brief:await reference(db,'task_briefs','task_id',task.task_id),role:await reference(db,'role_documents','member_id',member.member_id)};
    }
    if (assignment.pickup_observed_at_ms === null) fail('PICKUP_REQUIRED','Verify the assignment and read its role/brief before reporting.');
    await db.query('UPDATE assignment_attempts SET generation=:next,outcome=:outcome,summary=:summary,evidence=:evidence,reported_at_ms=:now WHERE assignment_id=:id AND generation=:expected',{next,outcome:command.outcome,summary:command.summary,evidence:command.evidence,now,id:command.assignmentId,expected:command.expectedAttemptGeneration});
    return {assignmentId:command.assignmentId,attemptGeneration:next,outcome:command.outcome,acceptance:'pending'};
  }
  if (type === 'acceptTask') {
    const report = await reference(db,'members','member_id',assignment.member_id);
    if (report.boss_member_id !== member.member_id || assignment.assigned_by_member_id !== member.member_id || report.membership_state !== 'active') fail('HEAD_REQUIRED','Only the admitting current direct head may decide acceptance.');
    if (attempt.outcome === null) fail('OUTCOME_REQUIRED','The worker must report an explicit outcome first.');
    await db.query('INSERT INTO task_acceptances (task_id,assignment_id,accepted_by_member_id,decision,reason,decided_at_ms) VALUES (:task,:assignment,:head,:decision,:reason,:now)',{task:task.task_id,assignment:command.assignmentId,head:member.member_id,decision:command.decision,reason:command.reason,now});
    await db.query('UPDATE tasks SET status=:status,outcome=:outcome WHERE task_id=:id AND status=\'open\'',{status:command.decision==='accepted'?attempt.outcome:'blocked',outcome:command.decision==='accepted'?attempt.outcome:null,id:task.task_id});
    return {taskId:task.task_id,decision:command.decision,workerOutcome:attempt.outcome,summary:attempt.summary,evidence:attempt.evidence};
  }
  fail('OPERATION_DENIED','Unsupported API operation.');
}
