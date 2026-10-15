import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value ?? null) : Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : `{${Object.entries(value).filter(([, entry]) => entry !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`;
// Pinned shared/agent-launch-operation.ts + agent-session-mutation-envelope.ts.
export function nativeLaunchFingerprint(input) {
  return createHash('sha256').update(canonical(Object.fromEntries([['method', 'agent.launch'], ...['agent', 'target', 'prompt', 'sessionOptions', 'reuseTerminal', 'agentArgs', 'cwd', 'paneKey', 'sessionId'].map(key => [key, input[key]])]))).digest('hex');
}
export async function readNativeLaunchLedger(userData, request) {
  let db;
  try {
    if (!isAbsolute(userData || '')) throw Error();
    const profile = await realpath(userData), file = await realpath(join(profile, 'agent-session-journal.db'));
    const rel = relative(profile, file);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw Error();
    const { DatabaseSync } = await import('node:sqlite');
    db = new DatabaseSync(file, { readOnly: true });
    if (db.prepare('PRAGMA user_version').get().user_version !== 4) throw Error();
    const callerKey = 'trusted-local:desktop';
    const stored = db.prepare('SELECT row_json FROM agent_session_operations WHERE operation_key=?').get(`${callerKey}\0${request.operationId}`);
    if (!stored) return { state: 'unknown', detail: 'Original native launch ledger row is absent; no launch was retried.' };
    if (typeof stored.row_json !== 'string' || stored.row_json.length > 262144) throw Error();
    const row = JSON.parse(stored.row_json), now = Date.now();
    if (row.callerKey !== callerKey || row.operationId !== request.operationId || row.fingerprint !== nativeLaunchFingerprint(request) || row.operationTimestamp !== Number(request.operationId.split('-')[0]) || !Number.isSafeInteger(row.recordedAt) || !Number.isSafeInteger(row.expiresAt) || row.recordedAt > now + 300000 || row.expiresAt <= now || row.expiresAt <= row.recordedAt) throw Error();
    if (row.outcome?.status === 'succeeded' && row.outcome.launch) return { state: 'succeeded', result: row.outcome.launch };
    if (row.outcome?.status === 'failed' && typeof row.outcome.code === 'string') return { state: 'failed', detail: `Native launch failed: ${row.outcome.code.slice(0, 200)}. The member remains reserved for explicit recovery.` };
    return { state: 'unknown', detail: 'Native launch remains pending or unknown; checking its ledger never starts another session.' };
  } catch { return { state: 'unknown', detail: 'Original native launch ledger is unavailable, expired or incompatible; no launch was retried.' }; }
  finally { db?.close(); }
}
