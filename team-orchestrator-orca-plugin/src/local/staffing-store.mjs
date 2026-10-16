import {staffingExpiryProof} from './staffing-expiry.mjs';
import {randomUUID} from 'node:crypto';
import {staffingFingerprint} from './staffing-fingerprint.mjs';
import {validatePersistentState} from '../team.mjs';
const text=(v,n)=>typeof v==='string'&&v.trim().length>0&&v.length<=n;
const id=v=>text(v,120)&&/^[a-zA-Z0-9-]+$/.test(v);
export function staffingStore({db,readPrivate,putPrivate,readWork,listRunWorks,readSnapshot,write,archive,atomic}) {
 const rows=prefix=>db.prepare('SELECT json FROM receipts WHERE id LIKE ? ORDER BY rowid').all(prefix+'%').map(r=>JSON.parse(r.json));
 const rootWork=id=>{const w=readWork(id);return w?.teamWorkId?readWork(w.teamWorkId):w;};
 const active=id=>{const w=rootWork(id);if(!w||w.status==='completed')throw Error('This TeamWork is closed or unavailable; staffing requires a current work.');return w;};
 const effectiveTeamForWork=id=>{const work=rootWork(id);if(!work)return null;const amendment=readPrivate(`work-configuration:${work.id}`);return JSON.parse(db.prepare('SELECT json FROM team_versions WHERE team_id=? AND version=?').get(work.teamId,amendment?.configVersion??work.configVersion)?.json??'null');};
 const listRosterDeltas=id=>rows('roster-delta:').filter(r=>r.workId===(rootWork(id)?.id??id));
 const listStaffingProposals=id=>rows('staffing-proposal:').filter(r=>r.workId===(rootWork(id)?.id??id));
 // Called inside the same configuration transaction. Old Work/Task/Operation snapshots stay immutable.
 const recordConfigurationAmendment=(workId,team,{requestId,kind,memberIds})=>{
  if(!db.isTransaction)throw Error('Configuration amendment must share its validated save transaction.');
  const work=active(workId),previous=effectiveTeamForWork(work.id);
  if(team.id!==work.teamId||team.configVersion<=previous.configVersion||!memberIds.length||memberIds.some(id=>!team.members.some(m=>m.id===id)))throw Error('Invalid Work configuration amendment.');
  const amendment={id:randomUUID(),workId:work.id,teamId:team.id,previousConfigVersion:previous.configVersion,configVersion:team.configVersion,requestId,kind,memberIds,createdAt:new Date().toISOString()};
  putPrivate(`configuration-amendment:${amendment.id}`,amendment);putPrivate(`work-configuration:${work.id}`,amendment);
  for(const supervisorMemberId of new Set(team.members.filter(m=>team.members.some(child=>child.boss===m.id)).map(m=>m.id))){
   const delta={id:randomUUID(),workId:work.id,teamId:team.id,amendmentId:amendment.id,supervisorMemberId,configVersion:team.configVersion,memberIds:memberIds.filter(id=>team.members.find(m=>m.id===id).boss===supervisorMemberId),state:'queued',processed:'unconfirmed',createdAt:amendment.createdAt};putPrivate(`roster-delta:${delta.id}`,delta);
  }
  return amendment;
 };
 const publicDelta=({nativeSend,...row})=>row;
 const api={effectiveTeamForWork,listRosterDeltas,listStaffingProposals,recordConfigurationAmendment,
  expireStaffingProposals(decision){
   if(!db.isTransaction)throw Error('Staffing expiry must share the accepted Work transaction.');
   let expired=0;
   for(const proposal of listStaffingProposals(decision.workId).filter(p=>p.status==='pending')){
    const expiry={kind:'accepted-work-closure',workId:decision.workId,deliveryId:decision.deliveryId,decisionRequestId:decision.requestId,recordedAt:decision.recordedAt};
    if(!staffingExpiryProof({...proposal,expiry},readPrivate))continue;
    putPrivate(`staffing-proposal:${proposal.workId}:${proposal.id}`,{...proposal,status:'expired',expiry});expired++;
   }
   return expired;
  },
  reconcileExpiredStaffingProposals(){return atomic(()=>{
   let expired=0;for(const decision of rows('work-decision:').filter(d=>d.decision==='accept'))expired+=api.expireStaffingProposals(decision);
   if(expired){const state=readSnapshot();state.revision++;write(state);}return expired;
  });},
  staffingRecipientBindings(workId){const root=rootWork(workId),ids=new Set(rows('configuration-amendment:').filter(a=>a.workId===root?.id&&a.kind==='add-member').flatMap(a=>a.memberIds));return rows('operation:').filter(o=>ids.has(o.memberId)&&readPrivate(`binding:${o.memberId}`)?.requestId===o.requestId).map(o=>({memberId:o.memberId,requestId:o.requestId,instanceGeneration:o.instanceGeneration??1}));},
  staffingClosureBlockers(workId){const root=rootWork(workId),reasons=[];for(const d of listRosterDeltas(workId))if(d.processed!=='confirmed'&&(d.state!=='queued'||(listRunWorks?.(workId)??[root]).some(w=>w.supervisorMemberId===d.supervisorMemberId&&(!w.parent||readPrivate(`dispatch:${w.parent.attemptId}`)?.status==='running'))))reasons.push(`Roster configuration ${d.configVersion} awaits manager processing`);for(const r of rows('staffing-request:'))if(r.result?.workId===root?.id&&r.result.launch&&readPrivate(`operation:${r.result.launch.requestId}`)?.status!=='created')reasons.push('Approved staffing preparation remains pending or unknown');return [...new Set(reasons)];},
  assertStaffingPreparation(memberId,requestId){const request=rows('staffing-request:').find(r=>r.result?.memberId===memberId&&r.result.launch?.requestId===requestId);if(request)active(request.result.workId);},
  readStaffingRequest(input){const prior=readPrivate(`staffing-request:${input.requestId}`);if(prior&&prior.fingerprint!==staffingFingerprint(input))throw Error('Staffing request identity conflicts.');return prior?.result??null;},
  staffingProjection:workId=>({staffingProposals:listStaffingProposals(workId).map(({proof,fingerprint,...p})=>p),rosterDeltas:listRosterDeltas(workId).map(publicDelta),effectiveConfigVersion:effectiveTeamForWork(workId)?.configVersion}),
  claimRosterDelta(id,{nativeSend,contextId,runId,generation,supervisorMemberId}){return atomic(()=>{
   const key=`roster-delta:${id}`,row=readPrivate(key);if(!row||row.state!=='queued')return false;
   active(row.workId);const work=readWork(contextId);
   if(!work||work.supervisorMemberId!==row.supervisorMemberId||supervisorMemberId!==row.supervisorMemberId||work.run.id!==runId||work.run.consumerGeneration!==generation)throw Error('Roster recipient authority changed.');
   Object.assign(row,{state:'sending',nativeSend,contextId,runId,generation});putPrivate(key,row);return true;
  });},
  updateRosterDelta(id,patch){return atomic(()=>{const key=`roster-delta:${id}`,row=readPrivate(key);if(!row)throw Error('Roster delta missing.');if(Object.keys(patch).some(k=>!['state','detail'].includes(k)))throw Error('Roster evidence is immutable.');Object.assign(row,patch);putPrivate(key,row);return row;});},
  acknowledgeRosterDelta(contextId,intent){return atomic(()=>{
   const s=intent.spec,key=`roster-delta:${s.deltaId}`,row=readPrivate(key),work=readWork(contextId);
   if(!row||!['accepted','sending','unknown'].includes(row.state)||row.contextId!==contextId||row.supervisorMemberId!==work.supervisorMemberId||row.runId!==work.run.id||row.generation!==s.generation||row.configVersion!==s.configVersion)throw Error('Roster acknowledgement does not match its actual manager/version.');
   row.processed='confirmed';row.acknowledgement={nativeTaskId:intent.nativeTaskId,payloadHash:intent.payloadHash};putPrivate(key,row);return row;
  });},
  ingestStaffingProposal(workId,intent){return atomic(()=>{
   const work=active(workId),context=readWork(workId),s=intent.spec,team=effectiveTeamForWork(workId),fingerprint=staffingFingerprint(intent),key=`staffing-proposal:${work.id}:${s.appQuestionId}`,prior=readPrivate(key);
   if(prior){if(prior.fingerprint!==fingerprint)throw Error('Proposal identity conflicts.');return prior;}
   if(s.kind!=='staffing-proposal'||!id(s.appQuestionId)||s.proposingManagerId!==context.supervisorMemberId||s.configVersion!==team.configVersion||s.roleVersion!==1||!text(s.rationale,8000)||!Array.isArray(s.affectedTaskKeys)||s.affectedTaskKeys.some(v=>!id(v))||!s.member||!team.members.some(m=>m.id===s.member.boss&&['ceo','head','lead'].includes(m.role)))throw Error('Staffing proposal configuration or manager is stale.');
   const proposal={id:s.appQuestionId,workId:work.id,contextId:workId,teamId:team.id,proposingManagerId:context.supervisorMemberId,runId:context.run.id,generation:context.run.consumerGeneration,configVersion:s.configVersion,roleVersion:s.roleVersion,member:s.member,rationale:s.rationale,affectedTaskKeys:s.affectedTaskKeys,status:'pending',proof:intent,fingerprint,createdAt:new Date().toISOString()};putPrivate(key,proposal);return proposal;
  });},
  saveStaffing(input){return atomic(()=>{
   if(!input||!id(input.requestId)||!Number.isSafeInteger(input.expectedRevision)||!Number.isSafeInteger(input.configVersion)||Object.keys(input).some(k=>!['requestId','workId','expectedRevision','configVersion','member','proposalId','decision'].includes(k))||!input.proposalId&&input.decision!==undefined)throw Error('Invalid staffing request identity or revision.');
   const fingerprint=staffingFingerprint(input),key=`staffing-request:${input.requestId}`,prior=readPrivate(key);
   if(prior){if(prior.fingerprint!==fingerprint)throw Error('Staffing request identity conflicts.');return prior.result;}
   const work=active(input.workId),state=readSnapshot(),team=state.teams.find(t=>t.id===work.teamId);
   const proposal=input.proposalId?readPrivate(`staffing-proposal:${work.id}:${input.proposalId}`):null;
   if(input.proposalId&&(!proposal||!['approve','reject'].includes(input.decision)||input.member))throw Error('Choose a saved staffing proposal and user decision.');
   if(proposal?.status!=='pending'&&proposal){if(proposal.decision.choice!==input.decision||proposal.configVersion!==input.configVersion)throw Error('Proposal is already decided; its decision cannot be changed.');putPrivate(key,{fingerprint,result:proposal.decision.result});return proposal.decision.result;}
   if(proposal&&input.decision==='approve'&&(readWork(proposal.contextId)?.run.id!==proposal.runId||readWork(proposal.contextId)?.run.consumerGeneration!==proposal.generation))throw Error('Proposal supervisor changed; review a fresh proposal.');
   if(proposal&&proposal.configVersion!==input.configVersion)throw Error('Proposal configuration changed; review a fresh proposal.');
   const decide=result=>{if(proposal){proposal.status=input.decision==='reject'?'rejected':'approved';proposal.decision={from:'user',choice:input.decision,requestId:input.requestId,recordedAt:new Date().toISOString(),result};putPrivate(`staffing-proposal:${work.id}:${proposal.id}`,proposal);}putPrivate(key,{fingerprint,result});return result;};
   if(proposal&&input.decision==='reject'){state.revision++;write(state);return decide({requestId:input.requestId,workId:work.id,proposalId:proposal.id,decision:'rejected'});}
   if(state.revision!==input.expectedRevision||team?.configVersion!==input.configVersion||effectiveTeamForWork(work.id)?.configVersion!==input.configVersion)throw Error('Team configuration changed; reload and review staffing again.');
   if(readPrivate(`next-goal:${team.id}`))throw Error('Queued goal transition is reserved.');
   const source=proposal?.member??input.member,boss=team.members.find(m=>m.id===source?.boss);
   if(!source||Object.keys(source).some(k=>!['name','boss','brief','habits','collaboration','agent','model','effort'].includes(k))||!text(source.name,120)||!text(source.brief,1500)||[source.habits,source.collaboration].some(v=>typeof v!=='string'||v.length>1500)||!boss||!['ceo','head','lead'].includes(boss.role)||boss.level>=3)throw Error('Choose a current direct manager and valid member role content.');
   if(team.members.length>=49)throw Error('The current team schema supports at most 49 members.');
   if(!['claude','codex'].includes(source.agent)||!text(source.model,120)||!text(source.effort,120)||source.model==='default'&&source.effort!=='default')throw Error('Choose valid agent, model and effort preferences.');
   if(team.members.some(m=>m.name.toLowerCase()===source.name.toLowerCase()))throw Error('Member name already exists.');
   if(team.scope.workspaceKey!==work.scope.workspaceKey||team.scope.executionHostId!==work.scope.executionHostId)throw Error('TeamWork execution scope changed.');
   const member={...source,id:randomUUID(),team:boss.team,role:boss.role==='ceo'?'head':boss.level===1&&team.configuration.levels===3?'lead':'worker',level:boss.level+1,roleVersion:1,state:'unassigned',preferenceOverride:true};
   team.members.push(member);team.configVersion++;archive(team);
   const amendment=recordConfigurationAmendment(work.id,team,{requestId:input.requestId,kind:'add-member',memberIds:[member.id]});
   state.revision++;validatePersistentState(state);write(state);
   const result={requestId:input.requestId,workId:work.id,from:'user',source:proposal?'proposal':'direct',recordedAt:new Date().toISOString(),memberId:member.id,configVersion:team.configVersion,amendmentId:amendment.id,decision:'approved',...(team.configuration.launchMode==='all'?{launch:{teamId:team.id,memberId:member.id,configVersion:team.configVersion,requestId:randomUUID()}}:{})};return decide(result);
  });},
 };return api;
}
