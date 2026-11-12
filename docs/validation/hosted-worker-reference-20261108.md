# Hosted worker reference and native forwarding — 2026-11-08

Herman selected external environment-variable credentials. The source resolver validates a bounded variable name and explicit project database URL, refuses missing/invalid credentials without local fallback, and requires verified TLS for remote references. New private worker profiles store only the variable name/driver reference, never the URL/password. Old private profiles remain readable for compatibility; new profiles cannot save raw connection strings.

A production integration gap was found: Codex does not pass an arbitrary parent variable to the MCP child by default. Native zero-turn control confirmed the missing sentinel; explicit `env_vars` forwarding made it available. `workerEnvironmentNames` is now shared by the production launcher and the native probe. It forwards the reference's name and the fixed host-identity variables. The secret value is absent from command arguments and profile data. No native/global permission or sandbox setting changes.

Missing profile credentials now return an actionable `STORE_CONNECTION_ENV_MISSING` naming the variable. Malformed profiles remain refused, and remote TLS-policy errors stay explicit. Worker bootstrap also names all four required tool calls and the exact inbox receipt confirmation. No fixture/file work is authorized by those calls.

Evidence:

- Focused SQLite + actual PostgreSQL launch/profile/reference/policy suite: **37 passed / 0 failed / 0 skipped**. TAP `C:/Users/Herman/AppData/Local/Temp/team-completion-pg-qPKo3F/suite.tap`; SHA256 `29E71D94306A5452D61D807A7E4DB6CC8F8ED7867967D6B98D0F4FE6C9C21F46`.
- Native Codex 0.166, disposable homes, zero model turns: `team-worker-policy-native-atLQXa/evidence.json` is the absent-variable control; `team-worker-policy-native-2Fai75/evidence.json` proves forwarding through the production helper. Both directories are under `C:/Users/Herman/AppData/Local/Temp/`. No real credentials or native approvals were used. Manual MCP calls were not used as model-access proof.
- Latest whole common candidate suite: **547/547**, both engines and native setup, as recorded in [completion evidence](completion-checkpoint-20261108.md).

This is not completed hosted onboarding, remote TLS/outage acceptance or a store move. The referenced variable must exist in the worker parent's native environment; configuration on a different process/machine is not enough. Engine selection, project identity, cross-client guard enrollment, driver packaging and a reviewed move remain open. No live credential, configuration, binding or store was changed.
