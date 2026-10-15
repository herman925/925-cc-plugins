import { mkdir, realpath, stat } from 'node:fs/promises';
import { join, isAbsolute, relative, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { planTeam, SETTINGS, validatePersistentState } from '../team.mjs';
import { exportTeamTemplate, parseTeamTemplate } from '../templates.mjs';
const FORMAT = 'orca-team-store';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const publicScope = ({ workspaceId, ...scope }) => scope;
const empty = () => ({ format: FORMAT, version: 2, revision: 0, teams: [], settings: { ...SETTINGS } });
const fail = message => { throw new Error(message); };
export async function openTeamStore(options) {
  try { return await openStore(options); }
  catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EROFS', 'EEXIST', 'ELOOP'].includes(error.code)) throw new Error(`Team storage is unavailable (${error.code}). Check access to the verified Orca profile; existing data has not been reset.`);
    throw error;
  }
}
async function openStore({ userData, sqlite = () => import('node:sqlite') } = {}) {
  if (typeof userData !== 'string' || !isAbsolute(userData) || userData.includes('\0')) fail('Verified Orca profile is required for team storage.');
  let DatabaseSync;
  try { ({ DatabaseSync } = await sqlite()); } catch { fail('This worker does not support node:sqlite. Team persistence is unavailable.'); }
  if (typeof DatabaseSync !== 'function') fail('This worker does not support node:sqlite. Team persistence is unavailable.');
  const profile = await realpath(userData);
  const directory = join(profile, 'plugins-data', 'herman925.team-orchestrator');
  const inside = path => { const rel = relative(profile, path); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('Plugin data directory escapes the verified Orca profile.'); };
  // Check each existing ancestor before creating its child.
  for (const target of [join(profile, 'plugins-data'), directory]) {
    try { inside(await realpath(target)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(target, { mode: 0o700 });
      inside(await realpath(target));
    }
  }
  const path = join(directory, 'team-orchestrator.sqlite');
  let exists = false;
  try { await stat(path); exists = true; inside(await realpath(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const db = new DatabaseSync(path);
  try {
    if (exists) {
      if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('Team database is damaged; preserve the file and restore a verified backup.');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      if (version !== 1) fail('Unsupported team database schema. Preserve this database and use a compatible plugin or backup.');
      if (db.prepare('SELECT format FROM metadata').get()?.format !== FORMAT) fail('Unrecognized team database. Original data has been preserved.');
    } else {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE metadata (format TEXT NOT NULL);
        INSERT INTO metadata VALUES ('${FORMAT}');
        CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL);
        CREATE TABLE scopes (team_id TEXT PRIMARY KEY, json TEXT NOT NULL);
        CREATE TABLE team_versions (team_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(team_id,version));
        CREATE TABLE role_versions (member_id TEXT NOT NULL, version INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(member_id,version));
        CREATE TABLE requests (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result TEXT NOT NULL);
        CREATE TABLE receipts (id TEXT PRIMARY KEY, json TEXT NOT NULL);
        PRAGMA user_version=1;
        `);
      db.prepare('INSERT INTO snapshot VALUES (1,?)').run(JSON.stringify(empty()));
      db.exec('COMMIT');
    }
    // A read failure is fatal; never recover by initializing an empty roster.
    const readSnapshot = () => {
      const value = JSON.parse(db.prepare('SELECT json FROM snapshot WHERE id=1').get()?.json ?? 'null');
      if (!value || value.format !== FORMAT || value.version !== 2 || !Number.isInteger(value.revision) || !Array.isArray(value.teams)) fail('Team database snapshot is invalid; original data has been preserved.');
      return validatePersistentState(value);
    };
    readSnapshot();
    const write = value => db.prepare('UPDATE snapshot SET json=? WHERE id=1').run(JSON.stringify(value));
    const mutate = (op, input, action) => {
      if (!input || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isInteger(input.expectedRevision)) fail('Invalid mutation request identity or revision.');
      const digest = fingerprint({ op, input });
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT * FROM requests WHERE id=?').get(input.requestId);
        if (previous) {
          if (previous.fingerprint !== digest) fail('Request identity conflicts with another input.');
          const result = validatePersistentState(JSON.parse(previous.result));
          db.exec('COMMIT'); return result;
        }
        const next = readSnapshot();
        if (next.revision !== input.expectedRevision) fail('Another panel changed the team data. Reload saved teams before trying again; your changes were not saved.');
        action(next);
        next.revision++;
        validatePersistentState(next);
        write(next);
        db.prepare('INSERT INTO requests VALUES (?,?,?)').run(input.requestId, digest, JSON.stringify(next));
        db.exec('COMMIT'); return next;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    };
    const archive = team => {
      db.prepare('INSERT INTO team_versions VALUES (?,?,?)').run(team.id, team.configVersion, JSON.stringify(team));
      for (const member of team.members) db.prepare('INSERT OR IGNORE INTO role_versions VALUES (?,?,?)').run(member.id, member.roleVersion, JSON.stringify({ brief: member.brief, habits: member.habits, collaboration: member.collaboration }));
    };
    let closed = false;
    return {
      readSnapshot,
      replay(op, input) {
        readSnapshot();
        if (typeof input?.requestId !== 'string') fail('Invalid request identity.');
        const previous = db.prepare('SELECT fingerprint,result FROM requests WHERE id=?').get(input.requestId);
        if (!previous) return null;
        if (previous.fingerprint !== fingerprint({ op, input })) fail('Request identity conflicts with another input.');
        return validatePersistentState(JSON.parse(previous.result));
      },
      readScope(teamId) {
        const row = db.prepare('SELECT json FROM scopes WHERE team_id=?').get(teamId);
        if (!row) fail('Saved team scope was not found.');
        const scope = JSON.parse(row.json);
        const saved = readSnapshot().teams.find(team => team.id === teamId)?.scope;
        if (!saved || !scope || ['workspaceKey', 'executionHostId', 'kind'].some(key => saved[key] !== scope[key]) || fingerprint([scope.workspaceId, scope.executionHostId]) !== scope.workspaceKey) fail('Saved project binding is damaged. Original data has been preserved.');
        return scope;
      },
      createTeam(input, scope) {
        return mutate('createTeam', input, next => {
          if (!scope?.workspaceId || !scope.executionHostId || !['git', 'folder'].includes(scope.kind)) fail('Confirm a verified project and execution host before saving.');
          const team = planTeam(input.form);
          const ids = new Map(team.members.map(member => [member.id, randomUUID()]));
          team.id = randomUUID(); team.createdAt = new Date().toISOString(); team.configVersion = 1; team.scope = publicScope(scope);
          team.members = team.members.map(member => ({ ...member, id: ids.get(member.id), boss: member.boss ? ids.get(member.boss) : null, roleVersion: 1, habits: '', collaboration: '' }));
          db.prepare('INSERT INTO scopes VALUES (?,?)').run(team.id, JSON.stringify(scope));
          archive(team); next.teams.push(team);
        });
      },
      updateAgentPreferences(input) {
        return mutate('updateAgentPreferences', input, next => {
          const team = next.teams.find(row => row.id === input.teamId);
          if (!team) fail('Choose a saved team.');
          const member = input.memberId ? team.members.find(row => row.id === input.memberId) : null;
          if (input.memberId ? !member || input.level !== undefined : ![1, 2, 3].includes(input.level) || !team.members.some(row => row.level === input.level)) fail('Choose a member or hierarchy level.');
          const preferences = input.inherit === true && member
            ? { agent: team.configuration.agents[member.level - 1], model: team.configuration.models[member.level - 1], effort: team.configuration.efforts[member.level - 1] }
            : { agent: input.agent, model: input.model, effort: input.effort };
          if (!['codex', 'claude'].includes(preferences.agent) || [preferences.model, preferences.effort].some(value => typeof value !== 'string' || !value.trim() || value.length > 120) || (preferences.model === 'default' && preferences.effort !== 'default')) fail('Choose a valid agent, model and effort; default model inherits its effort.');
          if (member) Object.assign(member, preferences, { preferenceOverride: input.inherit !== true });
          else {
            for (const [key, values] of [['agent', 'agents'], ['model', 'models'], ['effort', 'efforts']]) team.configuration[values][input.level - 1] = preferences[key];
            for (const row of team.members) if (row.level === input.level && !row.preferenceOverride) Object.assign(row, preferences);
          }
          team.configVersion++; archive(team);
        });
      },
      exportTemplate(teamId) {
        const team = readSnapshot().teams.find(row => row.id === teamId);
        if (!team) fail('Saved team was not found.');
        return exportTeamTemplate(team);
      },
      importTemplate(input, scope) {
        return mutate('importTemplate', input, next => {
          if (!scope?.workspaceId || !scope.executionHostId || !['git', 'folder'].includes(scope.kind)) fail('Confirm a verified project and execution host before importing.');
          const template = parseTeamTemplate(input.template);
          const definition = template.team;
          const ids = new Map(definition.members.map(member => [member.ref, randomUUID()]));
          const team = { name: definition.name, purpose: definition.purpose, structure: definition.structure, configuration: definition.configuration, id: randomUUID(), createdAt: new Date().toISOString(), configVersion: 1, scope: publicScope(scope),
            members: definition.members.map(({ ref, boss, ...member }) => ({ ...member, id: ids.get(ref), boss: boss === null ? null : ids.get(boss), state: 'unassigned', roleVersion: 1 })) };
          db.prepare('INSERT INTO scopes VALUES (?,?)').run(team.id, JSON.stringify(scope));
          archive(team); next.teams.push(team);
        });
      },
      beginLaunch(input) {
        return mutate('beginLaunch', input, next => {
          const team = next.teams.find(row => row.id === input.teamId);
          if (!team || !['on-demand', 'all'].includes(input.mode)) fail('Choose a saved team and launch mode.');
          if (team.launch) fail('This launch has already been attempted. Inspect the saved receipts.');
          team.launch = { native: true, status: 'sending', mode: input.mode, workspaceKey: team.scope.workspaceKey, configVersion: team.configVersion, members: {} };
        });
      },
      readReceipt(id) { const row = db.prepare('SELECT json FROM receipts WHERE id=?').get(id); return row ? JSON.parse(row.json) : null; },
      writeReceipt(id, receipt) {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(id, JSON.stringify(receipt));
          const next = readSnapshot();
          const team = next.teams.find(row => row.members.some(member => `launch:${row.id}-${member.id}` === id));
          if (team?.launch) {
            const member = team.members.find(member => `launch:${team.id}-${member.id}` === id);
            team.launch.members[member.id] = receipt.handle
              ? { status: 'created', terminalId: receipt.handle, title: receipt.title, briefAccepted: receipt.briefAccepted === true, executionHostId: receipt.executionHostId ?? null, ...(receipt.warning ? { error: receipt.warning } : {}) }
              : { status: receipt.status === 'starting' ? 'starting' : 'unknown', ...(receipt.error ? { error: receipt.error } : {}) };
            team.launch.status = receipt.status === 'unknown' ? 'unknown' : 'accepted';
            next.revision++; write(next);
          }
          db.exec('COMMIT');
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
      updateSettings(input) {
        return mutate('updateSettings', input, next => {
          if (typeof input.settings?.chart !== 'boolean' || !['stacked', 'columns'].includes(input.settings.layout)) fail('Invalid display settings.');
          next.settings = { chart: input.settings.chart, layout: input.settings.layout };
        });
      },
      updateRole(input) {
        return mutate('updateRole', input, next => {
          const team = next.teams.find(row => row.id === input.teamId);
          const member = team?.members.find(row => row.id === input.memberId);
          if (!member) fail('Member was not found in this team.');
          for (const key of ['brief', 'habits', 'collaboration']) {
            if (typeof input[key] !== 'string' || input[key].length > 1500 || (key === 'brief' && !input[key].trim())) fail('Role text must be valid and under 1500 characters.');
            member[key] = input[key];
          }
          member.roleVersion++; team.configVersion++; archive(team);
        });
      },
      readTeamVersion(teamId, version) {
        const row = db.prepare('SELECT json FROM team_versions WHERE team_id=? AND version=?').get(teamId, version);
        if (!row) fail('Configuration version was not found.'); return JSON.parse(row.json);
      },
      readRoleVersion(memberId, version) {
        const row = db.prepare('SELECT json FROM role_versions WHERE member_id=? AND version=?').get(memberId, version);
        if (!row) fail('Role version was not found.'); return JSON.parse(row.json);
      },
      close() { if (!closed) { db.close(); closed = true; } }
    };
  } catch (error) { db.close(); throw new Error(`Cannot open team storage: ${error.message}`); }
}
