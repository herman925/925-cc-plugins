import { withNativeRuntime } from './native-runtime.mjs';
import { withOrchestrationSnapshot } from './orchestration-snapshot.mjs';
import { terminalIdentity } from './terminal-identity.mjs';
import { controlRuntime } from './runtime-control.mjs';
import { canonical } from './native-mutation.mjs';
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const terminalControlIdentity = terminal => [
  'handle', 'worktreeId', 'executionHostId', 'connected', 'writable',
  'agentIdentity', 'tabId', 'leafId', 'ptyId', 'incarnationId',
].map(key => terminal[key]);
async function nativeRun(userData, work, operations, settle = (value) => value) {
  return withOrchestrationSnapshot(
    userData,
    {
      pathError: 'The native evidence is outside this Orca profile.',
      schemaError: 'The native evidence format is unsupported.',
    },
    (db) => {
      const run = db
        .prepare(
          'SELECT id,objective,home_database,legacy,consumer_generation,coordinator_handle,coordinator_pane_key,coordinator_orca_session_id,coordinator_orca_session_id_generation FROM runs WHERE id=?',
        )
        .get(work.run.id);
      if (
        !run ||
        run.objective !== work.nativeObjective ||
        run.home_database !== 'this_database' ||
        run.legacy !== 0 ||
        run.consumer_generation !== work.run.consumerGeneration ||
        run.coordinator_handle !== work.instance.handle ||
        run.coordinator_pane_key !== work.instance.paneKey ||
        run.coordinator_orca_session_id
      )
        throw Error('The original native Run owner or generation changed.');
      if (
        db.prepare('SELECT id FROM tasks WHERE run_id=? LIMIT 1').get(run.id) ||
        db.prepare('SELECT id FROM dispatch_contexts WHERE run_id=? LIMIT 1').get(run.id)
      )
        throw Error(
          'This Run has native Task or Dispatch work. Reconnect requires a quiet original Run.',
        );
      for (const op of operations)
        if (
          db
            .prepare(
              "SELECT id FROM dispatch_contexts WHERE assignee_handle=? AND status IN ('pending','dispatched') LIMIT 1",
            )
            .get(op.handle)
        )
          throw Error('A prepared member has an active native assignment.');
      return settle({ ...run });
    },
  );
}
export async function reconnectRuntime({ store, rpc, userData, consent }, input) {
  if (
    !input ||
    Object.keys(input).some(
      (k) => !['requestId', 'workId', 'expectedRevision', 'expectedWorkVersion'].includes(k),
    ) ||
    !/^[A-Za-z0-9-]{1,120}$/.test(input.requestId ?? '') ||
    typeof input.workId !== 'string' ||
    !Number.isSafeInteger(input.expectedRevision) ||
    !Number.isSafeInteger(input.expectedWorkVersion)
  )
    throw Error('Choose the saved work and reload its current team before reconnecting.');
  await consent();
  const prior = store.replayRuntimeReconnect(input);
  if (prior) return store.readCurrentWork(input.workId);
  const before = store.runtimeReconnectSnapshot(input),
    work = before.work,
    initial = await rpc('status.get');
  if (
    typeof initial?.runtimeId !== 'string' ||
    !initial.runtimeId ||
    initial.runtimeId === controlRuntime({ ...work, runtimeControl: before.control })
  )
    throw Error('These sessions already belong to the current Orca runtime.');
  return withNativeRuntime(rpc, initial.runtimeId, async () => {
    const read = async () => {
      await consent();
      const status = await rpc('status.get');
      if (
        status?.runtimeId !== initial.runtimeId ||
        !['orchestration.contract.v1', 'terminal.prompt-delivery.v1'].every((c) =>
          status.capabilities?.includes(c),
        )
      )
        throw Error('Orca changed or the required native contract is unavailable.');
      const project = (
        await rpc('worktree.show', {
          worktree: work.scope.workspaceId.startsWith('folder:')
            ? work.scope.workspaceId
            : `id:${work.scope.workspaceId}`,
        })
      )?.worktree;
      if (
        project?.id !== work.scope.workspaceId ||
        (project.hostId ?? project.identity?.executionHostId) !== 'local'
      )
        throw Error('The saved project or local host changed.');
      const members = [];
      for (const op of before.operations) {
        const shown = (await rpc('terminal.show', { terminal: op.handle }))?.terminal;
        if (
          shown?.handle !== op.handle ||
          shown.worktreeId !== work.scope.workspaceId ||
          shown.executionHostId !== 'local' ||
          shown.connected !== true ||
          shown.writable !== true ||
          shown.agentIdentity !== op.nativeRequest.agent ||
          `${shown.tabId}:${shown.leafId}` !== op.paneKey ||
          /placeholder/.test(`${shown.tabId}:${shown.leafId}`) ||
          !same(terminalIdentity(shown), {
            ptyId: op.observation.ptyId,
            incarnationId: op.observation.incarnationId,
            processIncarnation: op.observation.processIncarnation,
          })
        )
          throw Error(
            'An original prepared session changed or is not connected. No session was replaced.',
          );
        if (
          op.requestId === work.binding.requestId &&
          !same(
            {
              kind: 'terminal',
              handle: shown.handle,
              paneKey: op.paneKey,
              ...terminalIdentity(shown),
            },
            work.instance,
          )
        )
          throw Error('The original supervisor execution identity changed.');
        const activity = (await rpc('terminal.agentStatus', { terminal: op.handle }))?.agentStatus;
        if (
          activity?.handle !== op.handle ||
          activity.isRunningAgent !== true ||
          !['idle', null].includes(activity.status)
        )
          throw Error(
            'A prepared agent is busy, waiting for permission, or has no verified idle status. Finish its current turn before reconnecting.',
          );
        const wait = (
          await rpc('terminal.wait', { terminal: op.handle, for: 'tui-idle', timeoutMs: 1000 })
        )?.wait;
        if (
          wait?.handle !== op.handle ||
          wait.condition !== 'tui-idle' ||
          wait.satisfied !== true ||
          wait.status !== 'running' ||
          wait.blockedReason ||
          wait.exitCode !== null
        )
          throw Error(
            'The native idle check did not confirm this exact agent is ready. Keep its session and finish the pending turn or permission prompt.',
          );
        const after = (await rpc('terminal.show', { terminal: op.handle }))?.terminal,
          afterActivity = (await rpc('terminal.agentStatus', { terminal: op.handle }))?.agentStatus;
        if (
          !after ||
          !same(terminalControlIdentity(shown), terminalControlIdentity(after)) ||
          afterActivity?.handle !== op.handle ||
          afterActivity.isRunningAgent !== true ||
          !['idle', null].includes(afterActivity.status)
        )
          throw Error('The original agent changed or became busy during its idle check.');
        members.push({
          requestId: op.requestId,
          memberId: op.memberId,
          handle: shown.handle,
          paneKey: op.paneKey,
          ...terminalIdentity(shown),
          agent: shown.agentIdentity,
          activity: 'native-tui-idle',
          idleEvidence: {
            condition: wait.condition,
            satisfied: wait.satisfied,
            status: wait.status,
          },
        });
      }
      const run = await nativeRun(userData, work, before.operations),
        shown = (await rpc('orchestration.runShow', { id: work.run.id }))?.run;
      if (
        shown?.id !== run.id ||
        shown.objective !== run.objective ||
        shown.consumer_generation !== run.consumer_generation
      )
        throw Error('Native Run changed during reconnect.');
      const tasks = await rpc('orchestration.taskList', { run: work.run.id, brief: true });
      if (!Array.isArray(tasks?.tasks) || tasks.tasks.length)
        throw Error('Native Task work appeared during reconnect.');
      return { runtimeId: status.runtimeId, run, members };
    };
    const first = await read(),
      second = await read();
    if (!same(first, second))
      throw Error('Native identities changed during reconnect. No control binding was changed.');
    // Re-read database authority after the final remote observation. The commit
    // then performs a synchronous local CAS; it never sends or creates anything.
    await consent();
    if ((await rpc('status.get'))?.runtimeId !== initial.runtimeId)
      throw Error('Orca restarted again during reconnect.');
    await nativeRun(userData, work, before.operations, (run) => {
      if (!same(second.run, run)) throw Error('Native Run changed before reconnect settlement.');
      store.commitRuntimeReconnect(input, before, { ...second, reads: 2 });
    });
    return store.readCurrentWork(work.id);
  });
}
