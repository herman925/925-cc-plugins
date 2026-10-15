# Team Orchestrator — Orca plugin

An Orca plugin panel inspired by [925-cc-plugins / team-orchestrator](https://github.com/herman925/925-cc-plugins/tree/main/team-orchestrator), with the organisation tree and Setup → Models → Preview → Launch selection flow.

It is separate from that Claude Code mod (0.5.37), which runs inside each Claude Code session. The current source keeps new teams in its own SQLite database under the verified Orca profile. It neither imports nor overwrites the mod's `.claude/team-orchestrator/` files or the prototype's `team-definitions-v1` KV data. It covers launching a team; the mod's messaging, on-demand starts, guard and live roster stay in the mod.

Release **0.1.06** (strict SemVer `0.1.6`). The plugin now includes its local Node worker and runtime adapter. You do not install a helper application, rebuild Orca or apply a source patch. Automatic injection is conditional on the installed Orca build passing the compatibility checks below.

## How it works

```text
Plugin panel on your PC
  → scoped runtime IPC adapter (in memory)
  → this plugin's Node worker on your PC
  → durable worker preparation → genuine native runtime IPC → durable settlement
  → Orca chooses the supervisor's terminal or structured session
```

The worker detects the local OS, application packaging, parent process and Electron inspector fuse. It activates its own parent Orca's loopback inspector, verifies the PID, application name and exact pinned build metadata, architecture, Electron/Node versions and SQLite capability, then installs an in-memory adapter. It closes the inspector it activated after injection; an existing developer inspector is left alone. Disabled fuses, another process on the inspector port, incompatible handlers or unsupported versions stop injection. The installed application files are never rewritten.

The adapter binds only `herman925.team-orchestrator`'s approved Team panel. It forwards an envelope through the existing `workspace.readContext` action to this plugin's declared commands. It calls Orca's original panel handler first, preserving current session ownership, consent, capability and admission checks, then uses the original command handler. An already open panel is bound on its next genuine main-frame IPC request, reusing Orca's owner/panel/revision token without refreshing discovery or manufacturing a sender event. Subframe requests and undeclared operations are rejected. It restores its wrappers on plugin disable/removal. Orca restart also removes the in-memory adapter.

The adapter captures the desktop's selected workspace identity. The worker resolves its actual `hostId`, presents a project/host selection for confirmation, and persists that binding with the team. Later launches check the saved identity and host, independently of desktop focus. Missing host evidence is reported instead of being assumed local. CLI `active` selectors are deliberately avoided because they resolve from cwd, not desktop selection. The worker passes `ORCA_USER_DATA_PATH` from the verified parent Electron application's `getPath('userData')`, and restores Windows `APPDATA` from `getPath('appData')` for its child CLI. It does not guess a profile directory, copy the desktop's full environment or change system environment settings. These internal paths are omitted from panel ping and Initialise results. This also pins macOS/Linux and custom/dev profiles to the same desktop instance.

Launch invokes native `agent.launchReplay` through the retained genuine main-frame event. The worker first commits a frozen role/configuration/scope, stable native operation ID and exclusive member reservation to SQLite. Fresh host capabilities and saved scope are checked before the effect. Orca applies custom command/argument/environment settings itself and chooses terminal or structured mode; the plugin does not construct provider shell commands. Omitted model/effort and `agentArgs` inherit native settings, while an explicit null argument override remains distinct.

Launch opens only the roster's highest supervisor. Its brief describes the team's persistent function and role, explicitly waits for a separate TeamWork objective, and does not instruct other members to start. Native returned identity is committed before optional terminal naming. Structured naming has no verified method in the pinned build, so the plugin keeps its own label and reports that limitation. Prompt journal/terminal handoff, provider observation and permission waits are separate facts. Structured provider observation remains unknown without a supported live stream; **Open verified session** opens the exact corroborated native session.

## Install or update

1. Use this folder on the **PC running Orca**, as your existing development plugin path. A checkout on the server alone is not automatically a local PC path.
2. Refresh **Settings → Plugins** and review/enable Team Orchestrator. Adding `main.mjs` changes Orca's consent to include **trusted Node worker code**. This worker has native process access, beyond the panel's declared host API capabilities.
3. Open the Team Orchestrator panel and check **v0.1.06**.
4. Orca starts workers lazily. An agent-status change or workspace-created event starts this worker and automatically injects the adapter. If the panel is opened on an idle desktop before either event, run the contributed Orca command **Team Orchestrator: Initialise local adapter** once. No external installer is involved. Bootstrap logs appear in this plugin's Orca logs.
5. Click **Test connection**. A successful test verifies a freshly echoed nonce from the worker and displays its actual OS, Orca version and worker PID. Launch stays disabled until that connection and workspace context are verified.
6. In the current source flow, select the intended Git or folder workspace in Orca, use **Refresh workspace** and **Confirm project and host**, then **Save team**. Saving does not launch agents or submit a total objective. Later choose **Launch this team** to open the highest supervisor, then inspect its native session for login or permission prompts. Source changes for issue #106 are bundled together once after its agent tickets merge.

The `main.mjs`, `runtime-adapter.cjs` and self-contained `panel.html` artifacts ship in this folder. Installation needs no npm packages or web server. The former manual patches and alternate manifest have been removed from this release; they remain in Git history.

If you see “plugin is not enabled with current consent”, first let any refresh finish and retry **Initialise local adapter**. If Settings → Plugins shows **Review required**, review/enable the plugin there. Version 0.1.05 removed the adapter's self-triggered refresh, added a live worker authority check before injection, and removed the unnecessary startup-status storage write that could poison bootstrap during a refresh. It does not alter or automatically approve consent.

## Features and recovery

- Roster, New team and Settings views; organisation tree and clickable member details.
- Squad (4), All-Purpose Team (11), Tech Team (21), and custom team hierarchies.
- Head only; Head → Workers; Head → Leads → Workers; CEO → named Heads → Workers.
- One to five reports per manager, Codex or Claude Code, model and effort by level.
- Persistent UUID team/member identities, confirmed project/host bindings, and immutable configuration/role versions in `<verified profile>/plugins-data/herman925.team-orchestrator/team-orchestrator.sqlite`. The native worker is the single writer; `node:sqlite` is required.
- Edit role descriptions, work habits and collaboration rules from member details. A new role version does not rewrite previous launch inputs.
- Version-checked semantic saves reject stale panels instead of overwriting another window. Same-name teams have independent identities.
- Read/schema/corruption errors block writes and preserve data. Legacy KV and mod data stay isolated; no automatic import occurs.
- Durable launch Operations and member reservations: intent before native effect, actual identity before naming, completed receipts reread without another launch.
- Unknown transport delivery retains the member reservation and is never automatically retried. Reload reads worker-saved handles from SQLite. Legacy coordinator requests are not imported or relaunched.

**Check saved launch** is an observation, not a second native launch. It reads only the pinned original `agent-session-journal.db` schema-4 operation row from the verified profile, under the desktop caller namespace, and validates operation ID, native fingerprint and expiry. A genuine succeeded launch receipt can repair missing plugin settlement. Missing, pending, unknown, expired, mismatched or unavailable rows remain unknown/reserved; no call to effectful `agent.launchReplay` is used as a query. Existing success is returned independently of current preferences. A native failure remains reserved for explicit later recovery; this ticket does not create a new session automatically.

## Separate total objectives and native Run evidence

After launching the registered Head/CEO, use **Submit total objective** on its team card. Saving a team and launching a preparation session remain separate actions. One TeamWork is reserved per team, with its saved project/host, configuration and role versions; repeated submission returns the same work. Updated role text is explicitly delivered as a handoff, while incompatible changed supervisor preferences are refused instead of pretending the existing session has changed agent/model.

The worker journals the objective before sending legitimate user input to the bound supervisor. It uses the pinned native local Unix socket/named-pipe protocol from the verified Orca profile, checks current plugin consent and runtime identity, and never supplies a fabricated supervisor caller or `--from`. This permits background evidence checks after the panel closes. The supervisor creates its own Run using its matching installed Orca CLI guide. The plugin opens the owning profile's schema-43 orchestration database read-only to corroborate exact objective, owner and consumer generation, then queries that explicit Run's task snapshot without reading/acknowledging the supervisor inbox.

The card distinguishes host input acceptance (including the exact journal dispatch state), observed processing, and verified Run ownership. A session/lineage record is not a liveness signal. Missing native evidence stays unverified; changed owner/generation fences previous work. **Check work evidence** never resends an ambiguous objective. **Retry unsent objective** appears only while no native input was attempted. Native metadata, credentials and private scope references stay out of public snapshots. The active worker checks real authority while reconciling pending work and resumes durable records after worker restart.

These source changes and their socket/SQLite/browser/Electron fixtures do not establish real installed-Orca/provider or remote-host acceptance. Current prerequisites come from actual host capabilities and refusals; the plugin does not invent obsolete Experimental/SSH settings. Task dispatch and total-result acceptance remain subsequent tickets.

## New-format team templates

In the current source, each saved team offers **Export template** and **Copy team**. Export opens a JSON document in **Templates**; select it and copy it using your normal keyboard shortcut to save or share it. A `.json` file can also be opened through the template file input. The opaque Orca panel does not require clipboard permission or an invented file-writing host API.

Import first validates and previews the hierarchy, roles and requested agent/model/effort preferences. Confirm the intended existing Git/folder project and local/SSH execution host, then choose **Import as new team**. Copy follows the same preview and confirmation flow, for the same project or another project currently selected in Orca. Each import creates new team/member IDs and a fresh role/configuration history; it starts no sessions. Same-name teams remain independent.

The versioned format contains configuration and role content, including level defaults and member override intent. It excludes active sessions, native Run/Dispatch authority, work history, account/login fields, effective model observations and full conversations. Import does not convert old mod/prototype data or provide shared control of another computer's running team. Invalid format/version/trees, stale panels and failed saves leave existing teams untouched; retries of one submitted request return its saved result without creating a second team.

## Verification

With Node.js 22 or newer, inside this folder:

```sh
npm ci
npm run build
npm test
npm run test:ui -- --output=/tmp/orca-worker-ui-results
npm run test:host
```

`test:host` downloads unmodified Orca sources pinned at `9fdd90ffa7721e145f1353ad9fb9df2f70c31f43`, compiles its actual manifest, panel envelope, consent fingerprint, capability gates, launch schemas/native fingerprint and host handlers, and exercises the adapter against those gates. It applies no source patch. OS secret encryption is stubbed.

For a separate native Electron test executable:

```sh
ELECTRON_TEST_BINARY=/absolute/path/to/electron npm run test:electron
```

That test creates a disposable Electron 43.7.5 application on macOS arm64 and forks the **built worker**. Real renderer `ipcRenderer.invoke` events exercise native launch/focus/reveal with durable intent-before-effect and identity-before-naming assertions, plus SQLite save/role editing/template copy/reload/replay after worker restart with confirmed SSH scope, lazy activation, the nonce round trip, subframe/foreign-command/token rejection, live consent and admission gates, retry without duplicate wrappers, inspector cleanup and disable restoration. Its explicit fixture metadata mirrors the pinned 1.4.222 package; it is not the actual Orca build and never starts a provider. The browser/host tests also use fixtures; they do not establish live provider readiness.

The current experimental contract is restricted to macOS arm64 Orca `1.4.222`, build `1.4.222-9fdd90ffa7721e145f1353ad9fb9df2f70c31f43-arm64`, Electron `43.7.5`, Node `24.21.0`. This is pinned source-contract and read-only package evidence plus separate Electron fixture validation, not installed-Orca/provider acceptance. Windows and other builds are explicitly unverified and refused until their contracts are validated. macOS resolves the outer application framework even when a forked worker runs from a nested Helper.app. Windows fuse inspection uses its actual executable.

Diagnostics distinguish `fuse_file_missing`, `fuse_disabled`, `port_conflict`, `invalid_parent_pid`, `parent_pid_mismatch`, `unsupported_build`, `platform_unverified`, and missing Node/profile capabilities. A panel load does not activate the worker. The panel displays panel-loaded, worker-activation and adapter status separately; a nonce never proves agent readiness. **Test connection** retries the declared initialise command when a bridge is available. If bootstrap fails before the bridge exists, run **Team Orchestrator: Initialise local adapter** and inspect its return/log diagnostics; the stock panel cannot bypass its absent command transport to retrieve those failures.

`npm run preview` serves an opaque, network-blocked panel fixture for Playwright. Its backend uses the real SQLite store and executor with fake Orca CLI/runtime boundaries. Native mediation and SQLite operations are the same source used by the adapter. Modes `unsupported-build`, `unpatched`, `no-tabs`, `write-error`, `read-error`, `launch-unknown`, `structured`, `permission`, `folder` and `no-workspace` cover behavior and failures. Browser localStorage only identifies a disposable fixture profile; product persistence never uses browser storage. Browser QA uses Playwright because the Browser plugin is unavailable.

## Compatibility limits

- Live launching in your PC's installed Orca remains unverified from this server session. The runtime adapter uses private Electron IPC handlers and Orca's experimental plugin interface; an Orca update can break it.
- Injection currently targets the main-process inspector's default loopback port 9229. A disabled inspector fuse or an incompatible debugger setup cannot be repaired by this plugin.
- Role persistence is confirmed by the plugin's SQLite transaction. A model's claim to have written a role file is not used as persistence evidence.
- Later on-demand workers, task dispatch, cross-session messaging, questions, live status and recovery UI are outside this launch proof of concept. Managers calling the remote orchestration CLI later still need the corresponding SSH-host CLI permission.
- Model/effort validity comes from the actual target catalog and native launch validation; no shared static provider effort list is assumed.

### Host-based agent preferences (#109)

Models now come from the saved project's native Orca capability reads. Level defaults and individual member overrides are saved as versioned requested preferences; changing a level leaves individual overrides intact. Member details can return to the level default. Model IDs and effort choices follow each model's host catalog. Effective model, effort and context usage remain unknown until native session evidence is available; a saved selection is not an observation of a running provider.

The adapter retains the genuine main-frame event for a fixed set of native reads, rechecks the original panel gate, and authenticates internal observation phases with a worker-instance secret. Panel input cannot provide capability proof or choose arbitrary runtime methods. Refresh failures invalidate older evidence, and rate-limit refusals retain the original host code. Normal plugin consent and frame/owner checks still apply.

Default model/effort inherit Orca settings without clearing launch arguments. SSH executable detection uses the saved target, with a separate connectivity check. The pinned host does not expose a trustworthy remote model catalog through the desktop model-catalog method: SSH catalog availability stays unknown, inherited defaults remain usable, and explicit model/effort overrides stay gated until verified. TUI picker visibility is displayed as configuration, not treated as a blanket structured-provider prohibition. Configuration and role collaboration rules do not intercept provider tools.

Evidence: source/service tests, opaque-frame browser tests, pinned source-schema checks, and a separate Electron fixture exercise these paths. They do not establish actual provider, SSH, or Windows acceptance. Native launch effect admission and later effective-value observation continue in the following implementation tickets.
