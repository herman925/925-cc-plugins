import { preferenceIssue } from './capabilities.mjs';
import { PRESETS, DEFAULT_FORM, GLYPHS, planTeam, emptyTeamState, validatePersistentState } from './team.mjs';
import { createBridge } from './bridge.mjs';
import { createWorkerBridge } from './worker-bridge.mjs';
import { initialMembers } from './launch.mjs';

const app = document.getElementById('app');
const rawCall = createBridge(window.parent);
const worker = createWorkerBridge(rawCall);
const call = (action, params) => worker.call(action, params);
let connection = 'Panel loaded · worker activation unknown · compatibility layer checking…';
let connectionReady = false;
let state = emptyTeamState();
let form = {...structuredClone(DEFAULT_FORM),sessionMode:true};
let telemetry={members:{},observedAt:null};
let rosterRefreshRunning=false;
let view = 'roster';
let selection = null;
let busy = true;
let loaded = false;
let storageAvailable = false;
let loading = true;
let showFailureDetails = false;
let message = '';
let problem = '';
let canRetry = false;
let storageRecovery=null,cleanupPreview=null,cleanupRequest=null;
const cleanupSelection=new Set();
let workspace = null;
let targetError = '';
let confirmedWorkspace = null;
const capabilityViews = new Map();
let memberPreferences = null;
let preferenceTarget = 'member';
const replacementDrafts=new Map();

const wakeDrafts = new Map(), wakeRequests = new Map();
const reconnectRequests=new Map();
const mutation = params => ({ ...params, expectedRevision: state.revision, requestId: crypto.randomUUID() });

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = role => ({ ceo: 'CEO', head: 'Head', lead: 'Lead', worker: 'Worker' })[role];
function button(text, action, attrs = '', className = '') { return `<button type="button" data-action="${action}" class="${className}" ${attrs}>${text}</button>`; }
function segment(field, choices, value) {
  return `<div class="segments" role="group" aria-label="${field === 'fan' ? 'Reports per manager' : field === 'levels' ? 'Hierarchy levels' : 'Structure'}">${choices.map(([id, text]) => button(escape(text), 'pick', `data-field="${field}" data-value="${id}" aria-pressed="${String(id) === String(value)}"`)).join('')}</div>`;
}
function presets() {
  return `<div class="presets">${PRESETS.map((preset, i) => button(`<span><strong>${preset.label}</strong><code>${preset.sketch}</code></span><small>${preset.hint}</small>`, 'preset', `data-index="${i}"`, 'preset')).join('')}</div>`;
}
function empty() { return `<section class="welcome"><h1>${workspace?'No teams in this project':'Select a project'}</h1><p>${workspace?'Use the New team tab to create and launch a team.':'Select a project in Orca to view its teams.'}</p></section>`; }
const STATUS_LABELS={working:'Working',idle:'Idle',asking:'Needs input',starting:'Starting',closed:'Closed','not-started':'Not started',offline:'Offline',unknown:'Unknown'};
function memberObservation(member){return telemetry.members[member.id]??{state:'unknown',model:null,effort:null,context:null,requestedModel:member.model,requestedEffort:member.effort};}
function statusCell(member){const row=memberObservation(member);return `<span class="member-status" data-state="${escape(row.state)}" title="${escape(row.detail||'Observed from the native session')}"><span class="status-dot" aria-hidden="true"></span>${STATUS_LABELS[row.state]||'Unknown'}</span>`;}
function contextCell(member){const usage=memberObservation(member).context;if(!usage)return '<span class="subtle" title="Context usage has not been reported by this session">—</span>';const percent=Math.round(usage.percent),tone=percent<50?'low':percent<80?'medium':'high';return `<span class="context-usage ${tone}" title="${escape(usage.used)} / ${escape(usage.limit)} tokens${usage.estimated?' · Estimated from native token usage':''}"><span>${usage.estimated?'≈':''}${percent}%</span><span class="context-track"><span style="width:${Math.min(100,Math.max(0,percent))}%"></span></span></span>`;}
function preferenceCell(member,field){const row=memberObservation(member),reported=row[field],setting=row[field==='model'?'sessionModel':'sessionEffort']??row[field==='model'?'requestedModel':'requestedEffort'];return reported?escape(reported):`<span title="Configured value; the current CLI has not confirmed its effective ${field}">${escape(setting==='default'?'Default':setting||'—')} <small class="subtle">set</small></span>`;}
function currentBinding(team,member){const observed=telemetry.members[member.id];if(observed?.sessionRequestId)return {requestId:observed.sessionRequestId,kind:observed.kind,status:'created',...(team.launch?.members?.[member.id]??{})};const prepared=team.launch?.members?.[member.id];if(prepared?.status==='created')return prepared;for(const work of state.works||[]){const task=work.tasks?.filter(a=>a.memberId===member.id&&a.binding).at(-1);if(task)return {...task.binding,requestId:task.id};}return null;}
function openSessionButton(team,member){const b=currentBinding(team,member);return b?button('Open session','open-member',`data-team="${team.id}" data-member="${member.id}" data-request="${b.requestId}"`,'small'):'';}
function tree(members, parent = null, clickable = false, teamIndex = 0, compact = false) {
  const children = members.filter(member => member.boss === parent);
  return `<ul class="org-tree ${parent === null ? 'root' : ''}">${children.map(member => {
    const shortName = compact ? member.role === 'ceo' ? 'CEO' : member.role === 'head' ? member.team : member.name.replace(/^.*Worker-/, 'W').replace(/^Lead-/, 'L') : member.name;
    return `<li><${clickable ? 'button type="button"' : 'span'} class="org-node ${escape(member.role)}" ${clickable ? `data-action="member" data-team="${teamIndex}" data-member="${escape(member.id)}" aria-label="${escape(member.name)}" title="${escape(member.name)} · ${escape(STATUS_LABELS[memberObservation(member).state]||'Unknown')}" data-state="${escape(memberObservation(member).state)}"` : ''}><span class="glyph" aria-hidden="true">${GLYPHS[member.role]}</span><span>${escape(shortName)}</span><small>${label(member.role)}</small></${clickable ? 'button' : 'span'}>${members.some(child => child.boss === member.id) ? tree(members, member.id, clickable, teamIndex, compact) : ''}</li>`;
  }).join('')}</ul>`;
}
function preferenceControls(name, preference, caps, suffix, member = false) {
  const agent = caps?.agents?.[preference.agent];
  const models = agent?.models ?? [];
  const listed = models.find(row => row.id === preference.model);
  const efforts = [...new Set(['default', ...(listed?.efforts ?? []).map(row => row.value), ...(preference.effort === 'default' ? [] : [preference.effort])])];
  const attr = field => member ? `data-preference="${field}"` : `data-${field}="${suffix}"`;
  const issue = preferenceIssue(preference, caps);
  return `<td><select aria-label="${name} ${member ? 'agent' : 'CLI'}" ${attr('agent')}>${[['codex', 'Codex'], ['claude', 'Claude Code']].map(([value, text]) => `<option value="${value}" ${preference.agent === value ? 'selected' : ''}>${text}${caps?.agents?.[value]?.tuiPickerDisabled ? ' · hidden in TUI picker' : ''}</option>`).join('')}</select></td><td><input aria-label="${name} model" ${attr('model')} list="models-${suffix}" value="${escape(preference.model)}" maxlength="120"><datalist id="models-${suffix}"><option value="default"></option>${models.map(row => `<option value="${escape(row.id)}">${escape(row.label)}</option>`).join('')}</datalist></td><td><select aria-label="${name} effort" ${attr('effort')} ${preference.model === 'default' ? 'disabled' : ''}>${efforts.map(value => `<option value="${escape(value)}" ${preference.effort === value ? 'selected' : ''}>${escape(value === 'default' ? 'Default' : value)}</option>`).join('')}</select>${issue ? `<small class="validation">${escape(issue)}</small>` : ''}</td>`;
}
function capabilityNotice(scope) {
  const caps = capabilityViews.get(scope?.workspaceKey);
  return `<p class="subtle">${caps ? caps.connection === 'connected' ? 'Capabilities verified for this project' : 'Execution host unavailable; refresh after reconnecting in Orca.' : 'Refresh host capabilities to validate explicit model and effort choices. Default inherits Orca configuration.'}</p>${caps ? `<p class="subtle">${['codex', 'claude'].map(id => `${id}: ${caps.agents[id].availability}${caps.agents[id].configured.model ? ` · Orca saved preference ${caps.agents[id].configured.model}${caps.agents[id].configured.effort ? ` / ${caps.agents[id].configured.effort}` : ''}` : ''}${caps.agents[id].detail ? ` · ${caps.agents[id].detail}` : ''}`).map(escape).join('<br>')}</p>` : ''}`;
}
function configRows() {
  const count = form.structure === 'organisation' ? 3 : form.levels;
  const caps = capabilityViews.get((confirmedWorkspace || workspace)?.workspaceKey);
  return Array.from({ length: count }, (_, i) => {
    const name = form.structure === 'organisation' ? ['CEO', 'Heads', 'Workers'][i] : i === 0 ? 'Head' : i === count - 1 ? 'Workers' : 'Leads';
    return `<tr><th scope="row">${name}</th>${preferenceControls(name, { agent: form.agents[i], model: form.models[i], effort: form.efforts[i] }, caps, i)}</tr>`;
  }).join('');
}
function preview() {
  try {
    const plan = planTeam(form);
    const counts = ['ceo', 'head', 'lead', 'worker'].map(role => [role, plan.members.filter(member => member.role === role).length]).filter(([, n]) => n);
    return `<p class="count">${plan.members.length} members · ${counts.map(([role, n]) => `${n} ${label(role).toLowerCase()}${n > 1 ? 's' : ''}`).join(', ')}</p><div class="tree-scroll">${tree(plan.members)}</div>`;
  } catch (error) { return `<p class="validation">${escape(error.message)}</p>`; }
}
function formView() {
  return `<div class="flow"><h1>New team</h1><p class="steps">① Setup <span>→</span> ② Models <span>→</span> ③ Preview <span>→</span> Launch</p></div>
    <section class="section"><h2><span>①</span> Setup</h2><label class="field">Team name<input id="team-name" data-form="name" value="${escape(form.name)}" maxlength="64" autocomplete="off"></label><label class="field">Function<textarea id="team-purpose" data-form="purpose" maxlength="500" rows="2" placeholder="What the team is for, in a sentence">${escape(form.purpose)}</textarea></label><div class="field"><span>Quick start</span>${presets()}</div><div class="field"><span>Structure</span>${segment('structure', [['team', 'One team'], ['organisation', 'CEO over several teams']], form.structure)}</div>
    ${form.structure === 'organisation' ? `<label class="field">Teams<input id="team-groups" data-form="groups" value="${escape(form.groups)}" maxlength="520" placeholder="Team 1, Team 2"><small>Names separated by commas; each gets a head and workers.</small></label>` : `<div class="field"><span>Levels</span>${segment('levels', [[1, '1 · Head only'], [2, '2 · Head + workers'], [3, '3 · Head + leads + workers']], form.levels)}</div>`}
    <div class="field"><span>${form.structure === 'organisation' ? 'Workers each' : 'Reports each'}</span>${segment('fan', [1, 2, 3, 4, 5].map(n => [n, `${n}`]), form.fan)}</div></section>
    <section class="section"><h2><span>②</span> CLI, model and effort per level</h2><p class="subtle">Default inherits your agent configuration.</p><div class="table-scroll"><table class="models"><thead><tr><th>Level</th><th>CLI</th><th>Model</th><th>Effort</th></tr></thead><tbody>${configRows()}</tbody></table></div>${capabilityNotice(confirmedWorkspace || workspace)}${button('Refresh host capabilities', 'refresh-capabilities', !(confirmedWorkspace || workspace)?.selectionToken ? 'disabled' : '', 'small')}</section>
    <section class="section"><h2><span>③</span> Organisation preview</h2><div id="preview">${preview()}</div></section>
    ${state.teams.some(t=>!t.launch)?`<details><summary>Unstarted teams</summary>${state.teams.filter(t=>!t.launch).map(t=>button('Launch @'+escape(t.name),'launch-existing',`data-team="${state.teams.indexOf(t)}"`,'small')).join('')}</details>`:''}${projectControls()}<label class="field">Preparation mode<select data-form="launchMode"><option value="on-demand" ${form.launchMode!=='all'?'selected':''}>On demand</option><option value="all" ${form.launchMode==='all'?'selected':''}>All at start</option></select></label>${launchControls()}<div class="actions">${button('Launch team', 'create', busy || !loaded || !storageAvailable || !confirmedWorkspace ? 'disabled' : '', 'primary')}${button('Cancel', 'roster', '', 'secondary')}</div>`;
}
function projectControls() {
  const target = confirmedWorkspace || workspace;
  return `<section class="section"><h2>Project and execution host</h2><p>${escape(target?.displayName || 'No selected workspace')} · ${escape(target?.kind || 'unknown kind')} · ${escape(target?.executionHostId || 'unknown host')}</p>${button('Refresh workspace', 'refresh-tabs', '', 'small')} ${button('Confirm project and host', 'confirm-project', !workspace?.selectionToken ? 'disabled' : '', 'small')}<p class="subtle">${confirmedWorkspace ? 'Project confirmed. Changing Orca focus will not change this binding.' : 'Open the intended project in Orca, refresh here, then confirm it before saving.'}</p>${targetError ? `<p class="validation" role="alert">${escape(targetError)}</p>` : ''}</section>`;
}
function recoveryEvidence(value) {
  if (!value) return '';
  return `<div class="recovery-evidence"><p>Recovery: ${escape(value.state)} · Execution: ${escape(value.liveness || 'unknown')}</p><p>${escape(value.detail || '')}</p><small>Last observed: ${escape(value.observedAt || 'Not observed')} · Source: ${escape(value.source || 'unknown')}</small>${value.incomplete ? '<p>Observation or output is incomplete. Check the native session and reconnect its saved host.</p>' : ''}${value.output?.archived ? '<p>Output source is archived; it does not prove current execution.</p>' : ''}${value.output?.warnings?.length ? `<p>${escape(value.output.warnings.join(' · '))}</p>` : ''}</div>`;
}
function launchControls() {
  return `<section class="section launch-controls"><h2>Launch</h2><p>On demand prepares the highest supervisor and department managers; other members start on their first task. All at start prepares exactly the saved roster. Orca chooses terminal or native chat and applies its saved launch configuration. The supervisor receives its role and waits for the total objective.</p>${targetError ? `<p class="validation" role="alert">${escape(targetError)}</p>` : ''}</section>`;
}
function launchStatus(team, member) {
  if (!team.launch) return 'Not started';
  if (!team.launch.native) return 'Legacy request · unverified';
  const row = team.launch.members?.[member.id];
  if (row?.status === 'created') return row.briefAccepted ? 'Created · startup brief supplied' : 'Created · brief unconfirmed';
  if (row?.status === 'starting') return 'Starting';
  if (row?.status === 'unknown') return 'Unconfirmed';
  return initialMembers(team, team.launch.mode).some(initial => initial.id === member.id) ? 'Not started' : 'On demand';
}
function launchReceipt(team) {
  if (!team.launch) return '';
  if (!team.launch.native) return '<p class="subtle">Legacy coordinator request · unverified.</p>';
  const rows = Object.entries(team.launch.members ?? {});
  return `<p class="subtle">${rows.filter(([, row]) => row.terminalId).length} actual session receipt(s). Input acceptance does not prove agent readiness.</p><ul>${rows.map(([memberId, row]) => `<li>${escape(row.title || team.members.find(member => member.id === memberId)?.name || 'Supervisor')} · ${escape(row.status)}${row.kind ? ` · ${escape(row.kind)}` : ''}<br><small>Input: ${escape(row.prompt?.outcome || 'unconfirmed')} · Observation: ${escape(row.observation?.state || 'unknown')}</small>${recoveryEvidence(row.recovery)}${row.error || row.warning ? `<p>${escape(row.error || row.warning)}</p>` : ''}${row.terminalId ? button('Open verified session', 'open-member', `data-team="${team.id}" data-member="${memberId}" data-request="${row.requestId}"`, 'small') : ''}${row.requestId ? button('Wake closed member', 'wake-member', `data-team="${team.id}" data-member="${memberId}" data-request="${row.requestId}"`, 'small') : ''}${row.requestId ? button('Check saved launch', 'recover-launch', `data-team="${team.id}" data-member="${memberId}" data-request="${row.requestId}"`, 'small') : ''}</li>`).join('')}</ul>`;
}
function admissionControls(team,member) {
 const paused=member?team.admission?.members?.[member.id]===true:team.admission?.paused===true;
 return `<p>${member?'Member':'Team'} new assignments: ${paused?'Paused':'Allowed'}${member&&team.admission?.paused?' · Team is paused':''}</p>${button(paused?'Resume new assignments':'Pause new assignments','admission',`data-team="${team.id}" ${member?`data-member="${member.id}"`:''} data-paused="${!paused}"`,'small')}`;
}
function stopControls(team,member){
 const tasks=(state.works||[]).filter(w=>w.teamId===team.id&&w.status!=='completed').flatMap(w=>(w.tasks||[]).map(t=>({...t,workId:t.workId??w.id}))).filter(t=>t.memberId===member.id),task=tasks.at(-1),launch=team.launch?.members?.[member.id];
 const stops=(state.stops||[]).filter(s=>s.teamId===team.id&&s.memberId===member.id),stop=stops.at(-1);
 const action=task?.dispatchId?`data-work="${task.workId}" data-attempt="${task.attemptId}"`:!tasks.length&&launch?.requestId?`data-operation="${launch.requestId}"`:null;
 return `<section aria-label="Execution control"><h3>Execution control</h3>${admissionControls(team,member)}${action?button('Stop current execution','stop-member',`data-team="${team.id}" data-member="${member.id}" ${action}`,'small'):''}${stops.map(s=>`<p>Stop: ${escape(s.state)}</p><p>${escape(s.detail||'Intent saved; execution stop is not confirmed.')}</p>${button('Check stop evidence','check-stop',`data-request="${s.requestId}"`,'small')}${s.recoverable?`<p>Recover the same native request. The original outcome stays in history; no new stop identity is created.</p>${button('Recover same stop request','recover-stop',`data-request="${s.requestId}" data-version="${s.version}"`,'small')}`:''}`).join('')}<p>Stopping requires native execution evidence. Modified files are retained.</p></section>`;
}
function replacementControls(team,member){
 const task=(state.works||[]).filter(w=>w.teamId===team.id&&w.status!=='completed').flatMap(w=>w.tasks||[]).filter(t=>t.memberId===member.id).at(-1),bindingRequestId=task?.id??team.launch?.members?.[member.id]?.requestId;
 if(!bindingRequestId)return '';
 return `<section aria-label="Replace agent"><h3>Replace idle agent or model</h3><p>Use the requested choices above in a new conversation with the same member identity. Admission pauses while the handoff is checked. Unknown or unfinished execution must be resolved first. The old conversation may remain open for inspection.</p><label class="field">Replacement handoff summary<textarea data-replacement-summary="${member.id}" maxlength="4000">${escape(replacementDrafts.get(member.id)||'')}</textarea></label>${button(member.boss?'Approve idle member replacement':'Approve idle supervisor replacement','request-replacement',`data-request="${escape(bindingRequestId)}"`,'small')}</section>`;
}
function details() {
 if(!selection)return '';const team=state.teams[selection.team],member=team?.members.find(m=>m.id===selection.member);if(!member)return '';
 const boss=team.members.find(m=>m.id===member.boss),binding=currentBinding(team,member);
 return `<section class="inspector" aria-label="Member details"><div class="section-heading"><h2>${escape(member.name)}</h2>${button('Close details','close-details','','small')}</div><dl><dt>Role</dt><dd>${label(member.role)}</dd><dt>Reports to</dt><dd>${escape(boss?.name||'You')}</dd><dt>Status</dt><dd data-live-status="${member.id}">${statusCell(member)}</dd><dt>Context</dt><dd data-live-context="${member.id}">${contextCell(member)}</dd><dt>Model</dt><dd>${preferenceCell(member,'model')}</dd><dt>Effort</dt><dd>${preferenceCell(member,'effort')}</dd></dl>${openSessionButton(team,member)}<details><summary>Role and preferences</summary><p>Role version ${member.roleVersion} · Configuration version ${team.configVersion}</p><label class="field">Preference applies to<select data-preference-target><option value="member" ${preferenceTarget==='member'?'selected':''}>This member</option><option value="level" ${preferenceTarget==='level'?'selected':''}>Level ${member.level} defaults</option></select></label><div class="table-scroll"><table class="models"><tbody><tr>${preferenceControls('Member',memberPreferences||member,capabilityViews.get(team.scope.workspaceKey),'member',true)}</tr></tbody></table></div>${capabilityNotice(team.scope)}${button('Refresh host capabilities','refresh-capabilities','','small')}${button('Save preferences','save-preferences','','small')}${button('Use level default','inherit-preferences','','small')}<label class="field">Role description<textarea data-role="brief" maxlength="1500">${escape(member.brief)}</textarea></label><label class="field">Work habits<textarea data-role="habits" maxlength="1500">${escape(member.habits)}</textarea></label><label class="field">Collaboration rules<textarea data-role="collaboration" maxlength="1500">${escape(member.collaboration)}</textarea></label>${button('Save role','save-role','','small')}</details><details><summary>Session controls and diagnostics</summary>${(state.works||[]).filter(w=>w.supervisorMemberId===member.id&&w.canReconnectRuntime).map(w=>button('Reconnect existing team','reconnect-work',`data-work="${w.id}"`,'small')).join('')}${stopControls(team,member)}${replacementControls(team,member)}${binding&&team.launch?.members?.[member.id]?launchReceipt({...team,launch:{...team.launch,members:{[member.id]:binding}}}):''}${recoveryCards(team.id,member.id)}${initialMembers(team).some(m=>!team.launch?.members?.[m.id])?button('Continue starting team','launch-existing',`data-team="${state.teams.indexOf(team)}"`,'small'):''}</details></section>`;
}
function roster() {
 const teams=workspace?state.teams.filter(t=>t.launch&&t.scope.workspaceKey===workspace.workspaceKey):[];
 if(!teams.length)return empty();
 return `<div class="section-heading"><h1>Team roster</h1><small>Updates every 5s</small></div>${state.settings.chart?`<section class="organisation">${teams.map(team=>`<div class="chart-heading">@${escape(team.name)}</div><div class="tree-scroll org-chart">${tree(team.members,null,true,state.teams.indexOf(team),true)}</div>`).join('')}</section>`:''}<div class="team-cards ${state.settings.layout==='columns'?'columns':''}">${teams.map(team=>`<section class="team-card"><header><h2>@${escape(team.name)}</h2><small>${team.members.length} members</small></header><div class="table-scroll"><table class="roster"><thead><tr><th>Name</th><th>Role</th><th>CLI</th><th>Status</th><th>Context</th><th>Model</th><th>Effort</th></tr></thead><tbody>${team.members.map(member=>`<tr data-member-row="${member.id}"><td>${button(`${GLYPHS[member.role]} ${escape(member.name)}`,'member',`data-team="${state.teams.indexOf(team)}" data-member="${member.id}"`,'name-button')}</td><td>${label(member.role)}</td><td>${memberObservation(member).agent==='claude'?'Claude':'Codex'}</td><td data-live-status="${member.id}">${statusCell(member)}</td><td data-live-context="${member.id}">${contextCell(member)}</td><td data-live-model="${member.id}">${preferenceCell(member,'model')}</td><td data-live-effort="${member.id}">${preferenceCell(member,'effort')}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>${details()}`;
}
function recoveryCards(teamId,memberId){
 return (state.recoveries||[]).filter(row=>row.teamId===teamId&&row.memberId===memberId).map(row=>{
  const team=state.teams.find(t=>t.id===row.teamId),member=team?.members.find(m=>m.id===row.memberId),root=!member?.boss;
  return `<article class="task-card" aria-label="Member recovery"><h3>${escape(member?.name||row.memberId)} · Recovery</h3><p>State: ${escape(row.state)}</p><p>${escape(row.detail||'The old execution was confirmed stopped; native continuation is checked first.')}</p><p>Closing a conversation keeps this member on the roster. Assignment pause and removal are separate actions.</p><small>Previous instance ${escape(row.oldInstanceGeneration)} · Original request ${escape(row.oldRequestId)}</small>${row.handoff?`<p>Checked handoff: ${escape(row.handoff.summary)}</p><p>Reviewer: ${escape(row.handoff.reviewer)}</p>`:''}${row.state==='needs_decision'&&root?`<label class="field">Checked handoff summary<textarea data-wake-summary="${escape(row.requestId)}" maxlength="4000">${escape(wakeDrafts.get(row.requestId)||'')}</textarea></label>${button('Approve fresh supervisor', 'decide-wake', `data-request="${escape(row.requestId)}"`, 'primary small')}`:''}${row.state==='needs_decision'&&!root?`<p>Awaiting the actual direct manager’s checked handoff.</p>${button('Check manager handoff','handoff-wake',`data-request="${escape(row.requestId)}"`,'small')}`:''}${row.state==='approved'?button('Create approved replacement','replace-wake',`data-request="${escape(row.requestId)}" data-team="${escape(row.teamId)}"`,'primary small'):''}${button('Check recovery evidence','check-wake',`data-request="${escape(row.requestId)}"`,'small')}</article>`;
 }).join('');
}
function storageRecoveryView(){
 return `<section aria-label="Storage recovery"><h1>Saved storage is unavailable</h1><p>Your saved teams could not be read. Existing data has not been reset.</p><p>Preserve the database together with its WAL, SHM and journal sidecars. Stop the plugin before copying recovery evidence. Use a compatible plugin for a newer schema. Restoring an older backup requires manual reconciliation of later native effects before starting work.</p>${button('Inspect recovery details','storage-recovery','','small')}${storageRecovery?`<dl><dt>Storage status</dt><dd>${escape(storageRecovery.status)}</dd><dt>Found / supported schema</dt><dd>${escape(storageRecovery.foundSchema??'Unreadable')} / ${escape(storageRecovery.supportedSchema)}</dd>${storageRecovery.location?`<dt>Verified local recovery directory</dt><dd>${escape(storageRecovery.location)}</dd>`:''}</dl><p>${escape(storageRecovery.guidance)}</p><h2>Migration backups</h2>${storageRecovery.backups.length?storageRecovery.backups.map(b=>`<p>${escape(b.id)} · ${escape(b.status)} · ${escape(b.createdAt||'Incomplete')}</p>`).join(''):'<p>No verified migration backup is available.</p>'}`:''}</section>`;
}
function cleanupView(){
 const history=(state.works||[]).filter(w=>w.status==='completed');
 return `<section class="section" aria-label="Manual history cleanup"><h2>Manual history cleanup</h2><p>Select accepted work to preview summary and task-result cleanup. Identity, acceptance and replay evidence stay saved.</p>${history.map(w=>`<label class="check"><input type="checkbox" data-cleanup-work="${escape(w.id)}" ${cleanupSelection.has(w.id)?'checked':''} ${w.historyPruned?'disabled':''}> ${escape(w.objective)} · ${w.historyPruned?'Previously cleaned':'Accepted by you'}</label>`).join('')}${!history.length?'<p>No accepted history yet.</p>':''}${button('Preview history cleanup','preview-cleanup',!storageAvailable||!cleanupSelection.size?'disabled':'','small')}${cleanupPreview?`<section aria-label="Cleanup preview"><h3>Cleanup preview</h3><p>${cleanupPreview.eligibleWorkIds.length} eligible Work(s) · ${cleanupPreview.changes.length} records · ${cleanupPreview.snapshotCount} cached snapshots · ${cleanupPreview.logicalBytes} logical bytes inspected</p><p>${escape(cleanupPreview.notice)}</p>${cleanupPreview.retained.map(r=>`<p>Kept ${escape(r.workId)}: ${escape(r.reason)}</p>`).join('')}<details><summary>Exact affected records</summary>${cleanupPreview.changes.map(r=>`<p>${escape(r.recordId)}: ${r.fields.map(escape).join(', ')}</p>`).join('')}</details>${button('Clear previewed summaries and results','apply-cleanup',!cleanupPreview.eligibleWorkIds.length?'disabled':'','primary small')}${button('Cancel preview','cancel-cleanup','','small')}</section>`:''}</section>`;
}
function settingsView() {
  return `<h1>Settings</h1><section class="section" aria-label="Connection"><h2>Connection</h2><p>Connected to Orca</p>${button('Test connection', 'test-connection', '', 'small')}<details><summary>Technical details</summary><p>${escape(connection)}</p></details></section>${cleanupView()}<section class="section"><h2>Roster display</h2><label class="check"><input type="checkbox" data-setting="chart" ${state.settings.chart ? 'checked' : ''} ${busy || !loaded ? 'disabled' : ''}> Show organisation tree</label><label class="field">Team cards<select data-setting="layout" ${busy || !loaded ? 'disabled' : ''}><option value="stacked" ${state.settings.layout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="columns" ${state.settings.layout === 'columns' ? 'selected' : ''}>Side by side when there is room</option></select></label></section><section class="section"><h2>Team launching</h2><p>Launch calls go to the bundled worker on your PC through the runtime adapter. Orca opens agent tabs on each team's saved project and execution host and passes each role brief as its startup prompt. The panel records actual created-tab receipts; it does not infer readiness or provider session IDs.</p><p>Default model and effort inherit agent configuration. On demand prepares the top and department Heads; all at start prepares the saved roster. Tasks share the selected directory. Scope coordination does not isolate undeclared filesystem writes.</p></section>`;
}
function unavailableView() {
  return `<section class="unavailable" aria-label="Plugin unavailable"><div role="alert"><h1>Plugin unavailable</h1><p>${connectionReady ? 'Your saved teams could not be loaded.' : 'Team Orchestrator could not connect to Orca.'}</p></div><div class="actions">${button('Retry', 'retry-plugin', '', 'primary small')}${button(showFailureDetails ? 'Hide details' : 'Details', 'failure-details', `aria-expanded="${showFailureDetails}" aria-controls="failure-details"`, 'secondary small')}</div>${showFailureDetails ? `<div id="failure-details" class="failure-details"><p>${escape(problem || connection)}</p>${connectionReady ? storageRecoveryView() : '<p>In Orca’s command menu, run <strong>Team Orchestrator: Initialise local adapter</strong>, then retry.</p>'}</div>` : ''}</section>`;
}
function render() {
  app.setAttribute('aria-busy', String(busy));
  const usable = connectionReady && loaded && storageAvailable;
  app.innerHTML = `<header class="app-header"><div class="brand"><span aria-hidden="true">◆</span> Team Orchestrator<small>v${escape(__PLUGIN_DISPLAY_VERSION__)}</small></div>${usable ? `<nav aria-label="Team Orchestrator">${[['roster', 'Roster'], ['new', 'New team'], ['settings', 'Settings']].map(([id, text]) => button(text, id, `aria-current="${view === id ? 'page' : 'false'}"`, view === id ? 'active' : '')).join('')}</nav>` : ''}</header><main>${!usable ? loading ? '<p class="loading" role="status">Connecting to Orca…</p>' : unavailableView() : `
    ${problem ? `<div class="notice error" role="alert">${escape(problem)} ${canRetry ? button('Retry storage', 'retry', busy ? 'disabled' : '', 'small') : ''}</div>` : ''}
    ${message ? `<p class="notice success" role="status">${escape(message)}</p>` : ''}
    ${view === 'new' ? formView() : view === 'settings' ? settingsView() : roster()}`}
    </main>${usable ? '<footer>Orca · Agent teams</footer>' : ''}`;
  if (busy) for (const control of app.querySelectorAll('button,input,select,textarea')) control.disabled = true;
}
function updatePreview() { const node = document.getElementById('preview'); if (node) node.innerHTML = preview(); }
async function load(retry = false) {
  busy = true; loading = true; connectionReady = false; loaded = false; storageAvailable = false; showFailureDetails = false; storageRecovery = null; problem = ''; message = ''; canRetry = false; render();
  try {
    const report = await worker.connect({ retry });
    connectionReady = true;
    connection = `Panel loaded · worker activated · compatibility layer available · ${report.platform} · Orca ${report.appVersion} · worker ${report.workerPid} · agent readiness not verified`;
    const result = await call('storage.get', {});
    state = validatePersistentState(result?.value);
    loaded = true; storageAvailable = true;
  } catch (error) {
    if (!connectionReady) { loaded = true; storageAvailable = false; connection = `Panel loaded · worker ${error.report ? 'activated' : 'activation unverified'} · compatibility layer unavailable. Run the Orca command “Team Orchestrator: Initialise local adapter” to initialise or retry; its diagnostics explain failures.`; problem = error.message; }
    else { loaded = false; storageAvailable = false; problem = error.message; canRetry = true; }
  } finally { if (storageAvailable) {await refreshTargets();try{const result=await call('rosterStatus',{});state=validatePersistentState(result.value);telemetry=result.telemetry;}catch(error){storageAvailable=false;problem=error.message;}} busy = false; loading = false; render(); }
}
async function refreshTargets() {
  try {
    workspace = await call('workspace.readContext', {});
    targetError = !workspace ? 'Open the intended workspace first.' : workspace.nativeAgentLaunch !== true ? 'The local executor is not ready. Use Test connection after the bundled bootstrap finishes.' : '';
  } catch (error) { workspace = null; targetError = error.message; }
}
async function refreshCapabilities(params, scope, force = false) {
  const previous = capabilityViews.get(scope?.workspaceKey);
  if (!force && previous && Date.now() - previous.observedAt < 300000) return;
  capabilityViews.delete(scope?.workspaceKey);
  busy = true; render();
  try { const value = await call('capabilities', params); capabilityViews.set(value.workspaceKey, value); }
  catch (error) { problem = `Could not read host capabilities: ${error.message}`; }
  finally { busy = false; render(); }
}
async function submit(action, params, request) {
  if (!loaded || !storageAvailable || busy) return false;
  busy = true; problem = ''; canRetry = false; render();
  try {
    const result = await call(action, request ?? mutation(params));
    state = validatePersistentState(result?.value); return true;
  } catch (error) { problem = `Could not save: ${error.message}`; canRetry = true; return false; }
  finally { busy = false; render(); }
}
async function launchTeam(index) {
  const team = state.teams[index], members = initialMembers(team);
  if (!members.length) throw Error('No highest supervisor exists in this saved roster.');
  busy = true; problem=''; render();
  try {
    const failures=[];let created=0;
    for (const [position,member] of members.entries()) {
      // The pinned host permits 30 panel admissions / 10 seconds, including
      // native authority rechecks. Pace preparation, never running workers.
      if(position){message=`Starting ${position+1} of ${members.length} members…`;render();await new Promise(resolve=>setTimeout(resolve,10100));}
      try {
        const receipt=await call('launchSupervisor',{teamId:team.id,memberId:member.id,requestId:`${team.id}-${member.id}`,configVersion:team.configVersion});
        if(receipt.status==='created')created++;else failures.push(member.name);
      }catch(error){failures.push(`${member.name}: ${error.message}`);}
    }
    message='';
  } catch (error) { problem = `${error.message} Saved launch intents remain reserved; no automatic retry occurs.`; }
  finally {
    try { state = validatePersistentState((await call('storage.get', {})).value); }
    catch (error) { problem = `Could not read saved launch receipts: ${error.message}`; storageAvailable = false; canRetry = true; }
    busy = false; render();
  }
}

app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled || busy) return;
  const action = target.dataset.action;
  if (['roster', 'new', 'settings'].includes(action)) { view = action; message = ''; render(); }
  else if (action === 'failure-details') { showFailureDetails = !showFailureDetails; render(); }
  else if (action === 'retry-plugin') { view = 'roster'; await load(!connectionReady); }
  else if(action==='storage-recovery') {busy=true;render();try{storageRecovery=await call('storageRecovery',{});}catch(error){problem=error.message;}finally{busy=false;render();}}
  else if(action==='preview-cleanup'||action==='apply-cleanup') {
    busy=true;problem='';render();try{
      if(action==='preview-cleanup'){cleanupPreview=await call('previewHistoryCleanup',{selectedWorkIds:[...cleanupSelection]});cleanupRequest=null;}
      else{cleanupRequest??={requestId:crypto.randomUUID(),previewToken:cleanupPreview.previewToken,expectedStorageRevision:cleanupPreview.storageRevision};const result=await call('applyHistoryCleanup',cleanupRequest);state=validatePersistentState(result.value);message=`Cleared summaries and results for ${result.cleanup.cleanedWorkIds.length} Work(s). Retained identity and acceptance evidence.`;cleanupPreview=null;cleanupRequest=null;cleanupSelection.clear();}
    }catch(error){problem=error.message;}finally{busy=false;render();}
  }
  else if(action==='cancel-cleanup'){cleanupPreview=null;cleanupRequest=null;render();}
  else if (action === 'preset') { Object.assign(form, PRESETS[Number(target.dataset.index)].form); view = 'new'; message = ''; render(); }
  else if (action === 'pick') {
    const field = target.dataset.field;
    form[field] = ['levels', 'fan'].includes(field) ? Number(target.dataset.value) : target.dataset.value;
    if (field === 'structure') { form.levels = form.structure === 'organisation' ? 3 : 2; if (!form.groups) form.groups = 'Team 1, Team 2'; }
    render();
  } else if (action === 'create') {
    try {
      if (!confirmedWorkspace) throw new Error('Confirm the project and execution host first.');
      if (await submit('createTeam', { form:{...form,sessionMode:true}, selectionToken: confirmedWorkspace.selectionToken })) { selection = null; await launchTeam(state.teams.length-1); view='roster'; await refreshRoster();render(); }
    } catch (error) { busy = false; message = ''; problem = error.message; canRetry = false; render(); }
  } else if (action === 'member') { selection = { team: Number(target.dataset.team), member: target.dataset.member }; const team = state.teams[selection.team]; memberPreferences = { ...team.members.find(row => row.id === selection.member) }; preferenceTarget = 'member'; await refreshCapabilities({ teamId: team.id }, team.scope); render(); document.querySelector('.inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  else if (action === 'close-details') { selection = null; render(); }
  else if (action === 'retry' || action === 'test-connection') { connectionReady = false; await load(action === 'test-connection'); }
  else if (action === 'refresh-tabs') { confirmedWorkspace = null; await refreshTargets(); render(); }
  else if (action === 'confirm-project') { confirmedWorkspace = workspace; await refreshCapabilities({ selectionToken: workspace.selectionToken }, workspace); render(); }
  else if (action === 'refresh-capabilities') {
    if (view === 'new') { const scope = confirmedWorkspace || workspace; await refreshCapabilities({ selectionToken: scope.selectionToken }, scope, true); }
    else if (selection) { const team = state.teams[selection.team]; await refreshCapabilities({ teamId: team.id }, team.scope, true); }
  }
  else if (action === 'save-preferences' || action === 'inherit-preferences') {
    const team = state.teams[selection.team], member = team.members.find(row => row.id === selection.member);
    const params = { teamId: team.id, ...(action === 'inherit-preferences' ? { memberId: member.id, inherit: true } : { ...(preferenceTarget === 'level' ? { level: member.level } : { memberId: member.id }), agent: memberPreferences.agent, model: memberPreferences.model, effort: memberPreferences.effort }) };
    if (await submit('updateAgentPreferences', params)) { memberPreferences = { ...state.teams[selection.team].members.find(row => row.id === member.id) }; message = 'Requested preferences saved. Effective model remains unknown until Orca reports it.'; render(); }
  }
  else if(action==='request-replacement'){
   const team=state.teams.find(t=>t.id===target.dataset.team),member=team.members.find(m=>m.id===target.dataset.member),params={requestId:crypto.randomUUID(),expectedRevision:state.revision,teamId:team.id,memberId:member.id,bindingRequestId:target.dataset.request,agent:memberPreferences.agent,model:memberPreferences.model,effort:memberPreferences.effort,summary:replacementDrafts.get(member.id)||'',evidenceRefs:[`previous-instance:${target.dataset.request}`,`role:${member.id}:${member.roleVersion}`]};
   busy=true;problem='';render();try{await call('requestReplacement',params);state=validatePersistentState((await call('storage.get',{})).value);message='Replacement decision saved.';}catch(error){problem=error.message;}finally{busy=false;render();}
  }
  else if (action === 'save-role') {
    const team = state.teams[selection.team];
    const fields = Object.fromEntries([...app.querySelectorAll('[data-role]')].map(node => [node.dataset.role, node.value]));
    if (await submit('updateRole', { teamId: team.id, memberId: selection.member, ...fields })) { message = 'Role saved as a new version.'; render(); }
  }
  else if(['wake-member','check-wake','decide-wake','handoff-wake','replace-wake'].includes(action)){
    busy=true;problem='';render();
    try{
      let op,params;const id=target.dataset.request,row=(state.recoveries||[]).find(r=>r.requestId===id);
      if(action==='wake-member'){
        if(!wakeRequests.has(id))wakeRequests.set(id,crypto.randomUUID());
        op='wakeMember';params={teamId:target.dataset.team,memberId:target.dataset.member,bindingRequestId:id,requestId:wakeRequests.get(id)};
      }else if(action==='decide-wake'){op='decideWake';params={requestId:id,version:row.version,decision:'replace',summary:wakeDrafts.get(id)||'',evidenceRefs:[`previous-instance:${row.oldRequestId}`,`native-death:${row.proof?.death?.ownerFence??row.proof?.stop?.stopRequestId??'exact-worker'}`]};}
      else if(action==='replace-wake'){op='replaceMember';params={requestId:id,teamId:target.dataset.team};}
      else {op=action==='check-wake'?'checkWake':'checkHandoff';params={requestId:id};}
      const result=await call(op,params);message=`Recovery: ${result.value?.state??result.state??result.status??'saved'}. ${result.value?.detail??result.detail??''}`;state=validatePersistentState((await call('storage.get',{})).value);view='roster';
    }catch(error){problem=error.message;}finally{busy=false;render();}
  }
  else if (action === 'admission' || action === 'stop-member' || action === 'check-stop' || action === 'recover-stop') {
    busy=true;problem='';render();
    try {
      let result;
      if(action==='admission')result=await call('setAdmission',{requestId:crypto.randomUUID(),expectedRevision:state.revision,teamId:target.dataset.team,...(target.dataset.member?{memberId:target.dataset.member}:{}),paused:target.dataset.paused==='true'});
      else if(action==='recover-stop')result=await call('recoverStop',{requestId:crypto.randomUUID(),stopRequestId:target.dataset.request,version:Number(target.dataset.version)});
      else if(action==='check-stop')result=await call('checkStop',{requestId:target.dataset.request});
      else result=await call('stopMember',{requestId:crypto.randomUUID(),teamId:target.dataset.team,memberId:target.dataset.member,...(target.dataset.attempt?{workId:target.dataset.work,attemptId:target.dataset.attempt}:{operationRequestId:target.dataset.operation})});
      state=validatePersistentState(result.value);message=action==='admission'?'Assignment admission saved. Existing sessions retain their execution state.':'Native stop evidence updated.';
    }catch(error){problem=error.message;}finally{busy=false;render();}
  }
  else if (action === 'open-member' || action === 'recover-launch') {
    busy = true; render();
    try {
      const team = state.teams.find(row => row.id === target.dataset.team);
      const params = { teamId: team.id, memberId: target.dataset.member, requestId: target.dataset.request };
      if (action === 'recover-launch') params.configVersion = team.launch.configVersion;
      const result = await call(action === 'open-member' ? 'openMember' : 'recoverLaunch', params);
      message = action === 'open-member' ? 'Opened the verified native session.' : `Saved launch: ${result.status}.`;
    } catch (error) { problem = error.message; }
    finally { try { state = validatePersistentState((await call('storage.get', {})).value); } catch (error) { problem = error.message; } busy = false; render(); }
  }
  else if(action==='reconnect-work'){
    busy=true;problem='';message='';render();
    try{
      const work=state.works.find(w=>w.id===target.dataset.work);
      if(!reconnectRequests.has(work.id))reconnectRequests.set(work.id,mutation({workId:work.id,expectedWorkVersion:work.version}));
      const result=await call('reconnectWork',reconnectRequests.get(work.id));state=validatePersistentState(result.value);reconnectRequests.delete(work.id);message='Existing sessions reconnected. Continue the original objective when ready.';
    }catch(error){problem=error.message;if(/changed|reload/i.test(error.message))reconnectRequests.delete(target.dataset.work);try{state=validatePersistentState((await call('storage.get',{})).value);}catch{}}
    finally{busy=false;render();}
  }
  else if (action === 'launch-existing') {
    try { await launchTeam(Number(target.dataset.team)); }
    catch (error) { problem = error.message; canRetry = false; render(); }
  }
});
app.addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.form) { form[target.dataset.form] = target.value; updatePreview(); }
});
app.addEventListener('change', async event => {
  const target = event.target;
  if(target.dataset.cleanupWork){if(target.checked)cleanupSelection.add(target.dataset.cleanupWork);else cleanupSelection.delete(target.dataset.cleanupWork);cleanupPreview=null;cleanupRequest=null;render();}
  else if (target.hasAttribute('data-preference-target')) { preferenceTarget = target.value; render(); }
  else if (target.dataset.preference) { memberPreferences[target.dataset.preference] = target.value.trim() || 'default'; if (target.dataset.preference === 'model' && memberPreferences.model === 'default') memberPreferences.effort = 'default'; render(); }
  else if (target.dataset.agent !== undefined) { const i = Number(target.dataset.agent); form.agents[i] = target.value; render(); }
  else if (target.dataset.model !== undefined) {
    const i = Number(target.dataset.model);
    form.models[i] = target.value.trim() || 'default';
    if (form.models[i] === 'default') form.efforts[i] = 'default';
    render();
  } else if (target.dataset.effort !== undefined) { form.efforts[Number(target.dataset.effort)] = target.value; updatePreview(); }
  else if (target.dataset.setting) { await submit('updateSettings', { settings: { ...state.settings, [target.dataset.setting]: target.type === 'checkbox' ? target.checked : target.value } }); }
});
async function refreshRoster(){
 if(rosterRefreshRunning||busy||!connectionReady||!storageAvailable||view!=='roster'||document.visibilityState==='hidden')return;
 rosterRefreshRunning=true;
 try{const result=await call('rosterStatus',{});if(busy||view!=='roster')return;if(result.value.revision>=state.revision)state=validatePersistentState(result.value);telemetry=result.telemetry;const previousWorkspace=workspace?.workspaceKey;await refreshTargets();if(previousWorkspace!==workspace?.workspaceKey)selection=null;if(!selection){message='';render();}else for(const team of state.teams)for(const member of team.members){for(const [field,html] of [['status',statusCell(member)],['context',contextCell(member)],['model',preferenceCell(member,'model')],['effort',preferenceCell(member,'effort')]])for(const node of app.querySelectorAll(`[data-live-${field}="${member.id}"]`))node.innerHTML=html;for(const node of app.querySelectorAll(`.org-node[data-member="${member.id}"]`)){node.dataset.state=memberObservation(member).state;node.title=member.name+' · '+(STATUS_LABELS[memberObservation(member).state]||'Unknown');}}}
 catch(error){connectionReady=false;storageAvailable=false;problem=error.message;render();}
 finally{rosterRefreshRunning=false;}
}
setInterval(()=>void refreshRoster(),5000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshRoster();});
render();
void load();

app.addEventListener('input',event=>{if(event.target.dataset.replacementSummary)replacementDrafts.set(event.target.dataset.replacementSummary,event.target.value);if(event.target.dataset.wakeSummary)wakeDrafts.set(event.target.dataset.wakeSummary,event.target.value);});
