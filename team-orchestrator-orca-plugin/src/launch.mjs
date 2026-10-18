export function initialMembers(team, mode = team.configuration?.launchMode ?? 'on-demand') {
  if (!['on-demand', 'all'].includes(mode)) throw Error('Choose a supported launch mode.');
  return team.members.filter(member => mode === 'all' || !member.boss || member.role === 'head');
}

export function memberLaunch(team, member, workspaceKey) {
  if (!team.id || !/^[a-z0-9-]{1,80}$/i.test(team.id)) throw new Error('Missing launch request identity.');
  const boss = team.members.find(row => row.id === member.boss);
  const reports = team.members.filter(row => row.boss === member.id);
  const roster = team.members.map(row => `${row.id}: ${row.name} (${row.role}, ${row.agent}), boss=${row.boss ?? 'user'}`).join('\n');
  return {
    requestId: `${team.id}-${member.id}`, teamId: team.id, memberId: member.id, workspaceKey, title: `${team.name}/${member.name}`, agent: member.agent,
    ...(member.model !== 'default' ? { model: member.model } : {}),
    ...(member.effort !== 'default' ? { effort: member.effort } : {}),
    brief: `You are ${member.name}, the ${member.role} of @${team.name}. Your session name is ${team.name}/${member.name}.\nTeam purpose/function: ${team.purpose || 'Take assignments from the user in the highest supervisor session.'}\nReport to: ${boss?.name ?? 'the user'}. Direct reports: ${reports.map(row => row.name).join(', ') || 'none'}.\n${member.brief}\nWork habits: ${member.habits || 'None specified'}.\nCollaboration rules: ${member.collaboration || 'None specified'}.\nRole version: ${member.roleVersion ?? 1}; configuration version: ${team.configVersion ?? 1}.\nThis roster contains exactly ${team.members.length} members. The user is outside the roster; do not create extra members or launch teammates.\nRoster:\n${roster}\nThe plugin has saved your role and roster; do not claim to persist or change their authoritative versions. Acknowledge your role and report any login or access blockers. The highest supervisor receives assignments directly from the user in this conversation. Other members wait for their direct manager. The plugin will automatically supply the native team coordination protocol; do not ask the user to submit an objective in the panel. Managers will use Orca's version-matched orchestration skill for later supervised work; report access blockers rather than inventing results.`
  };
}
