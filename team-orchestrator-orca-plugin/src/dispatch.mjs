export const DISPATCH_STATUSES = ['admitted','awaiting_start','running','unknown','pending_acceptance','accepted','rework','rejected'];
const text = (value, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit;
export function validateDispatch(row) {
 if (!row || row.format !== 'team-dispatch-v1' || !['id','workId','teamId','memberId','supervisorMemberId','nativeTaskId','taskKey','attemptId'].every(key=>text(row[key],256)) || !DISPATCH_STATUSES.includes(row.status) || !Number.isSafeInteger(row.version) || row.version<1 || !Number.isSafeInteger(row.configVersion) || !Number.isSafeInteger(row.roleVersion) || !text(row.instruction,8000) || !text(row.token,256) || !Number.isSafeInteger(row.generation) || row.generation<1 || !row.startParams || !['not_sent','sending','accepted','unknown'].includes(row.permit?.state)) throw Error('Saved Dispatch evidence is damaged; preserve the original data.');
 if(!['committed','unadmitted'].includes(row.admission)||row.startParams.task!==row.nativeTaskId||row.startParams.run!==row.runId||!text(row.runId,256)||!row.scope?.workspaceId)throw Error('Saved Dispatch evidence is damaged; preserve the original data.');
 if(Object.keys(row.startParams).some(key=>!['task','run','worktree','agent','model','effort','terminal'].includes(key))||(row.startParams.terminal?(!row.reuse||row.reuse.terminal!==row.startParams.terminal||['agent','model','effort'].some(key=>row.startParams[key]!==undefined)):!['codex','claude'].includes(row.startParams.agent))||row.startParams.worktree!==(row.scope.workspaceId.startsWith('folder:')?row.scope.workspaceId:`id:${row.scope.workspaceId}`))throw Error('Saved Dispatch launch input is damaged; preserve the original data.');
 if(['running','pending_acceptance','accepted','rework'].includes(row.status)&&(!text(row.dispatchId,256)||!row.binding||!text(row.binding.handle)||(!text(row.binding.incarnationId)&&!(row.binding.kind==='structured'&&text(row.binding.sessionId)&&Number.isSafeInteger(row.binding.sessionFence)&&row.binding.sessionFence>0))))throw Error('Saved Dispatch binding is damaged; preserve the original data.');
 if(['pending_acceptance','accepted','rework'].includes(row.status)&&(!['succeeded','failed'].includes(row.outcome)||!text(row.evidenceId,256)||typeof row.result!=='string'))throw Error('Saved Dispatch completion evidence is damaged; preserve the original data.');
 if(row.dependencies!==undefined&&(!Array.isArray(row.dependencies)||row.dependencies.some(key=>!text(key,120))))throw Error('Saved task dependencies are damaged; preserve the original data.');
 if(['accepted','rework'].includes(row.status)&&(!row.review||row.review.decision!==(row.status==='accepted'?'accept':'rework')||!text(row.review.requestId)||!text(row.review.payloadHash)||!text(row.review.recordedAt)||row.review.reviewerMemberId!==row.supervisorMemberId||!Array.isArray(row.review.evidenceRefs)||!row.review.evidenceRefs?.includes(row.evidenceId)||!text(row.review.summary,8000)))throw Error('Saved supervisor review is damaged; preserve the original data.');
 return row;
}
export function validateDispatchProtocol(row) {
 if(!row||row.format!=='team-dispatch-protocol-v1'||!text(row.workId,120)||!text(row.token,120)||!Number.isSafeInteger(row.generation)||row.generation<1||!Number.isSafeInteger(row.version)||row.version<1||!['not_sent','sending','accepted','unknown','fenced'].includes(row.state)||(row.state==='not_sent'&&row.nativeSend)||(['sending','accepted','unknown'].includes(row.state)&&!row.nativeSend))throw Error('Saved dispatch protocol is damaged; preserve the original data.');
 return row;
}
export function publicDispatch(row) {
 validateDispatch(row);
 const keys=['id','nativeTaskId','taskKey','memberId','memberName','supervisorMemberId','configVersion','roleVersion','attemptId','status','admission','instruction','dispatchId','outcome','result','evidenceId','detail','createdAt','review','dependencies','previousAttemptId'];
 return Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
}
export function publicDispatchProtocol(row) { return row ? {state:row.state,generation:row.generation,...(row.detail?{detail:row.detail}:{})} : undefined; }
