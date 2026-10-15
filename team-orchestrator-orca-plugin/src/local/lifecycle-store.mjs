import { initialMembers } from '../launch.mjs';
import { randomUUID,createHash } from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw Error(message);};
const boundedHandoff=h=>({...h,summary:h.summary.slice(0,2000),evidenceRefs:h.evidenceRefs.slice(0,10).map(r=>r.slice(0,160)),truncated:h.summary.length>2000||h.evidenceRefs.length>10||h.evidenceRefs.some(r=>r.length>160)});
export function lifecycleStore({db,readPrivate,putPrivate,readWork,persistWork,listDispatches,listGoals,questions,atomic,readSnapshot,write}){
 const deliveries=id=>db.prepare("SELECT json FROM receipts WHERE id LIKE 'delivery:%' ORDER BY rowid").all().map(r=>JSON.parse(r.json)).filter(r=>r.workId===id);
 const current=id=>deliveries(id).at(-1);
 const blockers=work=>{
  const reasons=[];
  if(db.prepare("SELECT json FROM receipts WHERE id LIKE 'dispatch-queue:%'").all().some(r=>JSON.parse(r.json).workId===work.id))reasons.push('Queued member tasks await admission');
  const latest=new Map(listDispatches(work.id).map(a=>[a.taskKey,a]));
  for(const expected of work.recipientBindings??[work.binding])if(readPrivate(`operation:${expected.requestId}`)?.status!=='created')reasons.push('Preparation member launch remains unknown');
  for(const a of latest.values())if(a.status!=='accepted')reasons.push(`Task ${a.taskKey}: ${a.status}`);
  for(const q of questions.listQuestions(work.id))if(q.status==='pending'||q.status==='closed'&&!q.answers.some(a=>a.processed==='confirmed')||q.answers.some(a=>a.processed!=='confirmed'))reasons.push(`User decision ${q.id} awaits processing`);
  if(work.run.state!=='verified')reasons.push('Supervisor Run authority is unverified');
  return reasons;
 };
 const api={
  workClosureBlockers:workId=>blockers(readWork(workId)),
  deliveryProjection(workId){const d=current(workId);return d?{delivery:{...d,proof:undefined},closureBlockers:blockers(readWork(workId))}:{};},
  recordDelivery(workId,proposal){return atomic(()=>{
   const w=readWork(workId);if(!w||w.status==='completed')return null;
   const existing=deliveries(workId).find(d=>d.id===proposal.id);if(existing){if(existing.proof.payloadHash!==proposal.proof.payloadHash)fail('Delivery identity conflicts.');return existing;}
   const previous=current(workId);
   if((proposal.previousDeliveryId??null)!==(previous?.id??null))fail('Delivery must reference the current delivery revision.');
   if(proposal.generation!==w.run.consumerGeneration)fail('Delivery Run generation changed.');
   const d={...proposal,workId,revision:(previous?.revision??0)+1,status:'pending',createdAt:new Date().toISOString()};
   putPrivate(`delivery:${workId}:${d.id}`,d);w.status='awaiting_acceptance';w.version++;persistWork(w);return d;
  });},
  readWorkDecision(requestId){return readPrivate(`work-decision:${requestId}`);},
  decideWork(input){return atomic(()=>{
   if(!input||!/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId)||!['accept','rework'].includes(input.decision)||Object.keys(input).some(k=>!['requestId','workId','deliveryId','expectedWorkVersion','decision','feedback'].includes(k)))fail('Invalid user delivery decision.');
   const key=`work-decision:${input.requestId}`,fingerprint=digest(input),prior=readPrivate(key);
   if(prior){if(prior.fingerprint!==fingerprint)fail('User decision identity conflicts.');return prior;}
   const w=readWork(input.workId),d=current(input.workId);
   if(!w||w.version!==input.expectedWorkVersion||w.status!=='awaiting_acceptance'||d?.id!==input.deliveryId||d.status!=='pending')fail('Delivery changed or was superseded. Reload before deciding.');
   if(input.decision==='rework'&&(typeof input.feedback!=='string'||!input.feedback.trim()||input.feedback.length>8000))fail('Describe the requested corrections (1–8000 characters).');
   if(input.decision==='accept'){
    const reasons=blockers(w);if(reasons.length)fail('Required work remains: '+reasons.join('; '));
    const latest=[...new Map(listDispatches(w.id).map(a=>[a.taskKey,a])).values()];
    if(latest.some(a=>!d.attemptIds.includes(a.id)||!d.evidenceRefs.includes(a.evidenceId)))fail('Delivery omits required accepted task evidence.');
   }
   const event={...input,fingerprint,recordedAt:new Date().toISOString(),input:{state:input.decision==='rework'?'not_sent':'none'}};
   d.status=input.decision==='accept'?'accepted':'changes_requested';putPrivate(`delivery:${w.id}:${d.id}`,d);
   w.status=input.decision==='accept'?'completed':'active';w.version++;
   if(input.decision==='accept'){
    if(readPrivate(`active-work:${w.teamId}`)?.workId!==w.id)fail('Active TeamWork pointer changed.');
    const state=readSnapshot(),team=state.teams.find(t=>t.id===w.teamId);
    const expectedRecipients=w.recipientBindings??[w.binding];
    if(Object.values(team.launch?.members??{}).some(r=>!expectedRecipients.some(e=>e.requestId===r.requestId)))fail('Current member binding changed during Work; reconcile before closure.');
    for(const expected of expectedRecipients){
     const pointer=readPrivate(`binding:${expected.memberId}`);
     if(pointer?.requestId!==expected.requestId||(pointer.instanceGeneration??1)!==(expected.instanceGeneration??1))fail('Current member binding changed; closure must not retire a replacement.');
     db.prepare('DELETE FROM receipts WHERE id=?').run(`binding:${expected.memberId}`);putPrivate(`binding-generation:${expected.memberId}`,{generation:expected.instanceGeneration??1});
     if(team.launch?.members?.[expected.memberId]?.requestId===expected.requestId)delete team.launch.members[expected.memberId];
    }
    for(const a of listDispatches(w.id)){
     if(readPrivate(`dispatch-member:${a.memberId}`)?.id===a.id)db.prepare('DELETE FROM receipts WHERE id=?').run(`dispatch-member:${a.memberId}`);
     if(readPrivate(`dispatch-binding:${a.memberId}`)?.attemptId===a.id)db.prepare('DELETE FROM receipts WHERE id=?').run(`dispatch-binding:${a.memberId}`);
    }
    db.prepare('DELETE FROM receipts WHERE id=?').run(`active-work:${w.teamId}`);
    w.closedAt=event.recordedAt;w.handoff={summary:d.summary,evidenceRefs:d.evidenceRefs,deliveryId:d.id};
    const goal=listGoals(w.teamId).find(g=>g.status==='queued');
    if(goal){goal.status='reserved';goal.previousWorkId=w.id;goal.launchRequests=Object.fromEntries(initialMembers(team).map(m=>[m.id,randomUUID()]));goal.workRequestId=randomUUID();goal.configVersion=team.configVersion;goal.supervisorMemberId=team.members.find(m=>m.boss===null).id;goal.handoff=boundedHandoff(w.handoff);putPrivate(`goal:${goal.id}`,goal);putPrivate(`next-goal:${w.teamId}`,{goalId:goal.id});event.nextGoalId=goal.id;}
    state.revision++;write(state);
   }
   persistWork(w);putPrivate(key,event);return event;
  });},
  updateWorkDecision(requestId,patch){return atomic(()=>{const event=readPrivate(`work-decision:${requestId}`);if(!event)fail('Saved decision not found.');Object.assign(event,patch);putPrivate(`work-decision:${requestId}`,event);return event;});},
  reserveNextGoal(teamId){return atomic(()=>{
   const prior=api.nextGoal(teamId);if(prior)return prior;
   if(readPrivate(`active-work:${teamId}`))return null;
   const state=readSnapshot(),team=state.teams.find(t=>t.id===teamId),goal=listGoals(teamId).find(g=>g.status==='queued');
   if(!team||!goal)return null;
   if(Object.keys(team.launch?.members??{}).length)fail('Existing preparation bindings must be resolved before a fresh queued goal.');
   const old=db.prepare("SELECT json FROM receipts WHERE id LIKE 'work:%' ORDER BY rowid DESC").all().map(r=>JSON.parse(r.json)).find(w=>w.teamId===teamId&&w.status==='completed');
   if(!old)fail('Submit the first total objective with its prepared supervisor before advancing later goals.');
   Object.assign(goal,{status:'reserved',previousWorkId:old.id,handoff:boundedHandoff(old.handoff),launchRequests:Object.fromEntries(initialMembers(team).map(m=>[m.id,randomUUID()])),workRequestId:randomUUID(),configVersion:team.configVersion,supervisorMemberId:team.members.find(m=>m.boss===null).id});
   putPrivate(`goal:${goal.id}`,goal);putPrivate(`next-goal:${teamId}`,{goalId:goal.id});state.revision++;write(state);return goal;
  });},
  nextGoal(teamId){const p=readPrivate(`next-goal:${teamId}`);return p?readPrivate(`goal:${p.goalId}`):null;},
 };
 return api;
}
