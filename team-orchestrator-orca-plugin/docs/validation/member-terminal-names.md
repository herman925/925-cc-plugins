# Member terminal names — macOS validation

Observed 2026-10-16 on stock macOS arm64 Orca 1.4.223, build
`ff4a51c872e723d87ab141044814301ea5a78634`, Electron 43.7.5 / Node 24.21.0.
Plugin 0.1.10, source integration `80945be`, release commit `5b01e1f`.

The saved `proposal-rename-qa` roster contains one Head and three Codex workers,
all requesting `gpt-6.1-sol` / `medium`. The prepared Head waited while the plugin
was updated through normal disable/copy/enable/initialise/connect actions. Its
original Run and identity remained unchanged. The actual Head subsequently used
the normal task/permit flow to create three on-demand worker terminals.

| Check | Result | Evidence and boundary |
| --- | --- | --- |
| Three on-demand terminal names | PASS | Native rename receipts confirmed `proposal-rename-qa/Worker-1`, `/Worker-2`, `/Worker-3`; actual Orca accessibility tree showed all three custom tab labels |
| Prepared titles | PASS, existing path | Prepared Head already had the team/member title. Earlier QA prepared labels remained visible after the previously recorded desktop restart |
| Plugin reload and repeated evidence check | PASS | Same three handles, bindings and byte-identical naming records; labels retained, no additional worker creation |
| Preserve a later manual custom title | PASS | Operator renamed Worker-3 to `proposal-rename-qa/Worker-3-custom`; disable/enable/initialise/connect and evidence check did not overwrite it. Operator then restored `/Worker-3` |
| Approved replacement title | Automated PASS | Existing native launch boundary and actual lifecycle fixtures verify team/member formatting and refusal to rename the superseded live terminal; no new live replacement was performed in this batch |
| Normal task completion | NOT PASSED | All three native workers reported startup failure at `agent_readiness` while Codex displayed its update-choice prompt. Operator skipped the update; no CLI upgrade occurred. This is naming evidence, not a successful task/report/review/delivery run |
| Full desktop restart for this release | NOT RUN | Plugin reload was exercised; earlier desktop-restart evidence only establishes the existing prepared-title path |

The diagnostic TeamWork remains open. Native startup failures and plugin unknown
execution states were retained; there was no forced task success, fabricated
worker report, automatic retry, replacement launch or user delivery acceptance.
Project file hashes for reading.py, summary.py, report.py and tests/test_contract.py
were unchanged across this measurement.

Work `834259f7-c166-4951-b693-7df47f58a75a`, Run `run_d31443bd9175`:

| Member | Task | Dispatch | Confirmed rename time (UTC) |
| --- | --- | --- | --- |
| Worker-1 | task_014a002602bb | ctx_caf2e5466301 | 09:43:00.279 |
| Worker-2 | task_7f6a47d174ba | ctx_a688bebdd493 | 09:43:06.434 |
| Worker-3 | task_6ae656d3659a | ctx_e13760e338b5 | 09:43:18.824 |

`terminal.show` / `terminal.list` may return a provider-generated OSC title rather
than the renderer's custom tab title. These are not interchangeable evidence.
The fixed host's rename notifier records terminal-tabs feature usage, not worker
ownership. Real user terminal input has a separate `workerTerminalUserInput`
path; Escape was used to dismiss the observed updater prompts. No invented
rename parameters or host patches were introduced.

Final checks: 472 domain tests, 63 browser checks, both pinned host contracts and
build/metadata/hash checks passed. Independent Spec and Standards rechecks have
zero remaining findings. One release agent generated the 0.1.10 artifacts once.

SHA256:

- main.mjs: `6c8dfd7c67bf529e661e8b62eed34b8520cd0e12625b75bbfa6f0cae3b0c4b61`
- runtime-adapter.cjs: `42f50b01555f575f774f3a4855791536b117056547c2896f6f96f85395464b63`
- panel.html: `0188bbc51a922bcdc55f065f2e383cc5627323c90ae75919bd2cf47860b01699`

Structured-chat naming, provider conversation-ID discovery, Windows/SSH and
general crash recovery are outside this change. A visible name never replaces
the saved native identity used for dispatch.
