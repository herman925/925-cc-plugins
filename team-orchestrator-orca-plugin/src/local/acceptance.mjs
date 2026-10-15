// Business tasks are scoped to their owning manager context. Historical rework
// stays immutable; only the latest admitted attempt supplies acceptance evidence.
export const latestBusinessAttempts=attempts=>[...new Map(attempts.map(a=>[JSON.stringify([a.workId,a.taskKey]),a])).values()];
// Recovery records an explicit user resolution without fabricating an answer.
export const questionNeedsProcessing=q=>!q.resolution&&(q.status==='pending'||q.status==='closed'&&!q.answers.some(a=>a.processed==='confirmed')||q.answers.some(a=>a.processed!=='confirmed'));
