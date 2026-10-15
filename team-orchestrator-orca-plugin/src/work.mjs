export function workInput(input) {
 if (!input || Object.keys(input).some(key=>!['teamId','requestId','expectedRevision','objective'].includes(key)) || typeof input.teamId!=='string' || !/^[a-zA-Z0-9-]{1,120}$/.test(input.requestId) || !Number.isSafeInteger(input.expectedRevision) || typeof input.objective!=='string' || !input.objective.trim() || input.objective.length>8000) throw Error('Choose a saved team and a total objective of 1–8000 characters.');
 return input;
}
export function validateWork(work) {
 const text=(value,max=4096)=>typeof value==='string'&&value.length>0&&value.length<=max;
 const fail=()=>{throw Error('Saved TeamWork evidence is damaged; existing data was preserved.');};
 if(!work||work.format!=='team-work-v1'||!text(work.id,120)||!text(work.teamId,120)||!text(work.requestId,120)||!text(work.supervisorMemberId,120)||!text(work.objective,8000)||!text(work.protocolToken,120)||!Number.isSafeInteger(work.version)||work.version<1||!Number.isSafeInteger(work.configVersion)||work.configVersion<1||!Number.isSafeInteger(work.roleVersion)||work.roleVersion<1||!['preparing','awaiting_input','awaiting_run','active','needs_attention','awaiting_acceptance','completed'].includes(work.status))fail();
 if(work.parent&&(!text(work.teamWorkId,120)||work.teamWorkId===work.id||!['workId','runId','taskId','dispatchId','attemptId'].every(k=>text(work.parent[k],256))||!Number.isSafeInteger(work.parent.generation)||work.parent.generation<1||(work.binding?.sourceAttemptId??work.binding?.originAttemptId)!==work.parent.attemptId))fail();
 const scope=work.scope,binding=work.binding;
 if(!scope||!text(scope.workspaceId)||!text(scope.displayName)||!['git','folder'].includes(scope.kind)||! /^(local|ssh:[^\s|]+)$/.test(scope.executionHostId)||! /^[a-f0-9]{64}$/.test(scope.workspaceKey)||!binding||binding.status!=='created'||binding.teamId!==work.teamId||binding.memberId!==work.supervisorMemberId||!text(binding.requestId,120)||!text(binding.runtimeId,256)||!['structured','terminal'].includes(binding.kind)||!text(binding.handle)||binding.scope?.workspaceId!==scope.workspaceId||binding.scope?.executionHostId!==scope.executionHostId||binding.scope?.workspaceKey!==scope.workspaceKey||(binding.kind==='structured'&&!text(binding.sessionId)))fail();
 if(work.nativeObjective!==`TeamWork ${work.id} ${work.protocolToken}\n${work.objective}`||!['not_sent','sending','accepted','queued','unknown','rejected'].includes(work.input?.state)||!['unknown','observed'].includes(work.processing?.state)||!['unverified','verified','fenced'].includes(work.run?.state))fail();
 if(work.run.state==='verified'&&(!text(work.run.id,256)||!Number.isSafeInteger(work.run.consumerGeneration)||work.run.consumerGeneration<1))fail();
 if(work.input.state!=='not_sent'&&(!work.nativeSend||!['agentSession.send','terminal.send'].includes(work.nativeSend.method)||!work.nativeSend.params))fail();
 if(work.nativeSend){
  const request=work.nativeSend.params,instance=work.instance;
  if(!instance||instance.kind!==binding.kind)fail();
  if(binding.kind==='structured'){
   if(work.nativeSend.method!=='agentSession.send'||request.envelope?.sessionId!==binding.sessionId||instance.liveSessionId!==binding.sessionId||!text(instance.sessionId)||request.envelope?.expectedRuntimeFence!==instance.fence||!Number.isSafeInteger(instance.fence)||instance.fence<1||! /^[0-9]{13}-[0-9a-f]{32}$/.test(request.envelope?.clientOperationId)||! /^[a-f0-9]{64}$/.test(request.envelope?.payloadFingerprint)||request.body?.kind!=='message'||request.body?.role!=='user'||!Array.isArray(request.body.blocks)||request.body.blocks.length!==1||request.body.blocks[0].type!=='text'||!text(request.body.blocks[0].text,30000))fail();
  }else if(work.nativeSend.method!=='terminal.send'||request.terminal!==binding.handle||instance.handle!==binding.handle||instance.paneKey!==binding.paneKey||!text(instance.incarnationId)||request.agentPrompt!==true||request.enter!==true||!text(request.text,30000)||! /^[0-9a-f-]{36}$/.test(work.nativeSend.envelope?.orchestrationRequestId))fail();
 }

 if(work.currentSupervisor){
  const current=work.currentSupervisor;if(!Number.isSafeInteger(current.epoch)||current.epoch<1||!text(current.recoveryRequestId,120))fail();
  validateWork({...work,...current,currentSupervisor:undefined,nativeSend:current.nativeSend});
 }
 return work;
}
export function publicWork(work) {
 validateWork(work);
 const fields=['id','teamId','supervisorMemberId','objective','configVersion','roleVersion','createdAt','version','epoch','recoveryRequestId','status','processing','run','snapshot','error','closedAt','handoff','historyPruned'];
 return { ...Object.fromEntries(fields.filter(key=>work[key]!==undefined).map(key=>[key,work[key]])), scope:{displayName:work.scope.displayName,kind:work.scope.kind,executionHostId:work.scope.executionHostId},input:{state:work.input.state,...(work.input.source?{source:work.input.source}:{}),...(work.input.dispatchState?{dispatchState:work.input.dispatchState}:{}),...(work.input.queued?{queued:work.input.queued}:{}),...(work.input.messageId?{messageId:work.input.messageId}:{}),...(work.input.detail?{detail:work.input.detail}:{})} };
}
