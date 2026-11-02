# Direct Codex action skills

Team Orchestrator plugin **team-orchestration-925 0.1.2** adds six real skill entry points: `:create`, `:edit`, `:connect`, `:status`, `:meeting` and `:setup`. The existing menu skill remains available. These are plugin skills discovered by Codex, rather than arguments parsed by another CLI. Each starts its selected workflow and reads the shared menu skill's rules/references; the runtime is bundled once.

The repository npx command continues to install only the self-contained menu skill. Its existing `create-team`, `edit-team`, `connect-session`, `status` and `meeting` arguments remain valid. The complete plugin install includes all seven skills and their shared resources.

Validation in [validation/action-skills](validation/action-skills/):

- Native Codex `skills/list` reports exactly the seven expected names under the `team-orchestration-925:` namespace. All installed wrapper links resolve to the shared workflow.
- The actual installed Orca composer's isolated pure parser accepts all six action tokens plus the menu forms; the old digit-leading forms remain refused.
- Native plugin install/update/removal and pinned npx menu installation pass in disposable consumers, with zero model turns.
- All seven skill frontmatter checks pass. Six native setup tests pass on Node 22.13, including old owned adapter update, interruption and process-exit recovery.
- All 43 runtime files still match both packaged copies. Shared schema 8, Mod 0.5.56 and runtime behavior are unchanged; the earlier full runtime suites were not repeated for instruction-only entry points.

These checks establish packaging, discovery, token recognition and setup compatibility. They do not claim a real human has completed the six workflows or establish positive live-model guard/mixed-team acceptance. The [earlier native integration report](VALIDATION-925-TO.md) and [letter-first naming repair](VALIDATION-SKILL-INVOCATION.md) retain their evidence and limits.
