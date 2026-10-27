export const ROLE_MARKER = '<!-- END OF GENERATED ROLE. Personal notes below this line are preserved. -->';
export function roleFilePath(team, member) {
  for (const id of [team.id, member.id]) if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('Invalid role file identity.');
  return `.orca/team-orchestrator/${team.id}/roles/${member.id}.md`;
}
export function rolePointer(team, member) {
  return `Your persistent role file is ${roleFilePath(team, member)}. Read it before your first action, after any conversation summary or compaction, and when notified of a roster change. Personal notes are advisory; saved roles, native permissions and your manager's admitted tasks remain authoritative.`;
}
export function roleText(team, member) {
  const boss = team.members.find(row => row.id === member.boss);
  const reports = team.members.filter(row => row.boss === member.id);
  return `# ${member.name}\n\nTeam: ${team.name}\nMember ID: ${member.id}\nRole: ${member.role}\nBoss: ${boss?.name ?? 'the user'}\nDirect reports: ${reports.map(row => row.name).join(', ') || 'none'}\nConfiguration version: ${team.configVersion}; role version: ${member.roleVersion}\n\n## Purpose and duties\n\n${team.purpose || 'Take assignments from the user in the highest supervisor session.'}\n\n${member.brief}\n\n${reports.length ? 'Plan, delegate to your direct reports and review their results. Do not bypass another manager or do their assigned work yourself.' : 'Execute only admitted assignments from your direct manager and report results to that manager.'}\n\nWork habits: ${member.habits || 'None specified'}\nCollaboration: ${member.collaboration || 'None specified'}\n\n## Coordination\n\nUse the plugin-supplied native Orca coordination protocol and version-matched orchestration guide. Do not independently create teammates or provider-native subagents. Never type into another member's terminal to message it. Preserve native task, review and permission checks. If instructions or access are missing, report the blocker to your manager. Only the highest supervisor presents user decisions and overall delivery.\n\nAfter a task, clean up only your own temporary files and processes that are no longer needed, within your granted permissions, and report remaining work or blockers.\n\n## Roster\n\n${team.members.map(row => `- ${row.name} (${row.id}): ${row.role}; reports to ${team.members.find(parent => parent.id === row.boss)?.name ?? 'the user'}. ${row.brief}`).join('\n')}\n\n## Files and authority\n\nThese files are generated views of the plugin's SQLite records. Never edit the generated section, roster.json or configuration.json to change authoritative configuration. Use the highest supervisor conversation for changes. Do not edit another member's notes. Reread this file after compaction or a roster-change notice; compare the configuration version with the native task protocol, and report stale files rather than overriding it.\n\n`;
}
export function mergeRole(existing, generated) {
  if (existing !== undefined && !existing.includes(ROLE_MARKER)) throw Error('Existing role file has no generated-section marker; preserve it and resolve the conflict before launching.');
  const notes = existing === undefined ? '\n\n## Personal notes\n\n' : existing.slice(existing.indexOf(ROLE_MARKER) + ROLE_MARKER.length);
  return generated + ROLE_MARKER + notes;
}
