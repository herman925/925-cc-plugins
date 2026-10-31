# Focused independent navigation acceptance — 0.5.46

Date: 2026-11-01 local. Evidence root: `C:/Users/Herman/AppData/Local/Temp/nav046-ceo-1pBGqg`.

## Result

The focused native navigation/Settings/unapproved-creation checks passed on the final Settings-consolidation override. No database/lifecycle test was rerun and no creation, launch or controller-approval action was submitted.

| Check | Measurement / actual result |
| --- | --- |
| Independent final complete Mod suite | 385 passed, 0 failed, 40 files; 31.23s |
| Original candidate suite | 385 passed, 0 failed, 40 files; 28.89s; historical before final footer removal |
| Validation | Completed on final source with existing metadata warnings |
| Packaging | 16 packaged core modules matched |
| Preview Off tabs | Roster, New team, Settings and Shared store each opened, switched to another tab, returned, and closed on second active activation |
| Team Orchestrator Settings entries | Closed panel has one band shortcut; open panel has one header Settings tab; old footer alias absent in final source/host tests |
| Preview On, unapproved | Legacy New team and quick starts absent; empty roster opens Shared store; Approve controller visible; shared Create team absent |
| Friendly first setup | Details shows `No shared store yet. Approve controller to set up this project.`; raw STORE_NOT_FOUND absent |
| Dock | Actual visible dock Settings tab activation closed the pane entirely; band Settings reopened it |
| Narrow | Actual 60-column terminal: single Team Orchestrator Settings entry in closed/open states, wrapped tabs reachable, Approve controller visibly reachable without activation |
| Preservation | Real settings.json and installed_plugins.json SHA256 values match baseline |

Session Panel has its own Settings control. The one-entry assertion refers to Team Orchestrator only, not every installed mod.

## Candidate hashes and fixture scope

Initial source copy matched all three recorded candidate hashes. Then copied ONLY the final register.tsx override after its handoff:

- register.tsx final SHA256: `7ba982927acfe83ad4e94f0e4cf40d3698ca37167c20b59814df7bc5c58806fc`.
- shared-store.tsx unchanged initial SHA256: `bb10cff624ffc2b2c2173f0928e804f613e847677fa8e63ae874fefa617da9ac`.
- plugin.json unchanged initial SHA256: `6c56cd8a4f9762915e8d855ae3cdded479ad998431d2ce4d52ca36ed0ee08222`.

The original source copy is preserved as register-original-candidate.tsx. Final source/copy equality was checked. Both fresh fixtures load this source copy through --plugin-dir with fixed per-invocation Off/On options, exact Node/Orca paths, and installed Mod disabled for the invocation. No option Save/Toggle actions changed user config. Source preview default remains false.

Fresh owned project only. The real repository's new untracked .team-orchestrator and unrelated docs/validation draft were not inspected or modified. Previous schema5/UI/workspace fixtures remain retained and unchanged.

## Actual input and readback evidence

`check-tabs.cjs` drove real terminal key input and captured open/switch/close screen records for all four tabs. Counted closed states contain band Settings and no top tab row. Actual ui.focus and ui.press logs corroborate handler activation.

Early helper attempts suffered stale native button handles during decorative redraws; the failed snapshots remain. The helper initially reused the most recent focus log while a redraw had invalidated its handle. Those failed presses are NOT accepted evidence. Fresh ordinary Tab then Shift+Tab then Enter in one native input event reacquired the visible target, and all final sequences passed. No hidden UI-handler call, state write or product patch was used. Transient stale-handle behavior remains an observed host/redraw caveat, not established as a new candidate regression.

Actual dock: dock-open.json shows the native pane. Visible terminal mouse input at its Settings tab raised `ui.press ... tab-settings in Pane`; dock-closed.json shows pane removed, and dock-reopened.json shows the band shortcut reopened Settings. Only the new Off fixture's project-local layout setting changed; no global plugin options changed.

Narrow readbacks: narrow-closed.json, narrow-settings.json, narrow-roster.json and narrow-approval-visible.json. Measured 60 columns. Tabs wrap; ordinary focus navigation scrolls controls into view. No requirement that all settings fit simultaneously is claimed.

Expanded Details initially lay below the widget fold. Native Page Down scrolled the widget by 10 rows and visibly revealed the friendly setup explanation in details-page-down.json. Initial assertions that read the folded snapshot failed and were corrected by ordinary scrolling, not by altering product code or evidence.

## Coverage limits

No approved/bound fixture was changed to demonstrate approved workspace ordering; that ordering and creation availability remain final host-test/source evidence for this focused run. Existing 0.5.45 lifecycle evidence remains separate. No PostgreSQL/store suite, task execution, raw database inspection or uncertain transport injection occurred.

No new controller approval, team creation or legacy launch button was activated. The visible unapproved approval button was focused only.

## Retained resources

| Resource | Native handle |
| --- | --- |
| Preview Off navigation fixture | term_c15ddd63-ab86-4149-99f4-a83603b3e07e |
| Preview On unapproved fixture | term_633d5f80-8052-4233-b99e-106f198f8802 |

Both fixtures/project/source/evidence remain for inspection. Temporary window sizing was restored and topmost verified false. No screenshot was required for the focused checks; actual native cell readbacks establish visibility.

No real-project mutations, guard bypass, app restart, retained-session cleanup, global install/reload/config change, credentials copied, commit, merge or push by this tester. The existing shared-store guard denied a combined shell evidence command; its protected inspection was not performed through another route. All accepted evidence uses native UI/readbacks and independently produced test artifacts.
