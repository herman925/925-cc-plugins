import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
// Expiry is a consequence of an accepted Work boundary, never a staffing decision.
export function staffingExpiryProof(proposal,read){
 const work=read(`work:${proposal.workId}`),delivery=work&&read(`delivery:${work.id}:${work.handoff?.deliveryId}`),spec=proposal.proof?.spec;
 if(!work||work.status!=='completed'||!work.closedAt||work.teamId!==proposal.teamId||!delivery||delivery.status!=='accepted'||delivery.workId!==work.id||delivery.id!==work.handoff?.deliveryId||!delivery.proof?.requestId||!delivery.proof?.payloadHash)return null;
 if(!spec||spec.protocol!=='team-questions/v1'||spec.kind!=='staffing-proposal'||spec.workId!==proposal.contextId||spec.appQuestionId!==proposal.id||spec.proposingManagerId!==proposal.proposingManagerId||spec.configVersion!==proposal.configVersion||spec.generation!==proposal.generation||!proposal.proof.requestId||!proposal.proof.nativeTaskId||!proposal.proof.payloadHash||proposal.fingerprint!==hash(proposal.proof)||!proposal.createdAt||proposal.createdAt>work.closedAt)return null;
 const context=read(`${proposal.contextId===work.id?'work':'native-run-binding'}:${proposal.contextId}`);
 if(!context||(context.teamWorkId??context.id)!==work.id||context.teamId!==work.teamId)return null;
 const expiry=proposal.expiry;
 if(!expiry||expiry.kind!=='accepted-work-closure'||expiry.workId!==work.id||expiry.deliveryId!==delivery.id||expiry.recordedAt!==work.closedAt)return null;
 const decision=read(`work-decision:${expiry.decisionRequestId}`);
 if(!decision||decision.requestId!==expiry.decisionRequestId||decision.workId!==work.id||decision.deliveryId!==delivery.id||decision.decision!=='accept'||decision.recordedAt!==work.closedAt||decision.input?.state!=='none'||!decision.fingerprint)return null;
 return {kind:'accepted-work-closure',workId:work.id,deliveryId:delivery.id,decisionRequestId:decision.requestId,recordedAt:decision.recordedAt};
}
