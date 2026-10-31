import { createKeyedSerializer } from './keyed-serializer.mjs';
import { projectRoot, syncProjectRoles } from './project-roles.mjs';
import {createRosterStatusService} from './roster-status.mjs';
import {requiredDispatchDepth} from './dispatch-depth.mjs';
import {createClaudeStatuslineSettings} from './claude-statusline-settings.mjs';
import {createStaffingService} from './staffing.mjs';
import {createHierarchyService} from './hierarchy.mjs';
import {createWakeService} from './wake.mjs';
import {createStopService} from './stop.mjs';
import { createLifecycleService } from './lifecycle.mjs';
import { createQuestionService } from './questions.mjs';
import { initialMembers } from '../launch.mjs';
import { createRecoveryService } from './recovery.mjs';
import { createDispatchService } from './dispatch.mjs';
import { createNativeRpc } from './native-runtime.mjs';
import { createWorkService } from './teamwork.mjs';
import { preferenceIssue, sessionIssue } from '../capabilities.mjs';
import { timingSafeEqual } from 'node:crypto';
import { createHash, randomUUID } from 'node:crypto';
import { launchInput, nativeLaunchIntent, launchReceipt, publicOperation } from './native-launch.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
export function createExecutor(host, cli, { store, openStore, internalKey, userData, parentPid = process.ppid, nativeRpc, claudeContextOptions } = {}) {
  const consent = () => host.call('storage.get', { key: 'team-work-consent-v1' });
  const rpc = nativeRpc ?? createNativeRpc({ userData, parentPid, consent });
  const claudeContext=createClaudeStatuslineSettings({userData,consent,...claudeContextOptions});
  // A project-owned store is opened for the project the request names. Every service below captures `store`, which is
  // this proxy, so no service call site changes when the store underneath them does.
  let currentProject = '';
  const openedStores = new Map();
  if (openStore) {
    store = new Proxy({}, {
      get(_target, prop) {
        if (!currentProject) throw new Error('No project is selected, so team storage is unavailable for this call.');
        const real = openedStores.get(currentProject);
        if (!real) throw new Error('Team storage for the selected project is not open.');
        const value = Reflect.get(real, prop);
        // store.mjs uses `this` (effectiveTeamForWork, assertAdmission), so a copied reference would lose it
        return typeof value === 'function' ? value.bind(real) : value;
      },
    });
  }
  // Which project this worker serves, decided once per request. Phase 1 refuses a second project rather than serving two.
  async function selectProject(workspaceId) {
    if (!openStore) return;
    const workspace = await workspaceRecord(workspaceId);
    const scope = verifiedScope(workspace);
    if (scope.executionHostId !== 'local') throw new Error('This project runs on another machine, and teams on another machine are not supported in this release.');
    // the workspace record carries the folder Orca verified; the scope carries the identity, not the path
    const path = typeof workspace.path === 'string' ? workspace.path : '';
    if (!path) throw new Error('This project has no folder on this machine, so team storage is unavailable here.');
    if (currentProject && currentProject !== path) throw new Error('This worker is serving another project. Restart the plugin worker to switch projects.');
    if (currentProject) return;
    currentProject = path;
  }
  // Opening is separate from selecting: merely looking at a project must not write a folder into it (row 3).
  async function ensureStore() {
    if (!openStore || !currentProject || openedStores.has(currentProject)) return;
    openedStores.set(currentProject, await openStore(currentProject));
  }
  // The guard's identity file belongs to the project store, so it is written only once a project is selected.
  const rosterStatus=createRosterStatusService({store,rpc,consent,userData,claudeContext,projectRoot:()=>currentProject,log:message=>console.error(`[team-orchestrator] ${message}`)});
  const works = createWorkService({ store, userData, consent, rpc });
  const staffing=createStaffingService({store,userData,consent,rpc,works,notify:params=>host.call('notifications.show',params)});
  const questions = createQuestionService({ store, userData, consent, rpc, works, notify: params => host.call('notifications.show', params) });
  const dispatches = createDispatchService({ store, userData, consent, rpc, works, beforeAdmission: async id => { await questions.check(id); await syncTeamRoles(store.readWork(id).teamId); }, onNativeWait: (...args) => questions.nativeWait(...args), onClosedMember: input => wake.wake(input) });
  const hierarchy=createHierarchyService({store,userData,works});
  const stops = createStopService({store,rpc,userData,consent});
  const lifecycle = createLifecycleService({store,rpc,userData,consent,works,notify:params=>host.call('notifications.show',params)});
  const launchPlans = new Map();
  const recovery = createRecoveryService({ store, rpc, userData, consent,
    isOperationInFlight:requestId=>store.readOperation(requestId)?.effectState==='intent' && [...launchPlans.values()].some(phase=>phase.requestId===requestId) });
  const wake = createWakeService({store,rpc,userData,consent,works,notify:params=>host.call('notifications.show',params)});
  let workTimer, polling = false, stopped = false, reconnecting = false;
  const reconcileExisting=async()=>{await recovery.reconcile();await stops.reconcile();};
  const scheduleWork = () => { if (!workTimer && !stopped) { workTimer = setTimeout(() => { workTimer = null; void resumeWork(); }, 5000); workTimer.unref?.(); } };
  async function resumeWork() {
    if (polling || stopped || reconnecting) return;
    // the round runs on a timer, with no request and so no project: it serves the project last selected, and does
    // nothing at all before one is. It must never open a store of its own.
    if (openStore && !currentProject) { scheduleWork(); return; }
    polling = true;
    try {
      await consent(); await recovery.reconcile(); await stops.reconcile();for(const row of store.listWakes()){await wake.check(row.requestId);await wake.bind(row.requestId);}
      for (const team of store.readSnapshot().teams.filter(t=>t.launch)) await syncTeamRoles(team.id);
      for(const team of store.readSnapshot().teams.filter(t=>t.launch&&t.configuration.sessionMode!==false))try{await works.ensureSession(team.id);}catch{}
      if (!store.listCurrentWorks().some(work => work.status!=='completed' && (work.recoveryRequestId||work.input.state !== 'not_sent') && work.run.state !== 'fenced')) {if(store.readSnapshot().teams.some(t=>t.launch&&t.configuration.sessionMode!==false))scheduleWork();return;}
      await consent(); await works.reconcile(); await dispatches.reconcile(); await hierarchy.reconcile(); await dispatches.reconcile(); await questions.reconcile(); await staffing.reconcile(); await lifecycle.reconcile(); scheduleWork();
    } catch { stopped = true; }
    finally { polling = false; }
  }
  const selections = new Map();
  const observations = new Map(), capabilities = new Map(), latestObservation = new Map();
  async function workspaceRecord(workspaceId) {
    if (typeof workspaceId !== 'string' || !workspaceId || workspaceId.length > 4096) throw new Error('No verified desktop workspace selection.');
    const selector = workspaceId.startsWith('folder:') ? workspaceId : `id:${workspaceId}`;
    const result = await cli(['worktree', 'show', '--worktree', selector]);
    const workspace = result?.worktree;
    if (!workspace?.id || workspace.id !== workspaceId) throw new Error('Open the intended workspace first; Orca returned no active workspace identity.');
    if (workspace.id.startsWith('folder:')) return { ...workspace, kind: 'folder' };
    if (typeof workspace.repoId !== 'string' || !workspace.repoId || workspace.repoId.length > 4096) throw new Error('Orca did not verify the workspace repository identity.');
    const { repo } = await cli(['repo', 'show', '--repo', `id:${workspace.repoId}`]) ?? {};
    if (!repo || repo.id !== workspace.repoId) throw new Error('Orca returned a mismatching workspace repository identity.');
    if (repo.kind !== undefined && repo.kind !== 'git' && repo.kind !== 'folder') throw new Error('Orca returned an unsupported repository kind.');
    // Both pinned hosts normalize legacy records without kind to Git (shared/repo-kind.ts).
    return { ...workspace, kind: repo.kind ?? 'git' };
  }
  function verifiedScope(workspace) {
    const executionHostId = workspace.hostId ?? workspace.identity?.executionHostId;
    if (typeof executionHostId !== 'string' || !/^(local|ssh:[^\s|]+)$/.test(executionHostId)) throw new Error('Orca did not verify a supported local or SSH execution host for this workspace.');
    return { workspaceId: workspace.id, executionHostId, kind: workspace.kind, displayName: workspace.displayName || workspace.branch || 'Workspace', branch: workspace.branch || '', workspaceKey: hash(JSON.stringify([workspace.id, executionHostId])) };
  }
  const serializeRoleSync = createKeyedSerializer();
  async function syncTeamRoles(teamId) { return serializeRoleSync(teamId, async () => {
    const team = store.readSnapshot().teams.find(row => row.id === teamId);
    if (team?.configuration.projectRoleFiles !== 1) return;
    const scope = store.readScope(teamId), workspace = await workspaceRecord(scope.workspaceId);
    await syncProjectRoles(team, await projectRoot(workspace, scope));
    if (store.readSnapshot().teams.find(row => row.id === teamId)?.configVersion !== team.configVersion) throw Error('Team configuration changed while generating role files; retry before launching.');
  }); }
  const publicScope = ({ workspaceId, projectPath, ...scope }) => ({ ...scope, nativeAgentLaunch: true });
  async function context(workspaceId, teamId) {
    if (teamId) {
      // a team belongs to the project already open; without one there is no store to read its scope from
      // after a worker restart there is no workspace id in this call, and searching every project store is circular
      if (openStore && !currentProject) throw new Error('Select the project again to reopen its team.');
      return publicScope(store.readScope(teamId));
    }
    if (workspaceId) await selectProject(workspaceId);
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
      if (op?.startsWith('_') && !(typeof internalKey === 'string' && typeof suppliedKey === 'string' && Buffer.byteLength(internalKey) === Buffer.byteLength(suppliedKey) && timingSafeEqual(Buffer.from(internalKey), Buffer.from(suppliedKey)))) throw Error('Internal host observation authority is required.');
      if (workspaceId) await selectProject(workspaceId);
      // the panel's own context call must never create a store, so it is the one op that does not open one
      if (op !== 'context') await ensureStore();
      if (op?.startsWith('_')) {
        if(op==='_teamDepth'){
          if(Object.keys(params).some(key=>!['teamId','configVersion','memberId','observationId'].includes(key)))throw Error('Invalid team depth selection.');
          const team=store.readSnapshot().teams.find(row=>row.id===params.teamId);
          if(!team||team.configVersion!==params.configVersion)throw Error('The saved team configuration changed. Refresh before checking dispatch depth.');
          if(params.memberId&&!initialMembers(team).some(member=>member.id===params.memberId))throw Error('Dispatch depth requires a saved roster preparation member.');
          const scope=store.readScope(team.id);
          if(params.memberId){
            const observed=capabilities.get(scope.workspaceKey),member=team.members.find(row=>row.id===params.memberId);
            if(!params.observationId||latestObservation.get(scope.workspaceKey)!==params.observationId||!observed||Date.now()-observed.observedAt>30000)throw Error('Fresh launch admission is required before configuring dispatch depth.');
            if(team.configuration.sessionMode===true){const issue=sessionIssue(observed);if(issue)throw Error(issue);}
            const issue=preferenceIssue(member,observed,{requireCore:true});if(issue)throw Error(issue);
          }
          await consent();
          if(verifiedScope(await workspaceRecord(scope.workspaceId)).workspaceKey!==scope.workspaceKey)throw Error('The saved team execution host changed.');
          return {teamId:team.id,configVersion:team.configVersion,scope,requiredDepth:requiredDispatchDepth(team.members)};
        }
        if(op==='_staffingTarget'){
          const prior=store.readStaffingRequest(params);if(prior)return {staffing:prior};
          const work=store.readWork(params.workId);if(!work||work.status==='completed')throw Error('TeamWork is closed or unavailable.');
          return {teamId:work.teamId};
        }
        if(op==='_saveStaffing'){
          await consent();const previous=store.readStaffingRequest(params);
          if(previous)return {staffing:previous,value:store.readSnapshot()};
          const work=store.readWork(params.workId);if(!work||work.status==='completed')throw Error('TeamWork is closed or unavailable.');
          const member=params.member??store.listStaffingProposals(work.id).find(p=>p.id===params.proposalId)?.member;
          if(params.decision!=='reject'){const issue=preferenceIssue(member??{},capabilities.get(work.scope.workspaceKey));if(issue)throw Error(issue);}
          const result=store.saveStaffing(params);await staffing.check(work.id);stopped=false;scheduleWork();
          return {staffing:result,value:store.readSnapshot()};
        }
        if(op==='_wakeFreshPrepare'){
          const row=store.readWake(params.input.requestId);if(!row||row.teamId!==params.input.teamId)throw Error('Saved handoff recovery not found.');
          const observed=capabilities.get(row.oldBinding.scope.workspaceKey),member=store.readSnapshot().teams.find(t=>t.id===row.teamId)?.members.find(m=>m.id===row.memberId);
          if(latestObservation.get(row.oldBinding.scope.workspaceKey)!==params.observationId||!observed||Date.now()-observed.observedAt>30000||observed.runtimeId!==row.proof.runtimeId)throw Error('Fresh authenticated recovery capability admission is required.');
          const issue=preferenceIssue(member,observed,{requireCore:true});if(issue)throw Error(issue);
          await syncTeamRoles(row.teamId);const result=await wake.prepareFresh(row.requestId);return result.fresh?plan(result.operation):{receipt:publicOperation(result.operation)};
        }
        if (op === '_stopPrepare') { await reconcileExisting(); return stops.prepare(params); }
        if (op === '_stopRecover') return stops.recover(params);
        if (op === '_stopValidate') return stops.validate(params.requestId);
        if (op === '_stopSettle') return stops.settle(params.requestId,params.receipt,params.error);
        if(op==='_decideWork'){
          await reconcileExisting();
          if(!store.readWorkDecision(params.requestId))await questions.check(params.workId);
          const decision=await lifecycle.decide(params);return {value:store.readSnapshot(),decision,teamId:store.readWork(params.workId).teamId};
        }
        if(op==='_nextGoal'){
          const goal=params.goalId?store.nextGoal(params.teamId):store.reserveNextGoal(params.teamId);if(!goal||params.goalId&&goal.id!==params.goalId)return {value:store.readSnapshot()};
          const team=store.readSnapshot().teams.find(t=>t.id===params.teamId);
          if(team?.configVersion!==goal.configVersion)throw Error('Queued transition configuration changed.');
          const pending=Object.entries(goal.launchRequests).find(([memberId,id])=>store.readOperation(id)?.status!=='created');
          return {goalId:goal.id,...(pending?{launch:{teamId:team.id,memberId:pending[0],requestId:pending[1],configVersion:goal.configVersion}}:{ready:true})};
        }
        if(op==='_startQueuedWork'){
          await reconcileExisting();
          const goal=store.nextGoal(params.teamId);if(!goal||params.goalId&&goal.id!==params.goalId)return {value:store.readSnapshot()};
          const work=await works.submit({teamId:params.teamId,requestId:goal.workRequestId,objective:goal.objective,expectedRevision:store.readSnapshot().revision});
          await dispatches.check(work.id);stopped=false;scheduleWork();return {value:store.readSnapshot(),work};
        }
        if (op === '_launchLookup') {
          const saved = savedLaunch(params.input);
          if (!saved) return null;
          if (params.recover) return { receipt: publicOperation(await recovery.checkOperation(saved.requestId)) };
          return { receipt: publicOperation(saved) };
        }
        if (op === '_launchPrepare') {
          await reconcileExisting();
          const previous = savedLaunch(params.input);
          if (previous) return { receipt: publicOperation(previous) };
          const input = params.input, team = store.readSnapshot().teams.find(row => row.id === input.teamId);
          const member = team?.members.find(row => row.id === input.memberId);
          if (!member || !initialMembers(team).some(row => row.id === member.id) || team.configVersion !== input.configVersion) throw Error('Launch requires a member selected by the saved roster preparation mode.');
          const scope = store.readScope(team.id), observed = capabilities.get(scope.workspaceKey);
          if (!params.observationId || latestObservation.get(scope.workspaceKey) !== params.observationId || !observed || Date.now() - observed.observedAt > 30000) throw Error('Fresh authenticated launch capability admission is required.');
          if (typeof observed.runtimeId !== 'string' || !observed.runtimeId.trim()) throw Error('Native runtime identity is unavailable; no member was reserved.');
          if (team.configuration.sessionMode === true) { const issue = sessionIssue(observed); if (issue) throw Error(issue); }
          const issue = preferenceIssue(member, observed, { requireCore: true }); if (issue) throw Error(issue);
          if (verifiedScope(await workspaceRecord(scope.workspaceId)).workspaceKey !== scope.workspaceKey) throw Error('The bound workspace or execution host changed.');
          if (latestObservation.get(scope.workspaceKey) !== params.observationId) throw Error('Launch capability admission was superseded.');
          await syncTeamRoles(team.id);
          const prepared = store.prepareOperation(input, { scope, nativeRequest: nativeLaunchIntent(team, member, scope), roleVersion: member.roleVersion, title: `${team.name}/${member.name}`, executionHostId: scope.executionHostId, runtimeId: observed.runtimeId, hostGeneration: observed.hostGeneration });
          return prepared.fresh ? plan(prepared.operation) : { receipt: publicOperation(prepared.operation) };
        }
        if (op === '_launchValidate') {
          const phase = launchPlans.get(params.phaseId), saved = phase && store.readOperation(phase.requestId);
          if (!saved || latestObservation.get(saved.scope.workspaceKey) !== params.observationId) throw Error('Launch admission is stale.');
          store.assertStaffingPreparation(saved.memberId,saved.requestId);
          const observed = capabilities.get(saved.scope.workspaceKey);
          if (!saved.runtimeId || observed?.runtimeId !== saved.runtimeId) throw Error('Native runtime identity changed; the unknown launch remains reserved until its original ledger can be corroborated.');
          const issue = preferenceIssue({ agent: saved.nativeRequest.agent, model: saved.nativeRequest.sessionOptions?.model ?? 'default', effort: saved.nativeRequest.sessionOptions?.effort ?? 'default' }, observed, { requireCore: true });
          if (issue) throw Error(issue);
          if (verifiedScope(await workspaceRecord(saved.scope.workspaceId)).workspaceKey !== saved.scope.workspaceKey) throw Error('The saved execution scope changed before launch.');
          if(saved.wakeRequestId)await wake.validateFresh(saved.wakeRequestId);
          await syncTeamRoles(saved.teamId);
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
            try {
              if (params.error) throw Error(params.error);
              patch = { ...launchReceipt(params.result, operation), error: undefined };
              // A matching creation receipt supersedes a pre-receipt absence observation.
              // Current consent/identity/liveness failures remain separate recovery evidence.
              if (['intent', 'unknown'].includes(operation.recovery?.state) && !operation.recovery.incomplete) patch.recovery = undefined;
            }
            catch (error) { patch = { status: 'unknown', error: error.message.slice(0, 1200) }; }
            const saved = settled(operation, patch);
            if(saved.status==='created'){stopped=false;scheduleWork();}
            return saved.status === 'created' && store.isActiveOperation(saved) ? { ...plan(saved), receipt: publicOperation(saved) } : { receipt: publicOperation(saved) };
          }
          launchPlans.delete(params.phaseId);
          if (operation.status !== 'created') throw Error('A verified created identity is required.');
          stopped=false;scheduleWork();
          return publicOperation(settled(operation, { ...(params.warning ? { warning: String(params.warning).slice(0, 1200) } : {}), ...(params.observation ? { observation: params.observation } : {}) }));
        }
        if (op === '_memberBinding') {
          if (Object.keys(params).some(key => !['teamId', 'memberId', 'requestId'].includes(key))) throw Error('Invalid member selection.');
          let saved = store.readOperation(params.requestId);
          if(saved&&!store.isActiveOperation(saved))throw Error('A verified saved member binding is required.');
          if(!saved){const attempt=store.readMemberDispatch(params.memberId),b=attempt?.binding;if(attempt?.id!==params.requestId||attempt.teamId!==params.teamId||!b)throw Error('A current member session is required.');saved={...b,requestId:attempt.id,teamId:attempt.teamId,memberId:attempt.memberId,status:'created',sessionId:b.liveSessionId??b.sessionId,scope:attempt.scope,executionHostId:attempt.scope.executionHostId,nativeRequest:{agent:attempt.reuse?.preferences?.agent??attempt.startParams?.agent??store.readTeamVersion(attempt.teamId,attempt.configVersion).members.find(m=>m.id===attempt.memberId)?.agent},observation:b.kind==='terminal'?{processIncarnation:b.incarnationId}:undefined};}
          if(saved.teamId!==params.teamId||saved.memberId!==params.memberId||saved.status!=='created')throw Error('A verified saved member binding is required.');
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
      if(op==='reconnectWork'){
        if(polling||reconnecting)throw Error('A saved evidence check is still running. Wait briefly, then try reconnecting again.');
        reconnecting=true;
        try{const work=await works.reconnect(params);stopped=false;return {value:store.readSnapshot(),work};}
        finally{reconnecting=false;scheduleWork();}
      }
      if (op === 'submitWork' || op === 'checkWork' || op === 'retryObjective') {
        if(op!=='checkWork')await reconcileExisting();
        if (op !== 'submitWork' && (!params || Object.keys(params).some(key => key !== 'workId') || typeof params.workId !== 'string')) throw Error('Choose a saved TeamWork.');
        const work = op === 'submitWork' ? await works.submit(params) : op === 'checkWork' ? await works.check(params.workId) : await works.retry(params.workId);
        await dispatches.check(work.id); await hierarchy.check(work.id); for(const context of store.listRunWorks(work.id))await dispatches.check(context.id); await questions.check(work.id); await staffing.check(work.id); await recovery.checkWork(work.id); await lifecycle.check(work.id).catch(()=>{});
        stopped = false; scheduleWork();
        return { value: store.readSnapshot(), work };
      }
      if(op==='resolveRecoveryQuestion')return {value:await wake.resolveQuestion(params)};
      if(op==='requestReplacement'){await stops.reconcile();return {value:await wake.requestReplacement(params)};}
      if(op==='scheduleOrganization'||op==='cancelOrganization'){await consent();return {value:store[op](params)};}
      if(op==='wakeMember'){await stops.reconcile();return {value:await wake.wake(params)};}
      if(op==='checkWake'){await wake.check(params.requestId);return {value:await wake.bind(params.requestId)};}
      if(op==='decideWake')return {value:await wake.decide(params)};
      if(op==='checkHandoff')return {value:await wake.handoff(params.requestId)};
      if (op === 'setAdmission') { await consent(); await reconcileExisting(); const value=store.setAdmission(params); stopped=false;scheduleWork();return {value}; }
      if (op === 'checkStop') { await stops.check(params.requestId); return {value:store.readSnapshot()}; }
      if (op === 'answerQuestion') { await reconcileExisting(); return { value: await questions.answer(params) }; }
      if(op==='enqueueGoal'){await consent();store.enqueueGoal(params);return {value:store.readSnapshot()};}
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
      if(op==='previewHistoryCleanup')return store.previewHistoryCleanup(params);
      if(op==='applyHistoryCleanup')return {cleanup:store.applyHistoryCleanup(params),value:store.readSnapshot()};
      if(op==='claudeContext'){
        if(Object.keys(params??{}).some(key=>key!=='enabled'))throw Error('Invalid Claude context setting.');
        return Object.hasOwn(params??{},'enabled')?claudeContext.configure(params.enabled):claudeContext.status();
      }
      if(op==='rosterStatus')return {value:store.readSnapshot(),telemetry:await rosterStatus.read()};
      if (op === 'load') { await recovery.reconcile(); await stops.reconcile(); return { value: store.readSnapshot() }; }
      if (op === 'createTeam') {
        const previous = store.replay('createTeam', params);
        if (previous) { await syncTeamRoles(previous.teams.at(-1).id); return { value: previous }; }
        const selected = selections.get(params.selectionToken);
        if (!selected) throw new Error('The detected project expired. Try launching again to read the current project.');
        const workspace = await workspaceRecord(selected.workspaceId);
        const verified = verifiedScope(workspace);
        if (verified.workspaceKey !== selected.workspaceKey) throw new Error('The execution host changed. Try launching again to read the current project.');
        if (params.form.sessionMode === true) {
          const issue = sessionIssue(capabilities.get(selected.workspaceKey));
          if (issue) throw Error(issue);
        }
        for (let level = 0; level < 3; level++) {
          const issue = preferenceIssue({ agent: params.form.agents?.[level] ?? 'codex', model: params.form.models?.[level], effort: params.form.efforts?.[level] }, capabilities.get(selected.workspaceKey));
          if (issue) throw Error(issue);
        }
        const root = await projectRoot(workspace, selected);
        const value = store.createTeam(params, { ...selected, projectPath: root });
        try { await syncTeamRoles(value.teams.at(-1).id); }
        catch (error) { throw Error(`Team saved, but role files could not be prepared: ${error.message} No members were launched. Retry the same creation request to repair files without creating another team.`); }
        return { value };
      }
      if (op === 'updateRole') { const value = store.updateRole(params); await syncTeamRoles(params.teamId); return { value }; }
      if (op === 'updateSettings') return { value: store.updateSettings(params) };
      if (op === 'receipt') return publicOperation(store.readOperation(params.requestId));
      throw new Error('Unknown team operation.');
    }
  };
}
