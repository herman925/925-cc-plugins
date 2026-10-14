# Team Orchestrator — Orca plugin

A proof of concept inspired by the team builder and organisation tree in [925-cc-plugins / team-orchestrator](https://github.com/herman925/925-cc-plugins/tree/main/team-orchestrator). The interface runs inside Orca's plugin panel.

Release **0.1.02** (`0.1.2` in the strict SemVer manifest). This release replaces the 0.1.01 coordinator-prompt workaround with a **native host launch bridge**. It requires the included patches in the Orca build running on your local PC. An unchanged Orca release will reject the new `terminal:create` capability; installing this plugin alone does not enable it.

## Launch architecture

```text
Create and launch team (plugin panel on local PC)
  → terminal.createAgent (native plugin host on local PC)
  → Orca's existing createTerminal(workspace, typed agent options)
  → Codex / Claude processes on the workspace's execution host
```

Orca controls the launch directly. No existing agent receives instructions to create the team. A workspace on SSH still uses Orca's normal connection to start its processes on the server; a server-side Orca CLI does not call back into the desktop to launch them. Initial team creation does not require enabling SSH-host CLI control.

**All at create** starts exactly the roster: a Squad has one Head and three Workers, with no extra CEO. **On demand** initially starts only CEO/Heads. The user is outside the roster. Each member receives its CLI/model/effort, named Orca tab, role brief, boss and complete reporting roster. Native launch uses Orca's typed `startupAgent` and `launchPreferences` options and its host-aware startup-prompt quoting, rather than building shell commands in HTML.

The host captures the focused workspace and checks an opaque workspace key on every create. Request IDs are journaled in plugin-private storage before spawning; completed receipts replay without spawning twice. Unknown launches and partial failures stop further creation. A created tab and a carried startup brief do not prove agent readiness or task completion.

## Features

- Roster, New team and Settings tabs.
- Original quick starts: Squad (4 members), All-Purpose Team (11), Tech Team (21).
- Setup → Models → Preview → Launch selection flow.
- Head only; Head → Workers; Head → Leads → Workers; CEO → named Heads → Workers.
- One to five reports per manager, Codex or Claude Code, model and effort per hierarchy level.
- Immediate organisation tree, clickable member details and reporting relationships.
- Persistent roster and actual created-tab receipts: title, handle, execution host and startup-brief outcome.
- Duplicate-name protection, validated restored data and failure-safe saves.

There is no coordinator-tab picker: the per-level CLI selection determines which new agent Orca starts. The host patch also preserves real tab titles and CLI identities in workspace context, instead of projecting anonymous handles alone.

## Prepare Orca on the local PC

Apply both patches to a source checkout of the **Orca build handling the panel on your local PC**, then build/run it using that repository's instructions. They were checked against Orca commit `dc146c09e2b12c229cc38434b7b1d4d9c012fdc5`. A different version may need its patch adapted.

```sh
git -C /path/to/orca apply --check /path/to/plugin/patches/orca-panel-storage.patch
git -C /path/to/orca apply /path/to/plugin/patches/orca-panel-storage.patch
git -C /path/to/orca apply --check /path/to/plugin/patches/orca-native-agent-launch.patch
git -C /path/to/orca apply /path/to/plugin/patches/orca-native-agent-launch.patch
```

Skip the storage patch if it has already been applied. The native patch adds one explicit `terminal:create` capability, one validated `terminal.createAgent` method, and workspace/tab metadata. It uses the existing panel admission, plugin identity, consent, mutation audit and runtime launcher; it does not expose raw RPC, arbitrary commands, environment changes or filesystem access. The storage patch exposes only the existing scoped `storage.get` and `storage.set` methods to panels.

These files are host source patches, not code a plugin can apply automatically. This server workspace cannot replace your local PC's installed Orca binary.

## Install and use

1. Use this folder on the PC running Orca; no clone is needed if that development checkout already exists there.
2. Enable experimental plugins under **Settings → Plugins**, and add this folder's absolute path under **Development**.
3. Review and enable Team Orchestrator. Review the new capability set when updating: storage, focused workspace metadata and native terminal creation.
4. Open Team Orchestrator in the right sidebar and check **v0.1.02**.
5. Activate the workspace where the agents should run. Choose a preset, CLI/model/effort and launch mode, then **Create and launch team**.
6. Follow each created-tab receipt. Inspect those tabs for readiness, authentication or permission prompts.

The panel blocks launching when the host does not advertise native launch support. It never substitutes a coordinator prompt or asks you to guess terminal UUIDs. Older saved coordinator requests remain visibly marked as legacy and unverified; they are not silently relaunched.

## Verification

Run inside this folder with Node.js 22 or newer:

```sh
npm ci
npm run build
npm test
npm run test:ui -- --output=/tmp/orca-native-ui-results
npm run test:host
```

The host check downloads pinned Orca sources into a temporary directory, applies both patches, compiles the actual manifest/gate/handlers/service binding, and exercises consent, metadata, workspace fencing, native launch options, prompt-carry receipts and persisted replay protection. Native spawning is an injected runtime delegate; OS encryption is stubbed and not tested. It does not claim a full Orca desktop build or live agent launch.

`npm run preview` runs a local development fixture on `http://127.0.0.1:4173`, with an opaque sandbox and Orca's network-blocking panel policy. It emulates host receipts and storage; it does not start agents. Modes `unpatched`, `no-tabs`, `write-error`, `partial` and `no-workspace` cover relevant failures. Browser storage belongs only to the fixture, never the shipped plugin.

Edit `src/`, build, and commit the self-contained `panel.html`. No external dashboard, web server or runtime npm dependencies are part of installation.

## Limits

- Live launch in the user's local Orca desktop and a complete Orca build remain unverified here.
- The bridge names Orca tabs. Provider conversation names and provider session IDs are not renamed or fabricated.
- Agents are asked to save their role file after startup; there is no host filesystem API for those files. Readiness is checked in the actual agent tab.
- This release launches and briefs initial members. Later on-demand worker creation, task dispatch, messaging, status refresh and recovery UI are not implemented. Managers using the remote orchestration CLI later still need SSH-host CLI control permission.
- Model and effort preferences are passed to Orca's launcher; the runtime decides whether the selected CLI supports them. Defaults inherit agent configuration.
- Browser validation uses Playwright because the Browser plugin is unavailable.
