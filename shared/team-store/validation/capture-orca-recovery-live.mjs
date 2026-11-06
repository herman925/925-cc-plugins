// Read-only evidence from the real Orca session and its native child processes.
import {createReadStream} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOrcaHost} from '../src/orca-host.mjs';
const [label,conversationId,terminalHandle]=process.argv.slice(2);
if(!/^(?:pass[123]|fresh-launch-baseline|affected-before|review-fresh|review-resume)$/.test(label??'')||!(/^[a-f0-9-]{36}$/).test(conversationId??'')||!/^term_[a-f0-9-]{36}$/.test(terminalHandle??''))throw Error('Supply an evidence label and exact native conversation/terminal identifiers.');
const root=await import('node:fs/promises').then(fs=>fs.realpath(fileURLToPath(new URL('../../../',import.meta.url)))),host=await createOrcaHost();
const verified=await host.verifyTerminal({projectRoot:root,conversationId,terminalHandle,contextId:process.env.ORCA_WORKTREE_ID},'codex');
const execute=promisify(execFile),home=process.env.CODEX_HOME||join(homedir(),'.codex');
const files=(await execute('rg',['--files',join(home,'sessions')],{windowsHide:true,maxBuffer:4*1024*1024})).stdout.split(/\r?\n/).filter(path=>path.endsWith(conversationId+'.jsonl'));
if(files.length!==1)throw Error('The exact provider transcript was not unique.');
let context;for await(const line of createInterface({input:createReadStream(files[0]),crlfDelay:Infinity})){const row=JSON.parse(line);if(row.type==='turn_context')context={timestamp:row.timestamp,...row.payload};}
if(!context||resolve(context.cwd).toLowerCase()!==resolve(root).toLowerCase())throw Error('The effective turn context does not match this project.');
const script="$rows=Get-CimInstance Win32_Process -Filter \"Name = 'codex.exe' OR Name = 'node.exe'\"; $rows | Where-Object { $_.Name -eq 'codex.exe' -or $_.CommandLine -like '*codex-mcp.mjs*' } | Select-Object ProcessId,ParentProcessId,Name,CreationDate,CommandLine | ConvertTo-Json -Depth 3";
const processResult=await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,maxBuffer:1024*1024});
const processes=JSON.parse(processResult.stdout),parents=processes.filter(p=>p.Name==='codex.exe'&&p.CommandLine.includes(terminalHandle));
if(parents.length!==1)throw Error('The native Codex process was not unique.');
const parent=parents[0],children=processes.filter(p=>p.ParentProcessId===parent.ProcessId&&p.CommandLine.includes('codex-mcp.mjs'));
if(children.length!==1)throw Error('The active team MCP child was not unique.');
const child=children[0],runtimeDigest=child.CommandLine.match(/runtimes[\\/]([a-f0-9]{64})[\\/]codex-mcp\.mjs/)?.[1];if(!runtimeDigest)throw Error('The active MCP path does not identify its immutable snapshot.');
const evidence={label,observedAt:new Date().toISOString(),actor:verified.actor,orcaRuntimeId:host.runtimeId,codexPid:parent.ProcessId,mcpPid:child.ProcessId,runtimeDigest,
 launch:{explicitMcpPolicy:parent.CommandLine.includes('mcp_elicitations=true'),explicitDangerFullAccess:parent.CommandLine.includes('--sandbox danger-full-access'),resumeCommand:parent.CommandLine.includes('resume '+conversationId)},
 effectiveTurn:{timestamp:context.timestamp,turnId:context.turn_id,approvalPolicy:context.approval_policy,approvalsReviewer:context.approvals_reviewer,sandboxPolicy:context.sandbox_policy,permissionProfile:context.permission_profile}};
const directory=join(root,'docs/validation',label.startsWith('review-')?'codex-review-delivery-20261107':'codex-recovery-20261107');await mkdir(directory,{recursive:true});await writeFile(join(directory,label+'-hosted.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
