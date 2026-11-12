import {mkdtemp,mkdir,realpath,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {openOwnedClaudeDriver} from '../src/claude-driver.mjs';
import {codexTools} from '../codex-mcp.mjs';
import {claudeFixtureModel,claudeFixtureEnvironment} from './claude-model.fixture.mjs';
const [sdkModule,executable]=process.argv.slice(2);if(!sdkModule||!executable)throw Error('Supply official SDK module and native Claude executable.');
const denyTool=process.argv.includes('--deny');
const root=await realpath(await mkdtemp(join(tmpdir(),'team-claude-driver-'))),project=join(root,'project'),home=join(root,'home');await mkdir(project);await mkdir(home);let driver,toolCalls=0,guardCalls=0,step=0;
const model=await claudeFixtureModel((body,calls)=>{assert.ok(calls<10);const current=step++;if(current===0&&body.tools.some(tool=>tool.name==='ToolSearch'))return {tool:'ToolSearch',args:{query:'select:mcp__team_orchestrator__shared_team_status',max_results:1}};if(current<=1)return {tool:'mcp__team_orchestrator__shared_team_status',args:{}};return {text:'Synthetic guarded SDK tool sequence complete.'};});
let evidence={passed:false,root,realModel:false,humanReviewsAnswered:0};
try{
 const sessionId=randomUUID();driver=await openOwnedClaudeDriver({sdkModule,executable,projectRoot:project,sessionId,env:{...claudeFixtureEnvironment(home,model.url),ORCA_TERMINAL_HANDLE:'fixture-parent',TEAM_PROJECT_ROOT:'fixture-parent',CODEX_THREAD_ID:'fixture-parent'},model:'claude-sonnet-4-6',tools:codexTools,onTool:async(name,args)=>{toolCalls++;assert.equal(name,'shared_team_status');assert.deepEqual(args,{});return {host:'owned-fixture',bound:false};},onGuard:async event=>{guardCalls++;return denyTool&&event.tool==='mcp__team_orchestrator__shared_team_status'?{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:'Explicit disposable negative guard fixture.'}}:{};}},{spawn:(command,args,options)=>{for(const key of Object.keys(options.env))assert.ok(!/^(?:ORCA_|TEAM_|CODEX_(?:THREAD|SESSION)_ID$)/i.test(key));assert.equal(options.env.CLAUDE_CONFIG_DIR,home);return spawn(command,args,options);}});
 assert.equal(model.calls(),0);const receipt=await driver.enqueue({type:'user',uuid:randomUUID(),session_id:sessionId,parent_tool_use_id:null,message:{role:'user',content:'Synthetic guarded SDK tool probe.'}},{bootstrap:true});assert.equal(receipt.isReplay,true);
 const deadline=Date.now()+30000;while(Date.now()<deadline){if(model.error())throw Error(model.error());const state=await driver.state();if(state.results)break;await new Promise(resolve=>setTimeout(resolve,50));}
 const state=await driver.state();assert.equal(state.results,1);assert.equal(toolCalls,denyTool?0:1);assert.ok(guardCalls>=1);assert.equal(state.nativeVerified,true);assert.equal(state.sessionId,sessionId);assert.equal(state.projectRoot,project);assert.deepEqual(driver.pending(),[]);evidence={...evidence,passed:true,mode:denyTool?'negative-guard':'positive-tool',modelCalls:model.calls(),toolCalls,guardCalls,state,process:driver.process(),limitation:'Actual native SDK tools and fail-closed hooks, but no shared team or human approval.'};
}catch(error){evidence={...evidence,error:error.message,code:error.code,modelCalls:model.calls(),modelError:model.error(),toolCalls,guardCalls,requests:model.requests()};process.exitCode=1;error.retainedClaude?.query?.close();error.retainedClaude?.warm?.close();error.retainedClaude?.child?.kill();}
finally{await driver?.close();await model.close();}
await writeFile(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
