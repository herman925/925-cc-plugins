// Native Codex has no verified composer-vs-peer prompt provenance. Only durable
// member switches grant writes/subagents; prompt keywords never do.
export function codexGuard(authority,{tool,input}) {
 const deny=permissionDecisionReason=>({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason}});
 const m=authority.member;
 const source=typeof input==='string'?input:JSON.stringify(input??{});
 const normalized=source.replaceAll('\\\\','/').replaceAll('\\','/').toLowerCase();
 if(/team-orchestrator\/(?:controller-actions|launch-settings)|machine\.sqlite|925-to\/(?:installations|launch-profiles)|mod-bridge\.[cm]?js|\.codex\/(?:config\.toml|hooks\.json)|createTeamApi|upgradeTeamStore/i.test(normalized))return deny('Private team authority and adapter state cannot be accessed by model tools. Use shared_team.');
 if(!m)return {};
 const agent=/^(?:Agent|spawn_agent|functions\.spawn_agent|mcp__.*__spawn_agent)$/.test(tool);
 if(agent&&!Number(m.allow_agent))return deny('This team member has no subagent permission. Ask the person to enable its standing setting.');
 const shell=['Bash','exec_command','shell_command','PowerShell'].includes(tool);
 const command=String(input?.command??input?.cmd??'').trim();
 // Deliberately narrow: do not try to prove arbitrary shell/program text safe.
 const readOnly=shell&&!/[\r\n;&|><`$(){}\[\]#]/.test(command)&&!/(?:--output|--pre|--hostname-bin|--ext-diff|--textconv)(?:=|\s|$)/i.test(command)&&/^(?:git (?:status|diff|log|show)\b|rg(?:\s|$)|pwd\s*$|Get-Location\s*$)/i.test(command);
 const patch=['apply_patch','Write','Edit','NotebookEdit'].includes(tool);
 if((patch||shell&&!readOnly)&&/\.team-orchestrator(?:\/|[\s"']|$)/.test(normalized))return deny('Shared team records are changed through the typed API, never direct file or SQL edits.');
 if(authority.hasReports&&!Number(m.allow_write)&&(patch||shell&&!readOnly||['exec','code_mode','functions.exec','python','python_user_visible'].includes(tool)))return deny('This member has reports and no standing write permission. Delegate the implementation or ask the person to enable writes.');
 if(tool==='write_stdin'&&typeof input?.chars==='string'&&input.chars.length)return deny('Interactive shell input is not rechecked as a new command. Run a fresh guarded command instead.');
 return {};
}
