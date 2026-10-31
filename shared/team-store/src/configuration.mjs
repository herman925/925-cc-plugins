import { Buffer } from 'node:buffer';
import { text, integer, databaseInteger, nextInteger, snapshot } from './validation.mjs';
import { checkWriter, reference } from './writers.mjs';
import { refusal } from './errors.mjs';

const types = new Set(['createTeam', 'saveTeamSettings', 'putMember', 'createRoleDocument', 'updateOfficialRole', 'updateAdvisoryNotes']);
export const isConfigurationType = type => types.has(type);
const optional = (value, field) => value == null ? null : text(value, field, { allowEmpty: true });
const flag = (value, field) => { if (typeof value !== 'boolean') throw refusal('STORE_INPUT_INVALID', `${field} must be a boolean.`); return value; };
const choice = (value, field, values) => { if (!values.includes(value)) throw refusal('STORE_INPUT_INVALID', `${field} must be one of ${values.join(', ')}.`); return value; };
const exact = (object, names) => {
  if (!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(key => !names.includes(key))) throw refusal('STORE_INPUT_INVALID', 'Unexpected configuration field or shape.');
};
export const byteOrder = values => [...values].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));

function settings(input) {
  exact(input, ['autoClose', 'idleMinutes', 'reopen', 'maxOpen', 'launch', 'batch', 'autoScratch', 'assumptions', 'scratchDir', 'pickupWindowMinutes', 'answerWindowMinutes', 'taskWindowMinutes', 'replayIntervalMs', 'exemptMemberIds']);
  if (!Object.hasOwn(input, 'pickupWindowMinutes')) throw refusal('STORE_PICKUP_WINDOW_REQUIRED', 'pickupWindowMinutes must be explicitly configured; no default pickup window was chosen.');
  if (!Object.hasOwn(input, 'answerWindowMinutes')) throw refusal('STORE_ANSWER_WINDOW_REQUIRED', 'answerWindowMinutes must be explicitly configured; no default answer window was chosen.');
  if (!Object.hasOwn(input, 'taskWindowMinutes')) throw refusal('STORE_TASK_WINDOW_REQUIRED', 'taskWindowMinutes must be explicitly configured as positive minutes or null for off; no default was chosen.');
  if (!Object.hasOwn(input, 'replayIntervalMs')) throw refusal('STORE_REPLAY_INTERVAL_REQUIRED', 'replayIntervalMs must be explicitly configured as positive milliseconds; no default replay rate was chosen.');
  if (!Array.isArray(input.exemptMemberIds)) throw refusal('STORE_INPUT_INVALID', 'exemptMemberIds must be an explicit array of member IDs.');
  const ids = input.exemptMemberIds.map(id => text(id, 'exemptMemberId'));
  if (new Set(ids).size !== ids.length) throw refusal('STORE_INPUT_INVALID', 'exemptMemberIds must contain unique member IDs.');
  return {
    autoClose: flag(input.autoClose, 'autoClose'), idleMinutes: integer(input.idleMinutes, 'idleMinutes'),
    reopen: choice(input.reopen, 'reopen', ['resume', 'fresh']), maxOpen: integer(input.maxOpen, 'maxOpen'),
    launch: choice(input.launch, 'launch', ['demand', 'all']), batch: integer(input.batch, 'batch', { min: 1 }),
    autoScratch: flag(input.autoScratch, 'autoScratch'), assumptions: flag(input.assumptions, 'assumptions'),
    scratchDir: text(input.scratchDir, 'scratchDir', { allowEmpty: true }),
    pickupWindowMinutes: integer(input.pickupWindowMinutes, 'pickupWindowMinutes', { min: 1 }),
    answerWindowMinutes: integer(input.answerWindowMinutes, 'answerWindowMinutes', { min: 1 }),
    taskWindowMinutes: input.taskWindowMinutes === null ? null : integer(input.taskWindowMinutes, 'taskWindowMinutes', { min: 1 }),
    replayIntervalMs: integer(input.replayIntervalMs, 'replayIntervalMs', { min: 1 }), exemptMemberIds: byteOrder(ids),
  };
}

function member(input) {
  exact(input, ['memberId', 'name', 'bossMemberId', 'role', 'level', 'model', 'effort', 'worktree', 'registeredHome', 'machineId', 'location', 'membershipState', 'address', 'shortName', 'cli', 'allowAgent', 'allowWrite']);
  let home = null;
  if (input.registeredHome != null) {
    exact(input.registeredHome, ['contextKind', 'executionHostId', 'originalPath']);
    home = { contextKind: choice(input.registeredHome.contextKind, 'home.contextKind', ['worktree', 'folder', 'unknown']),
      executionHostId: text(input.registeredHome.executionHostId, 'home.executionHostId'), originalPath: text(input.registeredHome.originalPath, 'home.originalPath') };
  }
  return {
    memberId: text(input.memberId, 'memberId'), name: text(input.name, 'member name'), bossMemberId: input.bossMemberId == null ? null : text(input.bossMemberId, 'bossMemberId'),
    role: text(input.role, 'role', { allowEmpty: true }), level: integer(input.level, 'level', { min: 1 }),
    model: text(input.model, 'model', { allowEmpty: true }), effort: text(input.effort, 'effort', { allowEmpty: true }),
    worktree: optional(input.worktree, 'worktree'), registeredHome: home, machineId: optional(input.machineId, 'machineId'),
    location: input.location == null ? null : choice(input.location, 'location', ['local', 'remote', 'other-cli']),
    membershipState: choice(input.membershipState, 'membershipState', ['active', 'retired']), address: optional(input.address, 'address'),
    shortName: optional(input.shortName, 'shortName'), cli: optional(input.cli, 'cli'), allowAgent: flag(input.allowAgent, 'allowAgent'), allowWrite: flag(input.allowWrite, 'allowWrite'),
  };
}

export function normalizeConfigurationMutation(input) {
  const result = { type: input.type, teamId: text(input.teamId, 'teamId') };
  if (input.type !== 'createTeam') result.expectedConfigVersion = integer(input.expectedConfigVersion, 'expectedConfigVersion', { min: 1 });
  const keys = ['type', 'teamId', ...(input.type === 'createTeam' ? [] : ['expectedConfigVersion'])];
  switch (input.type) {
    case 'createTeam':
      Object.assign(result, { name: text(input.name, 'team name'), functionText: text(input.functionText, 'functionText', { allowEmpty: true }), settings: settings(input.settings) });
      keys.push('name', 'functionText', 'settings'); break;
    case 'saveTeamSettings': result.settings = settings(input.settings); keys.push('settings'); break;
    case 'putMember':
      result.member = member(input.member); result.expectedGeneration = integer(input.expectedGeneration, 'expectedGeneration');
      keys.push('member', 'expectedGeneration'); break;
    case 'createRoleDocument':
      result.memberId = text(input.memberId, 'memberId'); result.officialText = text(input.officialText, 'officialText', { allowEmpty: true });
      result.advisoryNotes = text(input.advisoryNotes, 'advisoryNotes', { allowEmpty: true }); keys.push('memberId', 'officialText', 'advisoryNotes'); break;
    case 'updateOfficialRole': case 'updateAdvisoryNotes': {
      const field = input.type === 'updateOfficialRole' ? 'officialText' : 'advisoryNotes';
      result.memberId = text(input.memberId, 'memberId'); result.expectedGeneration = integer(input.expectedGeneration, 'expectedGeneration', { min: 1 });
      result[field] = text(input[field], field, { allowEmpty: true }); keys.push('memberId', 'expectedGeneration', field); break;
    }
  }
  exact(input, keys);
  return snapshot(result);
}

async function saveSettings(db, teamId, value, create) {
  for (const id of value.exemptMemberIds) await reference(db, 'members', 'member_id', id);
  const params = { id: teamId, auto: +value.autoClose, idle: value.idleMinutes, reopen: value.reopen, max: value.maxOpen,
    launch: value.launch, batch: value.batch, scratch: +value.autoScratch, assumptions: +value.assumptions,
    path: value.scratchDir, pickup: value.pickupWindowMinutes, answer: value.answerWindowMinutes,
    task: value.taskWindowMinutes, replay: value.replayIntervalMs };
  if (create) await db.query(`INSERT INTO team_settings
    (team_id,auto_close,idle_minutes,reopen,max_open,launch,batch_size,auto_scratch,assumptions,scratch_dir,pickup_window_minutes,answer_window_minutes,task_window_minutes,replay_interval_ms)
    VALUES (:id,:auto,:idle,:reopen,:max,:launch,:batch,:scratch,:assumptions,:path,:pickup,:answer,:task,:replay)`, params);
  else {
    await reference(db, 'team_settings', 'team_id', teamId);
    await db.query(`UPDATE team_settings SET auto_close=:auto,idle_minutes=:idle,reopen=:reopen,max_open=:max,launch=:launch,
      batch_size=:batch,auto_scratch=:scratch,assumptions=:assumptions,scratch_dir=:path,pickup_window_minutes=:pickup,
      answer_window_minutes=:answer,task_window_minutes=:task,replay_interval_ms=:replay WHERE team_id=:id`, params);
  }
  await db.query('DELETE FROM settings_exemptions WHERE team_id = :id', { id: teamId });
  for (const id of value.exemptMemberIds) await db.query('INSERT INTO settings_exemptions (team_id,member_id) VALUES (:team,:member)', { team: teamId, member: id });
}

async function teamVersion(db, id, expected) {
  const row = await reference(db, 'teams', 'team_id', id);
  const current = databaseInteger(row.config_version, 'config_version', { min: 1 });
  if (current !== expected) throw refusal('STORE_CONFIG_CONFLICT', `Team ${JSON.stringify(id)} configuration changed (expected ${expected}, current ${current}).`, { teamId: id, expected, current });
  nextInteger(current, 'config_version');
  return row;
}

async function memberInTeam(db, id, teamId) {
  const row = await reference(db, 'members', 'member_id', id);
  if (row.team_id !== teamId) throw refusal('STORE_MEMBER_SCOPE', `Member ${JSON.stringify(id)} belongs to team ${JSON.stringify(row.team_id)}, not ${JSON.stringify(teamId)}.`, { memberId: id, teamId });
  return row;
}

export async function applyConfigurationMutation(db, mutation, writer) {
  if (mutation.type === 'createTeam') {
    const [duplicate] = await db.query('SELECT team_id FROM teams WHERE team_id = :id OR name = :name', { id: mutation.teamId, name: mutation.name });
    if (duplicate) throw refusal('STORE_TEAM_EXISTS', `Team ID or name ${JSON.stringify(mutation.teamId)} / ${JSON.stringify(mutation.name)} already belongs to ${JSON.stringify(duplicate.team_id)}.`);
    await checkWriter(db, writer, { advance: true });
    await db.query(`INSERT INTO teams (team_id,name,function_text,config_version,written_by_client,written_by_version)
      VALUES (:id,:name,:function,1,:client,:version)`, { id: mutation.teamId, name: mutation.name, function: mutation.functionText, client: writer.client, version: writer.version });
    await saveSettings(db, mutation.teamId, mutation.settings, true);
    return { type: mutation.type, teamId: mutation.teamId, configVersion: 1 };
  }
  await teamVersion(db, mutation.teamId, mutation.expectedConfigVersion);
  await checkWriter(db, writer, { advance: true });
  let extra = {};
  if (mutation.type === 'saveTeamSettings') await saveSettings(db, mutation.teamId, mutation.settings, false);
  else if (mutation.type === 'putMember') {
    const m = mutation.member;
    const [old] = await db.query('SELECT * FROM members WHERE member_id = :id', { id: m.memberId });
    if (old && old.team_id !== mutation.teamId) throw refusal('STORE_MEMBER_SCOPE', `Member ${JSON.stringify(m.memberId)} belongs to another team; routine roster updates cannot transfer it.`);
    const actual = old ? databaseInteger(old.generation, 'member generation', { min: 1 }) : 0;
    if (actual !== mutation.expectedGeneration) throw refusal('STORE_MEMBER_CONFLICT', `Member ${JSON.stringify(m.memberId)} generation changed (expected ${mutation.expectedGeneration}, current ${actual}).`);
    const [nameTaken] = await db.query('SELECT member_id FROM members WHERE name = :name AND member_id <> :id', { name: m.name, id: m.memberId });
    if (nameTaken) throw refusal('STORE_MEMBER_NAME_EXISTS', `Member name ${JSON.stringify(m.name)} already belongs to ${JSON.stringify(nameTaken.member_id)}.`);
    const seen = new Set([m.memberId]);
    for (let boss = m.bossMemberId; boss;) {
      if (seen.has(boss)) throw refusal('STORE_HIERARCHY_CYCLE', `Boss chain for member ${JSON.stringify(m.memberId)} would contain a cycle through ${JSON.stringify(boss)}.`);
      seen.add(boss); boss = (await reference(db, 'members', 'member_id', boss)).boss_member_id;
    }
    const home = m.registeredHome;
    if (old?.home_context_kind != null && (old.home_context_kind !== home?.contextKind || old.home_execution_host_id !== home?.executionHostId || old.home_original_path !== home?.originalPath)) {
      throw refusal('STORE_HOME_IMMUTABLE', `Registered home for member ${JSON.stringify(m.memberId)} cannot change in a routine roster update; an explicit transfer flow is required.`);
    }
    const next = nextInteger(actual, 'member generation');
    const fields = {
      member_id: m.memberId, team_id: mutation.teamId, name: m.name, boss_member_id: m.bossMemberId, role: m.role, level: m.level,
      model: m.model, effort: m.effort, worktree: m.worktree, home_context_kind: home?.contextKind ?? null,
      home_execution_host_id: home?.executionHostId ?? null, home_original_path: home?.originalPath ?? null, machine_id: m.machineId,
      location: m.location, membership_state: m.membershipState, address: m.address, short_name: m.shortName, cli: m.cli,
      allow_agent: +m.allowAgent, allow_write: +m.allowWrite, generation: next,
    };
    if (old) {
      const rows = await db.query(`UPDATE members SET ${Object.keys(fields).filter(key => key !== 'member_id').map(key => `${key}=:${key}`).join(',')}
        WHERE member_id=:member_id AND generation=:expected RETURNING member_id`, { ...fields, expected: actual });
      if (!rows.length) throw refusal('STORE_MEMBER_CONFLICT', `Member generation changed for ${JSON.stringify(m.memberId)}; the transaction was rolled back.`);
    }
    else await db.query(`INSERT INTO members (${Object.keys(fields).join(',')}) VALUES (${Object.keys(fields).map(key => `:${key}`).join(',')})`, fields);
    extra = { memberId: m.memberId, generation: next };
  } else {
    await memberInTeam(db, mutation.memberId, mutation.teamId);
    const [old] = await db.query('SELECT * FROM role_documents WHERE member_id = :id', { id: mutation.memberId });
    if (mutation.type === 'createRoleDocument') {
      if (old) throw refusal('STORE_ROLE_DOCUMENT_EXISTS', `Role document already exists for member ${JSON.stringify(mutation.memberId)}.`);
      await db.query(`INSERT INTO role_documents (member_id,official_text,advisory_notes,official_generation,notes_generation)
        VALUES (:id,:official,:notes,1,1)`, { id: mutation.memberId, official: mutation.officialText, notes: mutation.advisoryNotes });
      extra = { memberId: mutation.memberId, officialGeneration: 1, notesGeneration: 1 };
    } else {
      if (!old) throw refusal('STORE_REFERENCE_MISSING', `No role document exists for member ${JSON.stringify(mutation.memberId)}.`);
      const official = mutation.type === 'updateOfficialRole';
      const counter = official ? 'official_generation' : 'notes_generation', content = official ? 'official_text' : 'advisory_notes';
      const current = databaseInteger(old[counter], counter, { min: 1 });
      if (current !== mutation.expectedGeneration) throw refusal('STORE_ROLE_CONFLICT', `${counter} for member ${JSON.stringify(mutation.memberId)} changed (expected ${mutation.expectedGeneration}, current ${current}).`);
      const next = nextInteger(current, counter);
      const rows = await db.query(`UPDATE role_documents SET ${content}=:content,${counter}=:next
        WHERE member_id=:id AND ${counter}=:expected RETURNING member_id`, {
        content: official ? mutation.officialText : mutation.advisoryNotes, next, id: mutation.memberId, expected: current,
      });
      if (!rows.length) throw refusal('STORE_ROLE_CONFLICT', `Role document generation changed for member ${JSON.stringify(mutation.memberId)}.`);
      extra = { memberId: mutation.memberId, generation: next };
    }
  }
  const rows = await db.query(`UPDATE teams SET config_version=config_version+1,written_by_client=:client,written_by_version=:version
    WHERE team_id=:id AND config_version=:expected RETURNING config_version`, {
    client: writer.client, version: writer.version, id: mutation.teamId, expected: mutation.expectedConfigVersion,
  });
  if (!rows.length) throw refusal('STORE_CONFIG_CONFLICT', `Configuration changed for team ${JSON.stringify(mutation.teamId)}; the transaction was rolled back.`);
  return { type: mutation.type, teamId: mutation.teamId, configVersion: databaseInteger(rows[0].config_version, 'config_version'), ...extra };
}
