import {upgradeTeamStore} from './upgrade.mjs';
import {inspectGuardSchema} from './guard-reader.mjs';
import {exact,controllerId} from './api-domain.mjs';
import {text} from './validation.mjs';
import {refusal} from './errors.mjs';
import {SCHEMA_VERSION} from '../contract.mjs';
import {nativeReviewRefusal} from './native-review.mjs';
export async function codexUpgrade({args,actor,metadata,native,options,connection}){
 exact(args,['operationId','reconcile']);text(args.operationId,'operationId');if(args.reconcile!==undefined&&typeof args.reconcile!=='boolean')throw refusal('API_INPUT_INVALID','reconcile must be a boolean.');
 const state=await inspectGuardSchema({actor,postgres:options.postgres});
 if(args.reconcile===true&&state.storeVersion!==SCHEMA_VERSION)return {status:'unknown',operationId:args.operationId};
 let granted=false;
 if(state.storeVersion!==SCHEMA_VERSION){
  if(!connection?.canElicit)throw refusal('API_REVIEW_UNAVAILABLE','A native confirmation is required to update this workspace.');
  const review={mode:'form',message:`Update this project's shared Team Orchestrator store from schema ${state.storeVersion} to ${SCHEMA_VERSION}. A complete private backup is saved before changes. Existing roster, approvals and history are preserved. Other clients need matching updated packages. Older process-only launch approvals grant no worker tool access. This does not approve team management, launch workers or grant hook trust.\n${JSON.stringify({project:actor.projectRoot,conversation:actor.conversationId,operationId:args.operationId},null,2)}`,requestedSchema:{type:'object',properties:{confirm:{type:'boolean',title:'Back up and update this workspace',default:false}},required:['confirm']}};
  const started=Date.now(),answer=await connection.elicit(review);if(answer?.action!=='accept'||answer.content?.confirm!==true)throw nativeReviewRefusal(Date.now()-started,'Workspace update approval was not obtained. No migration was performed.');
  granted=true;
 }
 const current=await native.verifyCaller(metadata);if(JSON.stringify(current)!==JSON.stringify(actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed during workspace update review.');
 return upgradeTeamStore({projectRoot:actor.projectRoot,machineId:actor.machineId,writer:options.writer,postgres:options.postgres,backupRoot:options.backupRoot,operationId:args.operationId,caller:{principalId:controllerId(actor)},authorize:request=>request.scope.projectRoot===actor.projectRoot&&(granted||request.scope.fromVersion===SCHEMA_VERSION)});
}
