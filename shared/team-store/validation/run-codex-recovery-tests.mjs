// Repeatable suite pass using the actual installed native Codex config writer.
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {discoverCodexExecutable} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/codex-executable.mjs';
import {prepareRuntime} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-runtime.mjs';
const pass=process.argv[2];if(!/^pass[123]$/.test(pass??''))throw Error('Select pass1, pass2 or pass3.');
const series=process.argv[3]??'recovery';if(!['recovery','review-delivery'].includes(series))throw Error('Select recovery or review-delivery.');
const root=fileURLToPath(new URL('../../../',import.meta.url)),output=join(root,'docs/validation/codex-'+series+'-20261107');await mkdir(output,{recursive:true});
const executable=await discoverCodexExecutable({}),startedAt=new Date().toISOString();
const child=spawn(process.execPath,['--test','--test-reporter=tap','shared/team-store/test/*.test.mjs'],{cwd:root,env:{...process.env,TEAM_TEST_CODEX_EXECUTABLE:executable},windowsHide:true,stdio:['ignore','pipe','pipe']});
let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>stdout+=s);child.stderr.on('data',s=>stderr+=s);
const exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
const runtime=await prepareRuntime(join(root,'team-orchestration-925/skills/team-orchestration-925/scripts/runtime'),output);
const summary={pass,startedAt,completedAt:new Date().toISOString(),exitCode,runtimeDigest:runtime.digest,fileCount:runtime.files.length,summary:stdout.split(/\r?\n/).filter(line=>/^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line)),nativeConfigWriter:true,postgresConfigured:Boolean(process.env.TEAM_STORE_TEST_POSTGRES)};
await writeFile(join(output,pass+'-tests.tap'),stdout);await writeFile(join(output,pass+'-tests.stderr.log'),stderr);await writeFile(join(output,pass+'-tests.json'),JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));process.exitCode=exitCode??1;
