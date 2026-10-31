# UI044 narrow-workflow addendum

The remaining bounded check passed. At an actual 60-column terminal, ordinary native keyboard navigation visibly scrolled Connection and Details into the panel before activation. No hidden-handle invocation was used.

| Control | Before Enter | After Enter | Width |
| --- | --- | --- | --- |
| Connection | Connection ▾ visible | Connection ▴ visible | 60 columns |
| Details | Details ▾ visible | Details ▴ visible | 60 columns |

`ui-key.cjs` sent only Escape, Ctrl+X/Tab and ordinary Tab input through `orca terminal send`; it observed native ui.focus logs. Enter activated each actual Button handler. Terminal screen readbacks independently confirm the visible labels and expansion changes.

Evidence: addendum-connection-focused.json, addendum-connection-open.json, addendum-details-focused.json, addendum-details-open.json, addendum-verification.json.

This supersedes the final report's unaccepted full-visibility wording: all advanced controls need not fit simultaneously. Primary controls are visible; normal keyboard focus scrolling reaches the advanced controls. The bounded narrow workflow is accepted with scrolling explicitly disclosed.

Window restored to pre-check native geometry: x=-5173, y=545, width=3462, height=1402. OS topmost flag verified false. The initial restoration read encountered a minimized window; it was restored normally and checked again. Real settings.json and installed_plugins.json SHA256 values still match their saved baseline. A/B/C and all retained sessions remain intact. Connection and Details were collapsed after the check. No screenshots, source changes, option writes or new approvals were needed.
