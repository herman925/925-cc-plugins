Type: research (AFK)
Status: open
Blocked by: none

## Question

Can every member's plugin instance safely write its own `{tokens, window, percent}` into the one shared roster, and what
does the roster do when two instances write at nearly the same moment?

Read how the roster is shared today (the `pull` / `share` / `update` code in `team-orchestrator/hooks/register.tsx`)
and what the plugin API guarantees for `$.store` / `$.state` across sessions. Report: where the roster physically lives,
whether a write replaces or merges, whether a stale read can clobber another instance's fields, and what a safe
per-member record would look like. Facts and sources, not a design.
