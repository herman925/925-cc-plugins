import { preferenceIssue } from '../capabilities.mjs';
import { timingSafeEqual } from 'node:crypto';
import { createHash, randomUUID } from 'node:crypto';
import { startupCommand } from './startup-command.mjs';
import { memberLaunch } from '../launch.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export function createExecutor(host, cli, { store, internalKey } = {}) {
  const selections = new Map();
  const observations = new Map(), capabilities = new Map(), latestObservation = new Map();
  const starts = new Map();
  const jobs = new Set();
  const get = async key => store.readReceipt(key);
  const set = async (key, value) => store.writeReceipt(key, value);
  async function workspaceRecord(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 4096) throw new Error('No verified desktop workspace selection.');
    const selector = workspaceId.startsWith('folder:') ? workspaceId : `id:${workspaceId}`;
    const result = await cli(['worktree', 'show', '--worktree', selector]);
    const workspace = result?.worktree;
    if (!workspace?.id || workspace.id !== workspaceId) throw new Error('Open the intended workspace first; Orca returned no active workspace identity.');
    return workspace;
  }
  function verifiedScope(workspace) {
    const executionHostId = workspace.hostId ?? workspace.identity?.executionHostId;
    if (typeof executionHostId !== 'string' || !/^(local|ssh:[^\s|]+)$/.test(executionHostId)) throw new Error('Orca did not verify a supported local or SSH execution host for this workspace.');
    return { workspaceId: workspace.id, executionHostId, kind: workspace.id.startsWith('folder:') ? 'folder' : 'git', displayName: workspace.displayName || workspace.branch || 'Workspace', branch: workspace.branch || '', workspaceKey: hash(JSON.stringify([workspace.id, executionHostId])) };
  }
  const publicScope = ({ workspaceId, ...scope }) => ({ ...scope, nativeAgentLaunch: true });
  async function context(workspaceId, teamId) {
    if (teamId) return publicScope(store.readScope(teamId));
    const scope = verifiedScope(await workspaceRecord(workspaceId));
    const selectionToken = randomUUID();
    if (selections.size >= 128) selections.delete(selections.keys().next().value);
    selections.set(selectionToken, scope);
    return { ...publicScope(scope), selectionToken };
  }
  function validateLaunch(value) {
    if (!value || !/^[a-zA-Z0-9-]{1,120}$/.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.workspaceKey) || !['codex', 'claude'].includes(value.agent) || typeof value.title !== 'string' || !value.title || value.title.length > 160 || typeof value.brief !== 'string' || !value.brief || value.brief.length > 16384) throw new Error('Invalid member launch request.');
    for (const field of ['model', 'effort']) if (value[field] !== undefined && (typeof value[field] !== 'string' || !value[field] || value[field].length > 120)) throw new Error('Invalid model or effort.');
    if (value.effort && !value.model) throw new Error('Effort requires a model.');
  }
  async function start(params, workspaceId) {
    validateLaunch(params);
    const team = store.readSnapshot().teams.find(row => row.id === params.teamId);
    if (!team?.launch) throw new Error('Begin launching a saved team first.');
    const frozen = store.readTeamVersion(team.id, team.launch.configVersion);
    const member = frozen.members.find(row => row.id === params.memberId);
    if (!member) throw new Error('Member does not belong to the saved team.');
    const expected = memberLaunch(frozen, member, team.scope.workspaceKey);
    if (Object.keys(params).length !== Object.keys(expected).length || Object.keys(expected).some(key => params[key] !== expected[key])) throw new Error('Launch input conflicts with the saved role/configuration version.');
    const scope = store.readScope(team.id);
    workspaceId = scope.workspaceId;
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
      if (verifiedScope(workspace).workspaceKey !== scope.workspaceKey) throw new Error('The bound workspace or execution host changed. No new agent was launched.');
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
    async execute({ op, params = {}, workspaceId, internalKey: suppliedKey } = {}) {
      if (op?.startsWith('_')) {
        if (typeof internalKey !== 'string' || typeof suppliedKey !== 'string' || Buffer.byteLength(internalKey) !== Buffer.byteLength(suppliedKey) || !timingSafeEqual(Buffer.from(internalKey), Buffer.from(suppliedKey))) throw Error('Internal host observation authority is required.');
        if (op === '_capabilityScope') {
          const scope = params.teamId ? store.readScope(params.teamId) : selections.get(params.selectionToken);
          if (!scope) throw Error('Confirm a saved team or selected project before reading capabilities.');
          const observationId = randomUUID(); latestObservation.set(scope.workspaceKey, observationId);
          capabilities.delete(scope.workspaceKey);
          const verified = verifiedScope(await workspaceRecord(scope.workspaceId));
          if (verified.workspaceKey !== scope.workspaceKey) throw Error('The bound execution host changed.');
          if (latestObservation.get(scope.workspaceKey) !== observationId) throw Error('Host capability observation was superseded.');
          if (observations.size >= 128) observations.delete(observations.keys().next().value);
          observations.set(observationId, scope);
          return { observationId, scope };
        }
        if (op === '_capabilityResult') {
          const scope = observations.get(params.observationId); observations.delete(params.observationId);
          if (!scope || latestObservation.get(scope.workspaceKey) !== params.observationId || params.value?.workspaceKey !== scope.workspaceKey || params.value?.executionHostId !== scope.executionHostId) throw Error('Host capability observation is stale or does not match its scope.');
          capabilities.set(scope.workspaceKey, params.value);
          return params.value;
        }
        throw Error('Unknown internal observation phase.');
      }
      if (op === 'updateAgentPreferences') {
        const replay = store.replay(op, params); if (replay) return { value: replay };
        const scope = store.readScope(params.teamId);
        if (!params.inherit) {
          const issue = preferenceIssue(params, capabilities.get(scope.workspaceKey));
          if (issue) throw Error(issue);
        }
        return { value: store.updateAgentPreferences(params) };
      }
      if (op === 'context') return context(workspaceId, params.teamId);
      if (op === 'load') return { value: store.readSnapshot() };
      if (op === 'createTeam') {
        const previous = store.replay('createTeam', params);
        if (previous) return { value: previous };
        const selected = selections.get(params.selectionToken);
        if (!selected) throw new Error('Confirm the project and execution host again before saving.');
        const verified = verifiedScope(await workspaceRecord(selected.workspaceId));
        if (verified.workspaceKey !== selected.workspaceKey) throw new Error('The selected execution host changed. Confirm the project again.');
        for (let level = 0; level < 3; level++) {
          const issue = preferenceIssue({ agent: params.form.agents?.[level] ?? 'codex', model: params.form.models?.[level], effort: params.form.efforts?.[level] }, capabilities.get(selected.workspaceKey));
          if (issue) throw Error(issue);
        }
        return { value: store.createTeam(params, selected) };
      }
      if (op === 'updateRole') return { value: store.updateRole(params) };
      if (op === 'updateSettings') return { value: store.updateSettings(params) };
      if (op === 'beginLaunch') {
        const scope = store.readScope(params.teamId), observed = capabilities.get(scope.workspaceKey);
        if (observed) {
          const team = store.readSnapshot().teams.find(row => row.id === params.teamId);
          for (const member of team.members) { const issue = preferenceIssue(member, observed, { requireCore: true }); if (issue) throw Error(issue); }
        }
        return { value: store.beginLaunch(params) };
      }
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
