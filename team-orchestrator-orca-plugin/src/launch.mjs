export function initialMembers(team, mode) {
  if (!['on-demand', 'all'].includes(mode)) throw new Error('Choose a launch mode.');
  return team.members.filter(member => mode === 'all' || ['ceo', 'head'].includes(member.role));
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
    brief: `You are ${member.name}, the ${member.role} of @${team.name}. Your session name is ${team.name}/${member.name}.\nGoal: ${team.purpose || 'Wait for the user to provide the team goal.'}\nReport to: ${boss?.name ?? 'the user'}. Direct reports: ${reports.map(row => row.name).join(', ') || 'none'}.\n${member.brief}\nWork habits: ${member.habits || 'None specified'}.\nCollaboration rules: ${member.collaboration || 'None specified'}.\nRole version: ${member.roleVersion ?? 1}; configuration version: ${team.configVersion ?? 1}.\nThis roster contains exactly ${team.members.length} members. The user is outside the roster; do not create extra members or launch teammates.\nRoster:\n${roster}\nThe plugin has saved your role and roster; do not claim to persist or change their authoritative versions. Acknowledge your identity and readiness, then wait for an assignment. Managers will use Orca's version-matched orchestration skill for later supervised work; report access blockers rather than inventing results.`
  };
}

export async function launchMembers(call, team, mode, context, record) {
  if (context?.nativeAgentLaunch !== true || !context.workspaceKey) throw new Error('The bundled local executor is not connected. Use Test connection before launching.');
  for (const member of initialMembers(team, mode)) {
    // Record intent before mutation; an ambiguous create must never be automatically repeated.
    await record(member.id, { status: 'starting' });
    let receipt;
    try {
      receipt = await call('terminal.createAgent', memberLaunch(team, member, context.workspaceKey), { timeoutMs: 90000 });
    } catch (error) {
      await record(member.id, { status: 'unknown', error: error.message });
      throw error;
    }
    if (!receipt?.handle) {
      await record(member.id, { status: 'unknown', error: 'Orca returned no terminal handle.' });
      throw new Error('Launch outcome is unconfirmed. Inspect Orca before retrying.');
    }
    await record(member.id, { status: 'created', terminalId: receipt.handle, title: receipt.title, briefAccepted: receipt.briefAccepted === true, executionHostId: receipt.executionHostId ?? null, ...(receipt.warning ? { error: receipt.warning } : {}) });
    if (receipt.briefAccepted !== true || receipt.warning) throw new Error(receipt.warning || 'Tab created, but its briefing was not accepted. Inspect that tab before continuing.');
  }
}
