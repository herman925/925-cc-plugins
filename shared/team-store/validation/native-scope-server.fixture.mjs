// Disposable read-only MCP probe. Never used by product setup or as authority.
import {appendFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createIndependentCodexIdentity} from '../src/codex-independent-native.mjs';
import {createCodexAdapter} from '../codex-mcp.mjs';
import {prepareSetup,applySetup} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup.mjs';
import {verifySetupHost} from '../../../team-orchestration-925/skills/team-orchestration-925/scripts/setup-host.mjs';
let capabilities={},serial=0;const pending=new Map();
const send=row=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...row})+'\n');
const record=row=>appendFile(process.env.TEAM_SCOPE_AUDIT,JSON.stringify(row)+'\n');
const tool={name:'scope_probe',description:'Read-only disposable native metadata probe.',annotations:{readOnlyHint:true,destructiveHint:false},inputSchema:{type:'object',properties:{},additionalProperties:false}};
for await(const line of createInterface({input:process.stdin})){
 let row;try{row=JSON.parse(line);}catch{continue;}
 if(!row.method){const waiter=pending.get(row.id);if(waiter){pending.delete(row.id);waiter(row);}continue;}
 if(row.method==='initialize'){
  capabilities=row.params?.capabilities??{};await record({kind:'initialize',capabilities});send({id:row.id,result:{protocolVersion:row.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'scope_probe_fixture',version:'0.0.0'}}});
 }else if(row.method==='tools/list')send({id:row.id,result:{tools:[tool]}});
 else if(row.method==='tools/call'){
  const operation=async()=>{
   await record({kind:'call',name:row.params.name,metadata:row.params._meta??null});
   if(process.env.TEAM_SCOPE_NATIVE_PROOF==='true'){
    const native=await createIndependentCodexIdentity({scope:{projectRoot:process.env.TEAM_SCOPE_PROJECT_ROOT},codexExecutable:process.env.TEAM_SCOPE_CODEX_EXECUTABLE,codexHome:process.env.TEAM_SCOPE_CODEX_HOME});
    const actor=await native.verifyCaller(row.params._meta);
    const adapter=await createCodexAdapter({hostMode:'independent',observation:false},{createIdentity:async()=>native});
    try{
     await record({kind:'native-actor',actor,host:native.hostKind});
     const status=await adapter.call('shared_team_status',{},row.params._meta);await record({kind:'adapter-status',status});
     await record({kind:'ordinary-guard',result:await adapter.call('team_guard',{tool:'exec_command',input:{cmd:'Get-Location'}},row.params._meta)});
     if(process.env.TEAM_SCOPE_SETUP==='true'){
      const plan=await prepareSetup({hostMode:'independent',projectRoot:actor.projectRoot,stateRoot:process.env.TEAM_SCOPE_CODEX_HOME+'/925-to/installations',codexExecutable:process.env.TEAM_SCOPE_CODEX_EXECUTABLE},{verifyHost:(project,options)=>verifySetupHost(project,{...options,env:{...process.env,CODEX_HOME:process.env.TEAM_SCOPE_CODEX_HOME,CODEX_THREAD_ID:actor.conversationId}})});
      await record({kind:'setup-preview',summary:plan.summary});await record({kind:'setup-applied',summary:await applySetup(plan)});
     }
    }finally{await adapter.close();}
   }
   if(capabilities.roots){const id=`fixture-roots-${++serial}`;const answer=new Promise(resolve=>pending.set(id,resolve));send({id,method:'roots/list',params:{}});await record({kind:'roots',reply:await answer});}
   send({id:row.id,result:{content:[{type:'text',text:'Disposable scope probe completed.'}]}});
  };void operation().catch(()=>{process.exitCode=1;process.stdin.destroy();});
 }else if(row.id!==undefined)send({id:row.id,result:{}});
}
