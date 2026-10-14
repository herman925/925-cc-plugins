# Team Orchestrator Orca plugin

- Keep this plugin in this folder within `herman925/925-cc-plugins`; do not create a separate repository.
- Use the user's padded release labels: `0.1.01`, `0.1.02`, and so on, one increment at a time. Set `package.json`'s `displayVersion` accordingly. Orca's strict SemVer manifest and package version use `0.1.1`, `0.1.2`, respectively; the build checks consistency.
- Git commits must use `herman925` and the repository's configured GitHub identity.
- The shipped surface is an Orca plugin panel, not a CLI UI or external dashboard. Preserve the original Claude mod's hierarchy and selection flow.
- Never present accepted launch input as proof of live/ready child sessions. Unknown delivery must not trigger automatic duplicate launches.
- Run the build after source edits and commit the self-contained `panel.html`. Run domain/bridge tests, browser tests and host contract checks for changed behavior.

- Launch teams through the local Orca native host bridge. Do not restore the coordinator-prompt workaround or an anonymous terminal picker.
- The native bridge requires an Orca host source patch on the local PC. Never describe updating the plugin as applying that host patch or claim real desktop launching from fixture receipts.
- The default orca-plugin.json must validate on stock Orca. Keep terminal:create only in the explicit orca-plugin.native.json opt-in for patched hosts, and update both manifest versions together.
