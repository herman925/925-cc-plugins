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
   authorities.push({epoch,protocol,owner});
  }
  for(const q of questions.listQuestions(workId)){
   const epoch=q.epoch??0,r=q.resolution,wake=r&&readPrivate(`wake:${r.recoveryRequestId}`),recovered=history.findIndex(h=>h.recoveryRequestId===r?.recoveryRequestId);
   const resolved=q.status==='closed'&&r?.kind==='superseded-by-recovery'&&r.by==='user'&&r.note?.trim()&&Number.isSafeInteger(epoch)&&epoch>=0&&epoch<(work.epoch??0)&&recovered>=epoch&&wake?.state==='bound'&&wake.memberId===work.supervisorMemberId&&wake.newInstance?.workId===workId;
   const answered=q.status==='answered'&&(q.answers.length?q.answers.every(a=>a.processed==='confirmed'):Boolean(q.nativeQuestion?.answer));
   if(resolved||answered){controls.push({kind:'question',record:q,epoch});for(const a of q.answers.filter(a=>a.processed==='confirmed'&&a.acknowledgement))controls.push({kind:'answer-ack',record:q,answer:a});}
  }
  for(const d of rows('delivery:').filter(d=>d.workId===workId&&['superseded','changes_requested','accepted'].includes(d.status)))controls.push({kind:'delivery',record:d,epoch:d.epoch??0});
  for(const p of rows('staffing-proposal:').filter(p=>p.contextId===workId&&['approved','rejected'].includes(p.status)&&p.decision?.from==='user'))controls.push({kind:'staffing-proposal',record:p});
  for(const d of rows('roster-delta:').filter(d=>d.contextId===workId&&d.processed==='confirmed'&&d.acknowledgement))controls.push({kind:'roster-ack',record:d});
  for(const c of rows('collaboration:').filter(c=>c.workId===workId))controls.push({kind:'collaboration-directive',record:c});
  for(const m of rows('team-message:').filter(m=>m.workId===workId&&m.controlProof))controls.push({kind:'message-evidence',record:m});
  for(const w of rows('wake:').filter(w=>w.state==='bound'&&w.handoff?.workId===workId&&w.handoff.nativeTaskId))controls.push({kind:'recovery-handoff',record:w.handoff});
  return {authorities,controls};
 };
}
