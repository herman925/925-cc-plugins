import {notifyQuestionEvent} from './questions.mjs';
import {userMessage,accepted} from './dispatch.mjs';
import {withNativeRuntime} from './native-runtime.mjs';
import {readNativeQuestionEvidence} from './native-questions.mjs';
export function createStaffingService({store,rpc,userData,works,consent,notify}) {
 const current=id=>store.readCurrentWork?.(id)??store.readWork(id);
 const queues=new Map();
 const serial=(id,fn)=>{const p=(queues.get(id)??Promise.resolve()).catch(()=>{}).then(()=>withNativeRuntime(rpc,current(id)?.binding.runtimeId,fn));queues.set(id,p);p.finally(()=>{if(queues.get(id)===p)queues.delete(id);}).catch(()=>{});return p;};
 async function check(id){
  const root=current(id);if(!root||root.status==='completed')return;
  for(const work of store.listRunWorks?.(id)??[root]){
   try{
    await consent();const verified=await works.verifyWork(work.id,true),protocol=store.readDispatchProtocol(work.id);if(!protocol)continue;
    const native=await readNativeQuestionEvidence(userData,{work:current(work.id),protocol,owner:verified.instance,attempts:store.listDispatches(work.id)});
    if(native.state!=='verified')continue;
    for(const intent of native.intents)if(intent.spec.kind==='staffing-proposal')try{store.ingestStaffingProposal(work.id,intent);}catch{}
    for(const intent of native.intents)if(intent.spec.kind==='roster-ack')try{store.acknowledgeRosterDelta(work.id,intent);}catch{}
   }catch{}
  }
  for(const proposal of store.listStaffingProposals(id))if(proposal.status==='pending')await notifyQuestionEvent(store,notify,{workId:proposal.workId,id:'staffing-'+proposal.id,kind:'decision',title:'Staffing proposal needs your decision',body:proposal.rationale});
  for(const delta of store.listRosterDeltas(id)){
   if(delta.state==='sending'){store.updateRosterDelta(delta.id,{state:'unknown',detail:'Delivery interrupted; preserve its native request identity. No automatic resend.'});continue;}
   if(delta.state!=='queued')continue;
   try{
    const contexts=store.listRunWorks?.(id)??[current(id)],target=contexts.findLast(w=>w.supervisorMemberId===delta.supervisorMemberId&&(!w.parent||store.listDispatches(w.parent.workId).find(a=>a.id===w.parent.attemptId)?.status==='running'));
    if(!target)continue; // A new manager has no Run until its genuine native supervisor work establishes one.
    await consent();const verified=await works.verifyWork(target.id,true),work=current(target.id),protocol=store.readDispatchProtocol(work.id);
    if(!protocol||protocol.generation!==work.run.consumerGeneration)continue;
    const team=store.readTeamVersion(work.teamId,delta.configVersion),children=team.members.filter(m=>m.boss===delta.supervisorMemberId).map(m=>({memberId:m.id,name:m.name,agent:m.agent,model:m.model,effort:m.effort,roleVersion:m.roleVersion,role:{brief:m.brief,habits:m.habits,collaboration:m.collaboration}}));
    const text='TEAM_ROSTER_DELTA\n'+JSON.stringify({protocol:'team-questions/v1',kind:'roster-delta',workId:work.id,teamWorkId:delta.workId,deltaId:delta.id,configVersion:delta.configVersion,supervisorMemberId:delta.supervisorMemberId,memberIds:delta.memberIds,children,token:protocol.token,generation:protocol.generation,instruction:'The user saved this configuration. Use registered direct children and this configVersion for future task-create admission. Prior Tasks retain their versions. Do not create sessions or bypass dependencies, write scopes, host checks or TEAM_DISPATCH_PERMIT. Confirm incorporation with native task-create --spec JSON --run your actual Run --json, protocol team-questions/v1, kind roster-ack, workId, token, generation, appQuestionId, deltaId and configVersion. Native input acceptance alone is not your acknowledgement.'});
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
