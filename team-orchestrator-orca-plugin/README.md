# Team Orchestrator — Orca plugin

An Orca plugin panel inspired by [925-cc-plugins / team-orchestrator](https://github.com/herman925/925-cc-plugins/tree/main/team-orchestrator), with the organisation tree and Setup → Models → Preview → Launch selection flow.

Release **0.1.04** (strict SemVer `0.1.4`). The plugin now includes its local Node worker and runtime adapter. You do not install a helper application, rebuild Orca or apply a source patch. Automatic injection is conditional on the installed Orca build passing the compatibility checks below.

## How it works

```text
Plugin panel on your PC
  → scoped runtime IPC adapter (in memory)
  → this plugin's Node worker on your PC
  → the CLI bundled with that same Orca installation
  → new agent tabs on the workspace's execution host
```

The worker detects the local OS, application packaging, parent process and Electron inspector fuse. It activates its own parent Orca's loopback inspector, verifies the PID, application name and supported 1.4.x version, then installs an in-memory adapter. It closes the inspector it activated after injection; an existing developer inspector is left alone. Disabled fuses, another process on the inspector port, incompatible handlers or unsupported versions stop injection. The installed application files are never rewritten.

The adapter binds only `herman925.team-orchestrator`'s approved Team panel. It forwards an envelope through the existing `workspace.readContext` action to this plugin's declared commands. It calls Orca's original panel handler first, preserving current session ownership, consent, capability and admission checks, then uses the original command handler. It restores its wrappers on plugin disable/removal. Orca restart also removes the in-memory adapter.

The adapter captures the desktop's selected workspace identity. The worker hashes that identity for the panel and checks it before every new launch. CLI `active` selectors are deliberately avoided because they resolve from cwd, not desktop selection. The local CLI uses Orca's ordinary connection to start agents in an SSH workspace. Initial team creation does not need the server's “Allow this host's orca CLI to control Orca” setting.

For newer CLIs, the worker uses `agent launch --agent ... --worktree ... --prompt ...` with model and effort. For builds such as the 1.4.224 CLI inspected during development, it uses `terminal create --title ... --command ...`, carrying the role brief in the **new** agent's startup arguments. It quotes arguments for POSIX shells or explicitly selects PowerShell on Windows paths. It uses the `codex`/`claude` executables available to that terminal; this compatibility path does not apply a custom Orca agent-launch command. No existing agent receives a create-team instruction or role prompt.

“All at create” starts exactly the roster: Squad is one Head and three Workers. “On demand” initially starts only CEO/Heads. Every initial member gets its chosen CLI/model/effort, role, boss and reporting roster. The worker names Orca tabs and records actual returned handles and execution hosts. Provider conversation names are not changed. Supplying a startup prompt does not prove that an agent authenticated, acknowledged the brief or became ready.

## Install or update

1. Use this folder on the **PC running Orca**, as your existing development plugin path. A checkout on the server alone is not automatically a local PC path.
2. Refresh **Settings → Plugins** and review/enable Team Orchestrator. Adding `main.mjs` changes Orca's consent to include **trusted Node worker code**. This worker has native process access, beyond the panel's declared host API capabilities.
3. Open the Team Orchestrator panel and check **v0.1.04**.
4. Orca starts workers lazily. An agent-status change or workspace-created event starts this worker and automatically injects the adapter. If the panel is opened on an idle desktop before either event, run the contributed Orca command **Team Orchestrator: Initialise local adapter** once. No external installer is involved. Bootstrap logs appear in this plugin's Orca logs.
5. Click **Test connection**. A successful test verifies a freshly echoed nonce from the worker and displays its actual OS, Orca version and worker PID. Launch stays disabled until that connection and workspace context are verified.
6. Select the intended workspace, create a team and choose **All at create** or **On demand**. Inspect the named agent tabs for startup/authentication prompts.

The `main.mjs`, `runtime-adapter.cjs` and self-contained `panel.html` artifacts ship in this folder. Installation needs no npm packages or web server. The former manual patches and alternate manifest have been removed from this release; they remain in Git history.

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

`test:host` downloads unmodified Orca sources pinned at `dc146c09e2b12c229cc38434b7b1d4d9c012fdc5`, compiles its actual manifest, panel envelope, consent fingerprint, capability gates and host handlers, and exercises the adapter against those gates. It applies no source patch. OS secret encryption is stubbed.

For a separate native Electron test executable:

```sh
ELECTRON_TEST_BINARY=/absolute/path/to/electron npm run test:electron
```

That test creates a disposable Electron application, forks the **shipped worker**, verifies automatic injection, panel-to-worker nonce round trip, desktop workspace targeting, four named launch receipts, persisted duplicate prevention, inspector cleanup and disable. Its CLI records arguments and returns fixture receipts; it never starts coding agents. Linux QA used Electron 43.7.5 under Xvfb. Windows/macOS OS/package detection and quoting have unit coverage; native injection on those systems is not verified here.

`npm run preview` serves an opaque, network-blocked panel fixture for Playwright. Modes `unpatched`, `no-tabs`, `write-error`, `partial` and `no-workspace` cover failures. Browser storage is fixture-only, never used by the shipped panel. Browser QA uses Playwright because the Browser plugin is unavailable.

## Compatibility limits

- Live launching in your PC's installed Orca remains unverified from this server session. The runtime adapter uses private Electron IPC handlers and Orca's experimental plugin interface; an Orca update can break it.
- Injection currently targets the main-process inspector's default loopback port 9229. A disabled inspector fuse or an incompatible debugger setup cannot be repaired by this plugin.
- Role-file creation is requested in the startup brief; the worker does not write files in the execution workspace itself.
- Later on-demand workers, task dispatch, cross-session messaging, questions, live status and recovery UI are outside this launch proof of concept. Managers calling the remote orchestration CLI later still need the corresponding SSH-host CLI permission.
- CLI/provider model and effort availability is determined by the installed versions. The compatibility launcher refuses Claude's unsupported `xhigh` effort.
