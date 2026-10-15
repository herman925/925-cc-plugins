# Team Orchestrator — Orca plugin

An Orca plugin panel inspired by [925-cc-plugins / team-orchestrator](https://github.com/herman925/925-cc-plugins/tree/main/team-orchestrator), with the organisation tree and Setup → Models → Preview → Launch selection flow.

It is separate from that Claude Code mod (0.5.37), which runs inside each Claude Code session. This plugin keeps its teams in Orca's plugin-private storage, not in the mod's `.claude/team-orchestrator/` files, so a team made in one does not appear in the other. It covers launching a team; the mod's messaging, on-demand starts, guard and live roster stay in the mod.

Release **0.1.06** (strict SemVer `0.1.6`). The plugin now includes its local Node worker and runtime adapter. You do not install a helper application, rebuild Orca or apply a source patch. Automatic injection is conditional on the installed Orca build passing the compatibility checks below.

## How it works

```text
Plugin panel on your PC
  → scoped runtime IPC adapter (in memory)
  → this plugin's Node worker on your PC
  → the CLI bundled with that same Orca installation
  → new agent tabs on the workspace's execution host
```

The worker detects the local OS, application packaging, parent process and Electron inspector fuse. It activates its own parent Orca's loopback inspector, verifies the PID, application name and exact pinned build metadata, architecture, Electron/Node versions and SQLite capability, then installs an in-memory adapter. It closes the inspector it activated after injection; an existing developer inspector is left alone. Disabled fuses, another process on the inspector port, incompatible handlers or unsupported versions stop injection. The installed application files are never rewritten.

The adapter binds only `herman925.team-orchestrator`'s approved Team panel. It forwards an envelope through the existing `workspace.readContext` action to this plugin's declared commands. It calls Orca's original panel handler first, preserving current session ownership, consent, capability and admission checks, then uses the original command handler. An already open panel is bound on its next genuine main-frame IPC request, reusing Orca's owner/panel/revision token without refreshing discovery or manufacturing a sender event. Subframe requests and undeclared operations are rejected. It restores its wrappers on plugin disable/removal. Orca restart also removes the in-memory adapter.

The adapter captures the desktop's selected workspace identity. The worker hashes that identity for the panel and checks it before every new launch. CLI `active` selectors are deliberately avoided because they resolve from cwd, not desktop selection. The worker passes `ORCA_USER_DATA_PATH` from the verified parent Electron application's `getPath('userData')`, and restores Windows `APPDATA` from `getPath('appData')` for its child CLI. It does not guess a profile directory, copy the desktop's full environment or change system environment settings. These internal paths are omitted from panel ping and Initialise results. This also pins macOS/Linux and custom/dev profiles to the same desktop instance.

The local CLI uses Orca's ordinary connection to start agents in an SSH workspace. Initial team creation does not need the server's “Allow this host's orca CLI to control Orca” setting.

For newer CLIs, the worker uses `agent launch --agent ... --worktree ... --prompt ...` with model and effort. For builds such as the 1.4.224 CLI inspected during development, it uses `terminal create --title ... --command ...`, carrying the role brief in the **new** agent's startup arguments. It quotes arguments for POSIX shells or explicitly selects PowerShell on Windows paths. It uses the `codex`/`claude` executables available to that terminal; this compatibility path does not apply a custom Orca agent-launch command. No existing agent receives a create-team instruction or role prompt.

“All at create” starts exactly the roster: Squad is one Head and three Workers. “On demand” initially starts only CEO/Heads. Every initial member gets its chosen CLI/model/effort, role, boss and reporting roster. The worker names Orca tabs and records actual returned handles and execution hosts. Provider conversation names are not changed. Supplying a startup prompt does not prove that an agent authenticated, acknowledged the brief or became ready.

## Install or update

1. Use this folder on the **PC running Orca**, as your existing development plugin path. A checkout on the server alone is not automatically a local PC path.
2. Refresh **Settings → Plugins** and review/enable Team Orchestrator. Adding `main.mjs` changes Orca's consent to include **trusted Node worker code**. This worker has native process access, beyond the panel's declared host API capabilities.
3. Open the Team Orchestrator panel and check **v0.1.06**.
4. Orca starts workers lazily. An agent-status change or workspace-created event starts this worker and automatically injects the adapter. If the panel is opened on an idle desktop before either event, run the contributed Orca command **Team Orchestrator: Initialise local adapter** once. No external installer is involved. Bootstrap logs appear in this plugin's Orca logs.
5. Click **Test connection**. A successful test verifies a freshly echoed nonce from the worker and displays its actual OS, Orca version and worker PID. Launch stays disabled until that connection and workspace context are verified.
6. Select the intended workspace, create a team and choose **All at create** or **On demand**. Inspect the named agent tabs for startup/authentication prompts.

The `main.mjs`, `runtime-adapter.cjs` and self-contained `panel.html` artifacts ship in this folder. Installation needs no npm packages or web server. The former manual patches and alternate manifest have been removed from this release; they remain in Git history.

If you see “plugin is not enabled with current consent”, first let any refresh finish and retry **Initialise local adapter**. If Settings → Plugins shows **Review required**, review/enable the plugin there. Version 0.1.05 removed the adapter's self-triggered refresh, added a live worker authority check before injection, and removed the unnecessary startup-status storage write that could poison bootstrap during a refresh. It does not alter or automatically approve consent.

## Features and recovery

- Roster, New team and Settings views; organisation tree and clickable member details.
- Squad (4), All-Purpose Team (11), Tech Team (21), and custom team hierarchies.
- Head only; Head → Workers; Head → Leads → Workers; CEO → named Heads → Workers.
- One to five reports per manager, Codex or Claude Code, model and effort by level.
- Persistent team definitions in Orca's plugin-private storage, including legacy definitions.
- Background launch jobs and persisted request journals: intent before spawn, actual handle before naming follow-ups, completed receipts replayed without another spawn.
- Partial failure stops later members. Unknown transport delivery is never automatically retried. Reload merges already saved handles into the roster. Legacy coordinator requests are not silently relaunched.

After an unknown launch, inspect Orca before creating another team. A worker interrupted between spawning and saving its receipt cannot establish whether that spawn succeeded; its existing journal remains unresolved. There is no automatic recovery/relaunch button for that case.

## Verification

With Node.js 22 or newer, inside this folder:

```sh
npm ci
npm run build
npm test
npm run test:ui -- --output=/tmp/orca-worker-ui-results
npm run test:host
```

`test:host` downloads unmodified Orca sources pinned at `9fdd90ffa7721e145f1353ad9fb9df2f70c31f43`, compiles its actual manifest, panel envelope, consent fingerprint, capability gates and host handlers, and exercises the adapter against those gates. It applies no source patch. OS secret encryption is stubbed.

For a separate native Electron test executable:

```sh
ELECTRON_TEST_BINARY=/absolute/path/to/electron npm run test:electron
```

That test creates a disposable Electron 43.7.5 application on macOS arm64 and forks the **built worker**. Real renderer `ipcRenderer.invoke` events exercise lazy activation, the nonce round trip, subframe/foreign-command/token rejection, live consent and admission gates, retry without duplicate wrappers, inspector cleanup and disable restoration. Its explicit fixture metadata mirrors the pinned 1.4.222 package; it is not the actual Orca build and never starts a provider. The browser/host tests also use fixtures; they do not establish live provider readiness.

The current experimental contract is restricted to macOS arm64 Orca `1.4.222`, build `1.4.222-9fdd90ffa7721e145f1353ad9fb9df2f70c31f43-arm64`, Electron `43.7.5`, Node `24.21.0`. This is pinned source-contract and read-only package evidence plus separate Electron fixture validation, not installed-Orca/provider acceptance. Windows and other builds are explicitly unverified and refused until their contracts are validated. macOS resolves the outer application framework even when a forked worker runs from a nested Helper.app. Windows fuse inspection uses its actual executable.

Diagnostics distinguish `fuse_file_missing`, `fuse_disabled`, `port_conflict`, `invalid_parent_pid`, `parent_pid_mismatch`, `unsupported_build`, `platform_unverified`, and missing Node/profile capabilities. A panel load does not activate the worker. The panel displays panel-loaded, worker-activation and adapter status separately; a nonce never proves agent readiness. **Test connection** retries the declared initialise command when a bridge is available. If bootstrap fails before the bridge exists, run **Team Orchestrator: Initialise local adapter** and inspect its return/log diagnostics; the stock panel cannot bypass its absent command transport to retrieve those failures.

`npm run preview` serves an opaque, network-blocked panel fixture for Playwright. Modes `unsupported-build`, `unpatched`, `no-tabs`, `write-error`, `partial` and `no-workspace` cover failures. Browser storage is fixture-only, never used by the shipped panel. Browser QA uses Playwright because the Browser plugin is unavailable.

## Compatibility limits

- Live launching in your PC's installed Orca remains unverified from this server session. The runtime adapter uses private Electron IPC handlers and Orca's experimental plugin interface; an Orca update can break it.
- Injection currently targets the main-process inspector's default loopback port 9229. A disabled inspector fuse or an incompatible debugger setup cannot be repaired by this plugin.
- Role-file creation is requested in the startup brief; the worker does not write files in the execution workspace itself.
- Later on-demand workers, task dispatch, cross-session messaging, questions, live status and recovery UI are outside this launch proof of concept. Managers calling the remote orchestration CLI later still need the corresponding SSH-host CLI permission.
- CLI/provider model and effort availability is determined by the installed versions. The compatibility launcher refuses Claude's unsupported `xhigh` effort.
