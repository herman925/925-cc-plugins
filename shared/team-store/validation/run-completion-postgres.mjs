// Own fresh loopback PostgreSQL cluster. No real project store or installed
// client is opened, and only this invocation's cluster is stopped in finally.
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,readdir} from 'node:fs/promises';
import {openSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
const bin=process.argv[2],codex=process.argv[3];if(!bin||!codex)throw Error('Supply the embedded PostgreSQL bin directory and native Codex executable.');
const root=await mkdtemp(join(tmpdir(),'team-completion-pg-')),data=join(root,'data');
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const socket=createServer();await new Promise((resolve,reject)=>{socket.once('error',reject);socket.listen(0,'127.0.0.1',resolve);});const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const run=(exe,args,timeout=30000)=>spawnSync(join(bin,exe),args,{windowsHide:true,encoding:'utf8',timeout});
const initialized=run('initdb.exe',['-D',data,'-U','postgres','--auth=trust','--no-locale','--encoding=UTF8']);
if(initialized.status!==0)throw Error('Owned PostgreSQL initialization failed: '+initialized.stderr);
let started=false;
try{
 const status=run('pg_ctl.exe',['-D',data,'-l',join(root,'server.log'),'-o',`-h 127.0.0.1 -p ${port} -c shared_buffers=16MB -c max_connections=40`,'-w','start']);
 if(status.status!==0)throw Error('Owned PostgreSQL startup failed: '+status.stderr);started=true;
 const url=`postgresql://postgres@127.0.0.1:${port}/postgres`,client=new pg.Client({connectionString:url});
 await client.connect();try{await client.query('CREATE DATABASE team_store_contract_test');}finally{await client.end();}
 const connection=`postgresql://postgres@127.0.0.1:${port}/team_store_contract_test`;
 const selected=process.argv.slice(4),files=selected.length?selected:[];
 if(!selected.length)for(const directory of ['shared/team-store/test','shared/team-store/migration'])for(const file of await readdir(join(repo,directory)))if(file.endsWith('.test.mjs'))files.push(join(directory,file));
 const log=join(root,'suite.tap'),fd=openSync(log,'wx');let result;
 // Node applies this limit to each file as well as individual tests. The API
 // file runs both engines sequentially and legitimately exceeds 45 seconds.
 try{result=spawnSync(process.execPath,['--test','--test-concurrency=2','--test-timeout=180000',...files.map(f=>resolve(repo,f))],{cwd:repo,env:{...process.env,TEAM_STORE_TEST_POSTGRES:connection,TEAM_TEST_CODEX_EXECUTABLE:codex},stdio:['ignore',fd,fd],windowsHide:true,timeout:600000});}
 finally{closeSync(fd);}
 console.log(JSON.stringify({project:'disposable fixtures only',log,exit:result.status,error:result.error?.message,root,port,nativeCodexConfigured:true}));process.exitCode=result.status??1;
}finally{if(started){const stopped=run('pg_ctl.exe',['-D',data,'-m','fast','-w','stop']);console.log(JSON.stringify({ownedPostgresStopped:stopped.status===0,root}));if(stopped.status!==0)process.exitCode=1;}}
