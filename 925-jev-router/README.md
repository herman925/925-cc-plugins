# 925-jev-router

Thin LiteLLM pre-call hook. TypeSafe selects a model. LiteLLM executes it. The leader path does not call Jev.

M1 decisions are in [SPEC.md](SPEC.md). M2 adds an in-process mock Apply/read-back verifier and wires the synthetic harness through hook, decision, and execution rewrite. M3 adds offline request identity and stickiness in `src/request-context.mjs`. Identity headers are correlation hints and do not grant Apply. Auth A versus Auth B is still open. The M2 design record is [docs/m2-request-context.md](docs/m2-request-context.md). The M3 assertion map is [docs/m3-request-context.md](docs/m3-request-context.md). Verification is in [CHECKLIST.md](CHECKLIST.md).

Copy `examples/project-a/.925-jev-router/` into a workspace to get `config.json` and the Draft picker. Local Save writes a Draft only. The picker does not call a gateway or store a token.

```bash
node --test test/*.test.mjs
```
