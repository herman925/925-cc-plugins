import { preferenceIssue } from './capabilities.mjs';
import { DEFAULT_FORM, GLYPHS, planTeam, emptyTeamState, validatePersistentState } from './team.mjs';
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
let form = {...structuredClone(DEFAULT_FORM),name:'Team',sessionMode:true,launchMode:'all'};
let telemetry={members:{},observedAt:null};
let rosterRefreshRunning=false;
let view = 'roster';
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
let capabilitiesLoading = false;
let capabilityRetryTimer;

const mutation = params => ({ ...params, expectedRevision: state.revision, requestId: crypto.randomUUID() });

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const label = role => ({ ceo: 'CEO', head: 'Head', lead: 'Lead', worker: 'Worker' })[role];
function button(text, action, attrs = '', className = '') { return `<button type="button" data-action="${action}" class="${className}" ${attrs}>${text}</button>`; }
function segment(field, choices, value) {
  return `<div class="segments" role="group" aria-label="${field === 'fan' ? 'Reports per manager' : field === 'levels' ? 'Hierarchy levels' : 'Structure'}">${choices.map(([id, text]) => button(escape(text), 'pick', `data-field="${field}" data-value="${id}" aria-pressed="${String(id) === String(value)}"`)).join('')}</div>`;
}
function empty() { return `<section class="welcome"><h1>${workspace?'No teams in this project':'Select a project'}</h1><p>${workspace?'Create and launch a team for this project.':'Select a project in Orca to view its teams.'}</p>${button('Add team','new','','primary small')}</section>`; }
const STATUS_LABELS={working:'Working',idle:'Idle',asking:'Needs input',starting:'Starting',closed:'Closed','not-started':'Not started',offline:'Offline',unknown:'Unknown'};
function memberObservation(member){return telemetry.members[member.id]??{state:'unknown',model:null,effort:null,context:null,requestedModel:member.model,requestedEffort:member.effort};}
function statusCell(member){const row=memberObservation(member);return `<span class="member-status" data-state="${escape(row.state)}" title="${escape(row.detail||'Observed from the native session')}"><span class="status-dot" aria-hidden="true"></span>${STATUS_LABELS[row.state]||'Unknown'}</span>`;}
function contextCell(member){const usage=memberObservation(member).context;if(!usage)return '<span class="subtle" title="Context usage has not been reported by this session">—</span>';const percent=Math.round(usage.percent),tone=percent<50?'low':percent<80?'medium':'high';return `<span class="context-usage ${tone}" title="${escape(usage.used)} / ${escape(usage.limit)} tokens${usage.estimated?' · Estimated from native token usage':''}"><span>${usage.estimated?'≈':''}${percent}%</span><span class="context-track"><span style="width:${Math.min(100,Math.max(0,percent))}%"></span></span></span>`;}
function preferenceCell(member,field){const row=memberObservation(member),reported=row[field],setting=row[field==='model'?'sessionModel':'sessionEffort']??row[field==='model'?'requestedModel':'requestedEffort'];return reported?escape(reported):`<span title="Configured value; the current CLI has not confirmed its effective ${field}">${escape(setting==='default'?'Default':setting||'—')} <small class="subtle">set</small></span>`;}
function supervisorSessionButton(team) {
  const member = team.members.find(row => row.boss === null);
  const observed = telemetry.members[member?.id];
  const saved = team.launch?.members?.[member?.id];
  const requestId = observed?.sessionRequestId || (saved?.status === 'created' ? saved.requestId : null);
  return requestId ? button('Open supervisor', 'open-supervisor', `data-team="${escape(team.id)}" data-member="${escape(member.id)}" data-request="${escape(requestId)}" title="Open ${escape(member.name)}’s session"`, 'small') : '';
}
function tree(members, parent = null, live = false, compact = false) {
  const children = members.filter(member => member.boss === parent);
  return `<ul class="org-tree ${parent === null ? 'root' : ''}">${children.map(member => {
    const shortName = compact ? member.role === 'ceo' ? 'CEO' : member.role === 'head' ? member.team : member.name.replace(/^.*Worker-/, 'W').replace(/^Lead-/, 'L') : member.name;
    const observation = memberObservation(member);
    return `<li><span class="org-node ${escape(member.role)}" ${live ? `title="${escape(member.name)} · ${escape(STATUS_LABELS[observation.state] || 'Unknown')}" data-state="${escape(observation.state)}"` : ''}><span class="glyph" aria-hidden="true">${GLYPHS[member.role]}</span><span>${escape(shortName)}</span><small>${label(member.role)}</small></span>${members.some(child => child.boss === member.id) ? tree(members, member.id, live, compact) : ''}</li>`;
  }).join('')}</ul>`;
}
function preferenceControls(name, preference, caps, suffix) {
  const agent = caps?.agents?.[preference.agent];
  const models = agent?.catalogStatus === 'known' ? agent.models : [];
  const listed = models.find(row => row.id === preference.model);
  const efforts = [...new Set(['default', ...(listed?.efforts ?? []).map(row => row.value)])];
  const issue = preferenceIssue(preference, caps);
  return `<td><select aria-label="${name} CLI" data-agent="${suffix}">${[['codex', 'Codex'], ['claude', 'Claude Code']].map(([value, text]) => `<option value="${value}" ${preference.agent === value ? 'selected' : ''}>${text}</option>`).join('')}</select></td>
    <td><select aria-label="${name} model" data-model="${suffix}"><option value="default" ${preference.model === 'default' ? 'selected' : ''}>Default · Orca settings</option>${models.filter(row => row.id !== 'default').map(row => `<option value="${escape(row.id)}" ${preference.model === row.id ? 'selected' : ''}>${escape(row.label === row.id ? row.id : `${row.label} (${row.id})`)}</option>`).join('')}${preference.model !== 'default' && !listed ? `<option value="${escape(preference.model)}" selected disabled>Unavailable · ${escape(preference.model)}</option>` : ''}</select></td>
    <td><select aria-label="${name} effort" data-effort="${suffix}" ${!listed ? 'disabled' : ''}>${efforts.map(value => `<option value="${escape(value)}" ${preference.effort === value ? 'selected' : ''}>${escape(value === 'default' ? 'Default' : value)}</option>`).join('')}${!efforts.includes(preference.effort) ? `<option selected disabled value="${escape(preference.effort)}">Unavailable · ${escape(preference.effort)}</option>` : ''}</select>${issue ? `<small class="validation">${escape(issue)}</small>` : ''}</td>`;
}
function capabilityNotice(scope) {
  if (capabilitiesLoading) return '<p class="subtle" role="status">Loading models from Orca…</p>';
  const caps = capabilityViews.get(scope?.workspaceKey);
  if (!caps) return '<p class="subtle">Model list unavailable. Default uses Orca settings.</p>';
  const unavailable = [...new Set(form.agents.slice(0, form.structure === 'organisation' ? 3 : form.levels))].filter(id => caps.agents[id]?.catalogStatus !== 'known' || !caps.agents[id]?.models.length);
  return unavailable.length ? `<p class="subtle">${unavailable.map(id => id === 'claude' ? 'Claude Code' : 'Codex').join(', ')}: model list unavailable${caps.executionHostId !== 'local' ? ' for this remote host' : ''}. Default uses Orca settings.</p>` : '';
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
    <section class="section"><h2><span>①</span> Setup</h2><label class="field">Team name<input id="team-name" data-form="name" value="${escape(form.name)}" maxlength="64" autocomplete="off"></label><label class="field">Function<textarea id="team-purpose" data-form="purpose" maxlength="500" rows="2" placeholder="What the team is for, in a sentence">${escape(form.purpose)}</textarea></label><div class="field"><span>Structure</span>${segment('structure', [['team', 'One team'], ['organisation', 'CEO over several teams']], form.structure)}</div>
    ${form.structure === 'organisation' ? `<label class="field">Teams<input id="team-groups" data-form="groups" value="${escape(form.groups)}" maxlength="520" placeholder="Team 1, Team 2"><small>Names separated by commas; each gets a head and workers.</small></label>` : `<div class="field"><span>Levels</span>${segment('levels', [[2, '2 · Head + workers'], [3, '3 · Head + leads + workers']], form.levels)}</div>`}
    <div class="field"><span>${form.structure === 'organisation' ? 'Workers each' : 'Reports each'}</span>${segment('fan', [1, 2, 3, 4, 5].map(n => [n, `${n}`]), form.fan)}</div></section>
    <section class="section"><h2><span>②</span> CLI, model and effort per level</h2><p class="subtle">Default inherits your agent configuration.</p><div class="table-scroll"><table class="models"><thead><tr><th>Level</th><th>CLI</th><th>Model</th><th>Effort</th></tr></thead><tbody>${configRows()}</tbody></table></div>${capabilityNotice(confirmedWorkspace || workspace)}${button('Refresh models', 'refresh-capabilities', capabilitiesLoading || !(confirmedWorkspace || workspace)?.selectionToken ? 'disabled' : '', 'small')}</section>
    <section class="section"><h2><span>③</span> Organisation preview</h2><div id="preview">${preview()}</div></section>
    ${state.teams.some(t=>!t.launch)?`<details><summary>Unstarted teams</summary>${state.teams.filter(t=>!t.launch).map(t=>button('Launch @'+escape(t.name),'launch-existing',`data-team="${state.teams.indexOf(t)}"`,'small')).join('')}</details>`:''}${projectControls()}${launchControls()}<div class="actions">${button('Launch team', 'create', busy || capabilitiesLoading || !loaded || !storageAvailable || !confirmedWorkspace ? 'disabled' : '', 'primary')}${button('Cancel', 'roster', '', 'secondary')}</div>`;
}
function projectControls() {
  const target = confirmedWorkspace || workspace;
  return `<section class="section"><h2>Project and execution host</h2><p>${escape(target?.displayName || 'No selected workspace')} · ${escape(target?.kind || 'unknown kind')} · ${escape(target?.executionHostId || 'unknown host')}</p>${button('Refresh workspace', 'refresh-tabs', '', 'small')} ${button('Confirm project and host', 'confirm-project', !workspace?.selectionToken ? 'disabled' : '', 'small')}<p class="subtle">${confirmedWorkspace ? 'Project confirmed. Changing Orca focus will not change this binding.' : 'Open the intended project in Orca, refresh here, then confirm it before saving.'}</p>${targetError ? `<p class="validation" role="alert">${escape(targetError)}</p>` : ''}</section>`;
}
function launchControls() {
  return `<p class="subtle">All members start with their saved roles. Give assignments in the highest supervisor’s session.</p>`;
}
function roster() {
 const teams=workspace?state.teams.filter(t=>t.launch&&t.scope.workspaceKey===workspace.workspaceKey):[];
 if(!teams.length)return empty();
 return `<div class="section-heading"><h1>Team roster</h1><div class="team-heading-actions"><small>Updates every 5s</small>${button('Add team','new','','small')}</div></div>${state.settings.chart?`<section class="organisation">${teams.map(team=>`<div class="chart-heading">@${escape(team.name)}</div><div class="tree-scroll org-chart">${tree(team.members,null,true,true)}</div>`).join('')}</section>`:''}<div class="team-cards ${state.settings.layout==='columns'?'columns':''}">${teams.map(team=>`<section class="team-card"><header><h2>@${escape(team.name)}</h2><div class="team-heading-actions"><small>${team.members.length} members</small>${supervisorSessionButton(team)}</div></header><div class="table-scroll"><table class="roster"><thead><tr><th>Name</th><th>Role</th><th>CLI</th><th>Status</th><th>Context</th><th>Model</th><th>Effort</th></tr></thead><tbody>${team.members.map(member=>`<tr data-member-row="${member.id}"><td><span class="member-name">${GLYPHS[member.role]} ${escape(member.name)}</span></td><td>${label(member.role)}</td><td>${memberObservation(member).agent==='claude'?'Claude':'Codex'}</td><td data-live-status="${member.id}">${statusCell(member)}</td><td data-live-context="${member.id}">${contextCell(member)}</td><td data-live-model="${member.id}">${preferenceCell(member,'model')}</td><td data-live-effort="${member.id}">${preferenceCell(member,'effort')}</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>`;
}
function storageRecoveryView(){
 return `<section aria-label="Storage recovery"><h1>Saved storage is unavailable</h1><p>Your saved teams could not be read. Existing data has not been reset.</p><p>Preserve the database together with its WAL, SHM and journal sidecars. Stop the plugin before copying recovery evidence. Use a compatible plugin for a newer schema. Restoring an older backup requires manual reconciliation of later native effects before starting work.</p>${button('Inspect recovery details','storage-recovery','','small')}${storageRecovery?`<dl><dt>Storage status</dt><dd>${escape(storageRecovery.status)}</dd><dt>Found / supported schema</dt><dd>${escape(storageRecovery.foundSchema??'Unreadable')} / ${escape(storageRecovery.supportedSchema)}</dd>${storageRecovery.location?`<dt>Verified local recovery directory</dt><dd>${escape(storageRecovery.location)}</dd>`:''}</dl><p>${escape(storageRecovery.guidance)}</p><h2>Migration backups</h2>${storageRecovery.backups.length?storageRecovery.backups.map(b=>`<p>${escape(b.id)} · ${escape(b.status)} · ${escape(b.createdAt||'Incomplete')}</p>`).join(''):'<p>No verified migration backup is available.</p>'}`:''}</section>`;
}
function cleanupView(){
 const history=(state.works||[]).filter(w=>w.status==='completed');
 return `<section class="section" aria-label="Manual history cleanup"><h2>Manual history cleanup</h2><p>Select accepted work to preview summary and task-result cleanup. Identity, acceptance and replay evidence stay saved.</p>${history.map(w=>`<label class="check"><input type="checkbox" data-cleanup-work="${escape(w.id)}" ${cleanupSelection.has(w.id)?'checked':''} ${w.historyPruned?'disabled':''}> ${escape(w.objective)} · ${w.historyPruned?'Previously cleaned':'Accepted by you'}</label>`).join('')}${!history.length?'<p>No accepted history yet.</p>':''}${button('Preview history cleanup','preview-cleanup',!storageAvailable||!cleanupSelection.size?'disabled':'','small')}${cleanupPreview?`<section aria-label="Cleanup preview"><h3>Cleanup preview</h3><p>${cleanupPreview.eligibleWorkIds.length} eligible Work(s) · ${cleanupPreview.changes.length} records · ${cleanupPreview.snapshotCount} cached snapshots · ${cleanupPreview.logicalBytes} logical bytes inspected</p><p>${escape(cleanupPreview.notice)}</p>${cleanupPreview.retained.map(r=>`<p>Kept ${escape(r.workId)}: ${escape(r.reason)}</p>`).join('')}<details><summary>Exact affected records</summary>${cleanupPreview.changes.map(r=>`<p>${escape(r.recordId)}: ${r.fields.map(escape).join(', ')}</p>`).join('')}</details>${button('Clear previewed summaries and results','apply-cleanup',!cleanupPreview.eligibleWorkIds.length?'disabled':'','primary small')}${button('Cancel preview','cancel-cleanup','','small')}</section>`:''}</section>`;
}
function settingsView() {
  return `<h1>Settings</h1><section class="section" aria-label="Connection"><h2>Connection</h2><p>Connected to Orca</p>${button('Test connection', 'test-connection', '', 'small')}<details><summary>Technical details</summary><p>${escape(connection)}</p></details></section>${cleanupView()}<section class="section"><h2>Roster display</h2><label class="check"><input type="checkbox" data-setting="chart" ${state.settings.chart ? 'checked' : ''} ${busy || !loaded ? 'disabled' : ''}> Show organisation tree</label><label class="field">Team cards<select data-setting="layout" ${busy || !loaded ? 'disabled' : ''}><option value="stacked" ${state.settings.layout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="columns" ${state.settings.layout === 'columns' ? 'selected' : ''}>Side by side when there is room</option></select></label></section><section class="section"><h2>Team launching</h2><p>Launch calls go to the bundled worker on your PC through the runtime adapter. Orca opens agent tabs on each team's saved project and execution host and passes each role brief as its startup prompt. The panel records actual created-tab receipts; it does not infer readiness or provider session IDs.</p><p>Default model and effort inherit agent configuration. New teams start all roster members. Tasks share the selected directory. Scope coordination does not isolate undeclared filesystem writes.</p></section>`;
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
async function refreshCapabilities(params, scope, force = false, retry = 0) {
  if (!scope?.selectionToken || capabilitiesLoading) return;
  const previous = capabilityViews.get(scope.workspaceKey);
  if (!force && previous && Date.now() - previous.observedAt < 300000) return;
  clearTimeout(capabilityRetryTimer);
  capabilityViews.delete(scope.workspaceKey);
  capabilitiesLoading = true; render();
  try {
    const value = await call('capabilities', params);
    capabilityViews.set(value.workspaceKey, value);
    if (retry < 4 && value.connection === 'connected' && value.executionHostId === 'local' && Object.values(value.agents).some(agent => agent.listingInProgress)) {
      capabilityRetryTimer = setTimeout(() => {
        if (view === 'new' && !busy && (confirmedWorkspace || workspace)?.workspaceKey === scope.workspaceKey) void refreshCapabilities(params, scope, true, retry + 1);
      }, 11000);
    }
  } catch (error) { problem = `Could not load models: ${error.message}`; }
  finally { capabilitiesLoading = false; render(); }
}
async function enterNewTeam() {
  view = 'new'; message = ''; render();
  if (!confirmedWorkspace) await refreshTargets();
  const scope = confirmedWorkspace || workspace;
  if (scope?.selectionToken) await refreshCapabilities({ selectionToken: scope.selectionToken }, scope);
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
  if (action === 'new') { await enterNewTeam(); }
  else if (['roster', 'settings'].includes(action)) { view = action; message = ''; render(); }
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
  else if (action === 'pick') {
    const field = target.dataset.field;
    form[field] = ['levels', 'fan'].includes(field) ? Number(target.dataset.value) : target.dataset.value;
    if (field === 'structure') { form.levels = form.structure === 'organisation' ? 3 : 2; if (!form.groups) form.groups = 'Team 1, Team 2'; }
    render();
  } else if (action === 'create') {
    try {
      if (!confirmedWorkspace) throw new Error('Confirm the project and execution host first.');
      const count = form.structure === 'organisation' ? 3 : form.levels;
      for (let i = 0; i < count; i++) { const issue = preferenceIssue({agent:form.agents[i],model:form.models[i],effort:form.efforts[i]},capabilityViews.get(confirmedWorkspace.workspaceKey)); if (issue) throw Error(issue); }
      if (await submit('createTeam', { form:{...form,sessionMode:true,launchMode:'all'}, selectionToken: confirmedWorkspace.selectionToken })) { await launchTeam(state.teams.length-1); view='roster'; await refreshRoster();render(); }
    } catch (error) { busy = false; message = ''; problem = error.message; canRetry = false; render(); }
  }
  else if (action === 'retry' || action === 'test-connection') { connectionReady = false; await load(action === 'test-connection'); }
  else if (action === 'refresh-tabs') { confirmedWorkspace = null; await enterNewTeam(); }
  else if (action === 'confirm-project') { confirmedWorkspace = workspace; await refreshCapabilities({ selectionToken: workspace.selectionToken }, workspace); render(); }
  else if (action === 'refresh-capabilities') {
    if (view === 'new') { const scope = confirmedWorkspace || workspace; await refreshCapabilities({ selectionToken: scope.selectionToken }, scope, true); }
  }
  else if (action === 'open-supervisor') {
    busy = true; problem = ''; message = ''; render();
    try {
      const team = state.teams.find(row => row.id === target.dataset.team);
      const supervisor = team?.members.find(row => row.boss === null);
      if (!supervisor || supervisor.id !== target.dataset.member) throw Error('The team supervisor has changed. Refresh the roster.');
      await call('openMember', { teamId: team.id, memberId: supervisor.id, requestId: target.dataset.request });
      message = 'Opened the supervisor’s session.';
    } catch (error) { problem = error.message; }
    finally { busy = false; render(); }
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
  else if (target.dataset.agent !== undefined) { const i = Number(target.dataset.agent); form.agents[i] = target.value; form.models[i] = 'default'; form.efforts[i] = 'default'; render(); }
  else if (target.dataset.model !== undefined) {
    const i = Number(target.dataset.model);
    form.models[i] = target.value.trim() || 'default';
    form.efforts[i] = 'default';
    render();
  } else if (target.dataset.effort !== undefined) { form.efforts[Number(target.dataset.effort)] = target.value; updatePreview(); }
  else if (target.dataset.setting) { await submit('updateSettings', { settings: { ...state.settings, [target.dataset.setting]: target.type === 'checkbox' ? target.checked : target.value } }); }
});
async function refreshRoster(){
 if(rosterRefreshRunning||busy||!connectionReady||!storageAvailable||view!=='roster'||document.visibilityState==='hidden')return;
 rosterRefreshRunning=true;
 try {
   const result = await call('rosterStatus', {});
   if (busy || view !== 'roster') return;
   if (result.value.revision >= state.revision) state = validatePersistentState(result.value);
   telemetry = result.telemetry;
   await refreshTargets();
   if (!busy && view === 'roster') render();
 }
 catch(error){connectionReady=false;storageAvailable=false;problem=error.message;render();}
 finally{rosterRefreshRunning=false;}
}
setInterval(()=>void refreshRoster(),5000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void refreshRoster();});
render();
void load();
