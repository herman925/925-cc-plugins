export const DISPATCH_STATUSES = ['admitted','awaiting_start','running','unknown','pending_acceptance','rejected'];
const text = (value, limit = 4096) => typeof value === 'string' && value.length > 0 && value.length <= limit;
export function validateDispatch(row) {
 if (!row || row.format !== 'team-dispatch-v1' || !['id','workId','teamId','memberId','supervisorMemberId','nativeTaskId','taskKey','attemptId'].every(key=>text(row[key],256)) || !DISPATCH_STATUSES.includes(row.status) || !Number.isSafeInteger(row.version) || row.version<1 || !Number.isSafeInteger(row.configVersion) || !Number.isSafeInteger(row.roleVersion) || !text(row.instruction,8000) || !text(row.token,256) || !Number.isSafeInteger(row.generation) || row.generation<1 || !row.startParams || !['not_sent','sending','accepted','unknown'].includes(row.permit?.state)) throw Error('Saved Dispatch evidence is damaged; preserve the original data.');
 return row;
}
export function publicDispatch(row) {
 validateDispatch(row);
 const keys=['id','nativeTaskId','taskKey','memberId','memberName','supervisorMemberId','configVersion','roleVersion','attemptId','status','instruction','dispatchId','outcome','result','evidenceId','detail','createdAt'];
 return Object.fromEntries(keys.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
}
export function publicDispatchProtocol(row) { return row ? {state:row.state,generation:row.generation,...(row.detail?{detail:row.detail}:{})} : undefined; }
