// Business tasks are scoped to their owning manager context. Historical rework
// stays immutable; only the latest admitted attempt supplies acceptance evidence.
export const latestBusinessAttempts=attempts=>[...new Map(attempts.map(a=>[JSON.stringify([a.workId,a.taskKey]),a])).values()];
// Recovery records an explicit user resolution without fabricating an answer.
export const isUnsentBlockedAnswer=a=>a.state==='blocked'&&a.processed==='unconfirmed'&&['nativeSend','receipt','deliveryReceipt','dispatchState','nativeAnswer','acknowledgement'].every(key=>!Object.hasOwn(a,key));
export function questionAnswerResolved(q,a){
 if(a.processed==='confirmed')return true;
 const latest=q.answers.at(-1);
 return q.sourceReport?.kind==='worker-report'&&isUnsentBlockedAnswer(a)&&latest!==a&&latest?.supplement===true&&latest.processed==='confirmed'&&['accepted','unknown','sending'].includes(latest.state)&&Boolean(latest.sessionDecision?.nativeTaskId&&latest.sessionDecision?.payloadHash||latest.nativeSend&&latest.acknowledgement?.nativeTaskId&&latest.acknowledgement?.payloadHash)&&latest.supersedesBlockedAnswers?.includes(a.id)===true;
}
export const questionNeedsProcessing=q=>!q.resolution&&(q.status==='pending'||q.status==='closed'&&!q.answers.some(a=>a.processed==='confirmed')||q.answers.some(a=>!questionAnswerResolved(q,a)));
