// Native operations for an explicitly reviewed owned lead. Shared API launch
// claims still precede every creation; these handles grant no API authority.
import {join} from 'node:path';
import {homedir} from 'node:os';
import {normalizeActor,exact} from './api-domain.mjs';
import {refusal} from './errors.mjs';
const deny=message=>{throw refusal('API_NATIVE_UNVERIFIED',message);};
export function createOwnedHeadNative({verifyCaller,request,codexRuntime,claudeProvider,wake}){
 const targets=new WeakMap(),launchProviders=[...(codexRuntime?['codex']:[]),...(claudeProvider?.state==='available'?['claude']:[])];
 const currentTarget=async(target,metadata)=>{await verifyCaller(metadata);const launchId=targets.get(target);if(!launchId)deny('Only this lead’s own exact native preparation receipt can be used.');const current=await request('inspect',{launchId});if(JSON.stringify(current.target)!==JSON.stringify(target))deny('The owned target changed.');return launchId;};
 return {hostKind:'owned',launchWorkers:true,launchProviders,claudeProvider,launchProfileRoot:join(codexRuntime?.codexHome??homedir(),'925-to','launch-profiles'),verifyCaller,wake,
  async createLaunchTarget({member,launchId,launchProfile,workerToolPolicy},metadata){const actor=await verifyCaller(metadata);if(!launchProviders.includes(member.cli))deny('The selected native provider is unavailable.');const prepared=await request('prepare',{provider:member.cli,actor,launchId,launchProfile,workerToolPolicy,model:member.model,effort:member.effort,...(member.cli==='codex'?codexRuntime:codexRuntime?{codexRuntime}:{})},true);if(prepared.state!=='prepared'||!prepared.target)deny('Native preparation is uncertain. Preserve the original launch.');const target=Object.freeze(prepared.target);targets.set(target,launchId);return target;},
  async verifyLaunchTarget(target,metadata){await currentTarget(target,metadata);return target;},
  async startLaunchTarget(target,metadata){const launchId=await currentTarget(target,metadata),started=await request('start',{launchId,target});if(!started.bootstrap?.turnId&&!started.bootstrap?.nativeId)deny('Bootstrap outcome is unknown. Do not replace or replay it.');return started;},
  async ownedWorkerRequest(type,input,metadata){await verifyCaller(metadata);return request(type,input);},
  async verifyTarget(input,metadata){exact(input,['projectRoot','conversationId','terminalHandle','contextId']);const own=await verifyCaller(metadata);if(own.projectRoot!==input.projectRoot||own.contextId!==input.contextId)deny('The selected project home differs.');const candidates=[own,...(await request('list')).map(row=>row.identity).filter(Boolean)],target=candidates.find(row=>Object.entries(input).every(([key,value])=>row[key]===value));if(!target)deny('Only a current owned execution or this lead can be connected.');return normalizeActor(target);},
  async listTargets(metadata){
   const own=await verifyCaller(metadata),rows=await request('list'),seen=new Set(),sessions=[];
   for(const {identity} of [{identity:own},...rows]){if(identity?.projectRoot!==own.projectRoot||identity.contextId!==own.contextId)continue;const key=JSON.stringify([identity.provider,identity.conversationId]);if(seen.has(key))continue;seen.add(key);sessions.push({provider:identity.provider,label:'Verified owned '+identity.provider+' session',reference:Object.fromEntries(['projectRoot','conversationId','terminalHandle','contextId'].map(key=>[key,identity[key]]))});}
   return {ownedDiscovery:'verified',sessions};
  },
 };
}
