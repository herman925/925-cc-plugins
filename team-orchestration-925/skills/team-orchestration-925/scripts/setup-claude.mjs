// Explicit optional component setup. Never called by status or worker launch.
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {nativeProjectRoot,verifySetupHost} from './setup-host.mjs';
import {prepareClaudeProvider,applyClaudeProvider,inspectClaudeProvider} from './runtime/src/claude-provider.mjs';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const action=process.argv[2]??'preview';if(!['preview','apply','diagnose'].includes(action))throw Error('Use preview, apply or diagnose.');
  if(action==='diagnose'){const current=await inspectClaudeProvider();console.log(JSON.stringify({state:current.state,version:current.version,digest:current.digest??null}));}
  else{const project=await nativeProjectRoot();await verifySetupHost(project);const plan=await prepareClaudeProvider({executable:process.env.TEAM_CLAUDE_EXECUTABLE});console.log(JSON.stringify(action==='preview'?plan.summary:await applyClaudeProvider(plan)));}
 }catch(error){console.log(JSON.stringify({ok:false,error:{code:error.code??'CLAUDE_SETUP_REFUSED',message:error.code?error.message:'Optional Claude setup did not complete. Existing configuration and team state were preserved.'}}));process.exitCode=1;}
}
