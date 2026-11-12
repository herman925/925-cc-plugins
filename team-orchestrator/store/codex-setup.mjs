// Produces reviewable configuration; never edits user or project configuration.
import {realpath,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join,isAbsolute} from 'node:path';
export function codexConfiguration({scope,codexExecutable,codexHome,orcaCommand='orca',node=process.execPath,adapter=fileURLToPath(new URL('./codex-mcp.mjs',import.meta.url)),orcaProfile,hostMode='orca'}){
 if(!['orca','independent'].includes(hostMode))throw Error('Unknown native host mode.');
 for(const value of [scope?.projectRoot,codexExecutable,codexHome,node,adapter])if(typeof value!=='string'||!isAbsolute(value))throw Error('Setup paths must be explicit and absolute.');
 if(hostMode==='orca')for(const key of ['terminalHandle','contextId'])if(!scope[key]||typeof scope[key]!=='string')throw Error('A fixed Orca terminal and context are required.');
 if(hostMode==='independent'&&(scope.terminalHandle||orcaProfile))throw Error('Independent setup cannot claim an Orca terminal/profile.');
 const environment={TEAM_HOST_MODE:hostMode,TEAM_PROJECT_ROOT:scope.projectRoot,TEAM_CODEX_EXECUTABLE:codexExecutable,TEAM_CODEX_HOME:codexHome,...(hostMode==='orca'?{TEAM_TERMINAL_HANDLE:scope.terminalHandle,TEAM_CONTEXT_ID:scope.contextId,TEAM_ORCA_COMMAND:orcaCommand,...(orcaProfile?{ORCA_USER_DATA_PATH:orcaProfile}:{})}:scope.contextId?{TEAM_CONTEXT_ID:scope.contextId}:{})};
 const q=JSON.stringify;
 const config=`[mcp_servers.team_orchestrator]\ncommand = ${q(node)}\nargs = [${q(adapter)}]\nstartup_timeout_sec = 30\ntool_timeout_sec = 60\n\n[mcp_servers.team_orchestrator.env]\n${Object.entries(environment).map(([k,v])=>`${k} = ${q(v)}`).join('\n')}\n`;
 const hooks={description:'Team Orchestrator native Codex guard. Review and trust this hook before binding the session.',hooks:{PreToolUse:[{matcher:'*',hooks:[{type:'mcp_tool',server:'team_orchestrator',tool:'team_guard',input:{tool:'${tool_name}',input:'${tool_input}'},timeout:30,statusMessage:'Checking team permissions'}]}]}};
 return {config,hooks};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [settingsPath,output]=process.argv.slice(2);
 if(!settingsPath||!output||!isAbsolute(output))throw Error('Usage: node codex-setup.mjs <trusted-settings.json> <absolute-new-output-directory>');
 const {readFile}=await import('node:fs/promises');const settings=JSON.parse(await readFile(settingsPath,'utf8'));
 settings.scope.projectRoot=await realpath(settings.scope.projectRoot);
 const result=codexConfiguration(settings);await mkdir(output,{recursive:false});
 await writeFile(join(output,'config.snippet.toml'),result.config,{flag:'wx'});await writeFile(join(output,'hooks.json'),JSON.stringify(result.hooks,null,2),{flag:'wx'});
 console.log('Reviewable configuration written. Merge it into the intended Codex config layer, review/trust the hook in Codex, then reconnect the native MCP server. No installation was performed.');
}
