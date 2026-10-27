# GitHub Wayfinding operations

Canonical map: [Map: Team Orchestrator — Claude Mod and Orca](https://github.com/herman925/925-cc-plugins/issues/2). This guide records tracker operations; the linked GitHub issue is the canonical map, not this file.

Status checked on 2026-10-27: the canonical map has 41 native child issues: 31 open and 10 closed. The six shared-system decision children remain open. Query GitHub for current assignments and blocking relationships; these counts are a dated snapshot.

Latest continuation: [published status update](https://github.com/herman925/925-cc-plugins/issues/2#issuecomment-6440724412) and [local handoff](handoff-2026-10-27.md). The older map handoff's current-status and frontier claims are historical. No decision ticket was resolved by this documentation update.

## Issue structure

- Repository: `herman925/925-cc-plugins`.
- The map issue carries `wayfinder:map`. Decision tickets are GitHub child issues with one `wayfinder:<type>` label: `research`, `prototype`, `grilling` or `task`.
- Use GitHub's native parent/child issue relation and native blocking/dependency links. Do not represent those relations only in issue text.
- Create all ticket issues before adding blocking links. Do not use placeholder issue numbers; link each ticket by its real title and URL.
- The existing [Orca-native spec map](https://github.com/herman925/925-cc-plugins/issues/95) remains historical. The superseded map [Map: shared project-owned Team Orchestrator for Claude Mod and Orca](https://github.com/herman925/925-cc-plugins/issues/138) is closed as not planned and redirects to the canonical map. Do not use it as active map.

## Work through the map

1. Read the map's Destination, Notes, Decisions so far, Not yet specified and Out of scope sections. Open tickets are child issues; query GitHub for the current open, unblocked, unassigned frontier.
2. Read the ticket label and body. Claim a ticket by assigning it to the responsible developer before work begins. Refer to the ticket by its linked title in prose, not by a bare number.
3. Resolve one decision ticket per session, except parallel research tickets. Record the answer as a resolution comment, close the ticket, and append one concise linked summary to the map's Decisions so far.
4. Add newly specified decisions as child issues, then connect their native blocking links. Remove graduated questions from Not yet specified. Close out-of-scope tickets and record them in Out of scope, not Decisions so far.
5. Do not implement the destination while resolving the map unless the map's Notes explicitly authorize execution. This guide does not authorize issue changes or create another map.
