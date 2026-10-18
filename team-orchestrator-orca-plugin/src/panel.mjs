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
let form = structuredClone(DEFAULT_FORM);
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
const objectives = new Map(), workRequests = new Map(), goalDrafts=new Map(), goalRequests=new Map(), decisionRequests=new Map(), reworkDrafts=new Map();
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
    return `<article class="task-card" aria-label="Task ${escape(task.taskKey)}"><h4>${escape(task.taskKey)}</h4><p>Member: ${escape(task.memberName || member?.name || task.memberId)} · Supervisor: ${escape(supervisor?.name || task.supervisorMemberId)}</p><p class="task-state">${escape(statuses[task.status] || 'Outcome unknown')}</p><p class="task-text">${escape(task.instruction || '')}</p><p>Native execution: ${escape(task.outcome || 'unconfirmed')}</p>${task.result ? `<p class="task-text">${escape(task.result)}</p>` : ''}${recoveryEvidence(task.recovery)}${task.detail ? `<p>${escape(task.detail)}</p>` : ''}${task.status === 'pending_acceptance' ? '<p>Supervisor review evidence missing: awaiting a verified decision from the direct supervisor.</p>' : ''}${task.review ? `<p>Review: ${escape(task.review.decision)} · Reviewer: ${escape(supervisor?.name || task.review.reviewerMemberId)}</p><p class="task-text">${escape(task.review.summary)}</p><p>Recorded: ${escape(task.review.recordedAt)}</p><p>Validation evidence: ${escape(task.review.evidenceRefs.join(' · '))}</p>` : ''}${task.writeScope ? `<p>Declared writes: ${escape(task.writeScope.map(row=>row.path+' ('+row.kind+')').join(', ') || 'None')}</p>` : ''}${task.dependencies?.length ? `<p>Depends on accepted tasks: ${escape(task.dependencies.join(', '))}</p>` : ''}${task.previousAttemptId ? `<p>Rework of attempt: ${escape(task.previousAttemptId)}</p>` : ''}${task.dispatchId?button('Wake closed member','wake-member',`data-team="${team.id}" data-member="${task.memberId}" data-request="${task.id}"`,'small'):''}${task.status === 'unknown' ? '<p>Check work evidence to reconcile this attempt. Its execution outcome is unconfirmed.</p>' : ''}<small>Configuration ${escape(task.configVersion)} · Role ${escape(task.roleVersion)}</small><details><summary>Task evidence</summary><dl><dt>Owning Run</dt><dd>${escape(task.runId||'Unverified')}</dd><dt>Native creator Dispatch</dt><dd>${escape(task.creatorDispatchId||'Root')}</dd><dt>Native depth</dt><dd>${escape(task.depth??'Unverified')}</dd><dt>Task</dt><dd>${escape(task.nativeTaskId)}</dd><dt>Attempt</dt><dd>${escape(task.attemptId)}</dd><dt>Dispatch</dt><dd>${escape(task.dispatchId || 'Not bound')}</dd><dt>Evidence</dt><dd>${escape(task.evidenceId || 'Not observed')}</dd></dl></details>${showMember && member ? button('View member', 'member', `data-team="${state.teams.indexOf(team)}" data-member="${escape(member.id)}"`, 'small') : ''}</article>`;
  }).join('');
}
function managerRuns(team,work,memberId) {
 const runs=(work.nativeRuns||[]).filter(r=>!memberId||r.supervisorMemberId===memberId);
 if(!runs.length)return '';
 return `<section aria-label="Manager Runs"><h4>Manager Runs</h4>${runs.map(r=>`<div><p>Manager: ${escape(team.members.find(m=>m.id===r.supervisorMemberId)?.name||r.supervisorMemberId)} · Run: ${escape(r.run.id||'Awaiting genuine manager Run')} · ${escape(r.run.state)}</p>${r.parent?`<p>Reports through parent Task ${escape(r.parent.taskId)} · Dispatch ${escape(r.parent.dispatchId)} · Attempt ${escape(r.parent.attemptId)}</p>`:''}${r.error?`<p>${escape(r.error)}</p>`:''}${r.dispatchProtocol?.detail?`<p>${escape(r.dispatchProtocol.detail)}</p>`:''}${(r.questions||[]).filter(q=>q.to==='manager').map(q=>`<p>Question relayed to parent: ${escape(q.summary)} · ${escape(q.status)}</p>`).join('')}</div>`).join('')}${runs.some(r=>r.parent)?'<p>Nested dispatch keeps native depth. Orca defaults to depth 1; these managers need Settings → Orchestration → Nested worker depth of at least 2. The plugin does not change this setting.</p>':''}</section>`;
}
function memberTasks(team, member) {
  const tasks = (state.works || []).filter(work => work.teamId === team.id).flatMap(work => [...(work.tasks || []),...(work.queuedTasks || [])]).filter(task => task.memberId === member.id || task.supervisorMemberId === member.id);
  return tasks.length ? `<section aria-label="Member tasks"><h3>Member tasks</h3>${taskCards(team, tasks, false)}</section>` : '';
}
function workTasks(team, work) {
  const protocol = work.dispatchProtocol;
  return `<section aria-label="Team tasks"><h3>Team tasks</h3>${managerRuns(team,work)}${work.messages?.length?`<details><summary>Verified team messages (${work.messages.length})</summary>${work.messages.map(m=>`<p>${escape(team.members.find(a=>a.id===m.fromMemberId)?.name||m.fromMemberId)} → ${escape(team.members.find(a=>a.id===m.toMemberId)?.name||m.toMemberId)}: ${escape(m.body)} · Native message saved · Processing ${escape(m.processing)}</p>`).join('')}</details>`:''}${work.collaborations?.length?`<details><summary>Supervisor collaboration directives (${work.collaborations.length})</summary>${work.collaborations.map(d=>`<p>${escape(team.members.find(a=>a.id===d.fromMemberId)?.name||d.fromMemberId)} → ${escape(team.members.find(a=>a.id===d.toMemberId)?.name||d.toMemberId)} · Reports to ${escape(team.members.find(a=>a.id===d.reportToMemberId)?.name||d.reportToMemberId)} · Processing ${escape(d.processing)}</p>`).join('')}</details>`:''}${protocol ? `<p>Supervisor dispatch protocol: ${escape(protocol.state)} · Generation ${escape(protocol.generation)}</p>${protocol.detail ? `<p>${escape(protocol.detail)}</p>` : ''}` : ''}${work.tasks?.length ? taskCards(team, work.tasks) : '<p>No admitted member tasks observed yet.</p>'}${work.queuedTasks?.length?'<h4>Queued tasks</h4>'+taskCards(team,work.queuedTasks):''}${work.withdrawnIntents?.length?`<details><summary>Corrected task intents (${work.withdrawnIntents.length})</summary>${work.withdrawnIntents.map(row=>`<p>${escape(row.taskKey)} · Original ${escape(row.nativeTaskId)} → Replacement ${escape(row.replacementNativeTaskId)} · Missing worker instructions corrected by the owning supervisor.</p>`).join('')}<p>Original native records are retained. These corrections are not execution failures; their proof is rechecked before closure.</p></details>`:''}<p>Declared scope coordination is not filesystem isolation. Unknown results and pending acceptance keep their scopes reserved.</p></section>`;

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
function organizationControls(team){
 const work=(state.works||[]).find(w=>w.teamId===team.id&&w.status!=='completed');if(!work)return '';
 const pending=(state.organizationChanges||[]).find(r=>r.teamId===team.id&&r.state==='pending');
 return `<section class="section" aria-label="Organization changes"><h3>Organization changes</h3><p>Removal and reporting changes take effect only after you accept “${escape(work.objective)}”. Existing tasks retain their original supervisor and role.</p>${pending?`<p>Pending for accepted-end boundary ${escape(pending.workId)} · ${pending.changes.length} change(s).</p>${button('Cancel pending organization change','cancel-organization',`data-request="${escape(pending.requestId)}"`,'small')}`:`<details><summary>Edit next organization</summary>${team.members.map(m=>`<label class="field">${escape(m.name)} reports to<select data-org-member="${m.id}"><option value="root" ${m.boss===null?'selected':''}>You (highest Head / CEO)</option>${team.members.filter(b=>b.id!==m.id).map(b=>`<option value="${b.id}" ${m.boss===b.id?'selected':''}>${escape(b.name)}</option>`).join('')}<option value="remove">Remove after acceptance</option></select></label>`).join('')}<label class="check"><input type="checkbox" data-org-pause checked> Pause new assignments to changed members now</label>${button('Schedule organization changes','schedule-organization',`data-team="${team.id}" data-work="${work.id}"`,'small')}</details>`}</section>`;
}
function details() {
  if (!selection) return '';
  const team = state.teams[selection.team];
  const member = team?.members.find(row => row.id === selection.member);
  if (!member) return '';
  const boss = team.members.find(row => row.id === member.boss);
  const reports = team.members.filter(row => row.boss === member.id);
  return `<section class="inspector" aria-label="Member details"><div class="section-heading"><h2>${GLYPHS[member.role]} ${escape(member.name)}</h2>${button('Close details', 'close-details', '', 'small')}</div><dl><dt>Role</dt><dd>${label(member.role)}</dd><dt>Reports to</dt><dd>${escape(boss?.name || 'You')}</dd><dt>Direct reports</dt><dd>${reports.length}</dd><dt>Agent</dt><dd>${member.agent === 'claude' ? 'Claude Code' : 'Codex'}</dd><dt>Requested model</dt><dd>${escape(member.model)}</dd><dt>Requested effort</dt><dd>${escape(member.effort)}</dd><dt>Launch</dt><dd>${launchStatus(team, member)}</dd></dl><p>Role version ${member.roleVersion} · Configuration version ${team.configVersion}</p>${stopControls(team,member)}${memberTasks(team, member)}${(state.works||[]).filter(w=>w.teamId===team.id).map(w=>managerRuns(team,w,member.id)).join('')}<h3>Agent preferences</h3><p class="subtle">${member.preferenceOverride ? 'Individual override' : 'Inherits level default'} · Effective model: unknown · Effective effort: unknown · Context usage: unknown</p><label class="field">Preference applies to<select data-preference-target><option value="member" ${preferenceTarget === 'member' ? 'selected' : ''}>This member</option><option value="level" ${preferenceTarget === 'level' ? 'selected' : ''}>Level ${member.level} defaults</option></select></label><div class="table-scroll"><table class="models"><thead><tr><th>Agent</th><th>Requested model</th><th>Requested effort</th></tr></thead><tbody><tr>${preferenceControls('Member', memberPreferences || member, capabilityViews.get(team.scope.workspaceKey), 'member', true)}</tr></tbody></table></div>${capabilityNotice(team.scope)}${button('Refresh host capabilities', 'refresh-capabilities', '', 'small')}${button('Save preferences', 'save-preferences', !storageAvailable ? 'disabled' : '', 'primary small')}${button('Use level default', 'inherit-preferences', '', 'small')}${replacementControls(team,member)}<p class="subtle">Saved preferences apply to future launches. Role collaboration rules guide agents; they do not intercept provider tools.</p><label class="field">Role description<textarea data-role="brief" maxlength="1500">${escape(member.brief)}</textarea></label><label class="field">Work habits<textarea data-role="habits" maxlength="1500">${escape(member.habits)}</textarea></label><label class="field">Collaboration rules<textarea data-role="collaboration" maxlength="1500">${escape(member.collaboration)}</textarea></label>${button('Save role', 'save-role', !storageAvailable ? 'disabled' : '', 'primary small')}<p class="subtle">Changes apply at the next launch or handoff. Existing work keeps its saved role version.</p></section>`;

}
function staffingProposals(work){
 return (work.staffingProposals||[]).map(p=>`<article class="task-card" aria-label="Staffing proposal ${escape(p.id)}"><h3>${escape(p.member.name)}</h3><p>${escape(p.rationale)}</p><p>${escape(p.member.brief)}</p><p>${escape(p.member.agent)} · ${escape(p.member.model)} · ${escape(p.member.effort)} · Configuration ${p.configVersion}</p><p>Proposed by ${escape(state.teams.find(t=>t.id===work.teamId)?.members.find(m=>m.id===p.proposingManagerId)?.name||p.proposingManagerId)} · Reports to ${escape(state.teams.find(t=>t.id===work.teamId)?.members.find(m=>m.id===p.member.boss)?.name||p.member.boss)} · ${escape(p.status)}</p>${p.decision?`<p>Your decision: ${escape(p.decision.choice)} · ${escape(p.decision.recordedAt)}</p>`:''}${p.status==='expired'&&p.expiry?`<p>Expired when you accepted delivery ${escape(p.expiry.deliveryId)} · ${escape(p.expiry.recordedAt)}. Original proposal retained.</p>`:''}</article>`).join('');
}
function sessionHistory(team,work){
 const questions=work.questions||[],proposals=work.staffingProposals||[],head=team.members.find(m=>m.id===work.supervisorMemberId),binding=team.launch?.members?.[head?.id];
 const open=work.status!=='completed'&&binding?.requestId?button('Open supervisor session','open-member',`data-team="${team.id}" data-member="${head.id}" data-request="${binding.requestId}"`,'small'):'';
 return `<section aria-label="Supervisor conversation"><p>Discuss questions and staffing with ${escape(head?.name||'the highest supervisor')} in their session.</p>${open}${questions.length||proposals.length?`<details><summary>Conversation decision history</summary>${staffingProposals(work)}${questions.map(q=>`<article aria-label="Question ${escape(q.id)}"><h4>${escape(q.summary)}</h4><p>${escape(q.status)}</p>${q.sourceReport?'<p>Completion report decision</p>':''}${q.answers.map(a=>`<p>${escape(a.id)} · ${escape(a.body)}</p><small>${a.source==='supervisor-session'?'Recorded in supervisor session':'Native input: '+escape(a.state)} · Manager processing: ${escape(a.processed)}</small>`).join('')}${q.resolution?`<p>${escape(q.resolution.note)}</p>`:''}</article>`).join('')}</details>`:''}</section>`;
}
function workSection(team){
 const history=(state.works||[]).filter(w=>w.teamId===team.id&&w.status==='completed'),goals=(state.goals||[]).filter(g=>g.teamId===team.id&&g.status!=='started');
 const queue=`<section class="section" aria-label="Queued objectives"><h3>Next total objectives</h3><label class="field">Queue a later objective<textarea data-goal="${team.id}" maxlength="8000">${escape(goalDrafts.get(team.id)||'')}</textarea></label>${button('Queue objective','enqueue-goal',`data-team="${team.id}"`,'small')}<p>Queueing saves the goal. It starts after you accept the current delivery, using fresh conversations.</p>${goals.map(g=>`<p>${escape(g.objective)} · ${escape(g.status)}</p>`).join('')}${(goals.some(g=>g.status==='reserved')||history.length&&!state.works?.some(w=>w.teamId===team.id&&w.status!=='completed')&&goals.length)?button('Continue next objective','start-next',`data-team="${team.id}"`,'small'):''}</section>`;
 const past=history.length?`<details><summary>Accepted work history (${history.length})</summary>${history.map(w=>`<p>${escape(w.objective)} · Accepted by you · ${escape(w.closedAt)}</p><p>${escape(w.handoff?.summary||'')}</p>${sessionHistory(team,w)}`).join('')}</details>`:'';
 return activeWorkSection(team)+organizationControls(team)+queue+past;
}
function deliverySection(work){
 const d=work.delivery;if(!d)return '';
 return `<section aria-label="Overall delivery"><h3>Overall delivery · ${escape(d.status)}</h3><p>${escape(d.summary)}</p><p>Evidence: ${escape(d.evidenceRefs.join(' · '))}</p><p>Delivery revision ${d.revision} · Highest supervisor verified</p>${work.closureBlockers?.length?`<p>Required work remains: ${escape(work.closureBlockers.join('; '))}</p>`:''}${d.status==='pending'?`${button('Accept delivery','accept-delivery',`data-work="${work.id}" ${work.closureBlockers?.length?'disabled':''}`,'primary small')}<label class="field">Requested corrections<textarea data-rework="${work.id}" maxlength="8000">${escape(reworkDrafts.get(work.id)||'')}</textarea></label>${button('Request rework','rework-delivery',`data-work="${work.id}"`,'small')}`:''}</section>`;
}
function activeWorkSection(team) {
  const work = state.works?.find(row => row.teamId === team.id&&row.status!=='completed');
  if (work) return `<section class="section" aria-label="TeamWork"><h3>Total objective</h3><p>${escape(work.objective)}</p><small>Configuration ${work.configVersion} · Role ${work.roleVersion} · ${escape(work.scope.displayName)} · ${escape(work.scope.executionHostId)}</small><p>Input: ${escape(work.input.state)}${work.input.dispatchState ? ` (journal: ${escape(work.input.dispatchState)})` : ''} · Processing: ${escape(work.processing.state)} · Run: ${escape(work.run.state)}</p>${work.run.id ? `<p>Native Run: ${escape(work.run.id)} · Consumer generation ${work.run.consumerGeneration}</p>` : ''}<p class="subtle">${escape(work.run.detail || 'Waiting for the real supervisor to create its Run.')}</p>${work.error ? `<p role="alert">${escape(work.error)}</p>` : ''}${button('Check work evidence', 'check-work', `data-work="${work.id}"`, 'small')}${work.canReconnectRuntime?`<p>After restarting Orca, recheck this team before continuing. Each agent must be idle and this work must have no tasks.</p>${button('Reconnect existing team','reconnect-work',`data-work="${work.id}"`,'small')}`:''}${work.runtimeRecovery?'<p class="subtle">Existing sessions reconnected. The original objective and work history are retained.</p>':''}${!work.recoveryRequestId && work.input.state === 'not_sent' ? button('Retry unsent objective', 'retry-objective', `data-work="${work.id}"`, 'small') : ''}${work.snapshot ? `<p>${work.snapshot.tasks.length} native task(s) in the ${work.snapshot.stale ? 'last observed' : 'confirmed'} Run. Execution status does not imply user acceptance.</p>` : ''}${deliverySection(work)}${workTasks(team, work)}${sessionHistory(team,work)}</section>`;
  const head = team.members.find(member => member.boss === null);
  if (team.launch?.members?.[head.id]?.status !== 'created') return '';
  return `<section class="section"><h3>Start team work</h3><label class="field">Total objective<textarea data-objective="${team.id}" rows="3" maxlength="8000">${escape(objectives.get(team.id) || '')}</textarea></label>${button('Submit total objective', 'submit-work', `data-team="${team.id}" ${!storageAvailable ? 'disabled' : ''}`, 'primary small')}<p class="subtle">Uses the prepared highest supervisor and this team's saved project. One total objective may remain in progress at a time.</p></section>`;
}
function roster() {
  if (!state.teams.length) return empty();
  const charts = state.settings.chart ? `<section class="organisation"><h2>Organisation</h2>${state.teams.map((team, i) => `<div class="chart-heading">@${escape(team.name)}</div><div class="tree-scroll org-chart">${tree(team.members, null, true, i, true)}</div>`).join('')}</section>` : '';
  return `<div class="section-heading"><h1>Team roster</h1>${button('+ New team', 'new', '', 'primary small')}</div>${charts}<div class="team-cards ${state.settings.layout === 'columns' ? 'columns' : ''}">${state.teams.map((team, i) => `<section class="team-card"><header><h2>@${escape(team.name)}</h2><small>${team.members.length} members</small></header><p class="bound-project">${escape(team.scope.displayName)} · ${escape(team.scope.kind)} · ${escape(team.scope.executionHostId)}</p>${team.purpose ? `<p class="purpose">${escape(team.purpose)}</p>` : ''}<div class="table-scroll"><table class="roster"><thead><tr><th>Name</th><th>Role</th><th>CLI</th><th>Model</th><th>Effort</th><th>Launch</th></tr></thead><tbody>${team.members.map(member => `<tr><td>${button(`${GLYPHS[member.role]} ${escape(member.name)}`, 'member', `data-team="${i}" data-member="${escape(member.id)}"`, 'name-button')}</td><td>${label(member.role)}</td><td>${member.agent === 'claude' ? 'Claude' : 'Codex'}</td><td>${escape(member.model)}</td><td>${escape(member.effort)}</td><td><span class="status-dot" aria-hidden="true"></span>${launchStatus(team, member)}</td></tr>`).join('')}</tbody></table></div>${admissionControls(team)}${!team.launch ? button('Launch this team', 'launch-existing', `data-team="${i}" ${!storageAvailable ? 'disabled' : ''}`, 'primary small') : launchReceipt(team)+(initialMembers(team).some(member=>!team.launch.members?.[member.id])?button('Continue roster preparation','launch-existing',`data-team="${i}"`, 'small'):'')}${workSection(team)}${recoveryCards(team.id)}</section>`).join('')}</div>${state.teams.some(team => !team.launch) ? launchControls() : ''}${details()}`;
}
function recoveryCards(teamId){
 return (state.recoveries||[]).filter(row=>row.teamId===teamId).map(row=>{
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
  return `<h1>Settings</h1><section class="section" aria-label="Connection"><h2>Connection</h2><p>Connected to Orca</p>${button('Test connection', 'test-connection', '', 'small')}<details><summary>Technical details</summary><p>${escape(connection)}</p></details></section>${cleanupView()}<section class="section"><h2>Roster display</h2><label class="check"><input type="checkbox" data-setting="chart" ${state.settings.chart ? 'checked' : ''} ${busy || !loaded ? 'disabled' : ''}> Show organisation tree</label><label class="field">Team cards<select data-setting="layout" ${busy || !loaded ? 'disabled' : ''}><option value="stacked" ${state.settings.layout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="columns" ${state.settings.layout === 'columns' ? 'selected' : ''}>Side by side when there is room</option></select></label></section><section class="section"><h2>Team launching</h2><p>Launch calls go to the bundled worker on your PC through the runtime adapter. Orca opens agent tabs on each team's saved project and execution host and passes each role brief as its startup prompt. The panel records actual created-tab receipts; it does not infer readiness or provider session IDs.</p><p>Default model and effort inherit agent configuration. On demand prepares managers; all at start prepares the saved roster. Tasks share the selected directory. Scope coordination does not isolate undeclared filesystem writes.</p></section>`;
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
  } finally { if (storageAvailable) await refreshTargets(); busy = false; loading = false; render(); }
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
      if (await submit('createTeam', { form, selectionToken: confirmedWorkspace.selectionToken })) { view = 'roster'; selection = null; message = 'Team saved. You can launch it later; no total objective has been submitted.'; render(); }
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
  else if (['request-replacement','schedule-organization','cancel-organization'].includes(action)) {
    let op,params;
    if(action==='request-replacement'){
      const team=state.teams[selection.team],member=team.members.find(m=>m.id===selection.member);op='requestReplacement';params={requestId:crypto.randomUUID(),expectedRevision:state.revision,teamId:team.id,memberId:member.id,bindingRequestId:target.dataset.request,agent:memberPreferences.agent,model:memberPreferences.model,effort:memberPreferences.effort,summary:replacementDrafts.get(member.id)||'',evidenceRefs:[`previous-instance:${target.dataset.request}`,`role:${member.id}:${member.roleVersion}`]};
    }else if(action==='cancel-organization'){op='cancelOrganization';params={requestId:target.dataset.request,expectedRevision:state.revision};}
    else {const team=state.teams.find(t=>t.id===target.dataset.team),changes=[...app.querySelectorAll('[data-org-member]')].flatMap(n=>{const m=team.members.find(m=>m.id===n.dataset.orgMember),boss=n.value==='root'?null:n.value;return n.value==='remove'?[{memberId:m.id,remove:true}]:boss!==m.boss?[{memberId:m.id,boss}]:[];});op='scheduleOrganization';params={requestId:crypto.randomUUID(),expectedRevision:state.revision,teamId:team.id,workId:target.dataset.work,configVersion:team.configVersion,changes,pause:app.querySelector('[data-org-pause]').checked};}
    busy=true;problem='';render();try{await call(op,params);state=validatePersistentState((await call('storage.get',{})).value);message=action==='request-replacement'?'Replacement decision saved. Create the approved conversation in this team’s recovery controls.':action==='schedule-organization'?'Organization changes saved for acceptance of this total objective.':'Pending organization change cancelled; admission pause remains until explicitly resumed.';}catch(error){problem=error.message;}finally{busy=false;render();}
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
  else if(['enqueue-goal','accept-delivery','rework-delivery','start-next'].includes(action)){
    busy=true;problem='';render();
    try{
      let result,teamId=target.dataset.team;
      if(action==='enqueue-goal'){
        if(!goalRequests.has(teamId))goalRequests.set(teamId,mutation({teamId,objective:goalDrafts.get(teamId)||''}));
        result=await call('enqueueGoal',goalRequests.get(teamId));goalRequests.delete(teamId);goalDrafts.delete(teamId);message='Later objective queued.';
      }else if(action==='start-next')result=await call('startNextGoal',{teamId});
      else{
        const work=state.works.find(w=>w.id===target.dataset.work);teamId=work.teamId;
        const key=work.delivery.id+action;
        if(!decisionRequests.has(key))decisionRequests.set(key,{requestId:crypto.randomUUID(),workId:work.id,deliveryId:work.delivery.id,expectedWorkVersion:work.version,decision:action==='accept-delivery'?'accept':'rework',...(action==='rework-delivery'?{feedback:reworkDrafts.get(work.id)||''}:{})});
        result=await call('decideWork',decisionRequests.get(key));message=action==='accept-delivery'?'Delivery accepted.':'Corrections saved for the highest supervisor.';
      }
      while(result.continue){message='Preparing fresh sessions for the next objective…';render();await new Promise(resolve=>setTimeout(resolve,10100));result=await call('startNextGoal',{teamId,goalId:result.goalId});}
      state=validatePersistentState(result.value||(await call('storage.get',{})).value);
      if(result.pending)message=result.detail||'Next objective remains reserved. Continue after checking its saved launch evidence.';
    }catch(error){problem=error.message;if(/changed|superseded/i.test(error.message))decisionRequests.clear();try{state=validatePersistentState((await call('storage.get',{})).value);}catch{}}
    finally{busy=false;render();}
  }
  else if (action === 'launch-existing') {
    try { await launchTeam(Number(target.dataset.team)); }
    catch (error) { problem = error.message; canRetry = false; render(); }
  }
});
app.addEventListener('input', event => {
  const target = event.target;
  if(target.dataset.goal){goalDrafts.set(target.dataset.goal,target.value);goalRequests.delete(target.dataset.goal);return;}
  if(target.dataset.rework){reworkDrafts.set(target.dataset.rework,target.value);return;}
  if (target.dataset.objective) { objectives.set(target.dataset.objective, target.value); workRequests.delete(target.dataset.objective); }
  else if (target.dataset.form) { form[target.dataset.form] = target.value; updatePreview(); }
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
render();
void load();

app.addEventListener('input',event=>{if(event.target.dataset.replacementSummary)replacementDrafts.set(event.target.dataset.replacementSummary,event.target.value);if(event.target.dataset.wakeSummary)wakeDrafts.set(event.target.dataset.wakeSummary,event.target.value);});
