// Native Codex has no verified composer-vs-peer prompt provenance. Only durable
// member switches grant writes/subagents; prompt keywords never do.
import {sourceEditAllowed,sourceReadAllowed} from './source-edits.mjs';
export function codexGuard(authority,{tool,input}) {
 const deny=permissionDecisionReason=>({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason}});
 // Native questions collect draft answers, never management consent or tool
 // effects. Keep them available during verified stale recovery, even when the
 // question mentions a protected path. Do not trust lookalike MCP tool names.
 if(authority.staleBinding&&['request_user_input','request_user_input_async','functions.request_user_input','functions.request_user_input_async'].includes(tool))return {};
 const m=authority.member;
 const source=typeof input==='string'?input:JSON.stringify(input??{});
 const normalized=source.replaceAll('\\\\','/').replaceAll('\\','/').toLowerCase();
 if(sourceReadAllowed(authority,{tool,input}))return {};
 if((!authority.workerSetup?.covered||authority.workerSetup.state==='ready')&&sourceEditAllowed(authority,{tool,input}))return {};
 if(/team-orchestrator\/(?:controller-actions|launch-settings|wake-receipts|dispatchers)|machine\.sqlite|925-to\/(?:installations|launch-profiles)|mod-(?:bridge|wake)\.[cm]?js|\.codex\/(?:config\.toml|hooks\.json)|createTeamApi|upgradeTeamStore/i.test(normalized))return deny('Private team authority and adapter state cannot be accessed by model tools. Use shared_team.');
 const shell=['Bash','exec_command','shell_command','PowerShell'].includes(tool);
 const command=String(input?.command??input?.cmd??'').trim();
 // A helper filename in git/rg arguments or source text is not execution.
 if(shell&&/^\s*node(?:\.exe)?\s+.*(?:dispatcher-service|mod-dispatch-receiver)\.mjs(?:["'\s]|$)/i.test(command))return deny('Dispatcher helpers are private native entrypoints; use shared_team.');
 // Deliberately narrow: do not try to prove arbitrary shell/program text safe.
 const readOnly=shell&&!/[\r\n;&|><`$(){}\[\]#]/.test(command)&&!/(?:--output|--pre|--hostname-bin|--ext-diff|--textconv)(?:=|\s|$)/i.test(command)&&/^(?:git (?:status|diff|log|show)\b|rg(?:\s|$)|pwd\s*$|Get-Location\s*$)/i.test(command);
 // A stale native binding must not disable every tool, or the session can never
 // recover: rebinding needs a controller approval, and that approval needs native
 // review to be reachable. Keep exactly the inspection and recovery calls open,
 // and nothing else. This gate is defence in depth, not the consent boundary:
 // approveController and bindMember still cannot take effect without a native
 // form the person themselves answers, so passing them here grants no authority.
 if(authority.staleBinding){
  if(readOnly)return {};
  const bare=typeof tool==='string'?tool.replace(/^mcp__[a-z0-9_]+__/,''):tool;
  if(['shared_team_status','shared_team_sessions'].includes(bare))return {};
  // A resumed older store must be upgraded before the current API can rebind
  // it. This entrypoint validates schema/protocol, requires its own native
  // review and backup, and preserves the stale binding without granting access.
  if(bare==='shared_team_upgrade')return {};
  if(bare==='shared_team'&&['inspectCaller','inspectController'].includes(input?.command?.type))return {};
  // Only the two reviewed recovery operations, never another management effect.
  if(bare==='shared_team_manage'&&['approveController','bindMember'].includes(input?.command?.type))return {};
  return deny(`This conversation's native binding is stale, so only inspection and the reviewed recovery calls are allowed. Run shared_team_status; if an upgrade is required, use shared_team_upgrade with native review and backup before shared_team_manage bindMember with its own native review. Every other effect stays blocked. ${authority.staleReason??''}`.trim());
 }
 if(!m)return {};
 if(authority.workerSetup?.covered&&authority.workerSetup.state!=='ready'){
  const bare=typeof tool==='string'?tool.replace(/^mcp__[a-z0-9_]+__/,''):tool;
  if(readOnly||['Read','Grep','Glob'].includes(bare)||['shared_team_status','shared_inbox_read','shared_inbox_seen'].includes(bare))return {};
  if(bare==='shared_team'&&(['inspectCaller','inspectController','inspectTeam'].includes(input?.command?.type)||(input?.command?.type==='askQuestion'&&input.command.assignmentId===null)))return {};
  return deny(`Worker team tools are ${authority.workerSetup.state}. Complete status, official-role inspection and the exact inbox bootstrap confirmation before task work. No task or permission was granted by connecting.`);
 }
 const agent=/^(?:Agent|spawn_agent|functions\.spawn_agent|mcp__.*__spawn_agent)$/.test(tool);
 if(agent&&!Number(m.allow_agent))return deny('This team member has no subagent permission. Ask the person to enable its standing setting.');
 const patch=['apply_patch','Write','Edit','NotebookEdit'].includes(tool);
 if((patch||shell&&!readOnly)&&/\.team-orchestrator(?:\/|[\s"']|$)/.test(normalized))return deny('Shared team records are changed through the typed API, never direct file or SQL edits.');
 if(authority.hasReports&&!Number(m.allow_write)&&(patch||shell&&!readOnly||['exec','code_mode','functions.exec','python','python_user_visible'].includes(tool)))return deny('This member has reports and no standing write permission. Delegate the implementation or ask the person to enable writes.');
 if(tool==='write_stdin'&&typeof input?.chars==='string'&&input.chars.length)return deny('Interactive shell input is not rechecked as a new command. Run a fresh guarded command instead.');
 return {};
}
