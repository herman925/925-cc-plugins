const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export function createWorkerBridge(raw, { nonce = () => crypto.randomUUID(), pollMs = 1000, spacingMs = 400 } = {}) {
  let connected = false;
  let previous = 0;
  let queue = Promise.resolve();
  const send = (...args) => {
    const result = queue.then(async () => { await pause(Math.max(0, previous + spacingMs - Date.now())); previous = Date.now(); return raw(...args); });
    queue = result.catch(() => {});
    return result;
  };
  const rpc = async (op, params = {}) => {
    const token = nonce();
    for (let attempt = 0; ; attempt++) {
      try { return await send('workspace.readContext', { teamWorker: { protocol: 1, nonce: token, commandId: 'team.control', args: { op, params } } }, { timeoutMs: 30000 }); }
      catch (error) {
        // A rate refusal precedes execution; transport ambiguity never qualifies for replay.
        if (error.code !== 'rate_limited' || attempt >= 3) throw error;
        await pause(1100);
      }
    }
  };
  return {
    async connect({ retry = false } = {}) {
      connected = false;
      const token = nonce();
      if (retry) await send('workspace.readContext', { teamWorker: { protocol: 1, nonce: token, commandId: 'team.initialise', args: {} } }, { timeoutMs: 30000 });
      const report = await send('workspace.readContext', { teamWorker: { protocol: 1, nonce: token, commandId: 'team.control', args: { op: 'ping' } } }, { timeoutMs: 30000 });
      if (report?.nonce !== token || !['linux', 'darwin', 'win32'].includes(report.platform) || !Number.isInteger(report.workerPid)) throw new Error('The local worker connection was not verified.');
      if (report.ready !== true) throw Object.assign(new Error(report.detail || 'Compatibility layer unavailable.'), { code: report.code, report });
      connected = true; return report;
    },
    async call(action, params) {
      if (!connected) throw new Error('Test the local worker connection first.');
      if (action === 'workspace.readContext') return rpc('context', params);
      if (['createTeam', 'updateRole', 'updateSettings', 'beginLaunch', 'capabilities', 'updateAgentPreferences'].includes(action)) return rpc(action, params);
      if (action === 'storage.get') return rpc('load');
      if (action !== 'terminal.createAgent') throw new Error('Unknown worker operation.');
      await rpc('start', params);
      const deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        const receipt = await rpc('receipt', { requestId: params.requestId });
        if (receipt?.status === 'created' && receipt.handle) return receipt;
        if (receipt?.status === 'unknown') throw new Error(receipt.error || 'Launch outcome is unknown. Inspect Orca before retrying.');
        await pause(pollMs);
      }
      throw new Error('Launch observation timed out. Inspect Orca before retrying.');
    }
  };
}
