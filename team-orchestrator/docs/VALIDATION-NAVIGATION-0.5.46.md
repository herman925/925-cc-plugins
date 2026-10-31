# Panel navigation validation — 0.5.46

Herman requested active-tab toggling, one unambiguous Settings entry and creation controls that match shared approval state. The older New team tab was a different creation flow; while shared preview is On it and the empty quick starts are now hidden. Shared creation stays inside the approved shared workspace. Diagnostics follow the workspace instead of pushing its controls down.

## Local checks

- Full Mod suite: **385 passed, 0 failed**, 40 files, 28.63 seconds.
- Manifest/hooks validation: passes with existing directory metadata warnings.
- Five new host cases cover all four active-tab toggles and cross-tab switching; closed-band versus open-panel Settings; preview-On approval gating and diagnostic ordering; no native verification when closing Shared store; and dock close/reopen behavior.
- Existing refresh fixtures were updated to navigate to Roster only when not already there. A second click now closes the active tab, so the former redundant click was no longer a valid setup step. All original lifecycle assertions remain.
- Final code review also found the older roster-footer Settings alias. It was removed; its tests now use the single header Settings tab and explicitly assert the footer alias is absent. The final candidate overlays the original register hash with `settings-consolidation-hashes.json`.
- Shared-store core/schema/native verification and all 16 packaged modules are unchanged. No new database test run is claimed or required for this UI-only change.

## Independent acceptance

Focused native checks passed on the final register override. Independent full Mod suite: **385 passed, 0 failed**, 40 files, 31.23 seconds. The tester exercised all four tabs' open/switch/second-active-close behavior, the closed band and open header Settings entries, preview-On unapproved creation visibility, friendly missing-store details, and actual dock close/reopen. Actual 60-column native readbacks confirmed wrapped tabs, one Team Orchestrator Settings entry and a reachable unapproved controller button without activating it. Diagnostics below the fold were reached with ordinary Page Down scrolling.

Initial automated focus sequences encountered transient stale native handles during decorative redraws; those presses were excluded. Fresh ordinary focus movement and Enter passed all final sequences. This is recorded as a host/redraw observation, not a newly established candidate regression. No hidden handler, state manipulation or runtime patch was used to obtain passing native evidence. Approved workspace ordering and creation availability are final host-test/source evidence for this focused run; the tester did not alter an approved/bound fixture just for that layout assertion.

See [the unchanged independent report](INDEPENDENT-NAVIGATION-0.5.46.md), received as `msg_160cf5c2dbaf`. No store/lifecycle suite was rerun; prior 0.5.45 evidence retains its original scope. Real settings/install-record hashes are unchanged, no creation/approval/launch action was submitted, and fresh test fixtures are retained. The real project's new untracked `.team-orchestrator/`, unrelated root `docs/validation/` and earlier fixtures were preserved.

Herman was notified before the focused handoffs. No installed-user plugin reload, global configuration change, database inspection or guard bypass was performed.
