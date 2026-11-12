import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { openTeamStore } from './index.mjs';
import { normalizeActor, normalizeApiCommand, controllerId, exact,launchTypes } from './src/api-domain.mjs';
import { text } from './src/validation.mjs';
import { refusal } from './src/errors.mjs';
import {WORKER_RUNTIME_TYPES} from './src/worker-policy.mjs';
import {normalizeRuntimeProof} from './src/worker-readiness.mjs';

// This factory is a trusted integration dependency, never a model tool. The
// authenticate/verifyTarget/confirmController functions belong to the native
// client and cannot be supplied or replaced in request JSON.
export async function createTeamApi(options) {
  if (typeof options?.authenticate !== 'function') throw refusal('API_AUTHENTICATOR_REQUIRED','A trusted native caller verifier is required.');
  const root = await realpath(text(options.projectRoot,'projectRoot'));
  const authenticate = async () => {
    const actor = normalizeActor(await options.authenticate());
    if (await realpath(actor.projectRoot) !== root || actor.machineId !== options.machineId) throw refusal('API_CALLER_SCOPE','Verified caller belongs to a different project or machine.');
    return normalizeActor({...actor,projectRoot:root});
  };
  const capability = randomUUID(); // private closure; never returned or put in a model request
  let store;
  const open = async (actor, create = false) => {
    if (!store) store = await openTeamStore({projectRoot:root, ...(options.postgres ? {postgres:options.postgres} : {}), machineId:options.machineId,
      holderToken:options.holderToken, writer:options.writer, create, releaseAfterApi:true,
      caller:{principalId:controllerId(actor),capability},
      authorize:({caller,kind})=>caller.capability===capability && (kind==='api' || (create && kind==='createStore'))});
    return store;
  };
  const request = async (input, privileged = false, recover = false) => {
    exact(input,['operationId','command',...(privileged ? ['approval'] : []), 'target']);
    const command = normalizeApiCommand(input.command,{privileged});
    const actor = await authenticate();
    let target = null;
    if (command.type === 'bindMember') {
      if (typeof options.verifyTarget !== 'function') throw refusal('API_TARGET_UNVERIFIED','The native client cannot verify a target.');
      target = normalizeActor(await options.verifyTarget(input.target));
      target = normalizeActor({...target,projectRoot:await realpath(target.projectRoot)});
    } else if(command.type==='recordLaunchTarget'){
      if(typeof options.verifyLaunchTarget!=='function')throw refusal('API_TARGET_UNVERIFIED','A native terminal creation receipt is required.');
      target=await options.verifyLaunchTarget(input.target);
    } else if (input.target !== undefined) throw refusal('API_INPUT_INVALID','This operation does not accept a target.');
    if (command.type === 'approveController'&&!recover) {
      if (typeof options.confirmController !== 'function' || await options.confirmController({actor,approval:input.approval}) !== true) throw refusal('API_APPROVAL_REQUIRED','A specific user controller-approval action is required.');
    }
    if(command.type==='editTeam'&&!recover&&(typeof options.confirmManagement!=='function'||await options.confirmManagement({actor,command})!==true))throw refusal('API_APPROVAL_REQUIRED','A specific native review of this configuration change is required.');
    if(command.type==='approveLaunchPlan'&&!recover&&(typeof options.confirmLaunchPlan!=='function'||await options.confirmLaunchPlan({actor,command})!==true))throw refusal('API_APPROVAL_REQUIRED','A specific native review of this launch plan is required.');
    if(command.type==='importClassicTeam'&&!recover){
      if(typeof options.confirmClassicImport!=='function'||await options.confirmClassicImport({actor,command})!==true)throw refusal('API_APPROVAL_REQUIRED','A specific native review of this complete classic import is required.');
      if(typeof options.verifyClassicImport!=='function'||await options.verifyClassicImport({actor,command})!==true)throw refusal('API_IMPORT_SOURCE_UNVERIFIED','Reverify the exact source fingerprint, complete private backup and safe native source state after review before importing.');
      if(JSON.stringify(await authenticate())!==JSON.stringify(actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed during classic import verification.');
    }
    const db = await open(actor, command.type === 'approveController'&&!recover);
    const value = {operationId:text(input.operationId,'operationId'),kind:'api',command,target,caller:{principalId:controllerId(actor),capability,actor}};
    return {db,value};
  };
  return Object.freeze({
    inspectWake:async input=>{if(input?.command?.type!=='inspectWake')throw refusal('API_OPERATION_DENIED','Only private wake eligibility inspection is supported.');const {db,value}=await request(input,true);return db.execute(value);},
    workerRuntime:async input=>{
      exact(input,['operationId','type','step','receiptId']);
      if(!WORKER_RUNTIME_TYPES.includes(input.type)||typeof options.verifyWorkerRuntime!=='function')throw refusal('API_WORKER_PROOF_REQUIRED','A private verified worker runtime is required.');
      const command={type:input.type,...(input.type==='observeWorkerRuntime'?{step:input.step,receiptId:input.receiptId??''}:{})};
      const {db,value}=await request({operationId:input.operationId,command},true);
      value.runtimeProof=normalizeRuntimeProof(await options.verifyWorkerRuntime({actor:value.caller.actor}));
      return db.execute(value);
    },
    execute:async input=>{const {db,value}=await request(input); return db.execute(value);},
    reconcile:async input=>{const {db,value}=await request(input); return db.reconcile(value);},
    // Only the client UI calls this method; it is deliberately absent from the
    // public execute command catalogue.
    approveController:async input=>{const {db,value}=await request({...input,command:{type:'approveController'}},true); return db.execute(value);},
    manageTeam:async input=>{if(!['createFreshTeam','editTeam','bindMember'].includes(input?.command?.type))throw refusal('API_OPERATION_DENIED','Unsupported native management operation.');const {db,value}=await request(input,true);return db.execute(value);},
    reconcileManagement:async input=>{if(!['approveController','createFreshTeam','editTeam','bindMember'].includes(input?.command?.type))throw refusal('API_OPERATION_DENIED','Unsupported management receipt.');const {db,value}=await request(input,true,true);return db.reconcile(value);},
    // Native migration integration only; deliberately absent from every MCP
    // command catalogue. Source/backup proof and a specific review are required.
    importClassicTeam:async input=>{if(input?.command?.type!=='importClassicTeam')throw refusal('API_OPERATION_DENIED','Not a classic import.');const {db,value}=await request(input,true);return db.execute(value);},
    reconcileClassicImport:async input=>{if(input?.command?.type!=='importClassicTeam')throw refusal('API_OPERATION_DENIED','Not a classic import receipt.');const {db,value}=await request(input,true,true);return db.reconcile(value);},
    launch:async input=>{const {db,value}=await request(input,true);if(!launchTypes.includes(value.command.type))throw refusal('API_OPERATION_DENIED','Not a launch operation.');return db.execute(value);},
    reconcileLaunch:async input=>{if(!launchTypes.includes(input?.command?.type))throw refusal('API_OPERATION_DENIED','Not a launch operation.');const {db,value}=await request(input,true,true);return db.reconcile(value);},
    close:async()=>{if(store) await store.close();},
  });
}
