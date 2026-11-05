// Native transport fixture only; never packaged with the installed runtime.
// Identity is deliberately substituted for an isolated TEMP project. This does
// not establish live Orca identity or a genuine person's approval.
import {realpath} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import {dirname,basename} from 'node:path';
import {createCodexAdapter,serveCodexMcp} from '../codex-mcp.mjs';
const root=await realpath(process.argv[2]);
if(dirname(root)!==await realpath(tmpdir())||!/^925-to-native-management-/.test(basename(root)))throw Error('Fixture is restricted to its own temporary project.');
const adapter=await createCodexAdapter({observation:false},{createIdentity:async()=>({launchWorkers:true,verifyCaller:async meta=>{
 if(typeof meta?.threadId!=='string')throw Error('Native thread metadata missing.');
 return {projectRoot:root,machineId:hostname(),provider:'codex',conversationId:meta.threadId,executionHostId:'local',contextId:'fixture-context',terminalHandle:'fixture-terminal',incarnationId:'fixture-incarnation'};
}})});
await serveCodexMcp(adapter);
