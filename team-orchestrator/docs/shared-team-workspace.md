# Shared team workspace — 0.5.45

Open **Shared store**, turn the preview On and choose **Check access**. A new controller conversation needs its own **Approve controller** action. **Refresh** loads teams after access is checked; it does not create a team or bind a session.

## Create and bind

**Create team** opens an editable form. Give it a name and purpose, edit the head and worker names, roles and official instructions, and add members as needed. Each member can report to an earlier member in the form. Removing a supervisor moves its remaining reports to the head. The head cannot be removed. The maximum is 30 members, with exactly one head.

The form shows pickup and answer windows in minutes, an optional task window, replay interval in milliseconds and capacity. Its visible initial values are 2 minutes pickup, 3 minutes answer, task window off, 1,000 ms replay and capacity 8. These are editable fresh-team form values, not migration defaults. Creation also records automatic close off, idle 10 minutes, resume reopening, demand launch, batch 1, automatic scratch and assumptions off, scratch directory `.claude/scratch` and no exemptions. This increment does not execute scheduling, launching or automatic window fencing.

**Create team** creates only the shared roster and configuration. Each member initially shows **Unbound**. Choose **Bind session** on its roster card, then select a session. Choices come from fresh native Orca evidence and the live local Claude registry, within this project/context. Selection is reverified at binding time; a title never proves identity. **This verified conversation** is offered once and can use the existing caller-only idle proof, with fresh direct-parent/process-creation checks on submit and an exact match of all four reference fields. Other idle targets without an explicit native conversation association are omitted and cannot use that exception. No session is launched, renamed or messaged. Changing a binding uses its displayed generation; duplicates and stale authority are refused by the API.

Bind the head to the conversation that will assign and review work. Controller approval permits roster management but does not make a conversation the head. Workers do not need separate controller approval: after binding, **Check access** and **Refresh** load their own team.

## Assign, report and review

The bound head sees **Assign task** on bound direct-report cards. Enter instructions and the expected result, then confirm **Assign task**. The store records an admitted assignment and starts its pickup window. This increment does not notify the worker automatically. In the worker's conversation, refresh the Shared store workspace and open **Tasks**.

The worker opens the task and chooses **Pick up · read role and brief**. Read the official role, instructions and expected result before doing work. After checking the result, enter an outcome summary and evidence, then choose **Report succeeded** or **Report failed**. Workers can also use the typed `shared_team` operations. A worker report leaves the task open for review.

The admitting head refreshes **Tasks**, opens the outcome, reads its summary and evidence, and enters a review reason. **Accept outcome** records a separate head decision and settles the task using the worker's outcome. **Reject outcome** records rejection and blocks the task. Retry/reassignment of rejected work is a later increment.

Task cards show Awaiting pickup, In progress, Needs review or the settled task status. The panel shows at most the 100 newest assignments visible to the current assignee or its current admitting direct head. Unbound controllers can inspect rosters but receive no task evidence through this projection. Member conversations discover only their own team; approved controllers discover the project's teams. Every call revalidates native caller evidence and uses the displayed configuration, member, binding and attempt generations.

## Unconfirmed writes

If a bridge/commit/rollback result is unknown, the panel keeps the exact request and operation ID and pauses further changes. Choose **Check receipt**. A confirmed receipt restores the workspace without another mutation. If no receipt is found, the panel offers **Retry same operation**, which reuses the original request and idempotency key. It never creates a new operation automatically. Keep this conversation open until the result is resolved; this increment does not claim recovery of panel state after a whole-app restart.

Opening, redrawing, editing drafts or changing tabs performs no native process calls. Explicit Refresh, binding discovery and confirmed actions own all I/O. The UI uses native buttons and fields; narrow layouts can require Tab navigation and scrolling.

Editable fields use native single-line inputs. Pasted line breaks and tabs become spaces; terminal control characters are removed so an editing event cannot invalidate the whole panel. Readable Unicode is preserved. The typed API continues to accept its own validated text independently of this UI display boundary.
