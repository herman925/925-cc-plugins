import { preferenceIssue } from './capabilities.mjs';
import { PRESETS, DEFAULT_FORM, GLYPHS, planTeam, emptyTeamState, validatePersistentState } from './team.mjs';
import { createBridge } from './bridge.mjs';
import { createWorkerBridge } from './worker-bridge.mjs';
import { initialMembers } from './launch.mjs';
import { parseTeamTemplate, MAX_TEMPLATE_BYTES } from './templates.mjs';

const app = document.getElementById('app');
const rawCall = createBridge(window.parent);
const worker = createWorkerBridge(rawCall);
const call = (action, params) => worker.call(action, params);
let connection = 'Panel loaded · worker activation unknown · compatibility layer checking…';
let connectionReady = false;
let state = emptyTeamState();
let form = structuredClone(DEFAULT_FORM);
let view = 'roster';
let selection = null;
let busy = true;
let loaded = false;
let storageAvailable = false;
let message = '';
let problem = '';
let canRetry = false;
let workspace = null;
let targetError = '';
let confirmedWorkspace = null;
const capabilityViews = new Map();
let memberPreferences = null;
let preferenceTarget = 'member';
let templateText = '';
let templatePreview = null;
let templateRequest = null;
const wakeDrafts = new Map(), wakeRequests = new Map();
const answerDrafts = new Map(), answerRequests = new Map();
const objectives = new Map(), workRequests = new Map();
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
function empty() {
  return `<section class="welcome"><h1>No team yet</h1><p>Build a team that reports up a clear chain.</p><pre class="sketch" aria-label="A head reporting to you, with three workers">       <span class="head">●</span>          Head
  ┌────┼────┐     plans, delegates and reviews
  ○    ○    ○     Workers execute and report back</pre><h2>Quick start</h2>${presets()}${button('Build a custom team', 'new', '', 'secondary')}</section>`;
}
function tree(members, parent = null, clickable = false, teamIndex = 0, compact = false) {
  const children = members.filter(member => member.boss === parent);
  return `<ul class="org-tree ${parent === null ? 'root' : ''}">${children.map(member => {
    const shortName = compact ? member.role === 'ceo' ? 'CEO' : member.role === 'head' ? member.team : member.name.replace(/^.*Worker-/, 'W').replace(/^Lead-/, 'L') : member.name;
    return `<li><${clickable ? 'button type="button"' : 'span'} class="org-node ${escape(member.role)}" ${clickable ? `data-action="member" data-team="${teamIndex}" data-member="${escape(member.id)}" aria-label="${escape(member.name)}" title="${escape(member.name)}"` : ''}><span class="glyph" aria-hidden="true">${GLYPHS[member.role]}</span><span>${escape(shortName)}</span><small>${label(member.role)}</small></${clickable ? 'button' : 'span'}>${members.some(child => child.boss === member.id) ? tree(members, member.id, clickable, teamIndex, compact) : ''}</li>`;
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
    ${projectControls()}<label class="field">Preparation mode<select data-form="launchMode"><option value="on-demand" ${form.launchMode!=='all'?'selected':''}>On demand</option><option value="all" ${form.launchMode==='all'?'selected':''}>All at start</option></select></label>${launchControls()}<div class="actions">${button('Save team', 'create', busy || !loaded || !storageAvailable || !confirmedWorkspace ? 'disabled' : '', 'primary')}${button('Cancel', 'roster', '', 'secondary')}</div>`;
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
function taskCards(team, tasks, showMember = true) {
  const statuses = { queued: 'Queued · awaiting admission', admitted: 'Admitted · awaiting member launch', awaiting_start: 'Awaiting native start', running: 'Native assignment observed', unknown: 'Outcome unknown', pending_acceptance: 'Pending supervisor acceptance', accepted: 'Accepted by direct supervisor', rework: 'Rework requested', rejected: 'Rejected' };
  return tasks.map(task => {
    const member = team.members.find(row => row.id === task.memberId);
    const supervisor = team.members.find(row => row.id === task.supervisorMemberId);
    return `<article class="task-card" aria-label="Task ${escape(task.taskKey)}"><h4>${escape(task.taskKey)}</h4><p>Member: ${escape(task.memberName || member?.name || task.memberId)} · Supervisor: ${escape(supervisor?.name || task.supervisorMemberId)}</p><p class="task-state">${escape(statuses[task.status] || 'Outcome unknown')}</p><p class="task-text">${escape(task.instruction || '')}</p><p>Native execution: ${escape(task.outcome || 'unconfirmed')}</p>${task.result ? `<p class="task-text">${escape(task.result)}</p>` : ''}${recoveryEvidence(task.recovery)}${task.detail ? `<p>${escape(task.detail)}</p>` : ''}${task.status === 'pending_acceptance' ? '<p>Supervisor review evidence missing: awaiting a verified decision from the direct supervisor.</p>' : ''}${task.review ? `<p>Review: ${escape(task.review.decision)} · Reviewer: ${escape(supervisor?.name || task.review.reviewerMemberId)}</p><p class="task-text">${escape(task.review.summary)}</p><p>Recorded: ${escape(task.review.recordedAt)}</p><p>Validation evidence: ${escape(task.review.evidenceRefs.join(' · '))}</p>` : ''}${task.writeScope ? `<p>Declared writes: ${escape(task.writeScope.map(row=>row.path+' ('+row.kind+')').join(', ') || 'None')}</p>` : ''}${task.dependencies?.length ? `<p>Depends on accepted tasks: ${escape(task.dependencies.join(', '))}</p>` : ''}${task.previousAttemptId ? `<p>Rework of attempt: ${escape(task.previousAttemptId)}</p>` : ''}${task.status === 'unknown' ? '<p>Check work evidence to reconcile this attempt. Its execution outcome is unconfirmed.</p>' : ''}<small>Configuration ${escape(task.configVersion)} · Role ${escape(task.roleVersion)}</small><details><summary>Task evidence</summary><dl><dt>Task</dt><dd>${escape(task.nativeTaskId)}</dd><dt>Attempt</dt><dd>${escape(task.attemptId)}</dd><dt>Dispatch</dt><dd>${escape(task.dispatchId || 'Not bound')}</dd><dt>Evidence</dt><dd>${escape(task.evidenceId || 'Not observed')}</dd></dl></details>${showMember && member ? button('View member', 'member', `data-team="${state.teams.indexOf(team)}" data-member="${escape(member.id)}"`, 'small') : ''}</article>`;
  }).join('');
}
function memberTasks(team, member) {
  const tasks = (state.works || []).filter(work => work.teamId === team.id).flatMap(work => [...(work.tasks || []),...(work.queuedTasks || [])]).filter(task => task.memberId === member.id);
  return tasks.length ? `<section aria-label="Member tasks"><h3>Member tasks</h3>${taskCards(team, tasks, false)}</section>` : '';
}
function workTasks(team, work) {
  const protocol = work.dispatchProtocol;
  return `<section aria-label="Team tasks"><h3>Team tasks</h3>${work.messages?.length?`<details><summary>Verified team messages (${work.messages.length})</summary>${work.messages.map(m=>`<p>${escape(team.members.find(a=>a.id===m.fromMemberId)?.name||m.fromMemberId)} → ${escape(team.members.find(a=>a.id===m.toMemberId)?.name||m.toMemberId)}: ${escape(m.body)} · Native message saved · Processing ${escape(m.processing)}</p>`).join('')}</details>`:''}${work.collaborations?.length?`<details><summary>Supervisor collaboration directives (${work.collaborations.length})</summary>${work.collaborations.map(d=>`<p>${escape(team.members.find(a=>a.id===d.fromMemberId)?.name||d.fromMemberId)} → ${escape(team.members.find(a=>a.id===d.toMemberId)?.name||d.toMemberId)} · Reports to ${escape(team.members.find(a=>a.id===d.reportToMemberId)?.name||d.reportToMemberId)} · Processing ${escape(d.processing)}</p>`).join('')}</details>`:''}${protocol ? `<p>Supervisor dispatch protocol: ${escape(protocol.state)} · Generation ${escape(protocol.generation)}</p>${protocol.detail ? `<p>${escape(protocol.detail)}</p>` : ''}` : ''}${work.tasks?.length ? taskCards(team, work.tasks) : '<p>No admitted member tasks observed yet.</p>'}${work.queuedTasks?.length?'<h4>Queued tasks</h4>'+taskCards(team,work.queuedTasks):''}<p>Declared scope coordination is not filesystem isolation. Unknown results and pending acceptance keep their scopes reserved.</p></section>`;
}
function details() {
  if (!selection) return '';
  const team = state.teams[selection.team];
  const member = team?.members.find(row => row.id === selection.member);
  if (!member) return '';
  const boss = team.members.find(row => row.id === member.boss);
  const reports = team.members.filter(row => row.boss === member.id);
  return `<section class="inspector" aria-label="Member details"><div class="section-heading"><h2>${GLYPHS[member.role]} ${escape(member.name)}</h2>${button('Close details', 'close-details', '', 'small')}</div><dl><dt>Role</dt><dd>${label(member.role)}</dd><dt>Reports to</dt><dd>${escape(boss?.name || 'You')}</dd><dt>Direct reports</dt><dd>${reports.length}</dd><dt>Agent</dt><dd>${member.agent === 'claude' ? 'Claude Code' : 'Codex'}</dd><dt>Requested model</dt><dd>${escape(member.model)}</dd><dt>Requested effort</dt><dd>${escape(member.effort)}</dd><dt>Launch</dt><dd>${launchStatus(team, member)}</dd></dl><p>Role version ${member.roleVersion} · Configuration version ${team.configVersion}</p>${memberTasks(team, member)}<h3>Agent preferences</h3><p class="subtle">${member.preferenceOverride ? 'Individual override' : 'Inherits level default'} · Effective model: unknown · Effective effort: unknown · Context usage: unknown</p><label class="field">Preference applies to<select data-preference-target><option value="member" ${preferenceTarget === 'member' ? 'selected' : ''}>This member</option><option value="level" ${preferenceTarget === 'level' ? 'selected' : ''}>Level ${member.level} defaults</option></select></label><div class="table-scroll"><table class="models"><thead><tr><th>Agent</th><th>Requested model</th><th>Requested effort</th></tr></thead><tbody><tr>${preferenceControls('Member', memberPreferences || member, capabilityViews.get(team.scope.workspaceKey), 'member', true)}</tr></tbody></table></div>${capabilityNotice(team.scope)}${button('Refresh host capabilities', 'refresh-capabilities', '', 'small')}${button('Save preferences', 'save-preferences', !storageAvailable ? 'disabled' : '', 'primary small')}${button('Use level default', 'inherit-preferences', '', 'small')}<p class="subtle">Saved preferences apply to future launches. Role collaboration rules guide agents; they do not intercept provider tools.</p><label class="field">Role description<textarea data-role="brief" maxlength="1500">${escape(member.brief)}</textarea></label><label class="field">Work habits<textarea data-role="habits" maxlength="1500">${escape(member.habits)}</textarea></label><label class="field">Collaboration rules<textarea data-role="collaboration" maxlength="1500">${escape(member.collaboration)}</textarea></label>${button('Save role', 'save-role', !storageAvailable ? 'disabled' : '', 'primary small')}<p class="subtle">Changes apply at the next launch or handoff. Existing work keeps its saved role version.</p></section>`;
}
function workSection(team) {
  const work = state.works?.find(row => row.teamId === team.id);
  if (work) return `<section class="section" aria-label="TeamWork"><h3>Total objective</h3><p>${escape(work.objective)}</p><small>Configuration ${work.configVersion} · Role ${work.roleVersion} · ${escape(work.scope.displayName)} · ${escape(work.scope.executionHostId)}</small><p>Input: ${escape(work.input.state)}${work.input.dispatchState ? ` (journal: ${escape(work.input.dispatchState)})` : ''} · Processing: ${escape(work.processing.state)} · Run: ${escape(work.run.state)}</p>${work.run.id ? `<p>Native Run: ${escape(work.run.id)} · Consumer generation ${work.run.consumerGeneration}</p>` : ''}<p class="subtle">${escape(work.run.detail || 'Waiting for the real supervisor to create its Run.')}</p>${work.error ? `<p role="alert">${escape(work.error)}</p>` : ''}${button('Check work evidence', 'check-work', `data-work="${work.id}"`, 'small')}${work.input.state === 'not_sent' ? button('Retry unsent objective', 'retry-objective', `data-work="${work.id}"`, 'small') : ''}${work.snapshot ? `<p>${work.snapshot.tasks.length} native task(s) in the ${work.snapshot.stale ? 'last observed' : 'confirmed'} Run. Execution status does not imply user acceptance.</p>` : ''}${workTasks(team, work)}</section>`;
  const head = team.members.find(member => member.boss === null);
  if (team.launch?.members?.[head.id]?.status !== 'created') return '';
  return `<section class="section"><h3>Start team work</h3><label class="field">Total objective<textarea data-objective="${team.id}" rows="3" maxlength="8000">${escape(objectives.get(team.id) || '')}</textarea></label>${button('Submit total objective', 'submit-work', `data-team="${team.id}" ${!storageAvailable ? 'disabled' : ''}`, 'primary small')}<p class="subtle">Uses the prepared highest supervisor and this team's saved project. One total objective may remain in progress at a time.</p></section>`;
}
function roster() {
  if (!state.teams.length) return empty();
  const charts = state.settings.chart ? `<section class="organisation"><h2>Organisation</h2>${state.teams.map((team, i) => `<div class="chart-heading">@${escape(team.name)}</div><div class="tree-scroll org-chart">${tree(team.members, null, true, i, true)}</div>`).join('')}</section>` : '';
  return `<div class="section-heading"><h1>Team roster</h1>${button('+ New team', 'new', '', 'primary small')}</div>${charts}<div class="team-cards ${state.settings.layout === 'columns' ? 'columns' : ''}">${state.teams.map((team, i) => `<section class="team-card"><header><h2>@${escape(team.name)}</h2><small>${team.members.length} members</small></header><p class="bound-project">${escape(team.scope.displayName)} · ${escape(team.scope.kind)} · ${escape(team.scope.executionHostId)}</p>${team.purpose ? `<p class="purpose">${escape(team.purpose)}</p>` : ''}<div class="table-scroll"><table class="roster"><thead><tr><th>Name</th><th>Role</th><th>CLI</th><th>Model</th><th>Effort</th><th>Launch</th></tr></thead><tbody>${team.members.map(member => `<tr><td>${button(`${GLYPHS[member.role]} ${escape(member.name)}`, 'member', `data-team="${i}" data-member="${escape(member.id)}"`, 'name-button')}</td><td>${label(member.role)}</td><td>${member.agent === 'claude' ? 'Claude' : 'Codex'}</td><td>${escape(member.model)}</td><td>${escape(member.effort)}</td><td><span class="status-dot" aria-hidden="true"></span>${launchStatus(team, member)}</td></tr>`).join('')}</tbody></table></div><div class="actions">${button('Export template', 'export-template', `data-team="${i}" ${!storageAvailable ? 'disabled' : ''}`, 'secondary small')}${button('Copy team', 'copy-team', `data-team="${i}" ${!storageAvailable ? 'disabled' : ''}`, 'secondary small')}</div>${!team.launch ? button('Launch this team', 'launch-existing', `data-team="${i}" ${!storageAvailable ? 'disabled' : ''}`, 'primary small') : launchReceipt(team)+(initialMembers(team).some(member=>!team.launch.members?.[member.id])?button('Continue roster preparation','launch-existing',`data-team="${i}"`, 'small'):'')}${workSection(team)}</section>`).join('')}</div>${state.teams.some(team => !team.launch) ? launchControls() : ''}${details()}`;
}
function templatesView() {
  const preview = templatePreview?.template.team;
  return `<h1>Team templates</h1><p>Exchange configuration and roles as JSON. Imported teams have new identities and no sessions or work history. Legacy mod/prototype formats are not supported.</p><label class="field">Template JSON<textarea data-template rows="10" spellcheck="false" ${templatePreview ? 'readonly' : ''}>${escape(templateText)}</textarea></label><div class="actions">${button('Select JSON to copy', 'select-template', !templateText ? 'disabled' : '', 'secondary small')}${button(templatePreview ? 'Edit template JSON' : 'Preview template', templatePreview ? 'edit-template' : 'preview-template', !loaded || !storageAvailable ? 'disabled' : '', 'primary small')}</div><label class="field">Open template file<input type="file" data-template-file accept="application/json,.json"></label>
  ${preview ? `<section class="section" aria-label="Template preview"><h2>Preview @${escape(preview.name)}</h2><p>${preview.members.length} members · ${escape(preview.structure)}</p><p>${escape(preview.purpose)}</p><div class="tree-scroll">${tree(preview.members.map(member => ({ ...member, id: member.ref })))}</div>${preview.members.map(member => `<details><summary>${escape(member.name)} · ${escape(member.agent)} · ${escape(member.model)} · ${escape(member.effort)} · ${member.preferenceOverride ? 'Member override' : 'Level preference'}</summary><p>${escape(member.brief)}</p><p>Work habits: ${escape(member.habits || 'None specified')}</p><p>Collaboration rules: ${escape(member.collaboration || 'None specified')}</p></details>`).join('')}</section>${projectControls()}<div class="actions">${button('Import as new team', 'import-template', !confirmedWorkspace || !loaded || !storageAvailable ? 'disabled' : '', 'primary')}</div>` : ''}`;
}
function attentionCount() { return (state.recoveries||[]).filter(r=>!['bound','resumed'].includes(r.state)).length+(state.works || []).reduce((count,w)=>count+(w.questions||[]).filter(q=>q.status==='pending').length,0); }
function recoveryCards(){
 return (state.recoveries||[]).map(row=>{
  const team=state.teams.find(t=>t.id===row.teamId),member=team?.members.find(m=>m.id===row.memberId),root=!member?.boss;
  return `<article class="task-card" aria-label="Member recovery"><h3>${escape(member?.name||row.memberId)} · Recovery</h3><p>State: ${escape(row.state)}</p><p>${escape(row.detail||'The old execution was confirmed stopped; native continuation is checked first.')}</p><p>Closing a conversation keeps this member on the roster. Assignment pause and removal are separate actions.</p><small>Previous instance ${escape(row.oldInstanceGeneration)} · Original request ${escape(row.oldRequestId)}</small>${row.handoff?`<p>Checked handoff: ${escape(row.handoff.summary)}</p><p>Reviewer: ${escape(row.handoff.reviewer)}</p>`:''}${row.state==='needs_decision'&&root?`<label class="field">Checked handoff summary<textarea data-wake-summary="${escape(row.requestId)}" maxlength="4000">${escape(wakeDrafts.get(row.requestId)||'')}</textarea></label>${button('Approve fresh supervisor', 'decide-wake', `data-request="${escape(row.requestId)}"`, 'primary small')}`:''}${row.state==='needs_decision'&&!root?`<p>Awaiting the actual direct manager’s checked handoff.</p>${button('Check manager handoff','handoff-wake',`data-request="${escape(row.requestId)}"`,'small')}`:''}${row.state==='approved'?button('Create approved replacement','replace-wake',`data-request="${escape(row.requestId)}" data-team="${escape(row.teamId)}"`,'primary small'):''}${button('Check recovery evidence','check-wake',`data-request="${escape(row.requestId)}"`,'small')}</article>`;
 }).join('');
}
function attentionView() {
 return `<section aria-label="Needs your attention"><h1>Needs your attention</h1>${recoveryCards()}<p>Answers go to the saved highest supervisor. Independent tasks continue while a decision is pending.</p>${(state.works||[]).map(work=>{
 const team=state.teams.find(t=>t.id===work.teamId),head=team?.members.find(m=>m.id===work.supervisorMemberId);
 const waiting=(work.failureStreaks||[]).filter(s=>s.escalationNeeded&&!(work.questions||[]).some(q=>s.evidence.slice(-2).every(e=>q.evidence.includes(e.evidenceId))));
 return `<h2>${escape(team?.name||'Team')} · ${escape(work.objective)}</h2>${button('Check work evidence','check-work',`data-work="${escape(work.id)}"`,'small')}${waiting.map(s=>`<article class="task-card"><h3>${escape(s.taskKey)}</h3><p>Two proven execution failures. Waiting for supervisor summary and options.</p><details><summary>Failure evidence</summary>${s.evidence.map(e=>`<p>${escape(e.evidenceId)} · ${escape(e.attemptId)}</p>`).join('')}</details></article>`).join('')}${(work.questions||[]).map(q=>{
 const key=work.id+':'+q.id,supplement=q.answers.length>0;
 return `<article class="task-card" aria-label="Question ${escape(q.id)}"><h3>${escape(q.summary)}</h3><p>From ${escape(head?.name||q.fromMemberId)} · ${escape(q.status)}</p>${q.options.length?`<p>Options: ${q.options.map(escape).join(' · ')}</p>`:''}<p>Blocks: ${q.blockingTaskKeys.map(escape).join(', ')||'No independent tasks'}</p>${q.answers.map(a=>`<div class="notice"><p>${escape(a.body)}</p><small>Native input: ${escape(a.state)} · Manager processing: ${escape(a.processed)}</small>${a.nativeAnswer?`<p>Native question answered: ${escape(a.nativeAnswer.messageId)}</p>`:''}${a.detail?`<p>${escape(a.detail)}</p>`:''}</div>`).join('')}${q.status!=='closed'?`<label class="field">${supplement?'Your supplement':'Your answer'}<textarea data-answer="${escape(key)}" rows="3" maxlength="8000">${escape(answerDrafts.get(key)||'')}</textarea></label>${button(supplement?'Send supplement':'Send answer','answer-question',`data-work="${escape(work.id)}" data-question="${escape(q.id)}"`,'primary small')}`:'<p>Original requester is no longer active. Ask the supervisor for a new decision.</p>'}<details><summary>Question evidence</summary><p>Question ${escape(q.id)} · Work ${escape(work.id)} · Run ${escape(q.runId)} · Generation ${escape(q.generation)}</p>${q.origin?`<p>Origin reference (${q.nativeQuestion?'verified native question':'awaiting native verification'}): attempt ${escape(q.origin.attemptId)} · Dispatch ${escape(q.origin.dispatchId)} · Native question ${escape(q.origin.messageId)}</p>`:''}${q.nativeQuestion?`<p>Native question: ${escape(q.nativeQuestion.status)} · Original requester resumed: ${escape(q.nativeQuestion.requesterResumed)}</p>`:''}<p>Notification: ${escape(q.notification.state)}</p></details></article>`;
 }).join('')}`;
 }).join('')}${!(state.recoveries||[]).length&&!(state.works||[]).some(w=>w.questions?.length||w.failureStreaks?.some(s=>s.escalationNeeded))?'<p>No pending decisions.</p>':''}</section>`;
}
function settingsView() {
  return `<h1>Settings</h1><section class="section"><h2>Roster display</h2><label class="check"><input type="checkbox" data-setting="chart" ${state.settings.chart ? 'checked' : ''} ${busy || !loaded ? 'disabled' : ''}> Show organisation tree</label><label class="field">Team cards<select data-setting="layout" ${busy || !loaded ? 'disabled' : ''}><option value="stacked" ${state.settings.layout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="columns" ${state.settings.layout === 'columns' ? 'selected' : ''}>Side by side when there is room</option></select></label></section><section class="section"><h2>Team launching</h2><p>Launch calls go to the bundled worker on your PC through the runtime adapter. Orca opens agent tabs on each team's saved project and execution host and passes each role brief as its startup prompt. The panel records actual created-tab receipts; it does not infer readiness or provider session IDs.</p><p>Default model and effort inherit agent configuration. On demand prepares managers; all at start prepares the saved roster. Tasks share the selected directory. Scope coordination does not isolate undeclared filesystem writes.</p></section>`;
}
function render() {
  app.setAttribute('aria-busy', String(busy));
  app.innerHTML = `<header class="app-header"><div class="brand"><span aria-hidden="true">◆</span> Team Orchestrator<small>v${escape(__PLUGIN_DISPLAY_VERSION__)}</small></div><nav aria-label="Team Orchestrator">${[['roster', 'Roster'], ['new', 'New team'], ['templates', 'Templates'], ['attention', `Needs your attention (${attentionCount()})`], ['settings', 'Settings']].map(([id, text]) => button(text, id, `aria-current="${view === id ? 'page' : 'false'}"`, view === id ? 'active' : '')).join('')}</nav></header><main>
    ${state.teams.length ? `<div class="notice bound-project">Bound projects: ${state.teams.map(team => `${escape(team.name)} · ${escape(team.scope.displayName)} · ${escape(team.scope.executionHostId)}`).join(' | ')}</div>` : ''}
    <div class="notice" role="status">${escape(connection)} ${button('Test connection', 'test-connection', busy ? 'disabled' : '', 'small')}</div>
    ${problem ? `<div class="notice error" role="alert">${escape(problem)} ${canRetry ? button('Retry storage', 'retry', busy ? 'disabled' : '', 'small') : ''}</div>` : ''}
    ${loaded && !storageAvailable ? `<div class="notice" role="status">Session-only mode. The local executor has not loaded persistent storage. Launching stays disabled until connection is verified.</div>` : ''}
    ${message ? `<p class="notice success" role="status">${escape(message)}</p>` : ''}
    ${busy && !loaded ? '<p class="loading">Reading saved teams…</p>' : view === 'new' ? formView() : view === 'templates' ? templatesView() : view === 'settings' ? settingsView() : view === 'attention' ? attentionView() : roster()}
    </main><footer>${storageAvailable ? 'Saved in Orca' : loaded ? 'Session only' : 'Connecting to Orca'}<span>Orca · Agent teams</span></footer>`;
  if (busy) for (const control of app.querySelectorAll('button,input,select,textarea')) control.disabled = true;
}
function updatePreview() { const node = document.getElementById('preview'); if (node) node.innerHTML = preview(); }
async function load(retry = false) {
  busy = true; problem = ''; canRetry = false; render();
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
  } finally { busy = false; await refreshTargets(); render(); }
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
  } catch (error) { problem = `Could not save: ${error.message}`; if (/Another panel changed/.test(error.message)) templateRequest = null; canRetry = true; return false; }
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
      if(position){message=`Preparing ${position+1}/${members.length}: ${member.name}. Waiting for the native host request window.`;render();await new Promise(resolve=>setTimeout(resolve,10100));}
      try {
        const receipt=await call('launchSupervisor',{teamId:team.id,memberId:member.id,requestId:`${team.id}-${member.id}`,configVersion:team.configVersion});
        if(receipt.status==='created')created++;else failures.push(member.name);
      }catch(error){failures.push(`${member.name}: ${error.message}`);}
    }
    message=`${created}/${members.length} requested member sessions created. Input acceptance and provider readiness remain separate.${failures.length?' Needs attention: '+failures.join('; ')+'. Independent members were still prepared.':''}`;
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
  if (['roster', 'new', 'templates', 'settings', 'attention'].includes(action)) { view = action; message = ''; render(); }
  else if (action === 'preset') { Object.assign(form, PRESETS[Number(target.dataset.index)].form); view = 'new'; message = ''; render(); }
  else if (action === 'pick') {
    const field = target.dataset.field;
    form[field] = ['levels', 'fan'].includes(field) ? Number(target.dataset.value) : target.dataset.value;
    if (field === 'structure') { form.levels = form.structure === 'organisation' ? 3 : 2; if (!form.groups) form.groups = 'Team 1, Team 2'; }
    render();
  } else if (action === 'create') {
    try {
      if (!confirmedWorkspace) throw new Error('Confirm the project and execution host first.');
      if (await submit('createTeam', { form, selectionToken: confirmedWorkspace.selectionToken })) { view = 'roster'; selection = null; message = 'Team saved. You can launch it later; no total objective has been submitted.'; render(); }
    } catch (error) { busy = false; message = ''; problem = error.message; canRetry = false; render(); }
  } else if (action === 'member') { selection = { team: Number(target.dataset.team), member: target.dataset.member }; const team = state.teams[selection.team]; memberPreferences = { ...team.members.find(row => row.id === selection.member) }; preferenceTarget = 'member'; await refreshCapabilities({ teamId: team.id }, team.scope); render(); document.querySelector('.inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  else if (action === 'close-details') { selection = null; render(); }
  else if (action === 'retry' || action === 'test-connection') { connectionReady = false; await load(action === 'test-connection'); }
  else if (action === 'refresh-tabs') { confirmedWorkspace = null; templateRequest = null; await refreshTargets(); render(); }
  else if (action === 'confirm-project') { confirmedWorkspace = workspace; templateRequest = null; await refreshCapabilities({ selectionToken: workspace.selectionToken }, workspace); render(); }
  else if (action === 'refresh-capabilities') {
    if (view === 'new') { const scope = confirmedWorkspace || workspace; await refreshCapabilities({ selectionToken: scope.selectionToken }, scope, true); }
    else if (selection) { const team = state.teams[selection.team]; await refreshCapabilities({ teamId: team.id }, team.scope, true); }
  }
  else if (action === 'save-preferences' || action === 'inherit-preferences') {
    const team = state.teams[selection.team], member = team.members.find(row => row.id === selection.member);
    const params = { teamId: team.id, ...(action === 'inherit-preferences' ? { memberId: member.id, inherit: true } : { ...(preferenceTarget === 'level' ? { level: member.level } : { memberId: member.id }), agent: memberPreferences.agent, model: memberPreferences.model, effort: memberPreferences.effort }) };
    if (await submit('updateAgentPreferences', params)) { memberPreferences = { ...state.teams[selection.team].members.find(row => row.id === member.id) }; message = 'Requested preferences saved. Effective model remains unknown until Orca reports it.'; render(); }
  }
  else if (action === 'save-role') {
    const team = state.teams[selection.team];
    const fields = Object.fromEntries([...app.querySelectorAll('[data-role]')].map(node => [node.dataset.role, node.value]));
    if (await submit('updateRole', { teamId: team.id, memberId: selection.member, ...fields })) { message = 'Role saved as a new version.'; render(); }
  }
  else if (action === 'export-template' || action === 'copy-team') {
    busy = true; problem = ''; message = ''; render();
    try {
      const result = await call('exportTemplate', { teamId: state.teams[Number(target.dataset.team)].id });
      templateText = JSON.stringify(result.template, null, 2); templatePreview = null; templateRequest = null; confirmedWorkspace = null;
      if (action === 'copy-team') templatePreview = await call('previewTemplate', { template: result.template });
      view = 'templates'; await refreshTargets();
      message = action === 'copy-team' ? 'Review this independent copy, then confirm its target project.' : 'Template ready. Select the JSON and copy it with your usual keyboard shortcut to save or share it.';
    } catch (error) { problem = error.message; }
    finally { busy = false; render(); }
  }
  else if (action === 'select-template') { const field = app.querySelector('[data-template]'); field?.focus(); field?.select(); }
  else if (action === 'edit-template') { templatePreview = null; templateRequest = null; confirmedWorkspace = null; render(); }
  else if (action === 'preview-template') {
    busy = true; problem = ''; message = ''; render();
    try {
      templatePreview = await call('previewTemplate', { template: parseTeamTemplate(templateText) });
      templateRequest = null; confirmedWorkspace = null; await refreshTargets();
    } catch (error) { templatePreview = null; problem = error.message; }
    finally { busy = false; render(); }
  }
  else if (action === 'import-template') {
    if (!templatePreview || !confirmedWorkspace) return;
    templateRequest ??= mutation({ template: templatePreview.template, previewToken: templatePreview.previewToken, selectionToken: confirmedWorkspace.selectionToken });
    if (await submit('importTemplate', {}, templateRequest)) {
      templatePreview = null; templateRequest = null; templateText = ''; view = 'roster'; selection = null;
      message = 'Imported as an independent team. No members were launched and no work history was copied.'; render();
    }
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
      const result=await call(op,params);message=`Recovery: ${result.value?.state??result.state??result.status??'saved'}. ${result.value?.detail??result.detail??''}`;state=validatePersistentState((await call('storage.get',{})).value);view='attention';
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
  else if (action === 'submit-work' || action === 'check-work' || action === 'retry-objective') {
    busy = true; problem = ''; message = ''; render();
    try {
      let result;
      if (action === 'submit-work') {
        const teamId = target.dataset.team;
        if (!workRequests.has(teamId)) workRequests.set(teamId, mutation({ teamId, objective: objectives.get(teamId) || '' }));
        result = await call('submitWork', workRequests.get(teamId));
      } else result = await call(action === 'check-work' ? 'checkWork' : 'retryObjective', { workId: target.dataset.work });
      state = validatePersistentState(result.value);
      message = 'Saved work evidence updated. Native input acceptance, processing and Run binding are separate facts.';
    } catch (error) { problem = error.message; if (/Another panel changed/.test(error.message)) workRequests.delete(target.dataset.team); canRetry = true; }
    finally { busy = false; render(); }
  }
  else if (action === 'answer-question') {
    const work=state.works.find(w=>w.id===target.dataset.work),q=work.questions.find(q=>q.id===target.dataset.question),key=work.id+':'+q.id;
    if(!answerRequests.has(key))answerRequests.set(key,{workId:work.id,questionId:q.id,questionRevision:q.revision,answerId:crypto.randomUUID(),body:answerDrafts.get(key)||'',supplement:q.answers.length>0});
    busy=true;problem='';render();
    try{const result=await call('answerQuestion',answerRequests.get(key));state=validatePersistentState(result.value);answerRequests.delete(key);answerDrafts.delete(key);message='Answer saved. Native input and manager processing are shown separately.';}catch(error){problem=error.message;}
    finally{busy=false;render();}
  }
  else if (action === 'launch-existing') {
    try { await launchTeam(Number(target.dataset.team)); }
    catch (error) { problem = error.message; canRetry = false; render(); }
  }
});
app.addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.answer) { answerDrafts.set(target.dataset.answer,target.value); answerRequests.delete(target.dataset.answer); }
  else if (target.dataset.objective) { objectives.set(target.dataset.objective, target.value); workRequests.delete(target.dataset.objective); }
  else if (target.hasAttribute('data-template')) { templateText = target.value; }
  else if (target.dataset.form) { form[target.dataset.form] = target.value; updatePreview(); }
});
app.addEventListener('change', async event => {
  const target = event.target;
  if (target.hasAttribute('data-template-file')) {
    const file = target.files?.[0]; if (!file) return;
    templatePreview = null; templateRequest = null; confirmedWorkspace = null; problem = ''; message = '';
    try {
      if (file.size > MAX_TEMPLATE_BYTES) throw new Error('Template file exceeds the 1 MiB exchange limit.');
      templateText = await file.text();
    } catch (error) { problem = error.message; }
    render();
  }
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
render();
void load();

app.addEventListener('input',event=>{if(event.target.dataset.wakeSummary)wakeDrafts.set(event.target.dataset.wakeSummary,event.target.value);});
