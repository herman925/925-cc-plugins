import {questionAnswerResolved} from './acceptance.mjs';
// Only persisted application records can identify historical native controls.
// Native readers still reauthenticate their exact bytes; this is not a token allowlist.
export function nativeHistoryReader({db,readPrivate,readWork,questions}){
 const rows=prefix=>db.prepare('SELECT json FROM receipts WHERE id LIKE ? ORDER BY rowid').all(prefix+'%').map(r=>JSON.parse(r.json));
 return workId=>{
  const work=readWork(workId),history=work?.supervisorHistory??[],authorities=[],controls=[];
  for(const protocol of rows(`dispatch-protocol-history:${workId}:`))for(const [epoch,previous] of history.entries()){
   const owner=previous.instance,send=protocol.nativeSend;
   if(protocol.workId!==workId||previous.run.id!==work.run.id||previous.run.consumerGeneration!==protocol.generation||!owner)continue;
   if(owner.kind==='structured'?(send?.method!=='agentSession.send'||send.params.envelope.sessionId!==previous.binding.sessionId||send.params.envelope.expectedRuntimeFence!==owner.fence):(send?.method!=='terminal.send'||send.params.terminal!==previous.binding.handle))continue;
   const recovery=readPrivate(`wake:${previous.recoveryRequestId}`);
   const recoveryVerified=recovery?.state==='bound'&&recovery.memberId===work.supervisorMemberId&&recovery.oldBinding.requestId===previous.binding.requestId&&recovery.newInstance?.workId===workId&&recovery.newInstance.runId===work.run.id;
   authorities.push({epoch,protocol,owner,recoveryVerified});
  }
  for(const q of questions.listQuestions(workId)){
   const epoch=q.epoch??0,r=q.resolution,wake=r&&readPrivate(`wake:${r.recoveryRequestId}`),recovered=history.findIndex(h=>h.recoveryRequestId===r?.recoveryRequestId);
   const resolved=q.status==='closed'&&r?.kind==='superseded-by-recovery'&&r.by==='user'&&r.note?.trim()&&Number.isSafeInteger(epoch)&&epoch>=0&&epoch<(work.epoch??0)&&recovered>=epoch&&wake?.state==='bound'&&wake.memberId===work.supervisorMemberId&&wake.newInstance?.workId===workId;
   const answered=q.status==='answered'&&(q.answers.length?q.answers.every(a=>questionAnswerResolved(q,a)):Boolean(q.nativeQuestion?.answer));
   if(resolved||answered){if(q.resolution?.sessionDecision)controls.push({kind:'session-resolution',record:{proof:q.resolution.sessionDecision}});for(const a of q.answers.filter(a=>a.processed==='confirmed'&&a.sessionDecision))controls.push({kind:'session-answer',record:{proof:a.sessionDecision}});controls.push({kind:'question',record:q,epoch});for(const a of q.answers.filter(a=>a.processed==='confirmed'&&a.acknowledgement))controls.push({kind:'answer-ack',record:q,answer:a});}
  }
  for(const r of rows('staffing-request:').filter(r=>r.result?.workId===workId&&r.sessionDecision))controls.push({kind:'staffing-decision',record:{proof:r.sessionDecision}});
  for(const e of rows('question-event:').filter(e=>e.workId===workId&&e.kind==='TEAM_SESSION_DECISION_RESULT'&&e.data?.status==='rejected'&&e.data.proof))controls.push({kind:e.data.proof.spec.kind,record:{proof:e.data.proof}});
  for(const d of rows('delivery:').filter(d=>d.workId===workId&&['superseded','changes_requested','accepted'].includes(d.status)))controls.push({kind:'delivery',record:d,epoch:d.epoch??0});
  for(const p of rows('staffing-proposal:').filter(p=>p.contextId===workId&&['approved','rejected'].includes(p.status)&&p.decision?.from==='user'))controls.push({kind:'staffing-proposal',record:p});
  for(const d of rows('roster-delta:').filter(d=>d.contextId===workId&&d.processed==='confirmed'&&d.acknowledgement))controls.push({kind:'roster-ack',record:d});
  for(const c of rows('collaboration:').filter(c=>c.workId===workId))controls.push({kind:'collaboration-directive',record:c});
  for(const m of rows('team-message:').filter(m=>m.workId===workId&&m.controlProof))controls.push({kind:'message-evidence',record:m});
  for(const w of rows('wake:').filter(w=>w.state==='bound'&&w.handoff?.workId===workId&&w.handoff.nativeTaskId))controls.push({kind:'recovery-handoff',record:w.handoff});
  const withdrawals=rows('intent-withdrawal:').filter(row=>row.workId===workId);
  // Only an already-recorded withdrawal gets a frozen configuration/archived authority.
  // Native readers still recheck all original bytes and receipts before discharging history.
  const withdrawalContexts=withdrawals.map(row=>{
   let original,result;try{original=JSON.parse(row.originalSpec);result=JSON.parse(row.result);}catch{return {nativeTaskId:row.nativeTaskId};}
   const team=Number.isSafeInteger(original.configVersion)?JSON.parse(db.prepare('SELECT json FROM team_versions WHERE team_id=? AND version=?').get(work.teamId,original.configVersion)?.json??'null'):null;
   return {nativeTaskId:row.nativeTaskId,epoch:row.epoch,team,authorities:authorities.filter(a=>a.recoveryVerified&&a.epoch===row.epoch&&a.protocol.token===result.token&&a.protocol.generation===row.generation)};
  });
  return {authorities,controls,withdrawals,withdrawalContexts};
 };
}
