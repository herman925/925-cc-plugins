// Zero-model Windows probe. A disposable argument-capture script measures
// PowerShell argument boundaries; Codex itself is never executed here.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {codexLaunchCommand} from '../src/codex-launch.mjs';
import {configurationEnvironment} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-environment.mjs';
if(process.platform!=='win32')throw Error('This probe verifies the supported Windows launch path.');
const root=await mkdtemp(join(tmpdir(),'codex-launch-quoting-')),capture=join(root,"capture 'quoted'.exe"),marker=join(root,'must-not-exist');
const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),run=promisify(execFile);
const code='using System; using System.Text; public static class TeamCapture { public static void Main(string[] args) { foreach(string arg in args) Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(arg))); }}';
const compile=`$ErrorActionPreference='Stop'; Add-Type -TypeDefinition '${code}' -OutputAssembly '${capture.replaceAll("'","''")}' -OutputType ConsoleApplication`;
await run(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(compile,'utf16le').toString('base64')],{windowsHide:true,timeout:15000,maxBuffer:32768});
const malicious=`model'; [System.IO.File]::WriteAllText('${marker.replaceAll("'","''")}','injected'); '`,project=join(root,"project with 'quote' and $(literal)");
await mkdir(project);const adapter=join(root,"adapter 'quoted'.mjs");
const target={terminalHandle:'new-native-terminal',contextId:'new-native-context'};
const command=codexLaunchCommand({member:{model:malicious,effort:'high'},actor:{projectRoot:project},target,codexExecutable:capture,adapter,launchProfile:join(root,"private profile 'quoted'.json")});
const {stdout}=await run(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',command.split(' ').at(-1)],{windowsHide:true,timeout:15000,maxBuffer:32768});
const args=stdout.trim().split(/\r?\n/).map(line=>Buffer.from(line,'base64').toString('utf8'));assert.ok(args.includes('--no-daemon'));assert.equal(args[args.indexOf('--cd')+1],project);assert.equal(args[args.indexOf('--model')+1],malicious);assert.ok(args.includes(`mcp_servers.team_orchestrator.args=${JSON.stringify([adapter])}`),'MCP JSON quotes must reach the native program intact');await assert.rejects(access(marker),{code:'ENOENT'});
const result={root,passed:true,modelTurnsStarted:0,checks:['project and executable paths with apostrophes preserved','model text stayed one literal argument; no injected command ran','encoded bootstrap captured without executing Codex']};
if(process.argv[2]){
 const home=join(root,'codex-home');await mkdir(home);
 await writeFile(join(home,'config.toml'),'[mcp_servers.team_orchestrator]\ncommand = "old-adapter"\n[mcp_servers.team_orchestrator.env]\nTEAM_TERMINAL_HANDLE = "old-controller-terminal"\nTEAM_CONTEXT_ID = "old-controller-context"\n');
 const parsed=await run(process.argv[2],[...args.slice(0,-1),'mcp','get','team_orchestrator','--json'],{cwd:project,env:configurationEnvironment(home),windowsHide:true,timeout:15000,maxBuffer:32768});
 const server=JSON.parse(parsed.stdout),transport=server.transport??server;assert.deepEqual(transport.args,[adapter]);assert.equal(transport.env.TEAM_PROJECT_ROOT,project);assert.equal(transport.env.TEAM_RESERVED_LAUNCH_PROFILE,join(root,"private profile 'quoted'.json"));assert.equal(transport.env.TEAM_TERMINAL_HANDLE,target.terminalHandle);assert.equal(transport.env.TEAM_CONTEXT_ID,target.contextId);result.checks.push('actual Codex parses the captured CLI configuration with literal paths and new terminal scope intact; no model turn');
}
await writeFile(join(root,'evidence.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
