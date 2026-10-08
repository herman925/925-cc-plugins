# Cross-CLI orchestration

This is a design note. It records one direction the orchestration layer could
grow in. It is not a plan and it commits to nothing. No code changes with it.

The current mod builds and manages a team of agent sessions of **one** CLI. It
addresses each session, tracks its lifecycle, and guards it through a shared
host runtime. This note asks what changes if the team may hold sessions of
**different** agent CLIs, each with its own strengths, cost, and context window,
as peers in one team.

## The idea

An orchestration layer has three parts. A **coordinator** holds the plan and
routes work. A **member** is a session that does a piece of the work. A **host
runtime** starts sessions, keeps them alive, and shows them on a screen.

Today the mod decides that every member is a session of the CLI it was built
against. Nothing in the three parts above needs that. The coordinator routes by
**capability**, not by tool identity. If a member keeps a stable handle and
reports through the shared runtime, the CLI it runs is an implementation detail,
not a membership constraint.

## What the coordination layer already provides

These properties come from the layer, not from the CLI under it. They are what a
multi-CLI roster would inherit.

| Property | What it is | Why it does not depend on the CLI |
|---|---|---|
| Durable mailbox | Each member has a mailbox addressed by a stable handle | The address is held by the coordinator, not by the CLI |
| Explicit read state | A message carries a read flag; delivery and enqueue are separate | The flag lives with the message, not with the recipient |
| Consuming check | A member pulls the oldest batch and replays it until it is acknowledged | The replay rule is a queue rule, not a CLI feature |
| Lifecycle view | The coordinator sees liveness, screen state, last output, and idle or in-turn | These come from the runtime that hosts the session |
| Scope boundary | On a brief the worker exceeds, the coordinator raises a bounded choice to the human | The escalation is a coordinator rule |
| Guard model | Members are barred from spawning subagents or writing files unless allowed | The guard reads a roster, not a CLI |

Two points matter most. First, **enqueue is not delivery**. A message can sit in
a mailbox with its read flag clear for as long as the recipient does not check
it. That is observable and useful, but it means "sent" and "received" must never
be reported as the same thing. Second, **the check consumes**. A recipient pulls
the oldest batch and replays it until acknowledged, so a member that crashes or
restarts does not lose work.

## What a multi-CLI roster would require

A single-CLI roster gets these for free. A multi-CLI roster must build each one.

### 1. One addressing scheme

Every member must resolve the same handle the same way, whatever its own CLI
calls a session. The handle cannot be the CLI's internal session id, because
another CLI does not share that id and may not expose one. The coordinator
should own the handle and map it to whatever the member's CLI uses.

### 2. A per-member capability descriptor

The coordinator routes by capability, so every member needs a descriptor that
says what it can do. At least:

| Field | Meaning |
|---|---|
| Tools | What the member can run (read, write, shell, network) |
| Messageable | Whether the member can take a message while it works |
| Interruptible | Whether the member can be stopped mid-turn |
| Observable | Whether the member can report liveness and turn state |
| Context | The working size, for routing a large job away from a small one |

The descriptor is a promise. The coordinator may rely on the promise and must
not assume a capability the descriptor does not name.

### 3. Honest delivery semantics

A member that cannot be woken can only be enqueued to. The layer must say so,
per member, in the descriptor and in the read state. A message to such a member
is a durable queue entry, not a live message. The coordinator must not block on
it and must not report it as delivered. Delivery becomes a state the human can
see, not an assumption.

### 4. A per-member guard

The current guard reads the roster and decides by level. That model already
generalises, because it never looks at the CLI. A multi-CLI roster keeps the
same rule: the guard is expressed per member, in the roster, and not per CLI
family. A member of a second CLI is refused or allowed by the same fields as a
member of the first.

### 5. Attribution without a title or a copied id

The coordinator must know which CLI a session runs without reading its tab
title and without trusting an identifier the member copied for itself. Both are
weak: a title is a label a person can change, and a copied id can be stale or
wrong. The coordinator should record the CLI when it starts the member and hold
that record itself.

## Open questions

These are unresolved. This note does not answer them.

- **Can every candidate CLI expose liveness and turn state?** The layer needs
  last output and idle-or-in-turn. Some CLIs may report neither. A member that
  reports nothing can still be messaged, but the coordinator loses its view of
  it. Whether that is acceptable is open.
- **Is a member that cannot be woken useful, or only a durable queue?** If the
  member cannot be woken, the coordinator can enqueue work but cannot watch it
  advance. That may be fine for a batch job and wrong for interactive work. The
  line between the two is not drawn.
- **Is capability routing worth the coordination cost?** One strong generalist
  needs no descriptor, no routing table, and no cross-CLI addressing. A mixed
  roster adds all three. The gain must exceed that cost. When it does — a cheap
  CLI for a broad job, a costly one for a narrow job — is a question about the
  work, not about the layer.
- **How does attribution survive a restart?** A member that restarts may come
  back under a new session. The CLI record must outlive the session id. Whether
  the handle is enough to reattach, and what the coordinator does when it is
  not, is open.
- **Does the guard apply the same way across CLIs?** A CLI that can run a shell
  command outside the guarded tools widens the hole the current guard already
  leaves open. Whether the layer closes that per CLI, or accepts it, is open.

## What this note does not propose

- It does not propose a change to the roster or the screen. Those stay.
- It does not propose supporting any named CLI. The set is open.
- It does not propose a common wire format. The mailbox and the handle are
  enough to start.
- It does not propose replacing the single-CLI roster. That stays the default.
  A mixed roster is an option on top of it, not a replacement.

## Status

Idea only. Not scheduled, not scoped, no owner. Recorded so the reasoning is
not lost and so the questions above get an honest answer before any work starts.