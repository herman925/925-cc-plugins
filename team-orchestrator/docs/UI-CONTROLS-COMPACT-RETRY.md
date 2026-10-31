# Compact viewport retry — 0.5.44

The actual `auth-needs-approval.json` screen showed the access-card heading followed by `9 more`: the three-card layout pushed the primary actions below the visible panel. This is a real layout defect, even if keyboard focus can scroll to the hidden buttons.

Copy/hash-verify ONE runtime file into both current UI source fixtures:

- `team-orchestrator/hooks/shared-store.tsx`

`register.tsx` stays at the accepted boolean-save/Orca-validation repair. The new UI consolidates status, project, preview On/Off and access actions into one compact card. Primary actions are before expanded connection fields. Connection and Details controls stay before the content they expand. The main project label uses the current native project's folder name; Details retains the exact root, conversation and terminal. Approval still compares the full current proof, unchanged. No authentication, option-persistence, guard or backend operation changes.

The current full Mod suite passes **373 tests, 0 failures**, 38 files, 24.49 seconds. Manifest/hook validation and diff checking pass. Core packaged modules are unchanged.

Reload only the owned fixtures. Close Connection and Details before checking the default layout, then test their expansion separately. Capture/read back the actual normal and narrow windows. The primary toggle/access controls must be visible, not merely addressable by hidden keyboard handles. Preserve actual PNG paths and viewport dimensions. Native approval already completed on the old layout can be read back as Approved after this presentation-only patch; do not submit duplicate approvals. Keep the underlying approval action evidence and disclose this layout delta. Do not alter real/global options or retained A/B/C.
