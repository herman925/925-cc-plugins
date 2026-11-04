# 925 Team Orchestrator

`team-orchestration-925` **0.1.4** is a **Codex plugin containing six action skills, a menu skill and their shared runtime**. It provides native workflows for creating and editing a team, connecting existing sessions, checking status and participating in durable meetings. It uses the same project-owned store and typed API as Team Orchestrator Mod 0.5.57. An active Claude session is not required for team management.

Version 0.1.4 packages the matching runtime for the [Mod's native team editor](../team-orchestrator/docs/panel-navigation.md#edit-a-shared-team--0557). The existing Codex action skills and schema 8 remain the same.

For the wider product, see [choose your Team Orchestrator client](../README.md#team-orchestrator): Claude Code uses the native Mod/plugin, Codex uses this skill bundle, and Hermes native integration is pending. The existing classic-team Hermes guard is not an equivalent shared-runtime client.

This first release supports native Windows Codex terminals hosted by Orca. It does not require the Team Orchestrator Orca plugin. Automatic Codex launch, Hermes admission, independent hosts and the Orca plugin's separate store convergence remain later work.

Version **0.1.3** repairs setup executable discovery after live testing found that Codex's sandbox denied its Windows process query. Setup now resolves native `codex.exe` from PATH, including an installed npm shim's native package, and checks `--version`. It does not execute the shim or request process-query escalation. An explicit `TEAM_CODEX_EXECUTABLE` can select a native executable when PATH discovery is unavailable. This selects the staged config writer only; MCP parent/thread ownership and Orca caller checks remain unchanged. Host errors distinguish denied access, a missing host, CLI failure and a changed project scope. See [repair validation and live retest status](../shared/team-store/VALIDATION-SANDBOX-SETUP.md).

## Install

Choose one route. **The plugin route is recommended for the complete skill set**; the repository skill route installs the self-contained menu and matching runtime only.

Complete Codex plugin, from this GitHub repository's Codex marketplace:

```text
codex plugin marketplace add herman925/925-cc-plugins
codex plugin add team-orchestration-925@herman925-codex
```

Optional standalone menu, with the tested repository installer version:

```text
npx skills@1.7.4 add https://github.com/herman925/925-cc-plugins/tree/main/team-orchestration-925 --skill team-orchestration-925 --agent codex
```

Start a fresh Codex session in the project. Type `$team-orchestration-925` and select **925 Team Orchestrator** from the skill picker. A repository skill installation uses the short name:

```text
$team-orchestration-925
$team-orchestration-925 create-team
$team-orchestration-925 edit-team
$team-orchestration-925 connect-session
$team-orchestration-925 status
$team-orchestration-925 meeting
```

The plugin route includes six direct action skills in version **0.1.2**:

| Invocation | Opens |
| --- | --- |
| `$team-orchestration-925:create` | New team composition and reviewed creation |
| `$team-orchestration-925:edit` | Existing team inspection and supported edits |
| `$team-orchestration-925:connect` | Verified existing session connection/reconnection |
| `$team-orchestration-925:status` | Team, approval, binding and capability status |
| `$team-orchestration-925:meeting` | Durable meeting workflow |
| `$team-orchestration-925:setup` | Project connection setup, update, recovery or removal |

Each action starts its own workflow without reopening the general action menu. They share the menu skill's references, helper and single runtime. The npx command above installs only the self-contained menu skill; use its action arguments there. Use the plugin route for all six namespaced action skills.

For a new project, start with **`:setup` → reconnect/native hook review → `:create` → `:connect` → `:status`**, using the full `team-orchestration-925:` prefix for each invocation. Use `:edit` for later changes and `:meeting` for the durable meeting workflow. These are conversation skill invocations, not terminal commands.

The existing menu remains available as **`team-orchestration-925:team-orchestration-925`**:

```text
$team-orchestration-925:team-orchestration-925
```

Version 0.1.1 replaces the original `925-to` package name because Orca's `$` picker rejects names beginning with a digit. Both plugin and skill names now start with a letter. After installing the replacement, remove the old plugin with `codex plugin remove 925-to@herman925-codex` once any project connection has been updated through the new skill's setup workflow. Existing team data, MCP server name and owned setup/recovery records keep their identities. Do not install both a standalone skill and plugin merely to get a second invocation alias.

The skill's first setup pass previews a project-local MCP connection and permission hook. It discovers the actual Orca project/session instead of asking for terminal IDs or a JSON settings file. Apply the reviewed setup, reconnect/restart as instructed, and review/trust the exact hook through Codex's native controls. Installing the skill alone does not activate MCP tools or grant hook trust.

Ordinary question tools are used when available; native MCP interview forms provide the action/composition/edit choices when they are not. Draft answers grant no authority. Creating a team presents a native confirmation that can also approve that specific conversation to manage the project. Edits show the current/proposed configuration and require their own confirmation. Decline, cancellation, timeout and unsupported confirmation clients grant nothing.

## Supported editing

Rename/update team purpose, update explicit team settings, add members, and change supported member fields: name, role/instructions, advisory notes and standing permission switches. Model/effort edits are supported for unconnected members. Changes are atomic and generation-checked. Live role changes during unfinished assignments, connected model replacement, removal, hierarchy reparenting, CLI conversion, home transfer and silent rebinding are refused rather than simulated.

Use explicit session connection to bind eligible existing Claude/Codex sessions. Approval survives a verified same-conversation resume, but a changed native member binding requires an explicit reviewed reconnect. No session is silently started, transferred or rebound.

Only normal typed operations modify teams. A native confirmation is required for management; a model cannot provide its own approval flag. Preserve the exact operation id/request after an unknown reply and reconcile before repeating an effect. Reading, waking and listing sessions are not acknowledgements or grants.

## Updates and removal

Update the installed skill through its installer or refresh/reinstall the repository plugin, then use the packaged setup workflow to update its owned project connection. Existing unrelated settings/hooks are preserved. Modified or unowned team entries require review rather than replacement.

For plugin updates, run in your terminal:

```text
codex plugin marketplace upgrade herman925-codex
codex plugin add team-orchestration-925@herman925-codex
```

Before removing the skill/plugin, run its project setup `remove` workflow so the owned MCP/hook entries are removed first. Removal preserves teams, other configuration and private recovery backups. Resolve active work/binding ownership with the head first; uninstalling configuration is not a team-member transfer or retirement operation. If setup is interrupted, use `recover`; a native OS lock is released when the installer dies, and recovery refuses independently changed files.

See [direct action skill validation](../shared/team-store/VALIDATION-ACTION-SKILLS.md), [invocation repair validation](../shared/team-store/VALIDATION-SKILL-INVOCATION.md) and [the earlier integration evidence and live limits](../shared/team-store/VALIDATION-925-TO.md). Automated/native transport fixtures do not establish a real multi-model guard/lifecycle acceptance run. The runtime reports hook trust as unverified until it is checked in the actual client.
