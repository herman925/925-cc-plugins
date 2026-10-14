import { PRESETS, DEFAULT_FORM, GLYPHS, planTeam, addTeam, validateState } from './team.mjs';
import { createBridge } from './bridge.mjs';
import { createWorkerBridge } from './worker-bridge.mjs';
import { initialMembers, launchMembers } from './launch.mjs';

const app = document.getElementById('app');
const rawCall = createBridge(window.parent);
const worker = createWorkerBridge(rawCall);
const call = (action, params) => worker.call(action, params);
let connection = 'Checking the bundled local executor…';
let connectionReady = false;
const KEY = 'team-definitions-v1';
let state = validateState(null);
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
let launchMode = 'on-demand';
let targetError = '';

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
function configRows() {
  const count = form.structure === 'organisation' ? 3 : form.levels;
  return Array.from({ length: count }, (_, i) => {
    const name = form.structure === 'organisation' ? ['CEO', 'Heads', 'Workers'][i] : i === 0 ? 'Head' : i === count - 1 ? 'Workers' : 'Leads';
    return `<tr><th scope="row">${name}</th><td><select aria-label="${name} CLI" data-agent="${i}">${[['codex', 'Codex'], ['claude', 'Claude Code']].map(([value, text]) => `<option value="${value}" ${form.agents[i] === value ? 'selected' : ''}>${text}</option>`).join('')}</select></td><td><input aria-label="${name} model" data-model="${i}" list="model-options" value="${escape(form.models[i])}" maxlength="120" placeholder="default or model ID"></td><td><select aria-label="${name} effort" data-effort="${i}" ${form.models[i] === 'default' ? 'disabled' : ''}>${['default', 'low', 'medium', 'high', 'xhigh'].map(value => `<option value="${value}" ${form.efforts[i] === value ? 'selected' : ''}>${({ default: 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' })[value]}</option>`).join('')}</select></td></tr>`;
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
    <section class="section"><h2><span>②</span> CLI, model and effort per level</h2><p class="subtle">Default inherits your agent configuration.</p><div class="table-scroll"><table class="models"><thead><tr><th>Level</th><th>CLI</th><th>Model</th><th>Effort</th></tr></thead><tbody>${configRows()}</tbody></table></div><datalist id="model-options"><option value="default"></option><option value="gpt-6.1-sol"></option><option value="gpt-6-astra"></option><option value="gpt-6-sol"></option><option value="opus"></option><option value="sonnet"></option><option value="haiku"></option></datalist></section>
    <section class="section"><h2><span>③</span> Organisation preview</h2><div id="preview">${preview()}</div></section>
    ${launchControls()}<div class="actions">${button('Create and launch team', 'create', busy || !loaded || workspace?.nativeAgentLaunch !== true ? 'disabled' : '', 'primary')}${button('Cancel', 'roster', '', 'secondary')}</div>`;
}
function launchControls() {
  return `<section class="section launch-controls"><h2>Launch</h2><p><strong>${escape(workspace?.displayName ?? 'No active workspace')}</strong> · Orca opens new tabs on this workspace's execution host.</p>${button('Refresh workspace', 'refresh-tabs', '', 'small')}<label class="field">Launch mode<select data-launch-mode><option value="on-demand" ${launchMode === 'on-demand' ? 'selected' : ''}>On demand · start CEO and heads</option><option value="all" ${launchMode === 'all' ? 'selected' : ''}>All at create · start every member</option></select></label><p class="subtle">Orca launches each selected CLI, names its tab and passes its role briefing directly. No existing agent tab receives a launch request.</p>${targetError ? `<p class="validation" role="alert">${escape(targetError)}</p>` : ''}</section>`;
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
  if (!team.launch.native) return '<p class="subtle">Legacy coordinator request. Inspect that agent for any existing resources before recreating this team.</p>';
  const created = Object.values(team.launch.members ?? {}).filter(row => row.terminalId);
  return `<p class="subtle">${created.length} actual tab receipt${created.length === 1 ? '' : 's'}. Input delivery does not prove agent readiness.</p>${created.length ? `<ul>${created.map(row => `<li>${escape(row.title)} · ${escape(row.executionHostId ?? 'execution host unreported')}<br><small>${escape(row.terminalId)}</small>${row.error ? `<p>${escape(row.error)}</p>` : ''}</li>`).join('')}</ul>` : ''}`;
}
function details() {
  if (!selection) return '';
  const team = state.teams[selection.team];
  const member = team?.members.find(row => row.id === selection.member);
  if (!member) return '';
  const boss = team.members.find(row => row.id === member.boss);
  const reports = team.members.filter(row => row.boss === member.id);
  return `<section class="inspector" aria-label="Member details"><div class="section-heading"><h2>${GLYPHS[member.role]} ${escape(member.name)}</h2>${button('Close details', 'close-details', '', 'small')}</div><dl><dt>Role</dt><dd>${label(member.role)}</dd><dt>Reports to</dt><dd>${escape(boss?.name || 'You')}</dd><dt>Direct reports</dt><dd>${reports.length}</dd><dt>Agent</dt><dd>${member.agent === 'claude' ? 'Claude Code' : 'Codex'}</dd><dt>Model</dt><dd>${escape(member.model)}</dd><dt>Effort</dt><dd>${escape(member.effort)}</dd><dt>Launch</dt><dd>${launchStatus(team, member)}</dd></dl><p>${escape(member.brief)}</p></section>`;
}
function roster() {
  if (!state.teams.length) return empty();
  const charts = state.settings.chart ? `<section class="organisation"><h2>Organisation</h2>${state.teams.map((team, i) => `<div class="chart-heading">@${escape(team.name)}</div><div class="tree-scroll org-chart">${tree(team.members, null, true, i, true)}</div>`).join('')}</section>` : '';
  return `<div class="section-heading"><h1>Team roster</h1>${button('+ New team', 'new', '', 'primary small')}</div>${charts}<div class="team-cards ${state.settings.layout === 'columns' ? 'columns' : ''}">${state.teams.map((team, i) => `<section class="team-card"><header><h2>@${escape(team.name)}</h2><small>${team.members.length} members</small></header>${team.purpose ? `<p class="purpose">${escape(team.purpose)}</p>` : ''}<div class="table-scroll"><table class="roster"><thead><tr><th>Name</th><th>Role</th><th>CLI</th><th>Model</th><th>Effort</th><th>Launch</th></tr></thead><tbody>${team.members.map(member => `<tr><td>${button(`${GLYPHS[member.role]} ${escape(member.name)}`, 'member', `data-team="${i}" data-member="${escape(member.id)}"`, 'name-button')}</td><td>${label(member.role)}</td><td>${member.agent === 'claude' ? 'Claude' : 'Codex'}</td><td>${escape(member.model)}</td><td>${escape(member.effort)}</td><td><span class="status-dot" aria-hidden="true"></span>${launchStatus(team, member)}</td></tr>`).join('')}</tbody></table></div>${!team.launch ? button('Launch this team', 'launch-existing', `data-team="${i}" ${workspace?.nativeAgentLaunch !== true ? 'disabled' : ''}`, 'primary small') : launchReceipt(team)}</section>`).join('')}</div>${state.teams.some(team => !team.launch) ? launchControls() : ''}${details()}`;
}
function settingsView() {
  return `<h1>Settings</h1><section class="section"><h2>Roster display</h2><label class="check"><input type="checkbox" data-setting="chart" ${state.settings.chart ? 'checked' : ''} ${busy || !loaded ? 'disabled' : ''}> Show organisation tree</label><label class="field">Team cards<select data-setting="layout" ${busy || !loaded ? 'disabled' : ''}><option value="stacked" ${state.settings.layout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="columns" ${state.settings.layout === 'columns' ? 'selected' : ''}>Side by side when there is room</option></select></label></section><section class="section"><h2>Team launching</h2><p>Launch calls go to the bundled worker on your PC through the runtime adapter. Orca opens agent tabs on the active workspace's execution host and passes each role brief as its startup prompt. The panel records actual created-tab receipts; it does not infer readiness or provider session IDs.</p><p>Default model and effort inherit agent configuration. On-demand mode starts CEO and heads; all-at-create starts every member.</p></section>`;
}
function render() {
  app.setAttribute('aria-busy', String(busy));
  app.innerHTML = `<header class="app-header"><div class="brand"><span aria-hidden="true">◆</span> Team Orchestrator<small>v${escape(__PLUGIN_DISPLAY_VERSION__)}</small></div><nav aria-label="Team Orchestrator">${[['roster', 'Roster'], ['new', 'New team'], ['settings', 'Settings']].map(([id, text]) => button(text, id, `aria-current="${view === id ? 'page' : 'false'}"`, view === id ? 'active' : '')).join('')}</nav></header><main>
    <div class="notice" role="status">${escape(connection)} ${button('Test connection', 'test-connection', busy ? 'disabled' : '', 'small')}</div>
    ${problem ? `<div class="notice error" role="alert">${escape(problem)} ${canRetry ? button('Retry storage', 'retry', busy ? 'disabled' : '', 'small') : ''}</div>` : ''}
    ${loaded && !storageAvailable ? `<div class="notice" role="status">Session-only mode. The local executor has not loaded persistent storage. Launching stays disabled until connection is verified.</div>` : ''}
    ${message ? `<p class="notice success" role="status">${escape(message)}</p>` : ''}
    ${busy && !loaded ? '<p class="loading">Reading saved teams…</p>' : view === 'new' ? formView() : view === 'settings' ? settingsView() : roster()}
    </main><footer>${storageAvailable ? 'Saved in Orca' : loaded ? 'Session only' : 'Connecting to Orca'}<span>Orca · Agent teams</span></footer>`;
  if (busy) for (const control of app.querySelectorAll('button,input,select,textarea')) control.disabled = true;
}
function updatePreview() { const node = document.getElementById('preview'); if (node) node.innerHTML = preview(); }
async function load() {
  busy = true; problem = ''; canRetry = false; render();
  try {
    const report = await worker.connect();
    connectionReady = true;
    connection = `Local executor connected · ${report.platform} · Orca ${report.appVersion} · worker ${report.workerPid}`;
    const result = await call('storage.get', { key: KEY });
    state = validateState(result?.value ?? null);
    loaded = true; storageAvailable = true;
  } catch (error) {
    if (!connectionReady) { loaded = true; storageAvailable = false; connection = 'Bundled executor is not connected. Bootstrap starts on agent/workspace activity; the Orca command “Team Orchestrator: Initialise local adapter” also starts it.'; problem = error.message; }
    else if (['panel_forbidden', 'unknown_method', 'invalid_request'].includes(error.code)) { loaded = true; storageAvailable = false; }
    else { loaded = false; problem = error.message; canRetry = true; }
  } finally { busy = false; await refreshTargets(); render(); }
}
async function refreshTargets() {
  try {
    workspace = await call('workspace.readContext', {});
    targetError = !workspace ? 'Open the intended workspace first.' : workspace.nativeAgentLaunch !== true ? 'The local executor is not ready. Use Test connection after the bundled bootstrap finishes.' : '';
  } catch (error) { workspace = null; targetError = error.message; }
}
async function launchTeam(index) {
  const team = state.teams[index];
  if (team.launch) throw new Error('This launch has already been attempted. Inspect its receipts before starting another team.');
  busy = true; render();
  await refreshTargets();
  if (targetError) { busy = false; render(); throw new Error(targetError); }
  const request = { native: true, status: 'sending', workspaceKey: workspace.workspaceKey, mode: launchMode, members: {} };
  const withRequest = { ...state, teams: state.teams.map((item, i) => i === index ? { ...item, launch: request } : item) };
  if (!await save(withRequest, true, true)) return;
  busy = true; render();
  const persist = async () => { if (storageAvailable) await call('storage.set', { key: KEY, value: state }); };
  try {
    await launchMembers(call, team, launchMode, workspace, async (id, receipt) => {
      request.members[id] = receipt;
      render();
      await persist();
    });
    request.status = 'accepted';
    message = `Orca created ${initialMembers(team, launchMode).length} tab(s) for @${team.name} and passed their role briefs. Check those tabs for agent readiness.`;
  } catch (error) { request.status = 'unknown'; problem = `${error.message} Any partial tab receipts are retained below; no automatic retry occurs.`; }
  finally {
    try { await persist(); } catch (error) { problem = `Could not save the latest launch receipt: ${error.message}`; }
    busy = false; render();
  }
}
async function save(next, holdBusy = false, insideLaunch = false) {
  if (!loaded || (busy && !insideLaunch)) return false;
  let saved = false;
  busy = true; problem = ''; canRetry = false; render();
  try {
    if (storageAvailable) await call('storage.set', { key: KEY, value: next });
    state = next;
    saved = true;
    return true;
  } catch (error) { problem = `Could not save: ${error.message}`; canRetry = true; return false; }
  finally { busy = holdBusy && saved; render(); }
}

app.addEventListener('click', async event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled || busy) return;
  const action = target.dataset.action;
  if (['roster', 'new', 'settings'].includes(action)) { view = action; message = ''; render(); }
  else if (action === 'preset') { Object.assign(form, PRESETS[Number(target.dataset.index)].form); view = 'new'; message = ''; render(); }
  else if (action === 'pick') {
    const field = target.dataset.field;
    form[field] = ['levels', 'fan'].includes(field) ? Number(target.dataset.value) : target.dataset.value;
    if (field === 'structure') { form.levels = form.structure === 'organisation' ? 3 : 2; if (!form.groups) form.groups = 'Team 1, Team 2'; }
    render();
  } else if (action === 'create') {
    try {
      const team = { ...planTeam(form), id: crypto.randomUUID(), createdAt: new Date().toISOString() };
      const next = addTeam(state, team);
      if (workspace?.nativeAgentLaunch !== true) throw new Error(targetError || 'Native launching is unavailable.');
      if (await save(next, true)) { view = 'roster'; selection = null; await launchTeam(state.teams.length - 1); render(); }
    } catch (error) { busy = false; message = ''; problem = error.message; canRetry = false; render(); }
  } else if (action === 'member') { selection = { team: Number(target.dataset.team), member: target.dataset.member }; render(); document.querySelector('.inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  else if (action === 'close-details') { selection = null; render(); }
  else if (action === 'retry' || action === 'test-connection') { connectionReady = false; await load(); }
  else if (action === 'refresh-tabs') { await refreshTargets(); render(); }
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
  if (target.hasAttribute('data-launch-mode')) { launchMode = target.value; }
  else if (target.dataset.agent !== undefined) { const i = Number(target.dataset.agent); form.agents[i] = target.value; form.models[i] = 'default'; form.efforts[i] = 'default'; render(); }
  else if (target.dataset.model !== undefined) {
    const i = Number(target.dataset.model);
    form.models[i] = target.value.trim() || 'default';
    if (form.models[i] === 'default') form.efforts[i] = 'default';
    render();
  } else if (target.dataset.effort !== undefined) { form.efforts[Number(target.dataset.effort)] = target.value; updatePreview(); }
  else if (target.dataset.setting) { await save({ ...state, settings: { ...state.settings, [target.dataset.setting]: target.type === 'checkbox' ? target.checked : target.value } }); }
});
render();
void load();
