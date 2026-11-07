// Transport/catalogue fixture only. No native actor, store, approval or model.
import {serveMcp} from '../src/mcp-stdio.mjs';
import {codexTools} from '../codex-mcp.mjs';
await serveMcp({call:async(name)=>({fixture:true,tool:name})},codexTools);
