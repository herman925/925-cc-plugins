import {randomUUID} from 'node:crypto';
import {exact,normalizeApiCommand} from './api-domain.mjs';
import {managementReview} from './team-management.mjs';
import {refusal} from './errors.mjs';
import {text,snapshot} from './validation.mjs';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const managementTypes=['approveController','createFreshTeam','editTeam','bindMember'];
// A person cannot read a proposal and press confirm this fast.
export const HUMAN_REVIEW_FLOOR_MS=1000;

export async function codexManagement({args,actor,metadata,native,createApi,options,connection}){
 exact(args,['operationId','command','target','reconcile']);text(args.operationId,'operationId');if(args.reconcile!==undefined&&typeof args.reconcile!=='boolean')throw refusal('API_INPUT_INVALID','reconcile must be a boolean.');
 const command=normalizeApiCommand(args.command,{privileged:true});
 if(!managementTypes.includes(command.type))throw refusal('API_OPERATION_DENIED','Use shared_team for normal member operations.');
 if(args.target!==undefined&&command.type!=='bindMember')throw refusal('API_INPUT_INVALID','Only session binding accepts a target.');
 const target=args.target===undefined?undefined:snapshot(args.target);
 let granted=false,targetActor;
 const revalidate=async()=>{const current=await native.verifyCaller(metadata);if(!same(current,actor))throw refusal('API_STALE_AUTHORITY','The native conversation changed during review.');return current;};
 const api=await createApi({...options,projectRoot:actor.projectRoot,machineId:actor.machineId,authenticate:revalidate,
  verifyTarget:async reference=>{const current=await native.verifyTarget(reference,metadata);if(targetActor&&!same(current,targetActor))throw refusal('API_STALE_AUTHORITY','The selected native session changed during review.');return current;},
  confirmController:async()=>granted,confirmManagement:async()=>granted});
 const request={operationId:args.operationId,command,...(target?{target}:{})};
 // A client can advertise elicitation and still answer the form itself. Distinguish
 // that from a person declining, so a refusal is never mistaken for consent given
 // or withheld. An accept that arrives implausibly fast is also reported as
 // unverified rather than presented as a human decision.
 const reviewed=async params=>{
  const started=Date.now();let reply;
  try{reply=await connection.elicit(params);}
  catch(error){throw error;}
  const elapsedMs=Date.now()-started;
  return {reply,elapsedMs,confirmedRoundTrip:elapsedMs>=HUMAN_REVIEW_FLOOR_MS};
 };
 // A reply faster than any person could read the proposal is evidence that the
 // form was probably not shown, but it is not proof: the client could still have
 // shown a dismissed form. Report approval as not obtained and delivery as
 // unverified, with an automatic decline as one possible cause. Never turn a
 // fast reply into a claim about what the person did or did not do.
 const declined=(kind,humanMessage)=>{
  if(kind.confirmedRoundTrip)return refusal('API_APPROVAL_REQUIRED',humanMessage);
  return refusal('API_APPROVAL_UNVERIFIED',`Approval not obtained; delivery unverified. The review returned in ${kind.elapsedMs}ms, which is too fast for a person to have read it, so this is not treated as your refusal. An automatic decline by the client is one possible cause; a form that appeared and was dismissed is not ruled out. No consent was given or withheld. Check that MCP confirmation prompts are enabled for this project, then try again.`);
 };
 // Acceptance is not gated on timing: an automated harness may legitimately
 // answer at once, and no auto-accept path has been observed. Only the decline
 // report is corrected, because there a silent client answer was being
 // presented to the person as their own refusal.
 const recover=async()=>{try{return await api.reconcileManagement(request);}catch(e){if(['STORE_NOT_FOUND','STORE_EMPTY'].includes(e.code)||e.code==='API_CONTROLLER_REQUIRED'&&args.reconcile!==true)return {status:'unknown',operationId:args.operationId};throw e;}};
 try{
  const recovered=await recover();if(recovered.status!=='unknown'||args.reconcile===true)return recovered;
  if(!connection?.canElicit||typeof connection.elicit!=='function')throw refusal('API_REVIEW_UNAVAILABLE','This Codex client must support native form confirmation to approve management changes. No prompt or tool argument can replace it.');
  let info;try{info=(await api.execute({operationId:`management-caller-${randomUUID()}`,command:{type:'inspectController'}})).result;}catch(e){if(!['STORE_NOT_FOUND','STORE_EMPTY'].includes(e.code))throw e;info={controllerGeneration:null};}
  if(info.controllerRevoked)throw refusal('API_CONTROLLER_REVOKED','This conversation approval was revoked; it cannot be silently resurrected.');
  if(command.type==='bindMember')targetActor=await native.verifyTarget(target,metadata);
  // Inspecting an existing team requires approved controller authority before
  // disclosing its configuration. Creation's supplied draft can be reviewed first.
  const approve=async()=>{
   const approval=await reviewed(managementReview({actor,command:{type:'approveController'},needsApproval:true}));
   const approved=approval.reply;
   if(approved?.action!=='accept'||approved.content?.confirm!==true)throw declined(approval,'Management approval was declined or cancelled.');
   await revalidate();granted=true;
   await api.approveController({operationId:`controller-for-${args.operationId}`});granted=false;
   info=(await api.execute({operationId:`management-caller-${randomUUID()}`,command:{type:'inspectController'}})).result;
  };
  if(!info.controllerGeneration&&['editTeam','bindMember'].includes(command.type))await approve();
  let current=null;
  if(['editTeam','bindMember'].includes(command.type))current=(await api.execute({operationId:`management-preview-${randomUUID()}`,command:{type:'inspectConfiguration',teamId:command.teamId}})).result;
  if(command.type==='editTeam'&&Number(current.team.config_version)!==command.expectedConfigVersion)throw refusal('API_STALE_AUTHORITY','Configuration changed; inspect it before reviewing another proposal.');
  const review=managementReview({actor,command,current,target:targetActor,needsApproval:!info.controllerGeneration});
  const decision=await reviewed(review);
  const answer=decision.reply;
  if(answer?.action!=='accept'||answer.content?.confirm!==true)throw declined(decision,'The proposed change was declined or cancelled.');
  await revalidate();granted=true;
  if(command.type==='approveController')return await api.approveController({operationId:args.operationId});
  if(!info.controllerGeneration)await api.approveController({operationId:`controller-for-${args.operationId}`});
  return await api.manageTeam(request);
 }finally{granted=false;await api.close();}
}
