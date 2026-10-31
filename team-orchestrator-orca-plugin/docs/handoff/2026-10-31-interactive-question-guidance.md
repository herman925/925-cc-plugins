# Interactive question guidance — unreleased source change

Herman requested question-tool guidance independent of `/grill-me`, corrected the provider name from Q to Codex, and asked that async questions remain open until answered rather than disappearing when an agent ends its turn.

## Implemented

- Actual bound Claude Code prefers `AskUserQuestion`; Codex prefers `request_user_input` and may use the exposed/permitted `request_user_input_async`; Hermes Agent vocabulary is `clarify`. This does not enable additional provider launches.
- If tool names differ or the preferred tool is unavailable, discover an actually exposed, permitted native or MCP interactive question tool that presents choices to the user and returns their answer in the same conversation. Follow its real schema. Do not invent tools, install a server, change modes/permissions or redirect the question elsewhere.
- Ask one decision at a time with the recommended option first. This guidance does not depend on an interviewing skill.
- Blocking tools wait themselves. Async accepted/queued/pending is only an opened question. Keep the turn open through the available wait/resume mechanism until an answer, cancellation or explicit tool closure; do not send a final reply, end the turn/session or open a duplicate card while pending.
- Only when no permitted interactive tool exists, explain the limitation and use numbered choices in the same conversation. Silence, empty results, timeout, preselection and cancellation never authorize a decision.

Herman subsequently confirmed the tool distinction: `request_user_input` waits and returns the answer directly; `request_user_input_async` returns immediately and delivers the actual answer later as a separate message. Both names can be valid in an environment that exposes them, but neither is universally available or permitted. In the current environment the blocking tool is Plan-mode-only; that restriction must not be generalized to every client or worked around by forcing a mode change. Check the actual tool catalog and current-mode permissions. The existing prompt guidance already makes these availability and blocking/async distinctions; this note records the named-tool semantics explicitly.

The plugin's per-bound-session instructions preserve the existing method metadata shape. The Mod's highest-supervisor role now has its own question guidance; lower members continue relaying through their boss. Session Panel's general rules and skill-specific reminder have the same async waiting rule. Existing approval and authority checks are unchanged. Session Panel's prose-warning event tracking still specifically observes `AskUserQuestion`; no universal alternate-tool event tracker was added.

Source: plugin `src/local/session-decisions.mjs` and rebuilt `main.mjs`; Mod `hooks/question-guidance.ts` and `hooks/roles.ts`; Session Panel `hooks/logic.ts`. Related tests and documentation were updated. Build regenerated the self-contained outputs; `panel.html` remained byte-identical. Installed copies, versions, user configuration and provider sessions were not updated or reloaded. No commit/push/release or Claude testing handoff occurred.

## Validation

| Check | Result |
| --- | --- |
| `claude plugin test team-orchestrator` | 360 passed, 0 failed |
| `claude plugin test session-panel` | 310 passed, 0 failed |
| Plugin `npm test` | 656 passed, 0 failed, 3 skipped (659 total) |
| Question/decision integration test file | 22 passed, 0 failed |
| Plugin build | Passed; generated worker includes the new instructions |
| Mod and Session Panel manifest validation | Passed with existing metadata/directory-submission warnings |
| JavaScript syntax / `git diff --check` | Passed |
| Browser suite | 14 passed, 21 failed; not green |
| Full three-revision host verification | Incomplete; first pinned revision passed, newer source loading stopped on HTTP 404 |

Full unit/domain suites therefore have 1,326 passing cases and 3 skips. These checks validate emitted prompt instructions and preserve decision/consent behavior; they do not prove every live provider will obey the guidance or guarantee a question card's lifetime.

Browser prerequisites initially lacked Chromium headless-shell 1248; the installed Playwright CLI downloaded it and the subsequent run reached all 35 tests. Launch-related failures include the existing preview fixture's `worktree.show` response omitting `path`, which the production role-file preflight correctly refuses. Other failures include downstream missing-team assertions. The preview server, browser tests, panel source and panel HTML were not modified by this patch. A complete before/after baseline attribution of all 21 failures was not performed; these results must not be represented as a passing UI run.

The original host stop fixture attempted a Unix socket on Windows and exited 13 with an unsettled top-level await after EACCES. The only harness source fix uses a uniquely named Windows pipe on Windows, keeps Unix sockets elsewhere, and propagates listen errors. The corrected fixture passed against the actual pinned compiled host contract. A full host run with verification-only bounded fetch concurrency/retries passed revision `9fdd90ffa7721e145f1353ad9fb9df2f70c31f43`, then the unchanged pinned-source loader requested `src/main/runtime/rpc/methods.ts` at a newer revision and received HTTP 404. No production host checks were weakened to bypass that failure.

Evidence logs under `C:/Users/Herman/AppData/Local/Temp/`:

- `team-question-mod-01ab66cc993f440aa52a7a3b7c6fd5d9.log`
- `team-question-panel-9d43066ad46043508bd0dd00888eb6b6.log`
- `team-question-plugin-9b5251dc5e49484f8438bae6f30c670e.log`
- `team-question-browser-retry-60845c78449a462e8464e3bd18a9f4ef.log`
- `team-question-host-bounded-7dac1f3aec80429e967b0f7398be9947.log`
- `team-question-host-diagnostic-89kelkzg/output.log`

The shared schema-4 foundation and the separate API/controller decisions were preserved. This patch does not implement the pending typed API or client integration.
