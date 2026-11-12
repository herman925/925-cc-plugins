# Update Team Orchestrator

Current packages: **Claude Mod 0.5.62**, **Codex plugin 0.1.12**, shared **schema 11 / writer protocol 2**. The separate Orca plugin remains **0.1.25**. Hermes shared-runtime integration remains pending. Installing a package does not activate an old pinned Codex runtime or migrate a team store.

## Claude Code / Claude Mod

Run in a normal terminal:

```text
claude plugin marketplace update herman-mods
claude plugin update team-orchestrator@herman-mods
```

Restart/resume Claude Code normally after the update. Confirm **Team Orchestrator 0.5.62** in its panel or `claude plugin list`. Use the existing right panel's Shared workspace controls. Old classic teams are preserved; updating does not migrate them or grant a conversation permission to manage a team.

## Codex plugin, in Orca or independently

Run in a normal terminal:

```text
codex plugin marketplace upgrade herman925-codex
codex plugin add team-orchestration-925@herman925-codex
```

Restart/resume Codex normally so it discovers **0.1.12** and the updated skills. In **each project** where you installed the Team Orchestrator connection, invoke:

```text
$team-orchestration-925:setup
```

Ask it to **update the existing project connection**, review its normal preview, and apply that update. The preview should report **86 runtime files / schema 11**. It preserves unrelated settings, existing teams and old snapshots. Reconnect the MCP server or restart/resume the conversation once after apply. Review the native hook only if the preview reports that the hook changed; an unchanged hook does not need another approval merely because its runtime changed.

Then invoke:

```text
$team-orchestration-925:status
```

Check the actual loaded connection and capabilities. An installation receipt alone does not prove activation or native hook trust. If status reports a stale binding, use its explicit reviewed reconnect flow; do not delete hooks or edit database records. An Orca-host verification failure now leaves ordinary tools available to an OS-verified nonmember, but it still does not authorize any team API effect.

The Codex skill names above are conversation invocations, not shell commands. If you use the npx **menu-only** installation instead of the plugin, update that same menu with:

```text
npx skills@1.7.4 add https://github.com/herman925/925-cc-plugins/tree/main/team-orchestration-925 --skill team-orchestration-925 --agent codex
```

Restart Codex and use `$team-orchestration-925 setup` and `$team-orchestration-925 status`. That installation does not supply all seven namespaced action skills. Do not remove the existing project connection just to update a skill.

## Existing shared store

Update the Claude and Codex clients that use the project before upgrading its shared store. For an older store, choose the normal **Back up and update workspace** action in the Mod, or ask the updated Codex workflow to run **`shared_team_upgrade`**. It presents a separate native confirmation and makes a complete private backup before the transactional schemas 5–10 → 11 upgrade.

Preserve its exact operation ID and reconcile an uncertain result before trying again. Updating does not approve a controller, reconnect a member, launch a process or turn an existing team into managed-lead mode. New projects create their first store only through explicit team creation.

## Optional owned Claude sessions

This additional machine component is needed only for **dispatcher-owned Claude members**, not for an ordinary Claude Mod conversation. In the updated Codex setup workflow, ask to **set up the optional Claude provider**. It uses the bundled helper:

```text
node <installed-menu-skill>/scripts/setup-claude.mjs preview
node <installed-menu-skill>/scripts/setup-claude.mjs apply
```

The skill resolves its actual installed path; do not paste the `<installed-menu-skill>` placeholder literally. The preview identifies the pinned official SDK **0.3.322**, private destination and existing native Claude executable. It preserves your normal Claude authentication/configuration and does not start members. Reconnect the project MCP connection afterward to refresh its advertised provider availability. A new team's managed lead still needs its separately reviewed creation and launch plan.

## What changes, and what stays separate

| Area | Available in this update | Limit |
| --- | --- | --- |
| Claude Mod | Readiness/status, current provider identity, recovery/guard corrections, safe managed-lead display | Full owned-team creation/review uses the Codex workflow |
| Codex, with or without Orca | Shared management, reviewed owned sessions, explicit optional new-team lead | An existing conversation is never automatically adopted |
| Mixed Claude/Codex teams | One dispatcher, tracked two-way inbox input, distinct worker outcomes and head acceptance | Automatic input requires a verified owned recipient or supported fenced host route |
| Native questions/permissions | Original questions and supported one-time proposals, with binding rechecks and response receipts | Real person confirmation is still required; unsupported proposals stay pending |
| Meetings | Durable common agenda/contribution/output workflow and joined-member default | A meeting output grants no task, role or permission; live mixed meeting acceptance remains separate |
| Storage | SQLite default; explicit backed-up schema upgrade; PostgreSQL alternative | No automatic local/online switching, hosted onboarding or classic migration UI |
| Separate Orca plugin | No change in this merge | Its store/runtime has not converged with the shared clients; ordinary Orca terminal auto-input still needs its host fence |
| Hermes | Existing classic helpers only | No equivalent shared-runtime plugin/skill yet |

Native fixture validation used Codex **0.167.0**, Claude Code **2.1.322**, Node **22.13+**, local deterministic model responses and synthetic fixture creation/launch grants. It establishes transport/API behavior, not real human approval, model reasoning or Codex hook trust. No CLI binary upgrade is required solely by these plugin version numbers.
