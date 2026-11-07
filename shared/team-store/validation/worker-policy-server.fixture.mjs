// Transport/catalogue fixture only. No native actor, store, approval or model.
import {serveMcp} from '../src/mcp-stdio.mjs';
import {codexTools} from '../codex-mcp.mjs';
const marker=process.env.TEAM_WORKER_POLICY_SENTINEL;
const catalogue=codexTools.map(tool=>tool.name==='shared_team_status'?{...tool,description:tool.description+'\nFixture environment: '+(marker??'not-forwarded')}:tool);
await serveMcp({call:async(name)=>({fixture:true,tool:name})},catalogue);
