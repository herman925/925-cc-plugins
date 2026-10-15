// Portable configuration only. Native identities and observed runtime evidence
// never cross this boundary; refs exist solely to express the template tree.
export const TEMPLATE_FORMAT = 'orca-team-template';
export const TEMPLATE_VERSION = 1;
export const MAX_TEMPLATE_BYTES = 1024 * 1024;
const formFields = ['name', 'purpose', 'structure', 'levels', 'fan', 'groups', 'agents', 'models', 'efforts', 'launchMode'];
const memberFields = ['name', 'team', 'role', 'level', 'agent', 'model', 'effort', 'brief', 'habits', 'collaboration'];
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
export function exportTeamTemplate(team) {
  const refs = new Map(team.members.map((member, i) => [member.id, `m${i + 1}`]));
  return parseTeamTemplate({
    format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION,
    team: {
      name: team.name, purpose: team.purpose, structure: team.structure,
      configuration: structuredClone(pick(team.configuration, formFields)),
      members: team.members.map(member => ({ ref: refs.get(member.id), boss: member.boss === null ? null : refs.get(member.boss), ...pick(member, memberFields), preferenceOverride: member.preferenceOverride ?? false }))
    }
  });
}
const reject = detail => { throw new Error(`Invalid team template: ${detail}`); };
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
const name = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const only = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) reject('fields are missing or unsupported. Runtime/session/account fields cannot be imported.');
};
export function parseTeamTemplate(value) {
  let bytes;
  try { bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length; }
  catch { reject('the document must be serializable JSON.'); }
  if (bytes > MAX_TEMPLATE_BYTES) reject('the document exceeds the 1 MiB exchange limit.');
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('Template is not valid JSON. Export a new-format team template and try again.'); }
  }
  if (!value || value.format !== TEMPLATE_FORMAT || value.version !== TEMPLATE_VERSION) throw new Error('Unsupported team template format or version. Legacy mod and prototype data cannot be imported.');
  only(value, ['format', 'version', 'team']);
  const team = value.team;
  only(team, ['name', 'purpose', 'structure', 'configuration', 'members']);
  if (!name(team.name) || !text(team.purpose, 500, true) || !['team', 'organisation'].includes(team.structure) || !Array.isArray(team.members) || !team.members.length || team.members.length > 49) reject('choose a supported team name, structure and roster of 1–49 members.');
  const config = {...team.configuration,launchMode:team.configuration?.launchMode??'on-demand'};
  only(config, formFields);
  if (!text(config.name, 64) || !text(config.purpose, 500, true) || config.structure !== team.structure || ![1, 2, 3].includes(config.levels) || ![1, 2, 3, 4, 5].includes(config.fan) || !text(config.groups, 520, true)) reject('the saved setup configuration is invalid.');
  if(config.launchMode!==undefined&&!['on-demand','all'].includes(config.launchMode))reject('unsupported launch mode.');
  for (const key of ['agents', 'models', 'efforts']) {
    if (!Array.isArray(config[key]) || config[key].length !== 3 || config[key].some(value => !text(value, 120))) reject('three level preferences are required.');
  }
  if (config.agents.some(agent => !['codex', 'claude'].includes(agent))) reject('only Codex and Claude Code agent identities are supported.');
  const byRef = new Map(), names = new Set();
  for (const member of team.members) {
    only(member, ['ref', 'boss', ...memberFields, 'preferenceOverride']);
    if (!text(member.ref, 120) || byRef.has(member.ref) || !text(member.name, 120) || names.has(member.name.toLowerCase()) || !name(member.team) || !['ceo', 'head', 'lead', 'worker'].includes(member.role) || ![1, 2, 3].includes(member.level) || !['codex', 'claude'].includes(member.agent) || !text(member.model, 120) || !text(member.effort, 120) || typeof member.preferenceOverride !== 'boolean' || !text(member.brief, 1500) || !text(member.habits, 1500, true) || !text(member.collaboration, 1500, true) || (member.boss !== null && !text(member.boss, 120))) reject('member identities, roles or requested preferences are invalid.');
    byRef.set(member.ref, member); names.add(member.name.toLowerCase());
  }
  const roots = team.members.filter(member => member.boss === null);
  if (roots.length !== 1 || roots[0].level !== 1 || roots[0].role !== (team.structure === 'organisation' ? 'ceo' : 'head')) reject('the reporting tree must have exactly one Head or CEO root.');
  const visiting = new Set(), visited = new Set(), ordered = [];
  const visit = member => {
    if (visiting.has(member.ref)) reject('the reporting tree contains a cycle.');
    if (visited.has(member.ref)) return;
    visiting.add(member.ref);
    if (member.boss !== null) {
      const boss = byRef.get(member.boss);
      if (!boss || boss.role === 'worker' || boss.level !== member.level - 1) reject('a reporting relationship is missing or has an invalid level.');
      visit(boss);
    }
    visiting.delete(member.ref); visited.add(member.ref); ordered.push(member);
  };
  team.members.forEach(visit);
  return { format: TEMPLATE_FORMAT, version: TEMPLATE_VERSION, team: { name: team.name, purpose: team.purpose, structure: team.structure, configuration: structuredClone(pick(config, formFields)), members: ordered.map(member => ({ ref: member.ref, boss: member.boss, ...pick(member, memberFields), preferenceOverride: member.preferenceOverride })) } };
}
