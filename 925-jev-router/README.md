# 925-jev-router

M1 scaffold for a thin LiteLLM pre-call hook. TypeSafe selects a model. LiteLLM executes it. The leader path does not call Jev.

The frozen decisions are in [SPEC.md](SPEC.md). Verification steps are in [CHECKLIST.md](CHECKLIST.md).

Copy `examples/project-a/.925-jev-router/` into a workspace to get `config.json` and the Draft picker. Local Save writes a Draft only. This package does not call a gateway.

```bash
node --test test/*.test.mjs
```
