import { rolePointer } from '../role-files.mjs';
import {controlRuntime} from './runtime-control.mjs';
import {createKeyedSerializer} from './keyed-serializer.mjs';
import {notifyQuestionEvent} from './questions.mjs';
import {userMessage,accepted} from './dispatch.mjs';
import {withNativeRuntime} from './native-runtime.mjs';
import {readNativeQuestionEvidence} from './native-questions.mjs';
import {sessionDecisionKey,sendSessionNotice} from './session-decisions.mjs';
import {discoverCapabilities} from './capabilities.mjs';
import {preferenceIssue} from '../capabilities.mjs';
export function createStaffingService({store,rpc,userData,works,consent,notify}) {
 const current=id=>store.readCurrentWork?.(id)??store.readWork(id);
 const serialize=createKeyedSerializer();
 const serial=(id,fn)=>serialize(id,()=>withNativeRuntime(rpc,controlRuntime(current(id)),fn));
 async function check(id){
  const root=current(id);if(!root||root.status==='completed')return;
  const notice=(noticeId,kind,body)=>sendSessionNotice({store,works,rpc,consent,userMessage,accepted,workId:root.id,id:noticeId,kind,body});
  for(const work of store.listRunWorks?.(id)??[root]){
   try{
    await consent();const verified=await works.verifyWork(work.id,true),protocol=store.readDispatchProtocol(work.id);if(!protocol)continue;
    const native=await readNativeQuestionEvidence(userData,{work:current(work.id),protocol,owner:verified.instance,attempts:store.listDispatches(work.id)});
    if(native.state!=='verified')continue;
    for(const intent of native.intents)if(intent.spec.kind==='staffing-proposal')try{store.ingestStaffingProposal(work.id,intent);}catch{}
    for(const intent of native.intents)if(intent.spec.kind==='roster-ack')try{store.acknowledgeRosterDelta(work.id,intent);}catch{}
   }catch{}
  }
  if(!root.parent){
   const protocol=store.readDispatchProtocol(root.id);
   if(protocol&&root.run.state==='verified'){
    const verified=await works.verifyWork(root.id,true);
    const native=await readNativeQuestionEvidence(userData,{work:current(root.id),protocol,owner:verified.instance,attempts:store.listDispatches(root.id),nativeHistory:store.readNativeHistory(root.id)});
    for(const intent of (native.intents??[]).filter(i=>i.spec.kind==='staffing-decision')){
     if(store.readQuestionEvent(root.id,'result-'+sessionDecisionKey(intent))?.data.status==='rejected')continue;
     try{
      const proposal=store.listStaffingProposals(root.id).find(p=>p.id===intent.spec.proposalId);
      if(proposal?.status==='pending'){
       const context=current(proposal.contextId),author=await works.verifyWork(context.id,true),proof=await readNativeQuestionEvidence(userData,{work:context,protocol:store.readDispatchProtocol(context.id),owner:author.instance,attempts:store.listDispatches(context.id),nativeHistory:store.readNativeHistory(context.id)});
       if(proof.state!=='verified'||!proof.intents.some(i=>i.nativeTaskId===proposal.proof.nativeTaskId&&i.payloadHash===proposal.proof.payloadHash&&JSON.stringify(i.spec)===JSON.stringify(proposal.proof.spec)))throw Error('The original staffing proposal evidence changed; request a fresh proposal.');
      }
      if(intent.spec.decision==='approve'&&proposal?.status==='pending'){
       const caps=await discoverCapabilities(rpc,root.scope),issue=preferenceIssue(proposal.member,caps,{requireCore:true});if(issue)throw Error(issue);
      }
      await consent();await works.verifyHost(root.id,verified.hostGeneration);
      const latest=await works.verifyWork(root.id,true),fresh=await readNativeQuestionEvidence(userData,{work:current(root.id),protocol:store.readDispatchProtocol(root.id),owner:latest.instance,attempts:store.listDispatches(root.id),nativeHistory:store.readNativeHistory(root.id)});
      if(fresh.state!=='verified'||!fresh.intents.some(i=>i.nativeTaskId===intent.nativeTaskId&&i.payloadHash===intent.payloadHash))throw Error('Supervisor decision changed before staffing was saved.');
      const result=store.saveSessionStaffing(root.id,intent);
      await notice('result-'+sessionDecisionKey(intent),'TEAM_SESSION_DECISION_RESULT',{decisionId:intent.spec.appQuestionId,kind:'staffing-decision',status:result.decision,...result,instruction:'Use the forthcoming roster delta and normal direct-parent task admission. No panel approval is needed.'});
     }catch(error){await notice('result-'+sessionDecisionKey(intent),'TEAM_SESSION_DECISION_RESULT',{decisionId:intent.spec.appQuestionId,kind:'staffing-decision',status:'rejected',detail:error.message,proof:intent});}
    }
   }
  }
  for(const proposal of store.listStaffingProposals(id))if(proposal.status==='pending')await notice(`session-staffing-${proposal.id}-${root.epoch??0}`,'TEAM_STAFFING_PROPOSAL',{proposalId:proposal.id,proposalNativeTaskId:proposal.proof.nativeTaskId,configVersion:proposal.configVersion,proposingManagerId:proposal.proposingManagerId,member:proposal.member,rationale:proposal.rationale,affectedTaskKeys:proposal.affectedTaskKeys,instruction:'Explain this exact proposal to the user in your own conversation, wait for their explicit answer, then record staffing-decision. Lower-manager proposals require this same highest-supervisor process.'});
  for(const proposal of store.listStaffingProposals(id))if(proposal.status==='pending')await notifyQuestionEvent(store,notify,{workId:proposal.workId,id:'staffing-'+proposal.id,kind:'decision',title:'Staffing request in supervisor session',body:proposal.rationale});
  for(const delta of store.listRosterDeltas(id)){
   if(delta.state==='sending'){store.updateRosterDelta(delta.id,{state:'unknown',detail:'Delivery interrupted; preserve its native request identity. No automatic resend.'});continue;}
   if(delta.state!=='queued')continue;
   try{
    const contexts=store.listRunWorks?.(id)??[current(id)],target=contexts.findLast(w=>w.supervisorMemberId===delta.supervisorMemberId&&(!w.parent||store.listDispatches(w.parent.workId).find(a=>a.id===w.parent.attemptId)?.status==='running'));
    if(!target)continue; // A new manager has no Run until its genuine native supervisor work establishes one.
    await consent();const verified=await works.verifyWork(target.id,true),work=current(target.id),protocol=store.readDispatchProtocol(work.id);
    if(!protocol||protocol.generation!==work.run.consumerGeneration)continue;
    const team=store.readTeamVersion(work.teamId,delta.configVersion),children=team.members.filter(m=>m.boss===delta.supervisorMemberId).map(m=>({memberId:m.id,name:m.name,agent:m.agent,model:m.model,effort:m.effort,roleVersion:m.roleVersion,...(team.configuration?.projectRoleFiles===1?{roleFileInstruction:rolePointer(team,m)}:{}),role:{brief:m.brief,habits:m.habits,collaboration:m.collaboration}}));
    const text='TEAM_ROSTER_DELTA\n'+JSON.stringify({protocol:'team-questions/v1',kind:'roster-delta',workId:work.id,teamWorkId:delta.workId,deltaId:delta.id,configVersion:delta.configVersion,supervisorMemberId:delta.supervisorMemberId,memberIds:delta.memberIds,children,token:protocol.token,generation:protocol.generation,instruction:'The user saved this configuration. Reread your persistent role file, tell participating direct children to reread theirs, and include each child roleFileInstruction verbatim in future native Task instructions when provided. Use registered direct children and this configVersion for future task-create admission. Prior Tasks retain their versions. Do not create sessions or bypass dependencies, write scopes, host checks or TEAM_DISPATCH_PERMIT. Confirm incorporation with native task-create --spec JSON --run your actual Run --json, protocol team-questions/v1, kind roster-ack, workId, token, generation, appQuestionId, deltaId and configVersion. Native input acceptance alone is not your acknowledgement.'});
    const nativeSend=userMessage(work,verified.instance,text,verified.status);
    if(!store.claimRosterDelta(delta.id,{nativeSend,contextId:work.id,runId:work.run.id,generation:work.run.consumerGeneration,supervisorMemberId:work.supervisorMemberId}))continue;
    await works.verifyHost(work.id,verified.hostGeneration);await consent();
    const latest=current(work.id);if(latest.run.id!==work.run.id||latest.run.consumerGeneration!==work.run.consumerGeneration||latest.status==='completed')throw Error('Roster supervisor changed before delivery.');
    const receipt=await rpc(nativeSend.method,nativeSend.params,nativeSend.envelope);store.updateRosterDelta(delta.id,{state:accepted(receipt,nativeSend,verified.instance)?'accepted':'unknown'});
   }catch(error){const row=store.listRosterDeltas(id).find(r=>r.id===delta.id);if(row?.state==='sending')store.updateRosterDelta(delta.id,{state:'unknown',detail:String(error.message).slice(0,1200)});}
  }
 }
 return {check:id=>serial(id,()=>check(id)),async reconcile(){for(const work of store.listWorks())if(work.status!=='completed')await this.check(work.id);}};
}
