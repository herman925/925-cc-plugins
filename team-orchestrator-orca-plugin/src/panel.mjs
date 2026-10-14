import { PRESETS, DEFAULT_FORM, SETTINGS, GLYPHS, planTeam, addTeam, validateState } from './team.mjs';
import { createBridge } from './bridge.mjs';

const app = document.getElementById('app');
const call = createBridge(window.parent);
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
    return `<tr><th scope="row">${name}</th><td><input aria-label="${name} model" data-model="${i}" list="model-options" value="${escape(form.models[i])}" maxlength="120" placeholder="default or model ID"></td><td><select aria-label="${name} effort" data-effort="${i}" ${form.models[i] === 'default' ? 'disabled' : ''}>${['default', 'low', 'medium', 'high', 'xhigh'].map(value => `<option value="${value}" ${form.efforts[i] === value ? 'selected' : ''}>${({ default: 'Default', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high' })[value]}</option>`).join('')}</select></td></tr>`;
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
  return `<div class="flow"><h1>New team</h1><p class="steps">① Setup <span>→</span> ② Models <span>→</span> ③ Preview <span>→</span> Create</p></div>
    <section class="section"><h2><span>①</span> Setup</h2><label class="field">Team name<input id="team-name" data-form="name" value="${escape(form.name)}" maxlength="64" autocomplete="off"></label><label class="field">Function<textarea id="team-purpose" data-form="purpose" maxlength="500" rows="2" placeholder="What the team is for, in a sentence">${escape(form.purpose)}</textarea></label><div class="field"><span>Quick start</span>${presets()}</div><div class="field"><span>Structure</span>${segment('structure', [['team', 'One team'], ['organisation', 'CEO over several teams']], form.structure)}</div>
    ${form.structure === 'organisation' ? `<label class="field">Teams<input id="team-groups" data-form="groups" value="${escape(form.groups)}" maxlength="520" placeholder="Team 1, Team 2"><small>Names separated by commas; each gets a head and workers.</small></label>` : `<div class="field"><span>Levels</span>${segment('levels', [[1, '1 · Head only'], [2, '2 · Head + workers'], [3, '3 · Head + leads + workers']], form.levels)}</div>`}
    <div class="field"><span>${form.structure === 'organisation' ? 'Workers each' : 'Reports each'}</span>${segment('fan', [1, 2, 3, 4, 5].map(n => [n, `${n}`]), form.fan)}</div></section>
    <section class="section"><h2><span>②</span> Model and effort per level</h2><p class="subtle">Codex · Default inherits your agent configuration.</p><div class="table-scroll"><table class="models"><thead><tr><th>Level</th><th>Model</th><th>Effort</th></tr></thead><tbody>${configRows()}</tbody></table></div><datalist id="model-options"><option value="default"></option><option value="gpt-6.1-sol"></option><option value="gpt-6-astra"></option><option value="gpt-6-sol"></option></datalist></section>
    <section class="section"><h2><span>③</span> Organisation preview</h2><div id="preview">${preview()}</div></section>
    <div class="actions">${button('Create team', 'create', busy || !loaded ? 'disabled' : '', 'primary')}${button('Cancel', 'roster', '', 'secondary')}</div>`;
}
function details() {
  if (!selection) return '';
  const team = state.teams[selection.team];
  const member = team?.members.find(row => row.id === selection.member);
  if (!member) return '';
  const boss = team.members.find(row => row.id === member.boss);
  const reports = team.members.filter(row => row.boss === member.id);
  return `<section class="inspector" aria-label="Member details"><div class="section-heading"><h2>${GLYPHS[member.role]} ${escape(member.name)}</h2>${button('Close details', 'close-details', '', 'small')}</div><dl><dt>Role</dt><dd>${label(member.role)}</dd><dt>Reports to</dt><dd>${escape(boss?.name || 'You')}</dd><dt>Direct reports</dt><dd>${reports.length}</dd><dt>Agent</dt><dd>Codex</dd><dt>Model</dt><dd>${escape(member.model)}</dd><dt>Effort</dt><dd>${escape(member.effort)}</dd><dt>Assignment</dt><dd>Unassigned</dd></dl><p>${escape(member.brief)}</p></section>`;
}
function roster() {
  if (!state.teams.length) return empty();
  const charts = state.settings.chart ? `<section class="organisation"><h2>Organisation</h2>${state.teams.map((team, i) => `<div class="chart-heading">@${escape(team.name)}</div><div class="tree-scroll org-chart">${tree(team.members, null, true, i, true)}</div>`).join('')}</section>` : '';
  return `<div class="section-heading"><h1>Team roster</h1>${button('+ New team', 'new', '', 'primary small')}</div>${charts}<div class="team-cards ${state.settings.layout === 'columns' ? 'columns' : ''}">${state.teams.map((team, i) => `<section class="team-card"><header><h2>@${escape(team.name)}</h2><small>${team.members.length} members</small></header>${team.purpose ? `<p class="purpose">${escape(team.purpose)}</p>` : ''}<div class="table-scroll"><table class="roster"><thead><tr><th>Name</th><th>Role</th><th>Model</th><th>Effort</th><th>Assignment</th></tr></thead><tbody>${team.members.map(member => `<tr><td>${button(`${GLYPHS[member.role]} ${escape(member.name)}`, 'member', `data-team="${i}" data-member="${escape(member.id)}"`, 'name-button')}</td><td>${label(member.role)}</td><td>${escape(member.model)}</td><td>${escape(member.effort)}</td><td><span class="status-dot" aria-hidden="true"></span>Unassigned</td></tr>`).join('')}</tbody></table></div></section>`).join('')}</div>${details()}`;
}
function settingsView() {
  return `<h1>Settings</h1><section class="section"><h2>Roster display</h2><label class="check"><input type="checkbox" data-setting="chart" ${state.settings.chart ? 'checked' : ''} ${busy || !loaded ? 'disabled' : ''}> Show organisation tree</label><label class="field">Team cards<select data-setting="layout" ${busy || !loaded ? 'disabled' : ''}><option value="stacked" ${state.settings.layout === 'stacked' ? 'selected' : ''}>Stacked</option><option value="columns" ${state.settings.layout === 'columns' ? 'selected' : ''}>Side by side when there is room</option></select></label></section><section class="section"><h2>Team creation</h2><p>Created members stay unassigned. This version saves team definitions; it does not launch agent sessions.</p><p>Model IDs are configurable; availability is checked when runtime integration is added.</p></section>`;
}
function render() {
  app.setAttribute('aria-busy', String(busy));
  app.innerHTML = `<header class="app-header"><div class="brand"><span aria-hidden="true">◆</span> Team Orchestrator<small>v0.1.0</small></div><nav aria-label="Team Orchestrator">${[['roster', 'Roster'], ['new', 'New team'], ['settings', 'Settings']].map(([id, text]) => button(text, id, `aria-current="${view === id ? 'page' : 'false'}"`, view === id ? 'active' : '')).join('')}</nav></header><main>
    ${problem ? `<div class="notice error" role="alert">${escape(problem)} ${canRetry ? button('Retry storage', 'retry', busy ? 'disabled' : '', 'small') : ''}</div>` : ''}
    ${loaded && !storageAvailable ? `<div class="notice" role="status">Session-only mode. This Orca build does not expose panel storage. Teams can be created here, but will be lost when the panel closes.</div>` : ''}
    ${message ? `<p class="notice success" role="status">${escape(message)}</p>` : ''}
    ${busy && !loaded ? '<p class="loading">Reading saved teams…</p>' : view === 'new' ? formView() : view === 'settings' ? settingsView() : roster()}
    </main><footer>${storageAvailable ? 'Saved in Orca' : loaded ? 'Session only' : 'Connecting to Orca'}<span>Codex · Team definitions</span></footer>`;
}
function updatePreview() { const node = document.getElementById('preview'); if (node) node.innerHTML = preview(); }
async function load() {
  busy = true; problem = ''; canRetry = false; render();
  try {
    const result = await call('storage.get', { key: KEY });
    state = validateState(result?.value ?? null);
    loaded = true; storageAvailable = true;
  } catch (error) {
    if (['panel_forbidden', 'unknown_method', 'invalid_request'].includes(error.code)) { loaded = true; storageAvailable = false; }
    else { loaded = false; problem = error.message; canRetry = true; }
  } finally { busy = false; render(); }
}
async function save(next) {
  if (!loaded || busy) return false;
  busy = true; problem = ''; canRetry = false; render();
  try {
    if (storageAvailable) await call('storage.set', { key: KEY, value: next });
    state = next;
    return true;
  } catch (error) { problem = `Could not save: ${error.message}`; canRetry = true; return false; }
  finally { busy = false; render(); }
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
      if (await save(next)) { view = 'roster'; selection = null; message = `Created @${team.name} with ${team.members.length} members.`; render(); }
    } catch (error) { message = ''; problem = error.message; canRetry = false; render(); }
  } else if (action === 'member') { selection = { team: Number(target.dataset.team), member: target.dataset.member }; render(); document.querySelector('.inspector')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  else if (action === 'close-details') { selection = null; render(); }
  else if (action === 'retry') { await load(); }
});
app.addEventListener('input', event => {
  const target = event.target;
  if (target.dataset.form) { form[target.dataset.form] = target.value; updatePreview(); }
});
app.addEventListener('change', async event => {
  const target = event.target;
  if (target.dataset.model !== undefined) {
    const i = Number(target.dataset.model);
    form.models[i] = target.value.trim() || 'default';
    if (form.models[i] === 'default') form.efforts[i] = 'default';
    render();
  } else if (target.dataset.effort !== undefined) { form.efforts[Number(target.dataset.effort)] = target.value; updatePreview(); }
  else if (target.dataset.setting) { await save({ ...state, settings: { ...state.settings, [target.dataset.setting]: target.type === 'checkbox' ? target.checked : target.value } }); }
});
render();
void load();
