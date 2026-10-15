import { createQuestionService } from './questions.mjs';
import { createRecoveryService } from './recovery.mjs';
import { createDispatchService } from './dispatch.mjs';
import { createNativeRpc } from './native-runtime.mjs';
import { createWorkService } from './teamwork.mjs';
import { preferenceIssue } from '../capabilities.mjs';
import { timingSafeEqual } from 'node:crypto';
import { createHash, randomUUID } from 'node:crypto';
import { launchInput, nativeLaunchIntent, launchReceipt, publicOperation } from './native-launch.mjs';
import { parseTeamTemplate } from '../templates.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export function createExecutor(host, cli, { store, internalKey, userData, parentPid = process.ppid, nativeRpc } = {}) {
  const consent = () => host.call('storage.get', { key: 'team-work-consent-v1' });
  const rpc = nativeRpc ?? createNativeRpc({ userData, parentPid, consent });
  const works = createWorkService({ store, userData, consent, rpc });
  const questions = createQuestionService({ store, userData, consent, rpc, works, notify: params => host.call('notifications.show', params) });
  const dispatches = createDispatchService({ store, userData, consent, rpc, works, beforeAdmission: id => questions.check(id), onNativeWait: (...args) => questions.nativeWait(...args) });
  const recovery = createRecoveryService({ store, rpc, userData, consent });
  let workTimer, polling = false, stopped = false;
  const scheduleWork = () => { if (!workTimer && !stopped) { workTimer = setTimeout(() => { workTimer = null; void resumeWork(); }, 5000); workTimer.unref?.(); } };
  async function resumeWork() {
    if (polling || stopped) return;
    polling = true;
    try {
      await consent(); await recovery.reconcile();
      if (!store.listWorks().some(work => work.input.state !== 'not_sent' && work.run.state !== 'fenced')) return;
      await consent(); await works.reconcile(); await dispatches.reconcile(); await questions.reconcile(); scheduleWork();
    } catch { stopped = true; }
    finally { polling = false; }
  }
  const selections = new Map();
  const observations = new Map(), capabilities = new Map(), latestObservation = new Map();
  const previews = new Map();
  const launchPlans = new Map();
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
  function savedLaunch(input) {
    launchInput(input);
    const saved = store.readOperation(input.requestId);
    if (saved) {
      if (['teamId', 'memberId', 'configVersion'].some(key => saved[key] !== input[key])) throw Error('Request identity conflicts with an existing launch.');
      return saved;
    }
    return null;
  }
  function plan(operation) {
    if (launchPlans.size >= 128) launchPlans.delete(launchPlans.keys().next().value);
    const phaseId = randomUUID(); launchPlans.set(phaseId, { requestId: operation.requestId, operationId: operation.nativeRequest.operationId });
    return { phaseId, operation };
  }
  const settled = (operation, patch) => {
    const publicValue = publicOperation({ ...operation, ...patch });
    return store.settleOperation(operation.requestId, operation.nativeRequest.operationId, { ...patch, public: publicValue }, operation.version??1);
  };
  return {
    resumeWork,
    stopWork() { stopped = true; clearTimeout(workTimer); workTimer = null; },
    async execute({ op, params = {}, workspaceId, internalKey: suppliedKey } = {}) {
      if (op?.startsWith('_')) {
        if (typeof internalKey !== 'string' || typeof suppliedKey !== 'string' || Buffer.byteLength(internalKey) !== Buffer.byteLength(suppliedKey) || !timingSafeEqual(Buffer.from(internalKey), Buffer.from(suppliedKey))) throw Error('Internal host observation authority is required.');
        if (op === '_launchLookup') {
          const saved = savedLaunch(params.input);
          if (!saved) return null;
          if (params.recover) return { receipt: publicOperation(await recovery.checkOperation(saved.requestId)) };
          return { receipt: publicOperation(saved) };
        }
        if (op === '_launchPrepare') {
          const previous = savedLaunch(params.input);
          if (previous) return { receipt: publicOperation(previous) };
          const input = params.input, team = store.readSnapshot().teams.find(row => row.id === input.teamId);
          const member = team?.members.find(row => row.id === input.memberId);
          if (!member || member.boss || team.configVersion !== input.configVersion) throw Error('Launch requires the current saved highest supervisor configuration.');
          const scope = store.readScope(team.id), observed = capabilities.get(scope.workspaceKey);
          if (!params.observationId || latestObservation.get(scope.workspaceKey) !== params.observationId || !observed || Date.now() - observed.observedAt > 30000) throw Error('Fresh authenticated launch capability admission is required.');
          if (typeof observed.runtimeId !== 'string' || !observed.runtimeId.trim()) throw Error('Native runtime identity is unavailable; no member was reserved.');
          const issue = preferenceIssue(member, observed, { requireCore: true }); if (issue) throw Error(issue);
          if (verifiedScope(await workspaceRecord(scope.workspaceId)).workspaceKey !== scope.workspaceKey) throw Error('The bound workspace or execution host changed.');
          if (latestObservation.get(scope.workspaceKey) !== params.observationId) throw Error('Launch capability admission was superseded.');
          const prepared = store.prepareOperation(input, { scope, nativeRequest: nativeLaunchIntent(team, member, scope), roleVersion: member.roleVersion, title: `${team.name}/${member.name}`, executionHostId: scope.executionHostId, runtimeId: observed.runtimeId, hostGeneration: observed.hostGeneration });
          return prepared.fresh ? plan(prepared.operation) : { receipt: publicOperation(prepared.operation) };
        }
        if (op === '_launchValidate') {
          const phase = launchPlans.get(params.phaseId), saved = phase && store.readOperation(phase.requestId);
          if (!saved || latestObservation.get(saved.scope.workspaceKey) !== params.observationId) throw Error('Launch admission is stale.');
          const observed = capabilities.get(saved.scope.workspaceKey);
          if (!saved.runtimeId || observed?.runtimeId !== saved.runtimeId) throw Error('Native runtime identity changed; the unknown launch remains reserved until its original ledger can be corroborated.');
          const issue = preferenceIssue({ agent: saved.nativeRequest.agent, model: saved.nativeRequest.sessionOptions?.model ?? 'default', effort: saved.nativeRequest.sessionOptions?.effort ?? 'default' }, observed, { requireCore: true });
          if (issue) throw Error(issue);
          if (verifiedScope(await workspaceRecord(saved.scope.workspaceId)).workspaceKey !== saved.scope.workspaceKey) throw Error('The saved execution scope changed before launch.');
          // Commit the may-have-executed boundary before the adapter can call the native effect.
          settled(saved,{effectState:'submitted',recovery:undefined});
          return { valid: true };
        }
        if (op === '_launchSettle' || op === '_launchFollowup') {
          const phase = launchPlans.get(params.phaseId);
          if (!phase) throw Error('Launch phase is stale or was already settled.');
          const operation = store.readOperation(phase.requestId);
          if (operation.nativeRequest.operationId !== phase.operationId) throw Error('Launch phase identity changed.');
          if (op === '_launchSettle') {
            launchPlans.delete(params.phaseId);
            let patch;
            try { if (params.error) throw Error(params.error); patch = launchReceipt(params.result, operation); }
            catch (error) { patch = { status: 'unknown', error: error.message.slice(0, 1200) }; }
            const saved = settled(operation, patch);
            return saved.status === 'created' && store.isActiveOperation(saved) ? { ...plan(saved), receipt: publicOperation(saved) } : { receipt: publicOperation(saved) };
          }
          launchPlans.delete(params.phaseId);
          if (operation.status !== 'created') throw Error('A verified created identity is required.');
          return publicOperation(settled(operation, { ...(params.warning ? { warning: String(params.warning).slice(0, 1200) } : {}), ...(params.observation ? { observation: params.observation } : {}) }));
        }
        if (op === '_memberBinding') {
          if (Object.keys(params).some(key => !['teamId', 'memberId', 'requestId'].includes(key))) throw Error('Invalid member selection.');
          const saved = store.readOperation(params.requestId);
          if (!saved || !store.isActiveOperation(saved) || saved.teamId !== params.teamId || saved.memberId !== params.memberId || saved.status !== 'created') throw Error('A verified saved member binding is required.');
          if (verifiedScope(await workspaceRecord(saved.scope.workspaceId)).workspaceKey !== saved.scope.workspaceKey) throw Error('The saved member execution scope changed.');
          return saved;
        }
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
      if (op === 'submitWork' || op === 'checkWork' || op === 'retryObjective') {
        if (op !== 'submitWork' && (!params || Object.keys(params).some(key => key !== 'workId') || typeof params.workId !== 'string')) throw Error('Choose a saved TeamWork.');
        const work = op === 'submitWork' ? await works.submit(params) : op === 'checkWork' ? await works.check(params.workId) : await works.retry(params.workId);
        await dispatches.check(work.id); await questions.check(work.id); await recovery.checkWork(work.id);
        stopped = false; scheduleWork();
        return { value: store.readSnapshot(), work };
      }
      if (op === 'answerQuestion') return { value: await questions.answer(params) };
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
      if (op === 'load') { await recovery.reconcile(); return { value: store.readSnapshot() }; }
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
      if (op === 'exportTemplate') return { template: store.exportTemplate(params.teamId) };
      if (op === 'previewTemplate') {
        const template = parseTeamTemplate(params.template);
        const previewToken = randomUUID();
        if (previews.size >= 128) previews.delete(previews.keys().next().value);
        previews.set(previewToken, JSON.stringify(template));
        return { template, previewToken };
      }
      if (op === 'importTemplate') {
        const previous = store.replay('importTemplate', params);
        if (previous) return { value: previous };
        const template = parseTeamTemplate(params.template);
        if (previews.get(params.previewToken) !== JSON.stringify(template)) throw new Error('Preview this exact template again before importing.');
        const selected = selections.get(params.selectionToken);
        if (!selected) throw new Error('Confirm the target project and execution host before importing.');
        const verified = verifiedScope(await workspaceRecord(selected.workspaceId));
        if (verified.workspaceKey !== selected.workspaceKey) throw new Error('The selected execution host changed. Confirm the project again.');
        return { value: store.importTemplate(params, selected) };
      }
      if (op === 'updateRole') return { value: store.updateRole(params) };
      if (op === 'updateSettings') return { value: store.updateSettings(params) };
      if (op === 'receipt') return publicOperation(store.readOperation(params.requestId));
      throw new Error('Unknown team operation.');
    }
  };
}
