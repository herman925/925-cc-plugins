// Private subprocess entry point for the Mod hooks. This is not a CLI offered to
// agents. JSON comes from $.process.run stdin; model tools cannot choose proof,
// approval, storage configuration or the native verifier.
import {hostname} from 'node:os';
import {homedir} from 'node:os';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {createTeamApi} from './api.mjs';
import {createModNative} from './mod-native.mjs';
import {exact} from './src/api-domain.mjs';
import {StoreError,refusal} from './src/errors.mjs';

let api;
try {
 let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>256*1024)throw refusal('API_INPUT_INVALID','Mod request is oversized.');}
 const envelope=JSON.parse(input);
 exact(envelope,['mode','proof','request','uiApprovalId','orcaCommand']);
 if(!['execute','reconcile','approveController'].includes(envelope.mode))throw refusal('API_OPERATION_DENIED','Unsupported private Mod bridge method.');
 const native=await createModNative({orcaCommand:envelope.orcaCommand});
 const actor=await native.verifyCaller(envelope.proof);
 // UI evidence is an exact action id, not an arbitrary successful question in
 // this turn. The model-facing request schema has no approval field.
 const manifest=JSON.parse(await readFile(new URL('../.claude-plugin/plugin.json',import.meta.url),'utf8'));
 api=await createTeamApi({projectRoot:actor.projectRoot,machineId:hostname(),writer:{client:'team-orchestrator',version:manifest.version},
  authenticate:()=>native.verifyCaller(envelope.proof),verifyTarget:target=>native.verify(target),
  confirmController:async({approval})=>{
   if(envelope.mode!=='approveController'||!/^\w{32}$/.test(envelope.uiApprovalId??'')||approval!==envelope.uiApprovalId)return false;
   const ticketPath=join(process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude'),'team-orchestrator','controller-actions',`${approval}.json`);
   const info=await lstat(ticketPath);if(!info.isFile()||info.isSymbolicLink()||info.size>8192)return false;
   const ticket=JSON.parse(await readFile(ticketPath,'utf8'));
   return ticket.action==='approveController' && ticket.id===approval && ticket.conversationId===actor.conversationId && ticket.terminalHandle===actor.terminalHandle && ticket.contextId===actor.contextId && ticket.projectRoot.replaceAll('\\','/')===actor.projectRoot.replaceAll('\\','/') && Number.isSafeInteger(ticket.createdAt) && ticket.createdAt<=Date.now() && Date.now()-ticket.createdAt<60000;
  }});
 const result=envelope.mode==='approveController'
  ? await api.approveController({operationId:envelope.request.operationId,approval:envelope.uiApprovalId})
  : await api[envelope.mode](envelope.request);
 console.log(JSON.stringify({ok:true,result}));
} catch(error) {
 const known=error instanceof StoreError;
 console.log(JSON.stringify({ok:false,error:{code:known?error.code:'API_BRIDGE_FAILED',message:known?error.message:'The private Mod bridge could not verify or complete this operation.',...(known?{details:error.details}:{})}}));
 process.exitCode=1;
} finally {
 try{await api?.close();}catch{process.exitCode=1;}
}
