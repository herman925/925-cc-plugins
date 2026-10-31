import { randomUUID } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { openTeamStore } from './index.mjs';
import { normalizeActor, normalizeApiCommand, controllerId, exact } from './src/api-domain.mjs';
import { text } from './src/validation.mjs';
import { refusal } from './src/errors.mjs';

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
  const request = async (input, privileged = false) => {
    exact(input,['operationId','command',...(privileged ? ['approval'] : []), 'target']);
    const command = normalizeApiCommand(input.command,{privileged});
    const actor = await authenticate();
    let target = null;
    if (command.type === 'bindMember') {
      if (typeof options.verifyTarget !== 'function') throw refusal('API_TARGET_UNVERIFIED','The native client cannot verify a target.');
      target = normalizeActor(await options.verifyTarget(input.target));
      target = normalizeActor({...target,projectRoot:await realpath(target.projectRoot)});
    } else if (input.target !== undefined) throw refusal('API_INPUT_INVALID','This operation does not accept a target.');
    if (command.type === 'approveController') {
      if (typeof options.confirmController !== 'function' || await options.confirmController({actor,approval:input.approval}) !== true) throw refusal('API_APPROVAL_REQUIRED','A specific user controller-approval action is required.');
    }
    const db = await open(actor, command.type === 'approveController');
    const value = {operationId:text(input.operationId,'operationId'),kind:'api',command,target,caller:{principalId:controllerId(actor),capability,actor}};
    return {db,value};
  };
  return Object.freeze({
    execute:async input=>{const {db,value}=await request(input); return db.execute(value);},
    reconcile:async input=>{const {db,value}=await request(input); return db.reconcile(value);},
    // Only the client UI calls this method; it is deliberately absent from the
    // public execute command catalogue.
    approveController:async input=>{const {db,value}=await request({...input,command:{type:'approveController'}},true); return db.execute(value);},
    close:async()=>{if(store) await store.close();},
  });
}
