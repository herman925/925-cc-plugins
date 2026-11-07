// Synthetic transport only: no native actor, real approval or team database.
import {appendFile} from 'node:fs/promises';
import {serveMcp} from '../src/mcp-stdio.mjs';
import {codexTools} from '../codex-mcp.mjs';
import {codexManagement} from '../src/codex-management.mjs';
const actor={projectRoot:process.cwd(),machineId:'fixture-machine',provider:'codex',conversationId:'fixture-conversation',executionHostId:'fixture-host',contextId:'fixture-context',terminalHandle:'fixture-terminal',incarnationId:'fixture-incarnation'};
await serveMcp({call:async(name,args,metadata,connection)=>{
 if(!process.env.TEAM_POLICY_AUDIT)throw Error('Disposable audit path missing.');
 const record=value=>appendFile(process.env.TEAM_POLICY_AUDIT,JSON.stringify(value)+'\n');
 await record({kind:'call',tool:name});
 if(name==='shared_team_manage')return codexManagement({args,actor,metadata,connection,options:{},native:{verifyCaller:async()=>actor},createApi:async()=>({
  reconcileManagement:async()=>({status:'unknown'}),execute:async()=>({result:{controllerGeneration:1}}),
  approveController:async()=>{await record({kind:'management-effect'});return {fixture:true};},close:async()=>{}
 })});
 return {fixture:true,tool:name};
}},codexTools);
