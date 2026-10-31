# M1 checklist

Command, from `925-jev-router/`:

```bash
node --test test/*.test.mjs
```

Result: 27 tests, 27 pass, 0 fail (Node v22.23.4). No network.

| Criterion | What was checked | Result |
| --- | --- | --- |
| SPEC freeze | `SPEC.md` records the closed locks from #157, #161, #162, #163, #165, #166, plus the #168 record shape. Hostinger is named as today’s home only. | Present |
| Allowlist schema | `test/schema.test.mjs` loads the example `.925-jev-router/config.json` and rejects bad schema, empty candidates, sentinel aliases, fallback outside `candidates`, agent models outside `candidates`, credentials, provider URLs, unknown fields, missing files, invalid JSON, and parent-directory discovery. | Pass |
| Fail-open | `test/fail-open.test.mjs` executes an approved choice, refuses a `model_list`-only model, retries a transient failure once, then uses the project fallback, refuses non-transient auth failure, and errors instead of picking the first candidate. | Pass |
| Hook stub | `test/hook.test.mjs` bypasses Jev for a non-sentinel model, finds `examples/project-a/.925-jev-router/`, rewrites the sentinel to the synthetic choice, bypasses TypeSafe for a fixed agent, and errors when no eligible fallback remains. The original request keeps `model: jev-router` on that error. | Pass |
| TypeSafe excerpt | `test/excerpt.test.mjs` redacts a constructed key, a password assignment, and an env assignment, caps the excerpt at 500 characters, and builds a System One body whose criteria keys are the candidates and whose `state` has no `project_id` field. | Pass |
| Draft-only picker | `test/picker.test.mjs` builds a Draft from the form helper, re-validates it with the schema, rejects a sentinel and a provider URL, and reads `picker.html` for Local Save, no Apply button, and no gateway call or token field. A headless Chrome click on Local Save downloaded `config.json` and showed that Draft in the preview. Putting `jev-router` in candidates cleared the preview and showed the sentinel error. | Pass |
| Draft → Applied shape | `test/records.test.mjs` applies a Draft twice on an in-memory map. Revisions are 1 then 2, `policy_hash` is stable, a policy change changes the hash, read-back returns the latest record, and a credential-shaped `applied_by` is rejected. | Pass |
| Synthetic harness | `test/harness.test.mjs` drives two in-memory transport failures and lands on `strong-worker` from the fixture, not on `model_list`. A synthetic 401 rejects. | Pass |

Not done, on purpose: live LiteLLM registration, live TypeSafe HTTP, Apply HTTP (#168), new credentials, deploy.
