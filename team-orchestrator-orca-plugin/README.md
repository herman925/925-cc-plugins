# Team Orchestrator — Orca plugin

A proof of concept inspired by the team builder and roster in [925-cc-plugins / team-orchestrator](https://github.com/herman925/925-cc-plugins/tree/main/team-orchestrator). The interface runs **inside Orca's plugin panel**. **Create and launch team** sends a structured request to an existing coordinator agent, which opens Orca tabs, names sessions and briefs team members.

Current release label: **0.1.01**. Orca requires SemVer without leading zeros, so the manifest/package version is `0.1.1`. Releases increment one at a time.

## Features

- Roster, New team and Settings tabs.
- Original quick starts: Squad (4 members), All-Purpose Team (11), Tech Team (21).
- Original selection flow: Setup → Models → Preview → Launch.
- Head only; Head → Workers; Head → Leads → Workers; CEO → named team Heads → Workers.
- One to five reports per manager, Codex or Claude Code CLI, model ID and effort per hierarchy level.
- Immediate organisation tree preview, role symbols, reporting relationships and counts.
- Saved roster, clickable member details, generated role briefs, stacked/side-by-side cards and tree visibility settings.
- Duplicate team protection, validated restored data and failure-safe saves.
- Coordinator-tab selection, on-demand/all-at-create launch modes and explicit delivery receipts. Existing 0.1.0 rosters have a **Launch this team** action.

## Install in Orca

This folder includes the manifest and prebuilt, self-contained `panel.html`. No web server, runtime npm dependencies or external dashboard is required.

1. Use your existing `team-orchestrator-orca-plugin/` folder **on the computer running the Orca desktop UI**. Clone `herman925/925-cc-plugins` only if you do not already have it there. A folder only on an SSH workspace is not a desktop plugin path.
2. Enable the experimental plugin system in **Settings → Plugins**.
3. Under **Development**, add the absolute path to the `team-orchestrator-orca-plugin/` folder inside that checkout.
4. Review and enable **Team Orchestrator**. It requests plugin-private storage, focused workspace metadata and text delivery to a selected terminal in that workspace.
5. Open **Team Orchestrator** from the right sidebar.

### Update from 0.1.0

The manifest adds `workspace:read` and `terminal:send`. After loading the new files, return to **Settings → Plugins → Team Orchestrator → Review & enable** to approve the updated capabilities. Reopen the panel and check that its header reads **v0.1.01**. The sidebar icon is now the supported **Bot** icon.

### Launch a team

1. Have an existing Codex or Claude Code session open in the intended workspace.
2. Choose the preset, hierarchy and CLI/model/effort for each level.
3. Under **Launch**, select that session in **Coordinator agent tab**. The current Orca panel API exposes terminal handles, not their titles, so the selector shows numbered tabs and exact handles. Choose an agent session, not a plain shell.
4. Choose **On demand** (CEO and heads initially) or **All at create** (every member).
5. Click **Create and launch team**. The request is submitted with Enter to that agent session.
6. Follow its results: the coordinator resolves the execution workspace, writes role files and an authoritative roster, creates and names tabs, waits for CLI readiness and delivers the briefs. It reports actual handles, observed session IDs and partial failures.

The coordinator is the executor, rather than a new plugin worker API or an inbox/outbox service. Launch requests fit Orca's 4096-character panel limit. They include a stable request ID and instructions to inspect existing receipts before recovering an uncertain launch. Managers use Orca's version-matched orchestration skill for subsequent supervised assignments and durable messages/questions.

Launching works through the existing panel APIs on **unpatched Orca**; only panel persistence needs the storage patch below. The coordinator must have access to the Orca CLI. If it runs on SSH and receives `forbidden`, enable **Settings → SSH → Allow this host's orca CLI to control Orca** for that host. The plugin does not change that permission.

The panel's **Requested** state means input was accepted by the coordinator, not that a child session is ready. Actual launch results are reported in the coordinator session. A timeout is **Unconfirmed**, and no automatic resend occurs.

### Persistence requires a small Orca host patch

The inspected Orca API allows storage calls from plugin workers but not from sandboxed panels. This plugin does not work around the sandbox using network access, browser storage or terminal commands.

`patches/orca-panel-storage.patch` changes only the existing `storage.get` and `storage.set` methods to be panel-callable. Plugin identity binding, storage capability consent, schemas, quotas and mutation auditing remain enforced. Other storage operations and secrets remain inaccessible to panels.

Apply it to an **Orca source checkout**, then build/run Orca using its own repository instructions:

```sh
git -C /path/to/orca apply --check /path/to/team-orchestrator-orca-plugin/patches/orca-panel-storage.patch
git -C /path/to/orca apply /path/to/team-orchestrator-orca-plugin/patches/orca-panel-storage.patch
```

The patch was verified against Orca commit `dc146c09e2b12c229cc38434b7b1d4d9c012fdc5`. It must be applied to the host handling plugin calls; desktop/runtime builds may differ. This repository cannot patch Orca simply by installing a plugin.

**On unpatched Orca**, the builder, preview, roster and member details still work in explicitly labelled **session-only mode**. Closing or reloading the panel loses these definitions. Permission failures, malformed stored data and timeouts are shown as errors, rather than silently replacing saved data.

## Development and verification

Node.js 22 or newer. Run these commands inside `team-orchestrator-orca-plugin/`:

```sh
npm ci
npm run build
npm test
npx playwright install chromium
npm run test:ui
node scripts/verify-host.mjs
```

`verify-host.mjs` downloads pinned Orca source into a temporary directory and verifies the real manifest parser, patch application, capability gate, storage handlers and workspace-scoped terminal delivery. It requires network access and deletes its checkout afterward.

`npm run preview` starts a **development test host** at `http://127.0.0.1:4173`. It mounts the built panel in an opaque `sandbox="allow-scripts"` iframe with Orca's network-blocking policy and emulates the parent storage bridge. Parent-side browser storage is only a test fixture; it is not used by the plugin. `?mode=unpatched` simulates the current panel restriction; `?mode=write-error` simulates a failed save.

The shipped HTML bundles all JavaScript and CSS inline because Orca panels cannot load external scripts or styles. Edit `src/` and run the build; keep `panel.html` committed for installation.

## Scope and limitations

- The panel tracks launch delivery, not live child-session status. No fake working/idle states or fabricated session IDs.
- Model IDs are configuration values, not a verified account model catalogue. Default inherits agent configuration; an effort override requires an explicit model ID.
- No native direct worker execution, live status bridge, auto-close/reopen, enforcement of role permissions or interview flow yet. Actual session operations are performed by the selected coordinator agent.
- UI validation uses Playwright because the Browser plugin is unavailable in the build environment. A sandbox harness and actual host-contract tests are not a claim of end-to-end validation inside a running Orca desktop window.
- The interface is an original HTML/CSS implementation of the referenced interaction flow; Claude mod source is not bundled.

The roster's enduring member identities remain separate from individual Orca Task/Dispatch attempts.
