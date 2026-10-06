Type: research (AFK)
Status: open
Blocked by: none

## Question

Which tool-call details can a plugin's hook actually see and block, so the 0.5.0 guard is possible as specified?

Find, from the plugin API types and the docs, with sources:

- Does the `tool.call` hook receive the full Bash and PowerShell command text, including ssh / scp remote command
  strings, so deletes inside them can be parsed?
- Can a hook deny a call from a subagent or a teammate session, or only from its own session?
- Can a hook see and deny file-writing tools (Write, Edit, NotebookEdit) with the resolved path, and how are 8.3 names,
  trailing dots / spaces and `:` streams presented to it?
- Which MCP tool calls can it classify as read-only?

The answer is facts and sources, not a design. The guard rules in the spec stay as agreed; this ticket says which of them
the API can enforce and which need a documented limit.
