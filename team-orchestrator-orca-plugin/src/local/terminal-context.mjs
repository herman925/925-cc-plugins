import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { readStatuslineContext, registerStatuslineBinding, statuslineBinding } from './claude-context.mjs';

const HEAD_BYTES = 256 * 1024, TAIL_BYTES = 512 * 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const samePath = (a, b) => typeof a === 'string' && typeof b === 'string' && isAbsolute(a) && isAbsolute(b) && resolve(a) === resolve(b);
function records(text, partialStart = false) {
  const lines = text.split('\n');
  if (partialStart) lines.shift();
  // A live provider can be halfway through writing the final JSON record.
  lines.pop();
  return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

export function transcriptContext({ agent, sessionId, cwd, head, tail, partialStart = false }) {
  const rows = records(tail, partialStart);
  if (agent === 'codex') {
    const meta = records(head).find(row => row.type === 'session_meta')?.payload;
    if (meta?.id !== sessionId || !samePath(meta.cwd, cwd)) return null;
    for (const row of rows.reverse()) {
      if (row.type === 'compacted' || row.type === 'event_msg' && row.payload?.type === 'context_compacted') return null;
      if (row.type !== 'event_msg' || row.payload?.type !== 'token_count' || !row.payload.info) continue;
      const info = row.payload.info, used = info.last_token_usage?.total_tokens, limit = info.model_context_window;
      // Codex's last total is its context reading (also restated after compaction).
      // total_token_usage is cumulative billing and must never be used here.
      if (!count(used) || used === 0) return null;
      return { used, limit: count(limit) && limit > 0 ? limit : null, percent: count(limit) && limit > 0 ? 100 * used / limit : null, estimated: false, capturedAt: row.timestamp, source: 'provider-transcript' };
    }
  } else if (agent === 'claude') {
    for (const row of rows.reverse()) {
      if (row.isSidechain || row.sessionId !== sessionId || !samePath(row.cwd, cwd)) continue;
      if (row.type === 'system' && row.subtype === 'compact_boundary') return null;
      if (row.type !== 'assistant' || row.message?.model === '<synthetic>') continue;
      const usage = row.message?.usage;
      if (!usage) continue;
      const parts = [usage.input_tokens, usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0];
      if (!parts.every(count)) return null;
      const used = parts.reduce((sum, value) => sum + value, 0);
      if (!count(used)) return null;
      // No model-name capacity guesses: Claude's response usage does not report a window.
      return { used, limit: null, percent: null, estimated: true, capturedAt: row.timestamp, source: 'provider-transcript' };
    }
  }
  return null;
}

export function terminalProviderSession(snapshot, shown, agent) {
  if (snapshot?.worktree !== shown.worktreeId) return null;
  const rows = snapshot.tabs?.filter(tab => tab.type === 'terminal' && tab.parentTabId === shown.tabId && tab.leafId === shown.leafId);
  if (rows?.length !== 1) return null;
  const tab = rows[0], status = tab.agentStatus, provider = status?.providerSession;
  if (tab.ptyId !== shown.ptyId || tab.incarnationId !== shown.incarnationId || status?.terminalHandle !== shown.handle || status.agentType !== agent || status.restoredUnconfirmed || status.sessionBoundary || provider?.key !== 'session_id' || typeof provider.id !== 'string' || !provider.id || typeof provider.transcriptPath !== 'string' || !isAbsolute(provider.transcriptPath) || !provider.transcriptPath.endsWith('.jsonl')) return null;
  return { sessionId: provider.id, path: provider.transcriptPath };
}

export function createTerminalContextReader() {
  const cache = new Map();
  // `onProvider` reports the verified provider session after the closing recheck, and never reports one whose read
  // threw: the store guard certifies a session that the terminal still agrees with, not a context reading.
  return async ({ rpc, shown, agent, scope, snapshots, contextDirectory, statuslineEnabled=false, onProvider }) => {
    // Paths belong to the execution host. Never read a remote path on this PC.
    if (scope.executionHostId !== 'local' || !['codex', 'claude'].includes(agent)) return null;
    const params = { worktree: scope.workspaceId.startsWith('folder:') ? scope.workspaceId : `id:${scope.workspaceId}` };
    if (!snapshots.has(scope.workspaceId)) snapshots.set(scope.workspaceId, rpc('session.tabs.list', params));
    const provider = terminalProviderSession(await snapshots.get(scope.workspaceId), shown, agent);
    if (!provider) return null;
    if(agent==='claude'&&contextDirectory)await registerStatuslineBinding(contextDirectory,statuslineBinding(provider,shown)).catch(()=>{});
    const file = await open(provider.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let context,transcriptStat;
    try {
      const before = await file.stat();
      transcriptStat=before;
      if (!before.isFile()) return null;
      const key = JSON.stringify([agent, provider.sessionId, provider.path, shown.worktreePath]);
      const stamp = [before.dev, before.ino, before.size, before.mtimeMs, before.ctimeMs].join(':');
      const previous = cache.get(key);
      if (previous?.stamp === stamp) context = previous.context;
      else {
        const read = async (position, length) => {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await file.read(buffer, 0, length, position);
          return buffer.subarray(0, bytesRead).toString('utf8');
        };
        const start = Math.max(0, before.size - TAIL_BYTES);
        const tail = await read(start, Math.min(before.size, TAIL_BYTES));
        const head = agent === 'codex' ? start === 0 ? tail : await read(0, Math.min(before.size, HEAD_BYTES)) : '';
        const after = await file.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) return null;
        context = transcriptContext({ agent, sessionId: provider.sessionId, cwd: shown.worktreePath, head, tail, partialStart: start > 0 });
        if (cache.size >= 256) cache.clear();
        cache.set(key, { stamp, context });
      }
    } finally { await file.close(); }
    if(agent==='claude'&&statuslineEnabled){
      const reported=await readStatuslineContext({directory:contextDirectory,provider,shown,transcript:context,transcriptStat});
      if(reported!==undefined)context=reported;
    }
    // A provider can reset/resume inside the same PTY; recheck the conversation too.
    const current = terminalProviderSession(await rpc('session.tabs.list', params), shown, agent);
    if (current?.sessionId !== provider.sessionId || current.path !== provider.path) return null;
    // Only a provider that survived the recheck is reported, so a reset inside the PTY never certifies an old session.
    if (onProvider) onProvider(provider);
    return context;
  };
}
