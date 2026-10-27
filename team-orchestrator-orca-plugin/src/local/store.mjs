import {runtimeReconnectStore} from './runtime-reconnect-store.mjs';
import {nativeHistoryReader} from './native-history-store.mjs';
import {latestBusinessAttempts,questionNeedsProcessing} from './acceptance.mjs';
import {historyCleanup} from './history-cleanup.mjs';
import {STORAGE_SCHEMA,MAINTENANCE_DDL,prepareStorage,migrateStorage,recoveryInventory} from './storage-maintenance.mjs';
import { organizationStore } from './organization-store.mjs';
import { staffingStore } from './staffing-store.mjs';

import { wakeStore, publicWake } from './wake-store.mjs';
import { stopStore } from './stop-store.mjs';
import { lifecycleStore } from './lifecycle-store.mjs';
import { questionStore } from './questions-store.mjs';
import { declaredWriteScope, scopeBlocker } from '../scheduling.mjs';
import { initialMembers } from '../launch.mjs';
import { validateDispatch, validateDispatchProtocol, publicDispatch, publicDispatchProtocol, DISPATCH_OBSERVATION_CHANGED } from '../dispatch.mjs';
import { mkdir, realpath, stat, open } from 'node:fs/promises';
import { join, isAbsolute, relative, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { planTeam, SETTINGS, validatePersistentState } from '../team.mjs';
import { workInput, validateWork, publicWork } from '../work.mjs';
const FORMAT = 'orca-team-store';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const fingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const publicScope = ({ workspaceId, ...scope }) => scope;
const empty = () => ({ format: FORMAT, version: 2, revision: 0, teams: [], settings: { ...SETTINGS } });
const fail = message => { throw new Error(message); };
export async function openTeamStore(options = {}) {
  const where = options.projectRoot === undefined ? 'the verified Orca profile' : 'the verified project folder';
  try { return await openStore(options); }
  catch (error) {
    if (['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'EROFS', 'EEXIST', 'ELOOP', 'ENOSPC', 'EMFILE', 'ENFILE', 'EIO'].includes(error.code)) throw new Error(`Team storage is unavailable (${error.code}). Check access to ${where}; existing data has not been reset.`);
    throw error;
  }
}
async function openStore({ userData, projectRoot, sqlite = () => import('node:sqlite') } = {}) {
  if (typeof userData !== 'string' || !isAbsolute(userData) || userData.includes('\0')) fail('Verified Orca profile is required for team storage.');
  let DatabaseSync, backup;
  try { ({ DatabaseSync, backup } = await sqlite()); } catch { fail('This worker does not support node:sqlite. Team persistence is unavailable.'); }
  if (typeof DatabaseSync !== 'function') fail('This worker does not support node:sqlite. Team persistence is unavailable.');
  const profile = await realpath(userData);
  // A project-owned store lives with its project. Without projectRoot the store stays in the profile, which is the
  // shape phase 1 leaves for a project this machine cannot open.
  if (projectRoot !== undefined && (typeof projectRoot !== 'string' || !isAbsolute(projectRoot) || projectRoot.includes('\0'))) fail('A verified project folder is required for a project-owned team store.');
  const scopeRoot = projectRoot === undefined ? profile : await realpath(projectRoot);
  // The store and the profile are separate homes: neither may sit inside the other, or the two stores interleave.
  if (projectRoot !== undefined) {
    const within = (a, b) => { const rel = relative(a, b); return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel)); };
    if (within(profile, scopeRoot) || within(scopeRoot, profile)) fail('A project store and the Orca profile must be separate folders.');
  }
  const parent = projectRoot === undefined ? join(profile, 'plugins-data') : join(scopeRoot, '.orca');
  const directory = projectRoot === undefined ? join(parent, 'herman925.team-orchestrator') : join(parent, 'team-orchestrator');
  const inside = path => { const rel = relative(scopeRoot, path); if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('Team store directory escapes its verified root.'); };
  // Check each existing ancestor before creating its child.
  for (const target of [parent, directory]) {
    try { inside(await realpath(target)); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await mkdir(target, { mode: 0o700 });
      inside(await realpath(target));
    }
  }
  // The project store uses the name the design and the guard wrapper both expect; the profile store keeps its name.
  const path = join(directory, projectRoot === undefined ? 'team-orchestrator.sqlite' : 'team.sqlite');
  let exists = false;
  try { await stat(path); exists = true; inside(await realpath(path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let prepared;
  if(exists)try{prepared=await prepareStorage({path,directory,DatabaseSync,backup});}catch(error){const backups=await recoveryInventory(directory,DatabaseSync);const reason=error instanceof SyntaxError?'Saved JSON evidence is damaged':/^(EACCES|EPERM|EROFS|ENOSPC|EIO|EMFILE|ENFILE)$/.test(error.code??'')?`Storage filesystem failure (${error.code})`:error.message;throw Error(`Cannot open team storage: ${reason}. Existing data has not been reset. Recovery: preserve the database and WAL/SHM/journal sidecars; stop the plugin before making a recovery copy. Verified migration backups: ${backups.filter(b=>b.status==='verified-backup').length}. Do not restore an older backup automatically: later native effects require manual reconciliation.`);}
  if(!exists){const fresh=await open(path,'wx',0o600);await fresh.close();}
  const db = new DatabaseSync(path);
  // Measured default here is journal_mode=delete with no busy timeout; one writer today, but the wrapper and the panel
  // both touch this folder, so wait rather than fail fast when they meet.
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    if (exists) {
      migrateStorage(db,prepared);
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
        ${MAINTENANCE_DDL};
        PRAGMA user_version=${STORAGE_SCHEMA};
        `);
      db.prepare('INSERT INTO snapshot VALUES (1,?)').run(JSON.stringify(empty()));
      db.exec('COMMIT');
    }
    let runtimeReconnect;
    const readWork = id => { const row = db.prepare('SELECT json FROM receipts WHERE id=?').get(`work:${id}`) ?? db.prepare('SELECT json FROM receipts WHERE id=?').get(`native-run-binding:${id}`); return row ? validateWork(JSON.parse(row.json)) : null; };
    const readCurrentWork = id => {
      const raw=readWork(id),work=raw?.currentSupervisor?{...raw,...raw.currentSupervisor,nativeSend:raw.currentSupervisor.nativeSend,error:raw.currentSupervisor.error,originalBinding:raw.binding}:raw;
      if(work?.parent){const parent=readWork(work.parent.workId),epoch=parent?.currentSupervisor,attempt=readPrivate(`dispatch:${work.parent.attemptId}`);if(epoch&&attempt?.reviewAuthority?.recoveryRequestId===epoch.recoveryRequestId&&attempt.reviewAuthority.generation===epoch.run.consumerGeneration)work.parentAuthority={generation:epoch.run.consumerGeneration,recoveryRequestId:epoch.recoveryRequestId};}
      if(work)delete work.runtimeControl;
      const control=work&&runtimeReconnect?.readRuntimeControl(work);if(control)work.runtimeControl=control;
      return work;
    };
    const listCurrentWorks = () => listWorks().map(work=>readCurrentWork(work.id));
    const listWorks = () => db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%'").all().map(row=>validateWork(JSON.parse(row.json)));
    const persistWork = work => {const {parentAuthority,runtimeControl,...saved}=work;return db.prepare('INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(`${work.parent?'native-run-binding':'work'}:${work.id}`, JSON.stringify(saved));};
    const persistCurrentWork = work => {
      const raw=readWork(work.id);if(!raw?.currentSupervisor)return persistWork(work);
      for(const key of ['status','input','processing','run','snapshot','error','instance','nativeSend'])raw.currentSupervisor[key]=work[key];
      raw.version=work.version;for(const key of ['closedAt','handoff'])if(work[key]!==undefined)raw[key]=work[key];if(work.status==='completed')raw.status='completed';persistWork(raw);
    };
    const readPrivate = key => { const row=db.prepare('SELECT json FROM receipts WHERE id=?').get(key); return row?JSON.parse(row.json):null; };
    const putPrivate = (key,value) => db.prepare('INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(key,JSON.stringify(value));
    const readDispatchProtocol = workId => { const row=readPrivate(`dispatch-protocol:${workId}`); return row?validateDispatchProtocol(row):null; };
    const listDispatches = workId => db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch:%' ORDER BY rowid").all().map(row=>validateDispatch(JSON.parse(row.json))).filter(row=>!workId||row.workId===workId);
    const listRunWorks = id => { const root=readCurrentWork(id);if(!root)return [];const teamWorkId=root.teamWorkId??root.id;return [readCurrentWork(teamWorkId),...db.prepare("SELECT json FROM receipts WHERE id LIKE 'native-run-binding:%' ORDER BY rowid").all().map(r=>readCurrentWork(JSON.parse(r.json).id)).filter(w=>w.teamWorkId===teamWorkId)]; };
    const listTeamDispatches = id => {const ids=new Set(listRunWorks(id).map(w=>w.id));return listDispatches().filter(a=>ids.has(a.workId));};
    const queuedTasks = workId => db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch-queue:%' ORDER BY rowid").all().map(row=>JSON.parse(row.json)).filter(row=>row.workId===workId);
    const withdrawnIntents = workId => db.prepare("SELECT json FROM receipts WHERE id LIKE 'intent-withdrawal:%'").all().map(row=>JSON.parse(row.json)).filter(row=>row.workId===workId);
    const dispatchProjection = workId => ({withdrawnIntents:listRunWorks(workId).flatMap(w=>withdrawnIntents(w.id).map(({originalSpec,replacementSpec,result,createProof,replacementProof,updateProof,...row})=>row)),queuedTasks:listRunWorks(workId).flatMap(w=>queuedTasks(w.id)),dispatchProtocol:publicDispatchProtocol(readDispatchProtocol(workId),readCurrentWork(workId)?.status==='completed'),tasks:listTeamDispatches(workId).map(publicDispatch),nativeRuns:listRunWorks(workId).map(w=>({id:w.id,teamWorkId:w.teamWorkId??w.id,supervisorMemberId:w.supervisorMemberId,run:w.run,parent:w.parent,input:{state:w.input.state},error:w.error,questions:questions.listQuestions(w.id).map(q=>({id:q.id,summary:q.summary,status:q.status,to:q.to,relay:q.relay})),dispatchProtocol:publicDispatchProtocol(readDispatchProtocol(w.id),w.status==='completed')}))});
    const atomicDispatch = action => { db.exec('BEGIN IMMEDIATE'); try { const value=action(); db.exec('COMMIT'); return value; } catch(error) { db.exec('ROLLBACK'); throw error; } };
    const stops = stopStore({db,readPrivate,putPrivate,atomic:atomicDispatch});
    const listGoals = teamId => db.prepare("SELECT json FROM receipts WHERE id LIKE 'goal:%' ORDER BY rowid").all().map(row=>JSON.parse(row.json)).filter(row=>!teamId||row.teamId===teamId);
    const questions = questionStore({db,readPrivate,putPrivate,readWork:readCurrentWork,listDispatches,effectiveTeamForWork:id=>staffing.effectiveTeamForWork(id),atomic:atomicDispatch});
    // A read failure is fatal; never recover by initializing an empty roster.
    const readSnapshot = () => {
      const value = JSON.parse(db.prepare('SELECT json FROM snapshot WHERE id=1').get()?.json ?? 'null');
      if (!value || value.format !== FORMAT || value.version !== 2 || !Number.isInteger(value.revision) || !Array.isArray(value.teams)) fail('Team database snapshot is invalid; original data has been preserved.');
      return { ...validatePersistentState(value), stops:stops.stopProjection(), goals: listGoals(), organizationChanges:organization.organizationProjection(), recoveries:db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().map(r=>publicWake(JSON.parse(r.json))), works: listCurrentWorks().map(work=>({...publicWork(work),...dispatchProjection(work.id),...questions.questionProjection(work.id),...lifecycle.deliveryProjection(work.id),...staffing.staffingProjection(work.id)})) };
    };
    const write = ({ works, goals, recoveries, organizationChanges, stops:ignoredStops, ...value }) => db.prepare('UPDATE snapshot SET json=? WHERE id=1').run(JSON.stringify(value));
    const lifecycle=lifecycleStore({db,readPrivate,putPrivate,readWork:readCurrentWork,persistWork:persistCurrentWork,listDispatches:listTeamDispatches,listRunWorks,listGoals,questions,staffing:()=>staffing,atomic:atomicDispatch,readSnapshot,write,applyOrganization:(work,team)=>organization.applyOrganization(work,team)});


    const mutate = (op, input, action) => {
      if (!input || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isInteger(input.expectedRevision)) fail('Invalid mutation request identity or revision.');
      const digest = fingerprint({ op, input });
      db.exec('BEGIN IMMEDIATE');
      try {
        const previous = db.prepare('SELECT * FROM requests WHERE id=?').get(input.requestId);
        if (previous) {
          if (previous.fingerprint !== digest) fail('Request identity conflicts with another input.');
          const saved=JSON.parse(previous.result);const result = saved.format==='history-pruned-replay-v1'?readSnapshot():validatePersistentState(saved);
          db.exec('COMMIT'); return result;
        }
        const next = readSnapshot();
        if (next.revision !== input.expectedRevision) fail('Another panel changed the team data. Reload saved teams before trying again; your changes were not saved.');
        if(op!=='setAdmission'&&input.teamId&&readPrivate(`next-goal:${input.teamId}`))fail('A queued-goal transition is reserved; finish it before changing team configuration.');
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
    const organization=organizationStore({db,readPrivate,putPrivate,atomic:atomicDispatch,readSnapshot,write,readWork:readCurrentWork,archive,validate:team=>validatePersistentState({...readSnapshot(),teams:[team]})});
    const readOperation = id => { const row = db.prepare('SELECT json FROM receipts WHERE id=?').get(`operation:${id}`); return row ? JSON.parse(row.json) : null; };
    const persistOperation = (operation, observationOnly=false) => {
      db.prepare('INSERT INTO receipts VALUES (?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json').run(`operation:${operation.requestId}`, JSON.stringify(operation));
      const next = readSnapshot(), team = next.teams.find(row => row.id === operation.teamId);
      const pointer=readPrivate(`binding:${operation.memberId}`);
      if(!team?.members.some(member=>member.id===operation.memberId)||pointer?.requestId!==operation.requestId||(pointer.instanceGeneration??1)!==(operation.instanceGeneration??1))return;
      team.launch ??= { native: true, status: 'sending', mode: team.configuration.launchMode ?? 'on-demand', workspaceKey: team.scope.workspaceKey, configVersion: operation.configVersion, members: {} };
      team.launch.members[operation.memberId] = { ...operation.public, status: operation.status, requestId: operation.requestId, ...(operation.handle ? { terminalId: operation.handle, title: operation.title, briefAccepted: operation.briefAccepted === true, executionHostId: operation.executionHostId } : {}), ...(operation.error ? { error: operation.error } : {}) };
      team.launch.status = initialMembers(team).every(member => team.launch.members[member.id]?.status === 'created') ? 'accepted' : 'unknown';
      if(!observationOnly)next.revision++; validatePersistentState(next); write(next);
    };
    const assertReplacementIdle=memberId=>{
      const memberTeam=readSnapshot().teams.find(t=>t.members.some(m=>m.id===memberId)),affected=new Set([memberId]);
      for(let changed=true;changed;){changed=false;for(const m of memberTeam?.members??[])if(affected.has(m.boss)&&!affected.has(m.id)){affected.add(m.id);changed=true;}}
      if(stops.listStops().some(r=>affected.has(r.target.memberId)&&['intent','submitted','unknown'].includes(r.state)))fail('Unresolved Stop blocks idle replacement.');
      if(db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().some(r=>{const w=JSON.parse(r.json);return affected.has(w.memberId)&&w.memberId!==memberId&&!['bound','resumed'].includes(w.state);}))fail('Descendant recovery blocks idle replacement.');
      for(const a of listDispatches().filter(a=>affected.has(a.memberId)))if(!['accepted','rework'].includes(a.status)||!a.evidenceId)fail('Member has running, unknown or unreviewed execution.');
      for(const saved of db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch-queue:%'").all()){const q=JSON.parse(saved.json);if(affected.has(q.memberId)||affected.has(q.supervisorMemberId))fail('Queued execution blocks idle replacement.');}
      const roots=listCurrentWorks().filter(w=>w.teamId===memberTeam?.id&&w.status!=='completed').flatMap(w=>listRunWorks(w.id));
      for(const w of roots){if(affected.has(w.supervisorMemberId)&&['sending','unknown','queued'].includes(w.input.state))fail('Supervisor input remains pending or unknown.');for(const q of questions.listQuestions(w.id))if(questionNeedsProcessing(q))fail('Unresolved question blocks idle replacement.');}
    };
    const replacementTeam=teamId=>{const work=listCurrentWorks().find(w=>w.teamId===teamId&&w.status!=='completed');return work?staffing.effectiveTeamForWork(work.id):readSnapshot().teams.find(t=>t.id===teamId);};
    const staffing=staffingStore({db,readPrivate,putPrivate,readWork:readCurrentWork,listRunWorks,readSnapshot,write,archive,atomic:atomicDispatch});
    runtimeReconnect=runtimeReconnectStore({db,readPrivate,putPrivate,readWork,persistWork,readSnapshot,readOperation,readDispatchProtocol,atomic:atomicDispatch});
    readSnapshot();
    staffing.reconcileExpiredStaffingProposals();

    let closed = false;
    return {
      ...historyCleanup({db,readSnapshot,write,atomic:atomicDispatch}),
      ...runtimeReconnect,
      storageInfo:()=>({schema:STORAGE_SCHEMA,backupId:prepared?.backupId??null}),
      ...staffing,
      ...questions,
      ...organization,
      assertReplacementIdle,
      reserveIdleReplacement(input,operation,proof){return mutate('reserveIdleReplacement',input,next=>{
        const team=next.teams.find(t=>t.id===input.teamId),member=team?.members.find(m=>m.id===input.memberId),current=operation.sourceAttemptId?readPrivate(`dispatch:${operation.sourceAttemptId}`):readOperation(operation.requestId);
        if(!member||current?.version!==operation.version)fail('Current member execution changed; reload.');
        const pointer=readPrivate(operation.sourceAttemptId?`dispatch-member:${member.id}`:`binding:${member.id}`);
        if((pointer?.requestId??pointer?.id)!==operation.requestId||readPrivate(`wake-member:${member.id}`))fail('Current member replacement reservation changed.');
        assertReplacementIdle(member.id);
        if(!['codex','claude'].includes(input.agent)||[input.model,input.effort].some(v=>typeof v!=='string'||!v.trim()||v.length>120)||(input.model==='default'&&input.effort!=='default'))fail('Choose valid requested agent/model/effort preferences.');
        team.admission??={paused:false,members:{}};team.admission.members[member.id]=true;
        Object.assign(member,{agent:input.agent,model:input.model,effort:input.effort,preferenceOverride:true});team.configVersion++;archive(team);
        for(const work of listCurrentWorks().filter(w=>w.teamId===team.id&&w.status!=='completed'))staffing.recordConfigurationAmendment(work.id,team,{requestId:input.requestId,kind:'idle-replacement',memberIds:[member.id]});
        const row={requestId:input.requestId,teamId:team.id,memberId:member.id,bindingRequestId:operation.requestId,mode:'idle-replacement',oldBinding:operation,proof,state:'approved',version:1,createdAt:new Date().toISOString(),handoff:{reviewer:'user',decision:'replace',summary:input.summary,evidenceRefs:input.evidenceRefs,oldRequestId:operation.requestId},detail:'Confirmed idle application recipient retirement. The old native conversation may remain open for inspection; no process death is claimed.'};
        putPrivate(`wake:${row.requestId}`,row);putPrivate(`wake-member:${member.id}`,{requestId:row.requestId});
      });},
      ...wakeStore({db,readPrivate,putPrivate,atomic:atomicDispatch,readOperation,persistOperation,readWork,persistWork,readCurrentWork,replacementTeam,assertReplacementIdle}),
      ...stops,
      ...lifecycle,
      readOperation,
      readMemberDispatch(memberId) {const pointer=readPrivate(`dispatch-member:${memberId}`);return pointer?listDispatches(pointer.workId).find(a=>a.id===pointer.id):null;},
      recordDispatchName(id,version,naming) { return atomicDispatch(()=>{
        const row=validateDispatch(readPrivate(`dispatch:${id}`));
        // An approved replacement installs binding:<member> while retaining the
        // old Dispatch pointer as history. Non-reuse on-demand naming owns no
        // prepared pointer; any current one supersedes its old terminal.
        if(row.version!==version||readCurrentWork(row.workId)?.status==='completed'||readPrivate(`dispatch-member:${row.memberId}`)?.id!==id||readPrivate(`binding:${row.memberId}`))fail('Member changed before sidebar naming.');
        if(row.binding?.kind!=='terminal'||row.admission!=='committed'||row.reuse||typeof naming.title!=='string'||!naming.title||!['attempted','confirmed','unconfirmed'].includes(naming.outcome)||typeof naming.at!=='string')fail('Verified terminal naming is required.');
        if(!row.sidebarNaming&&naming.outcome!=='attempted')fail('Sidebar naming intent must precede its receipt.');
        if(row.sidebarNaming&&row.sidebarNaming.outcome!=='attempted')return row;
        if(row.sidebarNaming&&naming.title!==row.sidebarNaming.title)fail('Saved sidebar name cannot change.');
        row.sidebarNaming=naming;row.version++;putPrivate(`dispatch:${id}`,row);return row;
      }); },
      readMemberOperation(memberId) { const pointer=readPrivate(`binding:${memberId}`); return pointer?readOperation(pointer.requestId):null; },
      listOperations:()=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'operation:%'").all().map(row=>JSON.parse(row.json)),
      isActiveOperation(operation){const pointer=readPrivate(`binding:${operation.memberId}`);return pointer?.requestId===operation.requestId&&(pointer.instanceGeneration??1)===(operation.instanceGeneration??1)&&readSnapshot().teams.some(team=>team.id===operation.teamId&&team.members.some(member=>member.id===operation.memberId));},
      // Retires only the app recipient pointer. Callers must separately establish lifecycle authorization.
      retireBinding({memberId,requestId,instanceGeneration}){return atomicDispatch(()=>{
        const pointer=readPrivate(`binding:${memberId}`);
        if(pointer?.requestId!==requestId||(pointer.instanceGeneration??1)!==instanceGeneration)return false;
        db.prepare('DELETE FROM receipts WHERE id=?').run(`binding:${memberId}`);
        putPrivate(`binding-generation:${memberId}`,{generation:instanceGeneration});
        const next=readSnapshot(),team=next.teams.find(row=>row.members.some(member=>member.id===memberId));
        if(team?.launch?.members?.[memberId]?.requestId===requestId){delete team.launch.members[memberId];next.revision++;write(next);}
        return true;
      });},
      setAdmission(input) { return mutate('setAdmission',input,next=>{
        const team=next.teams.find(row=>row.id===input.teamId);
        if(!team||typeof input.paused!=='boolean'||input.memberId&&!team.members.some(row=>row.id===input.memberId))fail('Choose a saved team or member.');
        team.admission??={paused:false,members:{}};
        if(input.memberId)team.admission.members[input.memberId]=input.paused;else team.admission.paused=input.paused;
      }); },
      assertAdmission(teamId,memberId) { const team=readSnapshot().teams.find(row=>row.id===teamId);if(!team)fail('Saved team is unavailable.');if(db.prepare("SELECT json FROM receipts WHERE id LIKE 'wake:%'").all().some(r=>{const wake=JSON.parse(r.json);if(wake.mode!=='idle-replacement'||wake.teamId!==teamId||['bound','resumed'].includes(wake.state))return false;let member=team.members.find(m=>m.id===memberId);while(member){if(member.id===wake.memberId)return true;member=team.members.find(m=>m.id===member.boss);}return false;}))fail('Member replacement handoff is reserved; new assignments are paused.');if(team.admission?.paused||team.admission?.members?.[memberId])fail('New assignments are paused. Existing executions remain unchanged.');if(stops.listStops().some(row=>row.target.teamId===teamId&&row.target.memberId===memberId&&['intent','submitted','unknown'].includes(row.state)))fail('Stop outcome is unresolved; reconcile this member before a new assignment.'); },
      listGoals,
      enqueueGoal(input){workInput(input);return atomicDispatch(()=>{
        const key=`goal-request:${input.requestId}`,digest=fingerprint(input),prior=readPrivate(key);
        if(prior){if(prior.fingerprint!==digest)fail('Queued goal request identity conflicts.');return readPrivate(`goal:${prior.id}`);}
        const state=readSnapshot(),team=state.teams.find(row=>row.id===input.teamId);
        if(!team||state.revision!==input.expectedRevision)fail('Team changed; reload before queueing a goal.');
        const goal={id:randomUUID(),teamId:team.id,objective:input.objective,status:'queued',createdAt:new Date().toISOString()};
        putPrivate(`goal:${goal.id}`,goal);putPrivate(key,{id:goal.id,fingerprint:digest});state.revision++;write(state);return goal;
      });},
      readCurrentWork, listCurrentWorks,
      recordIntentWithdrawals(workId,rows){return atomicDispatch(()=>{for(const row of rows){if(row.workId!==workId)fail('Withdrawal belongs to another work.');const key=`intent-withdrawal:${workId}:${row.nativeTaskId}`,prior=readPrivate(key);if(prior){if(fingerprint(prior)!==fingerprint(row))fail('Recorded withdrawal changed.');continue;}putPrivate(key,row);}});},
      readWork, listWorks, readDispatchProtocol, listDispatches, listRunWorks, listTeamDispatches, dispatchProjection,
      readNativeHistory:nativeHistoryReader({db,readPrivate,readWork:readCurrentWork,questions}),
      readOwningWork(workId,memberId){const root=readCurrentWork(workId),team=this.effectiveTeamForWork?.(root.id)??JSON.parse(db.prepare('SELECT json FROM team_versions WHERE team_id=? AND version=?').get(root.teamId,root.configVersion).json),member=team.members.find(m=>m.id===memberId);return listRunWorks(workId).filter(w=>w.supervisorMemberId===member?.boss).at(-1)??null;},
      prepareManagerRun(parentWorkId,attemptId){return atomicDispatch(()=>{
        const parentWork=readCurrentWork(parentWorkId),attempt=listDispatches(parentWorkId).find(a=>a.id===attemptId);
        const prior=listRunWorks(parentWorkId).find(w=>w.parent?.attemptId===attemptId);if(prior)return prior;
        const root=readCurrentWork(parentWork.teamWorkId??parentWork.id);
        const team=this.effectiveTeamForWork?.(root.id)??JSON.parse(db.prepare('SELECT json FROM team_versions WHERE team_id=? AND version=?').get(root.teamId,root.configVersion).json),member=team.members.find(m=>m.id===attempt?.memberId);
        if(root.status==='completed'||parentWork.run.state!=='verified'||attempt?.status!=='running'||attempt.admission!=='committed'||!attempt.dispatchId||!attempt.binding||attempt.supervisorMemberId!==parentWork.supervisorMemberId||!team.members.some(m=>m.boss===member?.id)||listDispatches(parentWorkId).filter(a=>a.taskKey===attempt.taskKey).at(-1)?.id!==attempt.id)fail('A current genuine manager parent assignment is required.');
        const id=randomUUID(),protocolToken=randomUUID(),b=attempt.binding;
        const binding={status:'created',requestId:attempt.id,sourceAttemptId:attempt.id,memberId:member.id,teamId:root.teamId,kind:b.kind,handle:b.handle,...(b.sessionId?{sessionId:b.liveSessionId??b.sessionId}:{}),paneKey:b.paneKey,runtimeId:b.runtimeId,scope:root.scope,nativeRequest:{agent:member.agent,sessionOptions:{model:member.model,effort:member.effort}}};
        const work={format:'team-work-v1',id,teamWorkId:root.id,teamId:root.teamId,requestId:attempt.id,objective:attempt.instruction,configVersion:team.configVersion,roleVersion:attempt.roleVersion,supervisorMemberId:member.id,scope:root.scope,binding,protocolToken,nativeObjective:`TeamWork ${id} ${protocolToken}\n${attempt.instruction}`,createdAt:new Date().toISOString(),version:1,status:'preparing',input:{state:'not_sent'},processing:{state:'unknown'},run:{state:'unverified'},parent:{workId:parentWork.id,runId:attempt.runId,taskId:attempt.nativeTaskId,dispatchId:attempt.dispatchId,attemptId:attempt.id,generation:attempt.generation}};
        validateWork(work);persistWork(work);return work;
      });},
      ensureDispatchProtocol(workId) { return atomicDispatch(()=>{
        const work=readCurrentWork(workId); if(work?.status==='completed'||work?.run.state!=='verified'||!work.instance)fail('Verify the real supervisor Run before enabling dispatch.');
        const prior=readDispatchProtocol(workId); if(prior) { if(prior.generation!==work.run.consumerGeneration)fail('Dispatch protocol belongs to an older Run generation.'); return prior; }
        const protocol={format:'team-dispatch-protocol-v1',workId,generation:work.run.consumerGeneration,token:randomUUID(),state:'not_sent',version:1,createdAt:new Date().toISOString()}; putPrivate(`dispatch-protocol:${workId}`,protocol);return protocol;
      }); },
      updateDispatchProtocol(workId,version,patch) { return atomicDispatch(()=>{
        if(readWork(workId)?.status==='completed')fail('Completed TeamWork is sealed.');
        const row=readDispatchProtocol(workId);if(!row||row.version!==version)fail('Dispatch protocol changed while observing evidence.');
        if(Object.keys(patch).some(key=>!['state','detail','nativeSend'].includes(key)))fail('Immutable dispatch protocol cannot change.');
        Object.assign(row,patch,{version:version+1});validateDispatchProtocol(row);putPrivate(`dispatch-protocol:${workId}`,row);return row;
      }); },
      queueDispatch(workId,intent,detail) { return atomicDispatch(()=>{
        if(listDispatches(workId).some(row=>row.nativeTaskId===intent.nativeTaskId))return;
        putPrivate(`dispatch-queue:${workId}:${intent.nativeTaskId}`,{workId,nativeTaskId:intent.nativeTaskId,taskKey:intent.spec.taskKey,memberId:intent.member.id,memberName:intent.member.name,supervisorMemberId:readWork(workId).supervisorMemberId,configVersion:intent.spec.configVersion,roleVersion:intent.spec.roleVersion,status:'queued',instruction:intent.spec.instruction,dependencies:intent.spec.dependencies??[],writeScope:intent.spec.writeScope,detail:String(detail).slice(0,1200)});
      }); },
      prepareDispatch(workId,intent,startParams,reuse) { return atomicDispatch(()=>{
        const work=readCurrentWork(workId),protocol=readDispatchProtocol(workId);
        if(work?.status==='completed'||work?.run.state!=='verified'||protocol?.state!=='accepted'||protocol.generation!==work.run.consumerGeneration||intent.spec.token!==protocol.token)fail('Current supervisor admission authority is required.');
        if(work.parent){const parent=readWork(work.parent.workId),a=listDispatches(parent.id).find(a=>a.id===work.parent.attemptId);if(readWork(work.teamWorkId)?.status==='completed'||a?.status!=='running'||a.evidenceId||a.dispatchId!==work.parent.dispatchId||listDispatches(parent.id).filter(r=>r.taskKey===a.taskKey).at(-1)?.id!==a.id)fail('Parent attempt is stale or settled; child admission is fenced.');}
        const key=`dispatch-intent:${workId}:${intent.spec.taskKey}${intent.spec.previousAttemptId?`:${intent.spec.previousAttemptId}`:''}`,digest=fingerprint({spec:intent.spec,nativeTaskId:intent.nativeTaskId});
        const prior=readPrivate(key);if(prior){if(prior.fingerprint!==digest)fail('Task intent identity conflicts with another input.');return {attempt:validateDispatch(readPrivate(`dispatch:${prior.id}`)),fresh:false};}
        this.assertAdmission(work.teamId,intent.spec.memberId);
        questions.questionTaskGate(workId,intent.spec.taskKey,intent.nativeTaskId);
        const team=staffing.effectiveTeamForWork(workId),member=team?.members.find(row=>row.id===intent.spec.memberId);
        if(!member||member.boss!==work.supervisorMemberId||member.roleVersion!==intent.spec.roleVersion||intent.spec.configVersion!==team.configVersion)fail('Only the true direct supervisor can admit this frozen member role.');
        const history=listDispatches(workId),previous=history.filter(row=>row.taskKey===intent.spec.taskKey).at(-1);
        const recovery=reuse?.recoveryRequestId&&readPrivate(`wake:${reuse.recoveryRequestId}`),recoveredPrior=recovery&&recovery.handoff?.decision==='replace'&&recovery.handoff.reviewer===work.supervisorMemberId&&(recovery.oldBinding.sourceAttemptId===previous?.id||previous?.reuse?.requestId===recovery.oldBinding.requestId)&&recovery.newInstance?.requestId===reuse.requestId;
        if(previous&&(!intent.spec.previousAttemptId||intent.spec.previousAttemptId!==previous.id||(previous.status!=='rework'&&!recoveredPrior)||previous.memberId!==member.id))fail('A new attempt requires the current direct supervisor rework decision.');
        if(!previous&&intent.spec.previousAttemptId)fail('Rework attempt does not exist in this TeamWork.');
        const stopAttempts=new Set(stops.listStops().filter(row=>['intent','submitted','unknown'].includes(row.state)).map(row=>row.target.attemptId));
        const writeScope=declaredWriteScope(intent.spec.writeScope),conflict=scopeBlocker(listTeamDispatches(work.teamWorkId??work.id).filter(a=>a.id!==work.parent?.attemptId).map(a=>({...a,originalTaskKey:a.taskKey,...(stopAttempts.has(a.id)?{status:'unknown'}:{}),taskKey:`${a.workId}:${a.taskKey}`})),`${workId}:${intent.spec.taskKey}`,writeScope);
        if(conflict&&!intent.unadmitted)fail(`Write scope conflicts with ${conflict.originalTaskKey??conflict.taskKey}; wait for direct supervisor acceptance or resolve its unknown result.`);
        if(previous&&JSON.stringify(writeScope)!==JSON.stringify(previous.writeScope??[]))fail('Rework must preserve the declared write scope.');
        const dependencies=intent.spec.dependencies??[];
        if(previous&&JSON.stringify(dependencies)!==JSON.stringify(previous.dependencies??[]))fail('Rework must preserve business task dependencies.');
        if(dependencies.some(key=>history.filter(row=>row.taskKey===key).at(-1)?.status!=='accepted'))fail('Application dependencies await direct supervisor acceptance.');
        const reservation=readPrivate(`dispatch-member:${member.id}`),retained=reservation&&history.find(row=>row.id===reservation.id);
        const preparedPointer=readPrivate(`binding:${member.id}`),prepared=preparedPointer&&readOperation(preparedPointer.requestId);
        if(preparedPointer&&(!reuse||reuse.kind==='prepared'&&(reuse.requestId!==preparedPointer.requestId||(reuse.instanceGeneration??1)!==(preparedPointer.instanceGeneration??1)||prepared?.status!=='created'||prepared.memberId!==member.id||prepared.teamId!==work.teamId||prepared.scope?.workspaceKey!==work.scope.workspaceKey)))fail('This member already has an active launch binding; verify it before reuse.');
        const recoveredMember=recovery&&recovery.newInstance?.requestId===prepared?.requestId&&(recovery.oldBinding.sourceAttemptId===retained?.id||retained?.reuse?.requestId===recovery.oldBinding.requestId)&&(['accepted','rework'].includes(retained?.status)||recovery.handoff?.decision==='replace'&&recovery.handoff.reviewer===work.supervisorMemberId);
        if(reuse?.kind==='prepared'&&(!prepared||reservation&&!recoveredMember||startParams.terminal!==reuse.terminal))fail('Prepared member reservation changed.');
        if(reservation&&!recoveredMember&&(!reuse||retained?.id!==reuse.attemptId||!['accepted','rework'].includes(retained.status)||JSON.stringify(retained.binding)!==JSON.stringify(reuse.binding)||startParams.terminal!==reuse.terminal))fail('This member already has a reserved or active binding. Reconcile it before another dispatch.');
        if(reuse&&reuse.kind!=='prepared'&&!reservation)fail('Retained member reservation changed.');
        const instanceGeneration=reuse?.instanceGeneration??retained?.instanceGeneration??(readPrivate(`binding-generation:${member.id}`)?.generation??0)+1;
        const id=randomUUID(),attempt={format:'team-dispatch-v1',id,attemptId:id,instanceGeneration,workId,teamWorkId:work.teamWorkId??work.id,runId:work.run.id,teamId:work.teamId,supervisorMemberId:work.supervisorMemberId,memberId:member.id,memberName:member.name,nativeTaskId:intent.nativeTaskId,taskKey:intent.spec.taskKey,taskSpec:intent.taskSpec,dependencies,writeScope,reviewToken:randomUUID(),...(previous?{previousAttemptId:previous.id}:{}),configVersion:team.configVersion,roleVersion:member.roleVersion,role:intent.spec.role,instruction:intent.spec.instruction,token:protocol.token,generation:protocol.generation,scope:work.scope,startParams,...(reuse?{reuse}:{}),createRequestId:intent.requestId,createPayloadHash:intent.payloadHash,admission:intent.unadmitted?'unadmitted':'committed',status:intent.unadmitted?'unknown':'admitted',permit:{state:intent.unadmitted?'unknown':'not_sent'},...(intent.unadmitted?{detail:'Native work started before plugin admission. Reserved for reconciliation; no permit or replacement was sent.'}:{}),version:1,createdAt:new Date().toISOString()};
        validateDispatch(attempt);db.prepare('DELETE FROM receipts WHERE id=?').run(`dispatch-queue:${workId}:${intent.nativeTaskId}`);putPrivate(`dispatch:${id}`,attempt);putPrivate(key,{id,fingerprint:digest});putPrivate(`dispatch-member:${member.id}`,{id,workId});return {attempt,fresh:true};
      }); },
      recordDispatchReview(id,review) { return atomicDispatch(()=>{
        const row=validateDispatch(readPrivate(`dispatch:${id}`)),work=readCurrentWork(row.workId),current=listDispatches(row.workId).filter(other=>other.taskKey===row.taskKey).at(-1);
        if(row.review){if(row.review.requestId===review.requestId&&row.review.payloadHash===review.payloadHash)return row;fail('This attempt already has an immutable supervisor decision.');}
        if(work?.status==='completed'||review.reviewToken!==(row.reviewAuthority?.reviewToken??row.reviewToken)||review.protocolToken!==readDispatchProtocol(row.workId)?.token||current?.id!==row.id||row.status!=='pending_acceptance'||work?.run.state!=='verified'||work.run.consumerGeneration!==review.generation||(row.reviewAuthority?.generation??row.generation)!==review.generation||review.attemptId!==id||review.reviewerMemberId!==row.supervisorMemberId||!review.evidenceRefs?.includes(row.evidenceId)||!['accept','rework'].includes(review.decision))fail('Review is not for the current completed attempt and supervisor.');
        if(review.decision==='accept')for(const child of listRunWorks(row.teamWorkId??row.workId).filter(w=>w.parent?.attemptId===row.id)){
          if(child.run.state!=='verified'||latestBusinessAttempts(listDispatches(child.id)).some(a=>a.status!=='accepted')||queuedTasks(child.id).length||questions.listQuestions(child.id).some(questionNeedsProcessing))fail('Manager acceptance awaits descendant results and questions.');
        }
        const event={...review,workId:row.workId,taskKey:row.taskKey,nativeTaskId:row.nativeTaskId,dispatchId:row.dispatchId,recordedAt:new Date().toISOString()};
        row.review=event;row.status=review.decision==='accept'?'accepted':'rework';row.version++;row.detail=review.decision==='accept'?'Direct supervisor accepted the execution and validation evidence.':'Direct supervisor requested rework; dependencies remain blocked.';
        validateDispatch(row);putPrivate(`dispatch-review:${row.id}`,event);putPrivate(`dispatch:${row.id}`,row);return row;
      }); },
      updateDispatch(id,version,patch,expectedWorkVersion) { return atomicDispatch(()=>{
        const row=validateDispatch(readPrivate(`dispatch:${id}`));if(readWork(row.workId)?.status==='completed')fail('Completed TeamWork is sealed.');if(expectedWorkVersion!==undefined&&readWork(row.workId)?.version!==expectedWorkVersion)fail('TeamWork changed during recovery.');if(row.version!==version)fail(DISPATCH_OBSERVATION_CHANGED);
        if(Object.keys(patch).some(key=>!['admission','status','permit','dispatchId','creatorDispatchId','depth','binding','nativeState','startRequestId','startPayloadHash','outcome','result','evidenceId','detail','recovery'].includes(key)))fail('Immutable Dispatch identity cannot change.');
        if(patch.admission!==undefined&&(patch.admission!=='unadmitted'||row.permit.state!=='not_sent'))fail('Admission cannot be rewritten after a permit attempt.');
        if(row.dispatchId&&patch.dispatchId&&row.dispatchId!==patch.dispatchId)fail('Late native evidence belongs to a different Dispatch.');
        if(row.evidenceId&&patch.evidenceId&&row.evidenceId!==patch.evidenceId)fail('Execution result already has immutable native evidence.');
        if(row.binding&&patch.binding&&['kind','handle','sessionId','paneKey','incarnationId','runtimeId','workspaceId','executionHostId'].some(key=>row.binding[key]!==patch.binding[key]))fail('Saved member execution instance changed; prior binding remains reserved.');
        if(patch.binding&&listDispatches().some(other=>other.memberId!==row.memberId&&other.binding&&(patch.binding.sessionId?other.binding.sessionId===patch.binding.sessionId:other.binding.handle===patch.binding.handle&&other.binding.incarnationId===patch.binding.incarnationId)))fail('Native session is already bound to another member.');
        if(row.evidenceId){if(patch.recovery){row.recovery=patch.recovery;row.version=version+1;putPrivate(`dispatch:${id}`,row);}return row;} // Execution facts and the independent review are immutable.
        Object.assign(row,patch,{version:version+1});validateDispatch(row);putPrivate(`dispatch:${id}`,row);
        if(row.binding&&row.reuse?.recoveryRequestId){const wake=readPrivate(`wake:${row.reuse.recoveryRequestId}`);if(wake&&wake.newInstance?.requestId===row.reuse.requestId&&wake.state==='replacing'){wake.state='bound';wake.newInstance={...wake.newInstance,attemptId:row.id,dispatchId:row.dispatchId};wake.version++;putPrivate(`wake:${wake.requestId}`,wake);db.prepare('DELETE FROM receipts WHERE id=?').run(`wake-member:${row.memberId}`);}}
        if(row.binding&&readPrivate(`dispatch-member:${row.memberId}`)?.id===row.id)putPrivate(`dispatch-binding:${row.memberId}`,{workId:row.workId,attemptId:row.id,dispatchId:row.dispatchId,...row.binding});
        return row;
      }); },
      prepareWork(input, {sessionMode=false}={}) {
        workInput(input); const digest=fingerprint(input);
        db.exec('BEGIN IMMEDIATE');
        try {
          const request=db.prepare('SELECT json FROM receipts WHERE id=?').get(`work-request:${input.requestId}`);
          if(request) { const saved=JSON.parse(request.json); if(saved.fingerprint!==digest) fail('Objective request identity conflicts with another input.'); const work=readWork(saved.workId); if(!work) fail('Saved objective is missing.'); db.exec('COMMIT'); return {work,fresh:false}; }
          const state=readSnapshot(),team=state.teams.find(row=>row.id===input.teamId),supervisor=team?.members.find(row=>row.boss===null);
          const nextGoal=lifecycle.nextGoal(input.teamId);
          if(nextGoal&&(input.requestId!==nextGoal.workRequestId||input.objective!==nextGoal.objective||team?.configVersion!==nextGoal.configVersion))fail('A queued-goal transition reserves this team.');
          if(nextGoal&&Object.entries(nextGoal.launchRequests).some(([memberId,id])=>readPrivate(`binding:${memberId}`)?.requestId!==id||readOperation(id)?.status!=='created'))fail('Queued goal awaits verified fresh preparation sessions.');
          if(!supervisor) fail('Saved team supervisor is missing.');
          if(db.prepare('SELECT id FROM receipts WHERE id=?').get(`active-work:${team.id}`)) fail('This team already has a total objective in progress. Check its active work.');
          if(state.revision!==input.expectedRevision) fail('Another panel changed team data. Reload before submitting the objective.');
          const requestId=team.launch?.members?.[supervisor.id]?.requestId, binding=requestId&&readOperation(requestId);
          if(binding?.status!=='created'||binding.teamId!==team.id||binding.memberId!==supervisor.id||!binding.handle) fail('Launch and verify the registered highest supervisor before submitting a total objective.');
          if(listWorks().some(w=>w.teamId===team.id&&(binding.kind==='structured'?w.binding.sessionId===binding.sessionId:w.binding.handle===binding.handle||w.binding.paneKey===binding.paneKey)))fail('New TeamWork requires a fresh native conversation; old session authority cannot be reused.');
          if (supervisor.agent !== binding.nativeRequest.agent || supervisor.model !== (binding.nativeRequest.sessionOptions?.model ?? 'default') || supervisor.effort !== (binding.nativeRequest.sessionOptions?.effort ?? 'default')) fail('The prepared supervisor preferences differ from the saved preferences. Restore its original requested preferences or replace the session through a supported lifecycle action first.');
          if(db.prepare('SELECT id FROM receipts WHERE id=?').get(`session-work:${requestId}`)) fail('This preparation session has already accepted a total objective.');
          const scope=JSON.parse(db.prepare('SELECT json FROM scopes WHERE team_id=?').get(team.id).json);
          const id=randomUUID(),protocolToken=randomUUID();
          const work={format:'team-work-v1',...(sessionMode?{mode:'supervisor-session'}:{}),id,teamId:team.id,requestId:input.requestId,objective:input.objective,configVersion:team.configVersion,roleVersion:supervisor.roleVersion,supervisorMemberId:supervisor.id,scope,binding,recipientBindings:Object.values(team.launch?.members??{}).map(r=>readOperation(r.requestId)).filter(Boolean),protocolToken,nativeObjective:`TeamWork ${id} ${protocolToken}\n${input.objective}`,createdAt:new Date().toISOString(),version:1,status:'preparing',input:{state:'not_sent'},processing:{state:'unknown'},run:{state:'unverified'}};
          if(nextGoal){work.handoff=nextGoal.handoff;work.previousWorkId=nextGoal.previousWorkId;nextGoal.status='started';nextGoal.workId=work.id;putPrivate(`goal:${nextGoal.id}`,nextGoal);db.prepare('DELETE FROM receipts WHERE id=?').run(`next-goal:${team.id}`);}
          persistWork(work);
          for(const [key,value] of [[`work-request:${input.requestId}`,{workId:id,fingerprint:digest}],[`active-work:${team.id}`,{workId:id}],[`session-work:${requestId}`,{workId:id}]]) db.prepare('INSERT INTO receipts VALUES (?,?)').run(key,JSON.stringify(value));
          state.revision++; write(state); db.exec('COMMIT'); return {work,fresh:true};
        }catch(error){db.exec('ROLLBACK');throw error;}
      },
      updateWork(id,version,patch) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const work=readWork(id);if(!work||work.version!==version) fail('TeamWork changed while native evidence was being observed.');
          if(work.status==='completed')fail('Completed TeamWork is sealed.');
          const permitted=['status','input','processing','run','snapshot','error','instance','nativeSend'];
          if(Object.keys(patch).some(key=>!permitted.includes(key))) fail('Immutable TeamWork identity cannot be changed.');
          // Observation freshness is not a business/authority revision. Keep the
          // CAS above, and advance it for every actual change except observation timestamps.
          const current=readCurrentWork(id),before=Object.fromEntries(Object.keys(patch).map(key=>[key,current[key]])),after={...patch};
          for(const value of [before,after])for(const key of ['run','snapshot'])if(value[key])value[key]={...value[key],observedAt:undefined};
          const nextVersion=version+(fingerprint(before)===fingerprint(after)?0:1);
          if(work.currentSupervisor){Object.assign(work.currentSupervisor,patch);work.version=nextVersion;}else Object.assign(work,patch,{version:nextVersion});validateWork(work);persistWork(work);
          db.exec('COMMIT');return readCurrentWork(id);
        }catch(error){db.exec('ROLLBACK');throw error;}
      },
      prepareOperation(input, intent) {
        const digest = fingerprint(input);
        db.exec('BEGIN IMMEDIATE');
        try {
          const previous = readOperation(input.requestId);
          if (previous) {
            if (previous.fingerprint !== digest) fail('Request identity conflicts with another launch input.');
            db.exec('COMMIT'); return { operation: previous, fresh: false };
          }
          const team = readSnapshot().teams.find(row => row.id === input.teamId);
          const member = team?.members.find(row => row.id === input.memberId);
          if (!member || !initialMembers(team).some(row => row.id === member.id) || team.configVersion !== input.configVersion) fail('Launch requires a member selected by the saved roster preparation mode.');
          staffing.assertStaffingPreparation(member.id,input.requestId);
          const nextGoal=lifecycle.nextGoal(input.teamId);
          if(nextGoal&&(nextGoal.launchRequests[input.memberId]!==input.requestId||nextGoal.configVersion!==input.configVersion))fail('Queued transition requires its saved fresh launch identity.');
          const bindingKey = `binding:${input.memberId}`;
          if (db.prepare('SELECT id FROM receipts WHERE id=?').get(bindingKey) || readPrivate(`dispatch-member:${member.id}`) || team.launch?.members?.[member.id]) fail('This member already has a launch or unresolved binding. Inspect its saved operation.');
          const instanceGeneration=(readPrivate(`binding-generation:${input.memberId}`)?.generation??0)+1;
          const operation = { ...intent, ...input, fingerprint: digest, status: 'unknown', effectState:'intent', instanceGeneration, version:1, createdAt: new Date().toISOString() };
          db.prepare('INSERT INTO receipts VALUES (?,?)').run(bindingKey, JSON.stringify({ requestId: input.requestId, instanceGeneration }));
          persistOperation(operation);
          db.exec('COMMIT'); return { operation, fresh: true };
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
      settleOperation(requestId, nativeOperationId, patch, expectedVersion) {
        db.exec('BEGIN IMMEDIATE');
        try {
          const operation = readOperation(requestId);
          if (!operation || operation.nativeRequest.operationId !== nativeOperationId) fail('Launch settlement does not match its operation.');
          if(expectedVersion!==undefined&&(operation.version??1)!==expectedVersion)fail('Operation changed while observing evidence; stale panel observation discarded.');
          // An ambiguous late response cannot erase a durable created identity.
          if (operation.status === 'created' && patch.status === 'unknown') { db.exec('COMMIT'); return operation; }
          if (operation.handle && patch.handle && (operation.kind !== patch.kind || (operation.kind === 'structured' ? operation.sessionId !== patch.sessionId : operation.handle !== patch.handle && (!operation.paneKey || operation.paneKey !== patch.paneKey)))) fail('Launch settlement conflicts with its saved identity.');
          const observationOnly=(!patch.status||patch.status===operation.status)&&(!patch.handle||patch.handle===operation.handle);
          Object.assign(operation, patch, {version:(operation.version??1)+1});
          persistOperation(operation,observationOnly); db.exec('COMMIT'); return operation;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
      },
      readSnapshot,
      replay(op, input) {
        readSnapshot();
        if (typeof input?.requestId !== 'string') fail('Invalid request identity.');
        const previous = db.prepare('SELECT fingerprint,result FROM requests WHERE id=?').get(input.requestId);
        if (!previous) return null;
        if (previous.fingerprint !== fingerprint({ op, input })) fail('Request identity conflicts with another input.');
        const saved=JSON.parse(previous.result);return saved.format==='history-pruned-replay-v1'?readSnapshot():validatePersistentState(saved);
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
          if (!scope?.workspaceId || !scope.executionHostId || !['git', 'folder'].includes(scope.kind)) fail('A verified current project and execution host are required before saving.');
          const team = planTeam(input.form);
          const ids = new Map(team.members.map(member => [member.id, randomUUID()]));
          if (scope.projectPath) team.configuration.projectRoleFiles = 1;
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
          for(const work of listWorks().filter(w=>w.teamId===team.id&&w.status!=='completed'))staffing.recordConfigurationAmendment(work.id,team,{requestId:input.requestId,kind:'role-update',memberIds:[member.id]});
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
