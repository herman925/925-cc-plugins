import { planTeam } from './team.mjs';

export function initialMembers(team, mode) {
  if (!['on-demand', 'all'].includes(mode)) throw new Error('Choose a launch mode.');
  return team.members.filter(member => mode === 'all' || ['ceo', 'head'].includes(member.role));
}

export function configurationFor(team) {
  if (team.configuration) return team.configuration;
  const levels = Math.max(...team.members.map(member => member.level));
  const firstManager = team.members.find(member => team.structure === 'organisation' ? member.role === 'head' : member.boss === null);
  const byLevel = Array.from({ length: 3 }, (_, i) => team.members.find(member => member.level === i + 1));
  return { name: team.name, purpose: team.purpose, structure: team.structure, levels, fan: Math.max(1, team.members.filter(member => member.boss === firstManager?.id).length), groups: team.members.filter(member => member.role === 'head').map(member => member.team).join(', '), agents: byLevel.map(member => member?.agent ?? 'codex'), models: byLevel.map(member => member?.model ?? 'default'), efforts: byLevel.map(member => member?.effort ?? 'default') };
}

export function launchInstructions(team, mode, coordinatorTerminalId) {
  const f = configurationFor(team);
  const plan = planTeam(f);
  const initial = initialMembers(plan, mode);
  if (!team.id || !/^[a-z0-9-]{1,80}$/i.test(team.id)) throw new Error('Missing launch request identity.');
  const spec = { request: team.id, coordinatorTerminalId, name: plan.name, function: plan.purpose, structure: f.structure, levels: f.levels, reports: f.fan, teams: f.structure === 'organisation' ? f.groups.split(',').map(name => name.trim().replace(/\s+/g, '-')) : [], agents: f.agents ?? ['codex', 'codex', 'codex'], models: f.models, efforts: f.efforts, launch: mode };
  const text = `Launch this Orca team (${initial.length} initial sessions). Use real Orca terminal tabs, not subagents.\n` +
    `Load the version-matched orca-cli guide and orchestration guide. Verify runtime access first. If forbidden, report the exact Settings > SSH permission; create nothing.\n` +
    `Resolve THIS terminal's exact workspace and execution host; use that fixed selector for every launch, never a later active workspace.\n` +
    `Create .orca/team-orchestrator/${plan.name}/roster.json and roles on the workspace execution host. Record this request ID before creating tabs. An existing roster with a different request is a name collision: do not replace it. The same request is recovery: inspect recorded handles, never launch duplicates or retry an uncertain create/send.\n` +
    `Derive the roster boss-first: one-team Head; with 2 levels Worker-i; with 3 levels Lead-1-i and Worker-leadIndex-i (${f.fan} reports for EVERY manager). Organisation: CEO, team-Head, team-Worker-i. Give each a role file with its goal, boss, direct reports, full roster and selected per-level CLI/model/effort; preserve existing user notes.\n` +
    `On-demand starts only CEO/heads; all starts everyone. Batch at most 3 starts. For EACH initial member: terminal create in the fixed workspace, title "${plan.name}/member-name", command its CLI (codex or claude). Defaults omit overrides. Codex model: --model ID; effort: -c model_reasoning_effort=LEVEL. Claude: --model ID, --effort LEVEL, --name title. Quote argv for the execution host shell; never interpolate raw function/role prose in a shell command.\n` +
    `Save every create receipt and real terminal handle immediately. Wait for tui-idle with a bounded timeout. For Codex, submit /rename title and wait for idle again; set the Orca terminal title too. Then terminal send its role-file pointer and brief with Enter. Check accepted receipts. Report observed session IDs only. On uncertainty stop and report partial resources; do not close unrelated tabs.\n` +
    `Brief: read your role; acknowledge readiness and wait for work. Managers plan/delegate/review. Later assignments use Orca orchestration worker-start with retained handles or create on-demand members with their configured CLI/model. Durable questions/messages use the orchestration skill. No inbox/outbox transport.\n` +
    `Finish with created titles, handles, briefing receipts and any blocker. Do not claim ready from input acceptance alone.\n` + JSON.stringify(spec);
  if (text.length > 4096) throw new Error('Launch request is too large. Shorten the function or team names.');
  return text;
}

export async function prepareLaunch(call, team, mode, terminalId) {
  const text = launchInstructions(team, mode, terminalId);
  const context = await call('workspace.readContext', {});
  if (!context?.terminals?.some(terminal => terminal.id === terminalId)) throw new Error('The selected coordinator tab is no longer in the active workspace. Refresh the tab list.');
  return text;
}
