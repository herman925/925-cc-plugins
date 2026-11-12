# Wake bidirectionality and freshness audit — 2026-11-12

Reviewed candidate `e34fab9`, Mod 0.5.62 / Codex 0.1.12 / schema 10. This audit changes no runtime behavior, permissions, hook configuration, team records or live sessions. Earlier green-suite results establish their covered cases; they do not establish the missing cases below.

## Directional coverage

The shared mailbox supports both directions. The new durable native wake path does **not** yet have equivalent coverage in both directions. It depends on recipient provider, not whether the sender is the head or a worker.

| Sender → recipient | Current transport | Equivalent durable turn-start receipt? |
| --- | --- | --- |
| Claude → Codex | Private Mod child → shared native prompt wake | Yes, subject to the limitations below |
| Codex → Codex | Codex native adapter → shared native prompt wake | Yes, subject to the limitations below |
| Claude → Claude | Mod SDK `session.send` | Not implemented by the new wake journal |
| Codex → Claude | Orca orchestration status notification | No; `queued: true` does not prove native turn start |

The audit does not establish whether an actual installed Claude host wakes on every orchestration notification. No live prompt was sent to test that. Managed Hermes and remote wake coverage remain unsupported.

## Confirmed gaps and limits

1. **Binding-generation changes reset duplicate prevention.** The journal key includes the binding generation. After a lost reply, rebinding the same conversation in the unchanged native process creates a new request ID for the same delivery. The fixture records two distinct host requests. A generation change is valid authority fencing, but does not prove the first prompt was never accepted. Duplicate inbox-check prompts are possible across that boundary; duplicate task execution was not demonstrated.

2. **Turn-start receipt has no inbox-progress recovery.** Once one wake records `turn-started`, the adapter returns that saved receipt on later pumps. It does not check whether the message was read, whether the turn ended or whether that wake accomplished anything. This enforces the selected one-prompt rule, but leaves a liveness gap if the model stops before reading. A bounded retry/escalation policy needs an explicit contract; it must not blindly resend uncertain input.

3. **Reconciled reservations are historical, not current delivery eligibility.** A real disposable SQLite case reserved mail, had the real recipient acknowledge it, then reconciled the old reservation through the Mod wake helper. Current binding/member checks passed and the helper invoked its wake dependency once. It never rechecked whether that delivery was still outstanding. The probe substituted the native wake dependency, so it sent no real prompt. Related expiry/supersession checks are absent at this boundary; those additional cases were identified by inspection, not separately run.

4. **Pending host-epoch changes stop safely but lack a recovery workflow.** An unknown request in the old epoch stays `unknown` without another send after the epoch changes. This is the correct conservative behavior for uncertain input, but automatic recovery or a clear typed reconciliation action is absent.

5. **Freshness checks do not atomically fence the initial native send.** The adapter verifies the target before submission, but the initial `terminal.send` parameters carry no expected provider conversation or incarnation. A fixture returning a replacement incarnation demonstrates that receipt mismatch is detected after a simulated host effect. This is an unclosed adapter race, not a reproduction against the actual Orca host. A repeated request ID is host-bound to an incarnation; that does not itself close the first-send check/use interval.

6. **Mod-side wake failure visibility is incomplete.** The Mod awaits the helper process but discards its structured result. Codex observer status exposes bounded recent receipts; the Claude head has no equivalent current projection from this path. A private disk receipt alone does not give the leader an actionable current state.

Codex-origin delivery also checks the native target against the reserved binding without refreshing current shared recipient membership/binding immediately before wake. The Mod helper refreshes a team snapshot once per batch. Both can therefore act on older shared facts after a concurrent change. Existing typed inbox/assignment authority checks still apply afterward; a wake grants no permission or work authority.

## Verification

Run `node shared/team-store/validation/probe-wake-staleness-20261112.mjs`. Its native-host responses are deterministic fixtures; its shared-store acknowledgement case uses a disposable real SQLite store. It performs no real Orca sends and removes only its own temporary tree after closing the fixture databases.

The probe confirms the five observations above. Existing focused native identity/wake tests were also rerun: **19 passed / 0 failed / 0 skipped**. These tests did not previously cover the binding-generation, post-read reservation or post-turn/no-read cases. No full-suite rerun is needed for this source-only audit because production code is unchanged.

Retained probe output: `%TEMP%/wake-staleness-audit-20261112.json`, SHA256 `B958665E6F3ED92E7FC26C142BCDDDAAA389C2519621F13CEDA815D083168425`.

## Recommended completion

Treat this feature as **automatic inbox wake-up**, with the harness as its verification machinery. Make delivery and receipt semantics equivalent for both supported recipient providers; add a current-delivery eligibility check and native target fence at the effect boundary; reconcile pending requests across binding/host changes rather than treating a new generation as proof of no prior send; expose pending/stale/failure/progress states to both leads. Define bounded recovery for a confirmed-started prompt with no inbox progress separately from uncertain input. Then run disposable real mixed-provider acceptance in both directions before candidate activation in the existing Research team.

This audit supersedes any interpretation that `e34fab9` provides complete symmetric wake delivery or duplicate prevention across rebinds. It does not retract the narrower same-binding lost-reply/concurrent-pump tests.
