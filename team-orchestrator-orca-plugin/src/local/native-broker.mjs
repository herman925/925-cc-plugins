import { discoverCapabilities } from './capabilities.mjs';
// Trusted adapter orchestration only; invoke/rpc retain its actual event and authority.
export async function mediateOperation({ op, input, invoke, rpc, authority }) {
  if(op==='decideWork'){
    await authority();const result=await invoke({op:'_decideWork',params:input});
    if(input.decision!=='accept')return {ok:true,value:result};
    return mediateOperation({op:'startNextGoal',input:{teamId:result.teamId},invoke,rpc,authority});
  }
  if(op==='startNextGoal'){
    await authority();const plan=await invoke({op:'_nextGoal',params:input});
    if(!plan.goalId)return {ok:true,value:{value:plan.value}};
    if(plan.launch){
      const launched=await mediateOperation({op:'launchSupervisor',input:plan.launch,invoke,rpc,authority});
      if(launched.value?.status!=='created')return {ok:true,value:{pending:true,detail:'Fresh launch outcome is unknown. Check saved launch evidence before continuing.'}};
      const remaining=await invoke({op:'_nextGoal',params:input});
      if(remaining.launch)return {ok:true,value:{pending:true,continue:true}};
    }
    await authority();return {ok:true,value:await invoke({op:'_startQueuedWork',params:input})};
  }
  if (op === 'openMember') {
    const saved = await invoke({ op: '_memberBinding', params: input });
    if (saved.kind === 'structured') {
      const address = await rpc('orchestration.sessionAddress', { sessionId: saved.sessionId });
      if (typeof address?.orcaSessionId !== 'string') throw Error('Native session address is unavailable.');
      const located = (await rpc('orchestration.partyLocation', { address: address.orcaSessionId }))?.location;
      if (located?.kind !== 'chat' || located.sessionId !== saved.sessionId || located.worktreeId !== saved.scope.workspaceId) throw Error('The saved structured session scope is no longer verified.');
      const opened = await rpc('agentSession.reveal', { sessionId: saved.sessionId });
      if (opened?.ok !== true || opened.sessionId !== saved.sessionId || opened.workspaceId !== saved.scope.workspaceId || opened.agent !== saved.nativeRequest.agent) throw Error('The native session could not be verified in its saved project.');
    } else {
      const shown = (await rpc('terminal.show', { terminal: saved.handle }))?.terminal;
      if (shown?.handle !== saved.handle || shown.worktreeId !== saved.scope.workspaceId || (shown.executionHostId && shown.executionHostId !== saved.scope.executionHostId) || (saved.paneKey && `${shown.tabId}:${shown.leafId}` !== saved.paneKey)) throw Error('The saved terminal identity is no longer verified.');
      await rpc('terminal.focus', { terminal: saved.handle, navigation: 'host' });
    }
    return { ok: true, value: { opened: true } };
  }
  let recovery;
  if (op !== 'capabilities') {
    recovery = await invoke({ op: '_launchLookup', params: { input, recover: op === 'recoverLaunch' } });
    if (recovery?.receipt) return { ok: true, value: recovery.receipt };
    if (op === 'recoverLaunch') throw Error('Saved launch operation was not found; checking cannot start a new session.');
  }
  const prepared = await invoke({ op: '_capabilityScope', params: op === 'capabilities' ? input : { teamId: input.teamId } });
  const value = await discoverCapabilities(rpc, prepared.scope);
  await authority();
  const observed = await invoke({ op: '_capabilityResult', params: { observationId: prepared.observationId, value } });
  if (op === 'capabilities') return { ok: true, value: observed };
  const launch = recovery ?? await invoke({ op: '_launchPrepare', params: { input, observationId: prepared.observationId } });
  if (launch.receipt) return { ok: true, value: launch.receipt };
  let result, error;
  try {
    await invoke({ op: '_launchValidate', params: { phaseId: launch.phaseId, observationId: prepared.observationId } });
    const status = await rpc('status.get');
    if (status?.runtimeId !== observed.runtimeId || !['agent.launch.v2', 'agent.launch.replay-required.v1', 'agent.launch.prompt-carry.v1'].every(capability => status?.capabilities?.includes(capability))) throw Error('Native launch capabilities changed before execution.');
    if (launch.operation.scope.executionHostId.startsWith('ssh:')) {
      const state = (await rpc('ssh.getState', { targetId: decodeURIComponent(launch.operation.scope.executionHostId.slice(4)) }))?.state;
      if (state?.status !== 'connected' || (observed.hostGeneration !== null && state.connectionGeneration !== observed.hostGeneration)) throw Error('The saved execution host disconnected or changed generation.');
    }
    result = await rpc('agent.launchReplay', launch.operation.nativeRequest);
  } catch (failure) { error = `${failure.code ? `${failure.code}: ` : ''}${failure.message}`; }
  // Settlement only records a previously admitted effect; no native follow-up before persistence.
  const settled = await invoke({ op: '_launchSettle', params: { phaseId: launch.phaseId, result, error } });
  if (!settled.operation) return { ok: true, value: settled.receipt };
  const saved = settled.operation;
  let warning = saved.warning, observation = saved.observation;
  try {
    if (saved.kind === 'terminal') {
      const shown = (await rpc('terminal.show', { terminal: saved.handle }))?.terminal;
      if (shown?.handle !== saved.handle || shown.worktreeId !== saved.scope.workspaceId || (saved.paneKey && `${shown.tabId}:${shown.leafId}` !== saved.paneKey)) throw Error('Created terminal could not be corroborated in its saved project.');
      await rpc('terminal.rename', { terminal: saved.handle, title: saved.title });
      const status = (await rpc('terminal.agentStatus', { terminal: saved.handle }))?.agentStatus;
      if (status?.handle === saved.handle && status.isRunningAgent === true) observation = { state: ['working', 'permission', 'idle'].includes(status.status) ? status.status : 'unknown', detail: 'Native terminal agent observation; task readiness is separate.', ...(shown.incarnationId ? { incarnationId: shown.incarnationId } : {}) };
    } else warning = [warning, 'Native structured naming is unavailable; the plugin label is retained. Provider start/login observation is unknown.'].filter(Boolean).join(' ');
  } catch (failure) { warning = [warning, failure.message].filter(Boolean).join(' ').slice(0, 1200); }
  return { ok: true, value: await invoke({ op: '_launchFollowup', params: { phaseId: settled.phaseId, warning, observation } }) };
}
