# Shared-store controls

Click **⚙ Settings** in the Team Orchestrator band. This button is visible even when the panel is closed. The Shared-store preview card has separate **On** and **Off** buttons; changes use the plugin's normal saved configuration. Editing a connection field only changes its draft until **Save Node** or **Save Orca** is pressed. Orca's existing executable validation still applies. These options also remain available in the standard configuration interface.

The **Shared store** tab is always visible, including while the preview is off. Its compact workspace keeps the preview toggle and access actions near the top. The main project label uses the current folder name; Details shows its exact path. **Check access** verifies the current native conversation and reads its saved approval. **Approve controller** is a separate explicit action. Enabling the preview, opening Settings or editing a connection does not approve a controller or create a team.

The main view shows Off, Checking, Needs approval or Approved. Technical session identifiers and raw receipts are hidden behind **Details**. If approval returns an uncertain result, the approval button is removed until **Check access** reads back the actual state; a second approval is not submitted automatically.

The tool catalogue is registered at session startup; the current option gates every API call. Saved On/Off changes take effect without manually reloading the plugin. Turning Off does not revoke a saved approval or delete team data. Existing shared-member permissions and raw-store protection remain enforced while Off. Ordinary sessions with no shared store keep their existing behavior.

Use fresh disposable projects for this preview. It does not migrate old teams, launch shared-store workers or add a scheduler. Node 22.13+ is required. Native identity and scoped approval checks are unchanged. The band and tab bar wrap on narrow terminals; connection fields and approval controls use the host's native keyboard/click controls. At narrow widths, Tab brings offscreen controls into view; advanced fields and Details can require widget scrolling.
