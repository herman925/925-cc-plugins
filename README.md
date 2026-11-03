# 925-cc-plugins

Herman's Claude Code mods, Codex workflows and Orca plugin. Claude Code uses the `herman-mods` marketplace; Codex uses `herman925-codex` or the repository skill installer.

## Team Orchestrator

Choose the client you work in. The Claude Code shared workspace and Codex client use the same project-owned store and management API; each has its own interface and installation package.

| Client | Package | Current status | How you use it |
| --- | --- | --- | --- |
| **Claude Code** | [Team Orchestrator Mod](team-orchestrator/README.md), installed as a Claude Code plugin | **0.5.56**, implemented | Native panel: Create team, templates/Interview me, team workspace, members, tasks, inbox, gates and meetings |
| **Codex** | [team-orchestration-925](team-orchestration-925/README.md), a Codex plugin containing a skill set and matching runtime | **0.1.2**, implemented for Windows native Codex hosted by Orca | Six direct action skills plus a general menu; an active Claude session is not required |
| **Hermes Agent** | Native Team Orchestrator client/package | **Pending** | Shared-store management, verified admission and lifecycle integration are not implemented; no equivalent install command yet |

The Codex **plugin** is the installable bundle; its **skills** are the named workflows. The optional npx route installs only the standalone menu skill with its matching runtime. It does not install the complete plugin or automatically activate/trust its connection and hook.

A separate [Orca plugin](#orca-plugin) also exists. It currently has its own store/runtime and is not required to use the Claude Code or Codex clients. Selecting Orca as the Codex session host does not install that plugin or move a team into its store.

### Claude Code: install and start

Run in your terminal:

```text
claude plugin marketplace add herman925/925-cc-plugins
claude plugin install team-orchestrator@herman-mods --scope user
```

In an already-open Claude Code session, run `/reload-plugins`. Open Team Orchestrator with the visible control, `t` or `/team`. For a new shared team, choose **Create team**, start from a template, **Interview me** or your own draft, then review members/options, enable the project's shared workspace, explicitly allow conversation management and create the team. The resulting **Team workspace** provides member/task controls; meetings use Agenda, Discussion and Outputs. The panel requests right docking where the host supports it. See [the Mod guide](team-orchestrator/README.md) and [panel navigation](team-orchestrator/docs/panel-navigation.md).

To update:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Then reload/restart as described in the Mod guide, reloading the team top first. Existing classic rosters remain separate from shared teams; installation is not a migration.

### Codex: install the plugin and choose a flow

For the complete skill set, run in your terminal:

```text
codex plugin marketplace add herman925/925-cc-plugins
codex plugin add team-orchestration-925@herman925-codex
```

In a Codex conversation, type `$team-orchestration-925` and select a workflow in the skill picker, or use its full name:

| Flow | Skill invocation | What happens |
| --- | --- | --- |
| Set up the project connection | `$team-orchestration-925:setup` | Preview/apply the owned project MCP/hook configuration, diagnose it, update it, recover interruption or remove it |
| Create a team | `$team-orchestration-925:create` | Draft purpose, composition, roles, reporting lines and supported CLIs; review and confirm creation |
| Edit a team | `$team-orchestration-925:edit` | Inspect the current team, preview supported configuration changes and confirm the exact edits |
| Connect sessions | `$team-orchestration-925:connect` | Choose verified existing Claude/Codex sessions for members, or explicitly reconnect a changed native binding |
| Check status | `$team-orchestration-925:status` | Inspect team, controller approval, binding and capability state |
| Work with meetings | `$team-orchestration-925:meeting` | Inspect invitations/discussion/outputs and use the operations permitted for the current member or chair |
| Choose from the general menu | `$team-orchestration-925:team-orchestration-925` | Pick one of the workflows interactively |

For a new project: **setup → reconnect/native hook review → create → connect → status**. The setup helper discovers the verified Orca project/session; it preserves unrelated configuration. Controller approval and management changes use native confirmation. Installing a plugin or answering draft questions is not approval or hook trust. Existing sessions are connected explicitly; automatic Codex launch is pending. If the skill list is stale, reopen the Codex session.

Update the repository snapshot and installed plugin with:

```text
codex plugin marketplace upgrade herman925-codex
codex plugin add team-orchestration-925@herman925-codex
```

Then use `:setup` for any owned project connection update and reconnect as instructed. Before uninstalling, use its setup removal workflow to remove owned connection/hook entries, then `codex plugin remove team-orchestration-925@herman925-codex`. Team data is preserved. See [supported edits, setup and removal](team-orchestration-925/README.md).

### Codex: optional standalone menu skill

If you prefer the repository skill installer instead of the complete plugin:

```text
npx skills@1.7.4 add https://github.com/herman925/925-cc-plugins/tree/main/team-orchestration-925 --skill team-orchestration-925 --agent codex
```

This route provides `$team-orchestration-925` with action arguments such as `create-team`, `edit-team`, `connect-session`, `status` and `meeting`. It includes the matching setup/runtime resources, but the six plugin-namespaced action skills come with the complete plugin route above. Choose one installation route. The first-use project connection and native hook review are required in either route.

### Hermes: pending native integration

Hermes is a planned client lane, not a shipped equivalent of the Codex skill set. The Mod already contains a [classic-team Hermes guard and patch checker](team-orchestrator/README.md#hermes-members-the-guard-and-the-re-check-0529). Those helpers do not provide shared-store management, native controller approval, session admission, delivery/recovery or meeting parity. The shared creation/binding API currently supports Claude and Codex only. Track the remaining work in the [Wayfinder map](https://github.com/herman925/925-cc-plugins/issues/2).

### Shared storage and current limits

Shared teams use local **SQLite by default**, with explicitly configured **PostgreSQL as an alternative**. This is store selection, not automatic local/online switching or synchronization. Hosted onboarding and classic/plugin migration remain separate work.

The Claude Mod's classic mode supports Windows, macOS and Linux; that does not extend the current Codex adapter beyond **Windows + Orca**. Positive live-model Codex guard behavior and a complete mixed-session assignment/meeting/wake acceptance run remain open. [Action-skill evidence](shared/team-store/VALIDATION-ACTION-SKILLS.md) and [shared runtime evidence](shared/team-store/VALIDATION-925-TO.md) state the exact tested boundaries.

## Claude Code mods

| Mod | What it does | Version |
|---|---|---|
| [`session-panel`](session-panel/README.md) | Hides tool calls and shows a calm step checklist above the prompt, with a Hide details / Show details button (`/simple on\|off`). Has a prompt Enhancer (`/enhance`, or auto-enhance on Enter), and an Assumptions list that Claude fills as it works, with Confirm, Wrong and Delete. A question box rule, on by default, has Claude ask for permission and big choices with AskUserQuestion instead of in prose, including every `/grilling`, `/grill-me` and `/grill-with-docs` question, with an optional warning when it asks in prose. Settings is a floating card with tabs, laid out as a table. | 0.3.66 |
| [`team-orchestrator`](team-orchestrator/README.md) | Runs a team of Claude Code sessions as Orca tabs, managed from a native panel that defaults to the right side where the host supports docking: quick starts, a team form, a live roster (stacked, side by side or docked) and an org chart. Members start on their first message and reopen when a message arrives; automatic close and eviction are paused until native cleanup verification exists. Each member has a role file. Members can be added to a running team. A guard keeps members from starting subagents, and members with reports from writing files, unless you allow it. With Session Panel, it shows each member's open assumptions and lets its boss or the team top confirm, mark wrong or delete them (opt-in: Settings → Classic teams → Assumptions → Show). Works on Windows, macOS and Linux. | 0.5.56 |
| [`speaker-colours`](speaker-colours) | Speaker colours: a blue bar for your messages, orange for Claude's replies. | 0.1.1 |

### Install

1. Add the marketplace: `claude plugin marketplace add herman925/925-cc-plugins`
2. Install a mod: `claude plugin install team-orchestrator@herman-mods --scope user`
3. Run `/reload-plugins` in a session that is already open.

To update: `claude plugin marketplace update herman-mods`, then `claude plugin update <mod>@herman-mods`, then `/reload-plugins`. For Team Orchestrator, reload the team top first (see its README).

### Develop a mod

The marketplace is this repository on GitHub, and nothing else. A mod is changed in a
clone of this repo, on a branch, and is only real once it is pushed.

1. Clone: `git clone https://github.com/herman925/925-cc-plugins.git`
2. Branch: `git checkout -b feature/<mod>-<version>`
3. Change the mod folder, and bump its `.claude-plugin/plugin.json` `version`.
4. Check it: `claude plugin validate <folder>` and `claude plugin test <folder>`.
5. Commit and push the branch, then merge it into `main`.
6. On every computer that uses the mod:
   `claude plugin marketplace update herman-mods`,
   `claude plugin update <mod>@herman-mods`, then `/reload-plugins`.

**Why the update step is not optional.** The installed copy lives in
`~/.claude/plugins/cache/<marketplace>/<mod>/<version>/`, and the marketplace itself is a
clone of this repo under `~/.claude/plugins/marketplaces/`. Both are refreshed only by
`claude plugin marketplace update` and `claude plugin update`. A change that exists only
in a working directory is not installed, and a machine that does not run the update keeps
the version it last installed. That is what makes several computers work: every one of
them pulls the same published commit.

**Do not develop against the installed copy.** `~/.claude/plugins/cache/` and
`~/.claude/plugins/marketplaces/` are both replaced by the update commands, so an edit
made there is lost on the next update. Change the clone, push it, and let the update
commands install it.

### Add a mod

1. Make a folder with `.claude-plugin/plugin.json` and `hooks/hooks.json` (and `hooks/register.tsx`).
2. Add it to `.claude-plugin/marketplace.json`.
3. Check it: `claude plugin validate <folder>` and `claude plugin test <folder>`.

## Orca plugin

The [shared team-store foundation](shared/team-store/README.md) defines the common schema and typed API, tested against SQLite and PostgreSQL and consumed by the Claude Mod and Codex clients described above. The Orca plugin still uses its own store/lifecycle; shared-runtime convergence is pending. Existing classic teams are also preserved separately. See the [client/install guide](#team-orchestrator) and [current shared validation](shared/team-store/VALIDATION-925-TO.md).

[Team Orchestrator for Orca](team-orchestrator-orca-plugin/README.md) (0.1.25) lives in `team-orchestrator-orca-plugin/`. It brings Team Orchestrator's team creation into Orca's own plugin panel: hierarchies derived from the lead count, with independent worker counts, automatic project detection, host-derived model selectors, an organisation tree and a read-only member roster. Add team opens the setup form; new teams start all members, and users give work directly to the highest supervisor. It bundles a local Node worker and an automatic in-memory runtime adapter that launch and brief Codex or Claude Code sessions on the selected workspace's host, and name terminal-backed tabs, with no separate helper to install and no Orca source patch. Injection depends on the installed Orca build passing its compatibility checks; its README explains native-worker consent, lazy startup, connection checks and the verified limits.

It is installed in Orca (Settings → Plugins), not from the marketplace above, and it keeps its teams in Orca's plugin storage, separate from the Claude Code mod's team files. It supports native task dispatch with on-demand member starts, hierarchical manager Runs, verified messages and user questions, recovery, and supervisor review followed by user acceptance of the total result. The panel tracks saved evidence and unknown outcomes; installed-provider and remote-host acceptance remain separate validation steps.
