export const PRESETS = [
  { label: 'Squad', sketch: '●┬○○○', hint: 'Head + 3 workers', form: { name: 'Squad', structure: 'team', levels: 2, fan: 3, groups: '' } },
  { label: 'All-Purpose Team', sketch: '■┬●●', hint: 'CEO + 2 heads, 4 workers each', form: { name: 'All-Purpose-Team', structure: 'organisation', levels: 3, fan: 4, groups: 'Team 1, Team 2' } },
  { label: 'Tech Team', sketch: '■┬●●●●', hint: 'CEO + 4 heads, 4 workers each', form: { name: 'Tech-Team', structure: 'organisation', levels: 3, fan: 4, groups: 'Dev Team, UI Team, Test Team, Security Team' } }
];
export const DEFAULT_FORM = { ...PRESETS[0].form, purpose: '', agents: ['codex', 'codex', 'codex'], models: ['default', 'default', 'default'], efforts: ['default', 'default', 'default'] };
export const SETTINGS = { chart: true, layout: 'stacked' };
export const GLYPHS = { ceo: '■', head: '●', lead: '◇', worker: '○' };

export function cleanName(value) { return value.trim().replace(/\s+/g, '-'); }
function nameValid(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value); }
export function planTeam(form) {
  const name = cleanName(form.name);
  if (!nameValid(name)) throw new Error('Use a team name of 1–64 letters, numbers, underscores or dashes, starting with a letter or number.');
  if (!['team', 'organisation'].includes(form.structure)) throw new Error('Choose a team structure.');
  if (![1, 2, 3].includes(form.levels) || ![1, 2, 3, 4, 5].includes(form.fan)) throw new Error('Choose 1–3 levels and 1–5 reports per manager.');
  if (typeof form.purpose !== 'string' || form.purpose.length > 500) throw new Error('Keep the team function under 500 characters.');
  for (const values of [form.models, form.efforts]) {
    if (!Array.isArray(values) || values.length !== 3 || values.some(value => typeof value !== 'string' || !value || value.length > 120)) throw new Error('Invalid model or effort selection.');
  }
  if (form.efforts.some(value => !['default', 'low', 'medium', 'high', 'xhigh'].includes(value))) throw new Error('Invalid effort selection.');
  if (form.models.some((model, i) => model === 'default' && form.efforts[i] !== 'default')) throw new Error('Choose a model before overriding its effort.');
  const agents = form.agents ?? ['codex', 'codex', 'codex'];
  if (!Array.isArray(agents) || agents.length !== 3 || agents.some(agent => !['codex', 'claude'].includes(agent))) throw new Error('Choose Codex or Claude Code for each level.');
  const members = [];
  const add = (memberName, team, role, level, boss) => {
    const id = `member-${members.length + 1}`;
    const purpose = form.purpose.trim() || 'the team goal';
    const brief = role === 'worker' ? `Execute tasks from ${boss.name} and report back.` : `Own ${purpose}; plan, delegate to direct reports, review results and report to ${boss?.name || 'the user'}.`;
    const member = { id, name: memberName, team, role, level, boss: boss?.id || null, model: form.models[level - 1], effort: form.efforts[level - 1], agent: agents[level - 1], state: 'unassigned', brief };
    members.push(member);
    return member;
  };
  if (form.structure === 'organisation') {
    const groups = form.groups.split(',').map(cleanName);
    if (!groups.length || groups.length > 8 || groups.some(group => !nameValid(group))) throw new Error('Enter 1–8 team names separated by commas.');
    if (new Set(groups.map(group => group.toLowerCase())).size !== groups.length) throw new Error('Team names must be unique.');
    if (groups.some(group => group.toLowerCase() === name.toLowerCase())) throw new Error('Give the organisation and its teams different names.');
    const ceo = add('CEO', name, 'ceo', 1, null);
    for (const group of groups) {
      const head = add(`${group}-Head`, group, 'head', 2, ceo);
      for (let i = 1; i <= form.fan; i++) add(`${group}-Worker-${i}`, group, 'worker', 3, head);
    }
  } else {
    let tier = [add('Head', name, 'head', 1, null)];
    for (let level = 2; level <= form.levels; level++) {
      const next = [];
      tier.forEach((boss, index) => {
        for (let i = 1; i <= form.fan; i++) {
          const role = level === form.levels ? 'worker' : 'lead';
          const suffix = form.levels === 2 ? `${i}` : `${index + 1}-${i}`;
          next.push(add(`${role === 'worker' ? 'Worker' : 'Lead'}-${suffix}`, name, role, level, boss));
        }
      });
      tier = next;
    }
  }
  return { name, purpose: form.purpose.trim(), structure: form.structure, members, configuration: { ...form, agents } };
}

export function addTeam(state, team) {
  const incoming = new Set([team.name, ...team.members.map(member => member.team)].map(name => name.toLowerCase()));
  if (state.teams.some(existing => [existing.name, ...existing.members.map(member => member.team)].some(name => incoming.has(name.toLowerCase())))) throw new Error('A team with this name already exists. Choose a different name; existing teams are never replaced.');
  return { ...state, teams: [...state.teams, team] };
}

export function validateState(value) {
  if (value === null) return { version: 1, teams: [], settings: { ...SETTINGS } };
  if (!value || value.version !== 1 || !Array.isArray(value.teams) || value.teams.length > 100) throw new Error('Saved team data has an unsupported format. It has been left untouched.');
  const string = (s, max = 120) => typeof s === 'string' && s.length > 0 && s.length <= max;
  let validated = { version: 1, teams: [], settings: { ...SETTINGS } };
  for (const team of value.teams) {
    if (!team || !nameValid(team.name) || typeof team.purpose !== 'string' || team.purpose.length > 500 || !['team', 'organisation'].includes(team.structure) || !Array.isArray(team.members) || !team.members.length || team.members.length > 49) throw new Error('Saved team data is invalid. It has been left untouched.');
    const ids = new Set();
    const names = new Set();
    for (const member of team.members) {
      if (!member || !string(member.id) || !string(member.name) || !nameValid(member.team) || !Object.hasOwn(GLYPHS, member.role) || ![1, 2, 3].includes(member.level) || !['codex', 'claude'].includes(member.agent) || member.state !== 'unassigned' || !string(member.model) || !['default', 'low', 'medium', 'high', 'xhigh'].includes(member.effort) || !string(member.brief, 1500) || ids.has(member.id) || names.has(member.name.toLowerCase())) throw new Error('Saved member data is invalid. It has been left untouched.');
      if (member.boss !== null && !ids.has(member.boss)) throw new Error('Saved reporting relationships are invalid. It has been left untouched.');
      if (member.boss === null && ids.size !== 0) throw new Error('Saved team has multiple roots. It has been left untouched.');
      if ((member.boss === null && member.level !== 1) || (member.boss !== null && team.members.find(boss => boss.id === member.boss)?.level !== member.level - 1)) throw new Error('Saved hierarchy levels are invalid. It has been left untouched.');
      ids.add(member.id); names.add(member.name.toLowerCase());
    }
    if (team.configuration) {
      const planned = planTeam(team.configuration);
      if (JSON.stringify(planned.members) !== JSON.stringify(team.members) || planned.name !== team.name || planned.purpose !== team.purpose || planned.structure !== team.structure) throw new Error('Saved launch configuration does not match its roster. It has been left untouched.');
    }
    if (team.launch) {
      const request = team.launch;
      if (!['sending', 'accepted', 'rejected', 'unknown'].includes(request.status) || !['on-demand', 'all'].includes(request.mode)) throw new Error('Saved launch request is invalid. It has been left untouched.');
      if (request.native === true) {
        if (!/^[a-f0-9]{64}$/.test(request.workspaceKey) || !request.members || typeof request.members !== 'object' || Array.isArray(request.members)) throw new Error('Saved native launch is invalid. It has been left untouched.');
        for (const [id, receipt] of Object.entries(request.members)) {
          if (!ids.has(id) || !receipt || !['starting', 'created', 'unknown'].includes(receipt.status) || (receipt.error !== undefined && !string(receipt.error, 1500)) || (receipt.status === 'created' && (!string(receipt.terminalId, 1024) || !string(receipt.title, 512) || typeof receipt.briefAccepted !== 'boolean' || (receipt.executionHostId !== null && !string(receipt.executionHostId, 256))))) throw new Error('Saved launch receipt is invalid. It has been left untouched.');
        }
      } else if (!string(request.terminalId, 1024)) throw new Error('Saved launch request is invalid. It has been left untouched.');
    }
    validated = addTeam(validated, team);
  }
  if (value.settings && typeof value.settings.chart === 'boolean' && ['stacked', 'columns'].includes(value.settings.layout)) validated.settings = { chart: value.settings.chart, layout: value.settings.layout };
  return validated;
}
