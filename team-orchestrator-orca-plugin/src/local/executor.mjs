import { createHash } from 'node:crypto';
import { startupCommand } from './startup-command.mjs';
import { validateState } from '../team.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const KEY = 'team-definitions-v1';
export function createExecutor(host, cli) {
  const starts = new Map();
  const jobs = new Set();
  const get = async key => (await host.call('storage.get', { key }))?.value ?? null;
  const set = async (key, value) => host.call('storage.set', { key, value });
  async function workspaceRecord(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 4096) throw new Error('No verified desktop workspace selection.');
    const selector = workspaceId.startsWith('folder:') ? workspaceId : `id:${workspaceId}`;
    const result = await cli(['worktree', 'show', '--worktree', selector]);
    const workspace = result?.worktree;
    if (!workspace?.id) throw new Error('Open the intended workspace first; Orca returned no active workspace identity.');
    return workspace;
  }
  async function context(workspaceId) {
    const workspace = await workspaceRecord(workspaceId);
    return { displayName: workspace.displayName || workspace.branch || 'Workspace', branch: workspace.branch || '', workspaceKey: hash(workspace.id), nativeAgentLaunch: true };
  }
  function validateLaunch(value) {
    if (!value || !/^[a-zA-Z0-9-]{1,120}$/.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.workspaceKey) || !['codex', 'claude'].includes(value.agent) || typeof value.title !== 'string' || !value.title || value.title.length > 160 || typeof value.brief !== 'string' || !value.brief || value.brief.length > 16384) throw new Error('Invalid member launch request.');
    for (const field of ['model', 'effort']) if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field] || value[field].length > 120)) throw new Error('Invalid model or effort.');
    if (value.effort && (!value.model || !['low', 'medium', 'high', 'xhigh'].includes(value.effort))) throw new Error('Effort requires a model and a supported level.');
  }
  async function start(params, workspaceId) {
    validateLaunch(params);
    const fingerprint = hash(JSON.stringify(params));
    const active = starts.get(params.requestId);
    if (active) { if (active.fingerprint !== fingerprint) throw new Error('Request identity conflicts with an existing launch.'); return active.promise; }
    const promise = (async () => {
      const key = `launch:${params.requestId}`;
      const saved = await get(key);
      if (saved) {
        if (saved.fingerprint !== fingerprint) throw new Error('Request identity conflicts with an existing launch.');
        return { requestId: params.requestId, status: saved.status };
      }
      const workspace = await workspaceRecord(workspaceId);
      if (hash(workspace.id) !== params.workspaceKey) throw new Error('The active workspace changed. No new agent was launched.');
      const schema = await cli(['agent-context']);
      const commands = schema.commands ?? [];
      const modern = commands.some(value => value.command === 'agent launch');
      if (!modern && !commands.some(value => value.command === 'terminal create')) throw new Error('The local Orca CLI has no agent or terminal launcher.');
      const windowsPath = /^[a-z]:[\\/]|^\\\\/i.test(workspace.path ?? workspace.git?.path ?? '');
      const powershell = windowsPath || (process.platform === 'win32' && !workspace.executionHostId?.startsWith('ssh:') && !(workspace.path ?? workspace.git?.path ?? '').startsWith('/'));
      if (!modern && powershell && !commands.find(value => value.command === 'terminal create')?.flags?.includes('shell')) throw new Error('This Orca CLI cannot select the Windows shell safely.');
      const command = modern ? null : startupCommand(params, powershell ? 'powershell' : 'posix');
      await set(key, { fingerprint, status: 'starting' });
      const job = run(key, fingerprint, params, workspaceId.startsWith('folder:') ? workspaceId : `id:${workspaceId}`, { command, powershell });
      jobs.add(job); job.finally(() => jobs.delete(job)).catch(() => {});
      return { requestId: params.requestId, status: 'starting' };
    })();
    starts.set(params.requestId, { fingerprint, promise });
    try { return await promise; } catch (error) { starts.delete(params.requestId); throw error; }
  }
  async function run(key, fingerprint, params, selector, { command, powershell }) {
    let record = { fingerprint, status: 'unknown' };
    try {
      let argv = ['agent', 'launch', '--agent', params.agent, '--worktree', selector, '--prompt', params.brief];
      if (params.model) argv.push('--model', params.model);
      if (params.effort) argv.push('--effort', params.effort);
      if (command) argv = ['terminal', 'create', '--worktree', selector, '--title', params.title, '--command', command, ...(powershell ? ['--shell', 'powershell.exe'] : [])];
      const result = await cli(argv);
      const handle = command ? result?.terminal?.handle : result?.outcome?.handle;
      if (!handle) throw new Error('Orca returned no agent handle; inspect the workspace before retrying.');
      const warning = result.warning || result.terminal?.warning;
      record = { fingerprint, status: 'naming', handle, title: params.title, briefAccepted: Boolean(command) || ['handed-to-terminal', 'journaled'].includes(result.prompt?.outcome), ...(result.outcome?.sessionId ? { sessionId: result.outcome?.sessionId } : {}), ...(warning ? { warning } : {}) };
      await set(key, record); // Save the actual handle before any naming/inspection follow-up.
      await cli(['terminal', 'rename', '--terminal', record.handle, '--title', params.title]);
      const shown = await cli(['terminal', 'show', '--terminal', record.handle]);
      record.title = shown.terminal?.title || params.title;
      if (shown.terminal?.executionHostId) record.executionHostId = shown.terminal.executionHostId;
      if (!record.briefAccepted) record.warning = 'Agent created, but Orca did not confirm role briefing delivery. Inspect its tab.';
    } catch (error) {
      if (record.handle) record.warning = error.message.slice(0, 1000);
      else record.error = error.message.slice(0, 1000);
    }
    if (record.handle) record.status = 'created';
    await set(key, record);
  }
  return {
    async execute({ op, params = {}, workspaceId } = {}) {
      if (op === 'context') return context(workspaceId);
      if (op === 'load') {
        const state = validateState(await get(KEY));
        for (const team of state.teams) if (team.launch?.native) for (const member of team.members) {
          const receipt = await get(`launch:${team.id}-${member.id}`);
          if (receipt?.handle) team.launch.members[member.id] = { status: 'created', terminalId: receipt.handle, title: receipt.title, briefAccepted: receipt.briefAccepted, executionHostId: receipt.executionHostId ?? null, ...(receipt.status === 'naming' ? { error: 'Tab created; naming observation was interrupted. Inspect that tab.' } : receipt.warning ? { error: receipt.warning } : {}) };
        }
        return { value: validateState(state) };
      }
      if (op === 'save') { await set(KEY, validateState(params.value)); return { ok: true }; }
      if (op === 'start') return start(params, workspaceId);
      if (op === 'receipt') {
        if (!/^[a-zA-Z0-9-]{1,120}$/.test(params.requestId)) throw new Error('Invalid request identity.');
        return get(`launch:${params.requestId}`);
      }
      throw new Error('Unknown team operation.');
    },
    async settle() { await Promise.allSettled([...jobs]); }
  };
}
