# Team Orchestrator — Orca plugin

A UI-first proof of concept inspired by the team builder and roster in [925-cc-plugins / team-orchestrator](https://github.com/herman925/925-cc-plugins/tree/main/team-orchestrator). The interface runs **inside Orca's plugin panel**. It creates team definitions; it does not launch or message agent sessions yet.

## Features

- Roster, New team and Settings tabs.
- Original quick starts: Squad (4 members), All-Purpose Team (11), Tech Team (21).
- Original selection flow: Setup → Models → Preview → Create.
- Head only; Head → Workers; Head → Leads → Workers; CEO → named team Heads → Workers.
- One to five reports per manager, Codex model ID and effort per hierarchy level.
- Immediate organisation tree preview, role symbols, reporting relationships and counts.
- Saved roster, clickable member details, generated role briefs, stacked/side-by-side cards and tree visibility settings.
- Duplicate team protection, validated restored data and failure-safe saves.

## Install in Orca

This folder includes the manifest and prebuilt, self-contained `panel.html`. No web server, runtime npm dependencies or external dashboard is required.

1. Clone `herman925/925-cc-plugins` **on the computer running the Orca desktop UI**. A folder only on an SSH workspace is not a desktop plugin path.
2. Enable the experimental plugin system in **Settings → Plugins**.
3. Under **Development**, add the absolute path to the `team-orchestrator-orca-plugin/` folder inside that checkout.
4. Review and enable **Team Orchestrator**. Its only requested capability is plugin-private storage.
5. Open **Team Orchestrator** from the right sidebar.

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

`verify-host.mjs` downloads pinned Orca source into a temporary directory and verifies the real manifest parser, patch application, capability gate and storage handlers. It requires network access and deletes its checkout afterward.

`npm run preview` starts a **development test host** at `http://127.0.0.1:4173`. It mounts the built panel in an opaque `sandbox="allow-scripts"` iframe with Orca's network-blocking policy and emulates the parent storage bridge. Parent-side browser storage is only a test fixture; it is not used by the plugin. `?mode=unpatched` simulates the current panel restriction; `?mode=write-error` simulates a failed save.

The shipped HTML bundles all JavaScript and CSS inline because Orca panels cannot load external scripts or styles. Edit `src/` and run the build; keep `panel.html` committed for installation.

## Scope and limitations

- All created members show **Unassigned**. No fake working/idle states or fabricated session IDs.
- Model IDs are configuration values, not a verified account model catalogue. Default inherits agent configuration; an effort override requires an explicit model ID.
- No agent launch, message delivery, polling, inbox/outbox, auto-close/reopen, permission guards or interview flow in this proof of concept.
- UI validation uses Playwright because the Browser plugin is unavailable in the build environment. A sandbox harness and actual host-contract tests are not a claim of end-to-end validation inside a running Orca desktop window.
- The interface is an original HTML/CSS implementation of the referenced interaction flow; Claude mod source is not bundled.

Later runtime integration can use Orca's orchestration skill/CLI. The roster's enduring member identities should remain separate from individual Task/Dispatch attempts.
