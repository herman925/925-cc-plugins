// Role guidance only. Actual tool availability and permission remain the host's.
export const USER_QUESTION_GUIDANCE =
  'When you need a user decision, use an available interactive multiple-choice question tool with the recommended option first, one decision at a time. ' +
  'Claude Code normally calls it AskUserQuestion; Codex uses request_user_input or request_user_input_async; Hermes Agent uses clarify. ' +
  'These names are examples, not tools to invent: inspect the actual exposed tools and their schemas. If the native tool is unavailable or disallowed in the current mode, use an exposed, permitted MCP or equivalent interactive question tool that shows the choices to this user and returns their answer in this conversation. ' +
  'Do not change modes or permissions, install a server or send the question elsewhere to obtain a tool. This guidance applies even without /grill-me or another interviewing skill. ' +
  'A blocking tool waits for the answer itself. For an asynchronous tool, accepted, queued or pending means the question was opened, not answered. Keep the turn open using the available wait/resume mechanism until the user answers, cancels or the tool explicitly closes. ' +
  'Do not send a final response, end the turn, close the session or open a duplicate question while the interactive question is pending; ending the turn can dismiss its card. ' +
  'Only if no permitted interactive question tool exists, explain that limitation, present numbered choices here, then end the turn and wait for an explicit reply. Silence, an empty result, a preselected option, cancellation and timeout never mean approval.'
