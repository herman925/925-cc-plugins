# 925-jev-router

Thin LiteLLM pre-call hook. TypeSafe selects a model. LiteLLM executes it. The leader path does not call Jev.

M1 decisions are in [SPEC.md](SPEC.md). M2 adds an in-process mock Apply/read-back verifier and wires the synthetic harness through hook, decision, and execution rewrite. It does not choose Apply auth and it does not implement header identity. That interface is recorded in [docs/m2-request-context.md](docs/m2-request-context.md). Verification is in [CHECKLIST.md](CHECKLIST.md).

Copy `examples/project-a/.925-jev-router/` into a workspace to get `config.json` and the Draft picker. Local Save writes a Draft only. The picker does not call a gateway or store a token.

```bash
node --test test/*.test.mjs
```
