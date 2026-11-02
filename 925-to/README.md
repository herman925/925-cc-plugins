# 925 Team Orchestrator

`925-to` gives Codex native workflows for creating and editing a team, connecting existing sessions, checking status and participating in durable meetings. It uses the same project-owned store and typed API as Team Orchestrator Mod 0.5.56. An active Claude session is not required for team management.

This first release supports native Windows Codex terminals hosted by Orca. It does not require the Team Orchestrator Orca plugin. Automatic Codex launch, Hermes admission, independent hosts and the Orca plugin's separate store convergence remain later work.

## Install

Choose one route; both contain the same self-contained skill and matching runtime.

Repository skill installation, with the tested installer version:

```text
npx skills@1.7.4 add https://github.com/herman925/925-cc-plugins/tree/main/925-to --skill 925-to --agent codex
```

Codex repository marketplace:

```text
codex plugin marketplace add herman925/925-cc-plugins
codex plugin add 925-to@herman925-codex
```

Start a fresh Codex session in the project, then invoke:

```text
$925-to
$925-to create-team
$925-to edit-team
$925-to connect-session
$925-to status
$925-to meeting
```

The skill's first setup pass previews a project-local MCP connection and permission hook. It discovers the actual Orca project/session instead of asking for terminal IDs or a JSON settings file. Apply the reviewed setup, reconnect/restart as instructed, and review/trust the exact hook through Codex's native controls. Installing the skill alone does not activate MCP tools or grant hook trust.

Ordinary question tools are used when available; native MCP interview forms provide the action/composition/edit choices when they are not. Draft answers grant no authority. Creating a team presents a native confirmation that can also approve that specific conversation to manage the project. Edits show the current/proposed configuration and require their own confirmation. Decline, cancellation, timeout and unsupported confirmation clients grant nothing.

## Supported editing

Rename/update team purpose, update explicit team settings, add members, and change supported member fields: name, role/instructions, advisory notes and standing permission switches. Model/effort edits are supported for unconnected members. Changes are atomic and generation-checked. Live role changes during unfinished assignments, connected model replacement, removal, hierarchy reparenting, CLI conversion, home transfer and silent rebinding are refused rather than simulated.

Use explicit session connection to bind eligible existing Claude/Codex sessions. Approval survives a verified same-conversation resume, but a changed native member binding requires an explicit reviewed reconnect. No session is silently started, transferred or rebound.

Only normal typed operations modify teams. A native confirmation is required for management; a model cannot provide its own approval flag. Preserve the exact operation id/request after an unknown reply and reconcile before repeating an effect. Reading, waking and listing sessions are not acknowledgements or grants.

## Updates and removal

Update the installed skill through its installer or refresh/reinstall the repository plugin, then use the packaged setup workflow to update its owned project connection. Existing unrelated settings/hooks are preserved. Modified or unowned team entries require review rather than replacement.

Before removing the skill/plugin, run its project setup `remove` workflow so the owned MCP/hook entries are removed first. Removal preserves teams, other configuration and private recovery backups. Resolve active work/binding ownership with the head first; uninstalling configuration is not a team-member transfer or retirement operation. If setup is interrupted, use `recover`; a native OS lock is released when the installer dies, and recovery refuses independently changed files.

See [validation and current acceptance limits](../shared/team-store/VALIDATION-925-TO.md). Automated/native transport fixtures do not establish a real multi-model guard/lifecycle acceptance run. The runtime reports hook trust as unverified until it is checked in the actual client.
