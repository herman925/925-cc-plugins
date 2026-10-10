# session-panel

Session Panel hides tool calls, diffs and command output while Claude works, and shows a calm step checklist above the prompt, with a Hide details / Show details button. Made for people who do not read code.

- Claude plans the job with `plan_steps`, reports progress with `report_progress`, and asks questions with `ask_choices` (numbered choices in the band).
- Until a plan exists, other tools are refused for the main agent (subagents are never gated). If the gate hook ever fails, tools are allowed through.
- `/simple on|off` (or the button) toggles it. The setting is kept between sessions. It starts on.
- `NO_COLOR` is honoured. `NO_MOTION`, `REDUCE_MOTION` or `PREFERS_REDUCED_MOTION` gives a static meter.

Check it: `claude plugin validate session-panel` and `claude plugin test session-panel`.
