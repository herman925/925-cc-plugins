# 925 Team Orchestrator

This development branch is **0.1.12**, paired with Mod **0.5.62 / schema 10**. Launch review includes fixed worker-tool access and readiness; both packages share 68 runtime files. Classic import currently has native library primitives, with no exposed migration action or skill. This candidate is not published or installed; the stable 0.1.11 flows below remain the main-branch release. See the [development checkpoint](../docs/validation/wayfinder-completion-note-20261112.md).

The candidate uses [one project dispatcher](../docs/validation/single-project-dispatcher-20261112.md) for Claude/Codex coordination. The Codex MCP connection is its receiver, with fresh caller verification for each scheduled pass. Direct owned Codex/Claude transports are library foundations; reviewed standalone launch/binding and real Claude acceptance remain open. The native action status continues to report standalone as unsupported.

The candidate uses one automatic inbox wake-up path for Claude and Codex recipients. It retains native request identity across a same-process rebind and separates input acceptance, turn start, inbox progress and task pickup. Current team/caller inspection also explains the manager-write rule, so a disabled standing write switch is not mistaken for a leaf-worker denial.

The [wake repairs](../docs/validation/wake-fencing-repair-20261112.md) require a proposed Orca target-fencing/receipt contract. **The current host lacks it, so this candidate blocks automatic inbox prompts** and reports `inboxWake.state: host-update-required`. Manual inbox tools remain available. [Orca maintainer handoff](../docs/validation/orca-fenced-inbox-wake-handoff-20261112.md). No installation or live bidirectional acceptance is claimed.

`team-orchestration-925` **0.1.11** is a **Codex plugin containing seven action skills, a menu skill and their shared runtime**. It provides native workflows for creating/editing a team, connecting existing sessions, reviewing worker launch plans, checking status and participating in durable meetings. It uses the same project-owned store and typed API as Team Orchestrator Mod **0.5.61 / schema 9**. An active Claude session is not required.

Version **0.1.11** restores native-reviewed recovery after resume, preserves pending confirmation forms until a response or cancellation, and provides normal Orca launch/resume setup with MCP confirmations enabled. Ordinary conversations outside a team keep their own execution permissions instead of inheriting team-role switches; private authority remains protected. A retired ordinary member is reported outside the team without deleting its binding history; a reserved/launched worker stays restricted. Active members keep their standing switches and task authorization. Closing a panel or terminal does not retire or disconnect an active member. Schema 9 is unchanged; PR #199's worker readiness work remains separate. [Recovery and ordinary-session evidence](../docs/validation/codex-ordinary-session-recovery-20261107.md).

Version **0.1.10** distinguishes editing public package source from accessing private runtime authority. Members with an explicit standing write grant may patch public source under their verified project, including tests of internal APIs. Direct private API execution, private data/configuration, external targets and redirected source paths remain protected. This is a developer guard repair; schema 9 is unchanged and worker tool-access/readiness design remains in progress. [Validation and limits](../shared/team-store/VALIDATION-PUBLIC-SOURCE-GUARD.md).

Version **0.1.9** fixes false native ownership refusals when permission hooks, observation or tool calls inspect the same thread concurrently. A bounded cross-process query gate prevents inspectors from appearing as extra resource owners. Every caller still needs exactly one matching native parent owner; genuine extra holders and failed/timed-out inspections remain refused. Schema 9 is unchanged. Update the project connection through setup and reconnect to load the repair. [Reproduction and validation](../shared/team-store/VALIDATION-CODEX-OWNERSHIP.md).

Version **0.1.8** adds **`:launch`**: approve one specific list of unconnected local Codex workers through a native form. Its workers can start automatically as capacity opens while their reviewed roles/settings remain valid. A durable claim precedes empty-terminal creation; its verified target commits before Codex starts, and the child binds with its real native conversation identity. Existing sessions are never replaced or auto-closed. Claimed/uncertain starts retain capacity and are not automatically retried. Existing stores need the explicit native-reviewed **`shared_team_upgrade`** operation with a complete backup. [Contract and limits](../shared/team-store/SCHEMA-9-LAUNCH-PLANS.md).

Setup now installs a private immutable runtime snapshot, so plugin-cache updates/removal cannot delete the configured adapter. It preserves native per-tool approval settings when updating. Reconnect after applying an update to use the new runtime; neither an install nor a status check grants hook trust. Hook refusals now include the specific verified error, while unexpected internal errors remain generic and denied.

Version **0.1.7** adds periodic coordination while the Codex MCP client is connected. After a tool verifies the native conversation, the adapter checks every 30 seconds for deadline transitions and delivery/replay notifications through the shared API. Confirmed mutations also queue a prompt check after returning their receipt. Status reports the loop's state and last error. Only a bound member can observe its team; a missing store is never created. Changed native identity suspends the loop until a new verified call, and disconnect stops it. Notifications can address this conversation as well as another verified local member; they queue Orca mailbox attention without starting a model turn, reading mail or acknowledging it. [Behavior and validation](../shared/team-store/VALIDATION-CODEX-OBSERVER.md).

Version **0.1.6** repairs a live `STORE_WRITER_TOO_OLD` refusal after the Mod touched a shared project. Codex now uses the packaged shared implementation release, generated from the Mod manifest, instead of a stale hardcoded writer version. Packaging checks detect future drift; genuinely older clients remain refused. [Validation and live limits](../shared/team-store/VALIDATION-CODEX-WRITER-RELEASE.md).

Version 0.1.4 packages the matching runtime for the [Mod's native team editor](../team-orchestrator/docs/panel-navigation.md#edit-a-shared-team--0557). The existing Codex action skills and schema 8 remain the same.

For the wider product, see [choose your Team Orchestrator client](../README.md#team-orchestrator): Claude Code uses the native Mod/plugin, Codex uses this skill bundle, and Hermes native integration is pending. The existing classic-team Hermes guard is not an equivalent shared-runtime client.

Version **0.1.5** clarifies the status workflow: a verified connection with no store reports **Connected · no team created** and stops without a redundant failing API read. Use `:create` when ready to create a team. For an existing store, no teams visible to an unapproved conversation does not mean the project is empty. Status never creates data or grants approval.

This release supports native Windows Codex terminals hosted by Orca. It does not require the Team Orchestrator Orca plugin. Hermes admission, independent hosts, top-member launch/replacement and the Orca plugin's separate store convergence remain later work. Codex launch plans do not launch Claude; existing Claude launch/connection workflows remain separate.

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

The plugin route includes seven direct action skills:

| Invocation | Opens |
| --- | --- |
| `$team-orchestration-925:create` | New team composition and reviewed creation |
| `$team-orchestration-925:edit` | Existing team inspection and supported edits |
| `$team-orchestration-925:connect` | Verified existing session connection/reconnection |
| `$team-orchestration-925:status` | Team, approval, binding and capability status; a fresh project reports connected/no team created without a second failed store read |
| `$team-orchestration-925:meeting` | Durable meeting workflow |
| `$team-orchestration-925:launch` | Native review of one specific Codex worker launch plan |
| `$team-orchestration-925:setup` | Project connection setup, update, recovery or removal |

Each action starts its own workflow without reopening the general action menu. They share the menu skill's references, helper and single runtime. The npx command above installs only the self-contained menu skill; use its action arguments there. Use the plugin route for all seven namespaced action skills.

For a new project, start with **`:setup` → reconnect/native hook review → `:create` → `:connect` for your head/existing sessions → `:launch` for new Codex workers → `:status`**, using the full `team-orchestration-925:` prefix for each invocation. Use `:edit` for later changes and `:meeting` for durable meetings. These are conversation skill invocations, not terminal commands.

The existing menu remains available as **`team-orchestration-925:team-orchestration-925`**:

```text
$team-orchestration-925:team-orchestration-925
```

Version 0.1.1 replaces the original `925-to` package name because Orca's `$` picker rejects names beginning with a digit. Both plugin and skill names now start with a letter. After installing the replacement, remove the old plugin with `codex plugin remove 925-to@herman925-codex` once any project connection has been updated through the new skill's setup workflow. Existing team data, MCP server name and owned setup/recovery records keep their identities. Do not install both a standalone skill and plugin merely to get a second invocation alias.

The skill's first setup pass previews a project-local MCP connection and permission hook. It discovers the actual Orca project/session instead of asking for terminal IDs or a JSON settings file. Apply the reviewed setup, reconnect/restart as instructed, and review/trust the exact hook through Codex's native controls. Installing the skill alone does not activate MCP tools or grant hook trust.

Ordinary question tools are used when available; native MCP interview forms provide the action/composition/edit choices when they are not. Draft answers grant no authority. Creating a team presents a native confirmation that can also approve that specific conversation to manage the project. Edits show the current/proposed configuration and require their own confirmation. Decline, cancellation, timeout and unsupported confirmation clients grant nothing.

## Supported editing

Rename/update team purpose, update explicit team settings, add members, and change supported member fields: name, role/instructions, advisory notes and standing permission switches. Model/effort edits are supported for unconnected members. Changes are atomic and generation-checked. Live role changes during unfinished assignments, connected model replacement, removal, hierarchy reparenting, CLI conversion, home transfer and silent rebinding are refused rather than simulated.

Use explicit session connection to bind eligible existing Claude/Codex sessions, or `:launch` for a new eligible Codex worker. Approval survives a verified same-conversation resume, but a changed native member binding requires an explicit reviewed reconnect. Fresh reserved workers self-bind only through their recorded native terminal; launch never silently transfers or replaces another session.

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
